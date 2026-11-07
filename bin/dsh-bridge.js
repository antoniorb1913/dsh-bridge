#!/usr/bin/env node
/**
 * dsh-bridge — exportar e importar conversaciones de DeepSeek Harness.
 *
 * Este fichero solo orquesta: lee argumentos, pregunta lo justo y llama a los
 * módulos de `src/core`. La lógica vive ahí y está probada aparte.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

import { adjuntosQueFaltan } from "../src/core/attachments.js";
import { tiposConocidos } from "../src/core/compat.js";
import { analizarBundle, importarBundle } from "../src/core/import.js";
import { exportarSesion } from "../src/core/pack.js";
import {
  findAppAsar,
  isAppRunning,
  nombreBase,
  registryPath,
  resolveHome,
  verifySessionDirNames
} from "../src/core/paths.js";
import { leerRegistro, validarRegistro } from "../src/core/registry.js";
import { attachmentHashes, listSessions } from "../src/core/sessions.js";
import { decodeLogBuffer } from "../src/core/zstd.js";
import { elegirArchivo, elegirCarpeta } from "../src/cli/dialogos.js";
import { crearServidor, ipLocal } from "../src/net/servidor.js";
import { enviarSesiones } from "../src/net/cliente.js";
import { crearUiServidor } from "../src/net/ui.js";
import { PUERTO_DESCUBRIR, crearRespondedor, descubrir } from "../src/net/descubrir.js";
import {
  SeleccionError,
  formatearBytes,
  formatearFecha,
  parsearSeleccion,
  recortar,
  tablaSesiones,
  textoAyuda
} from "../src/cli/formato.js";
import { CliError, parsearArgumentos, tiposManuales } from "../src/cli/opciones.js";

const VERSION = "0.2.0";

// Si alguien corta la salida (un `| head`, un `Select-Object -First`), no es un
// error del programa: se termina en silencio y con código 0.
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const escribir = (texto = "") => process.stdout.write(texto + "\n");
const ok = (texto) => escribir("✔ " + texto);
const mal = (texto) => escribir("✖ " + texto);
const aviso = (texto) => escribir("! " + texto);
const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function carpetaEscritorio() {
  const candidatos = [path.join(os.homedir(), "Desktop"), path.join(os.homedir(), "Escritorio"), os.homedir()];
  return candidatos.find((carpeta) => fs.existsSync(carpeta)) ?? os.homedir();
}

function limpiarRuta(entrada) {
  return String(entrada ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1");
}

/** Tipos de evento que entiende el harness de este equipo. */
function leerTipos(opciones) {
  const manual = tiposManuales(opciones);
  if (manual !== undefined) return tiposConocidos({ manual });
  const asar = findAppAsar();
  return tiposConocidos(asar === undefined ? {} : { rutaAsar: asar });
}

//#region comandos

function comandoList(opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const sesiones = listSessions(home, { full: opciones.rapido !== true });
  if (opciones.json === true) {
    escribir(JSON.stringify(sesiones.map(({ text, ...resto }) => resto), null, 2));
    return 0;
  }
  if (sesiones.length === 0) {
    aviso(`no hay conversaciones en ${home}`);
    return 0;
  }
  escribir(tablaSesiones(sesiones));
  escribir("");
  escribir(`${sesiones.length} conversación(es) en ${home}`);
  return 0;
}

async function comandoExport(posicionales, opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const id = posicionales[0];
  if (id === undefined) throw new CliError("indica qué conversación exportar (mira `dsh-bridge list`) o usa el menú");

  const { tipos, origen } = leerTipos(opciones);

  // Sin `-o`: si hay ventanas, se pregunta con el explorador; si no, al Escritorio.
  let destino = limpiarRuta(opciones.salida ?? opciones.o);
  if (destino === "") {
    const elegida = process.stdin.isTTY ? await elegirCarpeta({ titulo: "¿En qué carpeta guardo el ZIP?" }) : undefined;
    destino = elegida ?? carpetaEscritorio();
  }

  const resultado = exportarSesion(home, id, destino, { tiposConocidos: tipos, origenCompat: origen });

  ok(`exportada «${resultado.meta.sesion.titulo ?? resultado.meta.sesion.id}»`);
  escribir(`  fichero   : ${resultado.ruta}`);
  escribir(`  tamaño    : ${formatearBytes(resultado.bytes)}`);
  escribir(`  eventos   : ${resultado.meta.log.eventos}`);
  escribir(`  adjuntos  : ${resultado.meta.adjuntos.length}`);
  escribir(`  tipos     : ${origen}`);
  for (const nota of resultado.avisos) aviso(nota);
  escribir("");
  aviso("el ZIP lleva la conversación sin cifrar: bórralo cuando esté importado");
  return 0;
}

async function comandoImport(posicionales, opciones) {
  const home = resolveHome(opciones["dsh-home"]);

  let archivo = limpiarRuta(posicionales[0]);
  if (archivo === "") {
    const elegido = process.stdin.isTTY ? await elegirArchivo({ titulo: "Elige el ZIP de la conversación" }) : undefined;
    archivo = elegido === undefined ? "" : limpiarRuta(elegido);
  }
  if (archivo === "") throw new CliError("indica el fichero .zip a importar");

  let workspace = opciones.workspace === undefined ? undefined : limpiarRuta(opciones.workspace);
  if (workspace === undefined && process.stdin.isTTY) {
    const carpeta = await elegirCarpeta({ titulo: "¿En qué carpeta del proyecto vivo la conversación?" });
    if (carpeta !== undefined) workspace = limpiarRuta(carpeta);
  }

  const { tipos } = leerTipos(opciones);
  const plan = analizarBundle(archivo, { tiposConocidos: tipos });
  escribir(`bundle     : ${path.basename(archivo)}`);
  escribir(`conversación: ${plan.meta?.sesion?.titulo ?? "(sin título)"}`);
  escribir(`sesión     : ${plan.header.id}`);
  escribir(`eventos    : ${plan.eventos}`);
  escribir(`adjuntos   : ${plan.objetos.size}`);
  escribir(`viene de   : ${plan.header.cwd}`);
  escribir("");
  if (plan.compatibilidad.total > 0) aviso(`se marcarán ${plan.compatibilidad.total} sucesos como ignorables`);

  const resultado = importarBundle(archivo, {
    home,
    workspace,
    title: opciones.titulo,
    forzar: opciones.forzar === true,
    seco: opciones.seco === true,
    tiposConocidos: tipos
  });

  if (resultado.seco === true) {
    ok("en seco: no se ha escrito nada");
    escribir(`  instalaría en : ${resultado.rutaLog}`);
    escribir(`  workspace     : ${resultado.workspace}`);
    escribir(`  reemplaza     : ${resultado.reemplaza ? "sí" : "no"}`);
    escribir(`  adjuntos      : ${resultado.adjuntos.porCopiar}`);
  } else {
    ok(`importada en ${resultado.workspace}`);
    escribir(`  log        : ${resultado.rutaLog}`);
    escribir(`  eventos    : ${resultado.eventos}`);
    escribir(`  adjuntos   : ${resultado.adjuntos.copiados} copiados, ${resultado.adjuntos.yaExistian} ya estaban`);
    escribir(`  workspace  : ${resultado.registro.workspaceId.slice(0, 8)}… (${resultado.registro.creado ? "creado" : "existente"})`);
    if (resultado.registro.copia !== undefined) escribir(`  copia      : ${resultado.registro.copia}`);
  }
  for (const nota of resultado.avisos) aviso(nota);
  return 0;
}

function comandoDoctor(opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const problemas = [];
  const lineas = [];

  lineas.push(`datos de DSH : ${home}`);
  lineas.push(`app abierta  : ${isAppRunning() ? "sí (ciérrala para importar)" : "no"}`);

  const asar = findAppAsar();
  if (asar === undefined) {
    lineas.push("app.asar     : no encontrado (se usará la tabla de tipos de respaldo)");
  } else {
    const { tipos, origen } = leerTipos(opciones);
    lineas.push(`app.asar     : ${asar}`);
    lineas.push(`tipos evento : ${tipos.size} (${origen})`);
    if (origen !== "asar") aviso("no he podido leer los tipos del app.asar; se usa la tabla de respaldo");
  }

  const sesiones = listSessions(home, { full: true });
  const danadas = sesiones.filter((sesion) => sesion.broken !== undefined);
  lineas.push(`sesiones     : ${sesiones.length}${danadas.length > 0 ? ` (${danadas.length} con el log dañado)` : ""}`);
  if (danadas.length > 0) problemas.push(`${danadas.length} log(s) dañado(s)`);

  const { checked, mismatches } = verifySessionDirNames(home);
  lineas.push(`carpetas     : ${checked.length} comprobadas, ${mismatches.length} en carpeta que no toca`);
  if (mismatches.length > 0) problemas.push(`${mismatches.length} sesión(es) en la carpeta equivocada`);

  let registro;
  try {
    registro = leerRegistro(home);
  } catch (error) {
    problemas.push("el registro de workspaces no se puede leer");
    lineas.push(`registro     : ✖ ${error instanceof Error ? error.message : String(error)}`);
    registro = undefined;
  }
  if (registro !== undefined) {
    const fallos = validarRegistro(registro.registro);
    lineas.push(`registro     : ${registro.existe ? registryPath(home) : "(todavía no existe)"}`);
    lineas.push(`workspaces   : ${registro.registro.global.workspaceIds.length}, ${fallos.length} problema(s)`);
    if (fallos.length > 0) {
      problemas.push("el registro tiene incoherencias (la app podría no arrancar)");
      for (const fallo of fallos) lineas.push(`  - ${fallo}`);
    }
  }

  const muestra = sesiones.filter((sesion) => (sesion.attachments ?? 0) > 0).slice(0, 5);
  let faltan = 0;
  for (const sesion of muestra) {
    try {
      const hashes = attachmentHashes(decodeLogBuffer(fs.readFileSync(sesion.logPath)));
      faltan += adjuntosQueFaltan(home, hashes).length;
    } catch {
      /* un log dañado ya se ha contado arriba */
    }
  }
  lineas.push(`adjuntos     : ${muestra.length} sesión(es) revisadas, ${faltan} referencia(s) sin fichero`);
  if (faltan > 0) aviso("faltan adjuntos en el almacén: se exportarán avisando de ello");

  for (const linea of lineas) escribir(linea);
  escribir("");
  if (problemas.length === 0) {
    ok("todo en orden");
  } else {
    for (const problema of problemas) mal(problema);
  }
  return problemas.length === 0 ? 0 : 1;
}

/**
 * ¿Hay ya un `dsh-bridge serve` contestando en ese puerto de este equipo?
 */
async function hayReceptorPropio(puerto) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 800);
  try {
    const respuesta = await fetch(`http://127.0.0.1:${puerto}/estado`, { signal: control.signal });
    const datos = await respuesta.json();
    return datos !== null && typeof datos === "object" && datos.app === "dsh-bridge";
  } catch {
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Se queda escuchando para que otro equipo se empareje y envíe una conversación.
 * El código se enseña una vez, caduca y solo sirve una vez.
 */
async function comandoServe(opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const puerto = opciones.puerto === undefined ? 8787 : Number(opciones.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new CliError(`puerto no válido: ${opciones.puerto}`);

  const { tipos } = leerTipos(opciones);
  const host = opciones.red === true ? "0.0.0.0" : "127.0.0.1";
  const workspace = opciones.workspace === undefined ? undefined : limpiarRuta(opciones.workspace);
  if (workspace !== undefined) {
    try {
      fs.statSync(workspace);
    } catch {
      throw new CliError(`la carpeta de destino no existe: ${workspace}`);
    }
  }

  let maxBytes;
  if (opciones.max !== undefined) {
    const maxMB = Number(opciones.max);
    if (!Number.isFinite(maxMB) || maxMB <= 0) throw new CliError(`--max debe ser un número de MB mayor que 0: ${opciones.max}`);
    maxBytes = Math.round(maxMB * 1024 * 1024);
  }

  // Ya hay un `serve` nuestro en el puerto por defecto: en vez de abrir otro
  // (que se pisarían en el anuncio), se avisa y se sale.
  if (opciones.puerto === undefined && (await hayReceptorPropio(puerto))) {
    aviso(`ya hay un dsh-bridge recibiendo en http://127.0.0.1:${puerto}`);
    escribir("mira esa ventana: el código está ahí. Si de verdad quieres abrir otro, usa --puerto 8788");
    return 0;
  }

  // Destino de lo que llega, sin preguntar nada (salvo `--preguntar`):
  //   1. Si esa conversación ya está en este equipo, se actualiza donde está.
  //   2. Si no, a la carpeta del proyecto del emisor (la misma ruta si existe).
  //   3. Y si esa carpeta no existe, se crea con su nombre en Documents\recibidas.
  const preguntarDestino = opciones.preguntar === true && process.stdin.isTTY;
  const baseRecepcion = path.join(os.homedir(), "Documents", "recibidas");
  let ultimaElegida = workspace;

  const resolverDestino = async (zip) => {
    let plan;
    try {
      plan = analizarBundle(zip, { tiposConocidos: tipos });
    } catch {
      plan = undefined;
    }
    const id = plan?.header?.id;
    const proyectoEmisor = plan?.header?.cwd;

    if (preguntarDestino) {
      escribir("");
      aviso("llega una conversación: elige la carpeta del proyecto (puedes crear una nueva)");
      const elegida = await elegirCarpeta({
        titulo: "¿En qué carpeta guardo la conversación que llega?",
        carpetaInicial: ultimaElegida ?? baseRecepcion
      });
      if (elegida !== undefined) {
        ultimaElegida = elegida;
        escribir(`  destino: ${elegida}`);
        return elegida;
      }
      aviso("no elegiste carpeta: la guardo donde corresponda");
    }

    // 1. ¿Ya la tengo? Se actualiza en su sitio, con copia del anterior.
    if (typeof id === "string") {
      try {
        const existente = listSessions(home, { full: false }).find((sesion) => sesion.id === id);
        if (existente?.cwd) {
          escribir(`  destino: ${existente.cwd}  (ya la tenías: se actualiza)`);
          return existente.cwd;
        }
      } catch {
        // Sin poder leer el almacén se sigue con la carpeta del emisor.
      }
    }

    // 2. La carpeta del emisor tal cual, si en este equipo existe esa ruta.
    if (typeof proyectoEmisor === "string" && proyectoEmisor !== "") {
      try {
        if (fs.statSync(proyectoEmisor).isDirectory()) {
          escribir(`  destino: ${proyectoEmisor}  (la carpeta del proyecto del otro equipo)`);
          return proyectoEmisor;
        }
      } catch {
        // Esa ruta no existe aquí: se crea más abajo con el mismo nombre.
      }
    }

    // 3. Se crea con el nombre del proyecto del emisor.
    const nombre = nombreBase(proyectoEmisor ?? "") || "recibidas";
    const destino = path.join(baseRecepcion, nombre);
    fs.mkdirSync(destino, { recursive: true });
    escribir(`  destino: ${destino}  (carpeta nueva)`);
    return destino;
  };

  const opcionesServidor = {
    home,
    host,
    codigo: opciones.codigo,
    workspace,
    // Una conversación recibida siempre reemplaza a la que hubiera: la que viaja
    // es la buena. El importador guarda copia de la anterior al hacerlo.
    forzar: true,
    tiposConocidos: tipos,
    maxBytes,
    elegirDestino: workspace === undefined || opciones.preguntar === true ? resolverDestino : undefined,
    alRecibir: (resultado) => {
      escribir("");
      ok(`${resultado.reemplaza === true ? "actualizada" : "recibida"} «${resultado.titulo ?? resultado.sesionId}»`);
      escribir(`  eventos   : ${resultado.eventos}`);
      escribir(`  adjuntos  : ${resultado.adjuntos.copiados} copiados, ${resultado.adjuntos.yaExistian} ya estaban`);
      escribir(`  queda en  : ${resultado.workspace}`);
      for (const nota of resultado.avisos ?? []) aviso(nota);
      escribir("  Ctrl+C para parar.");
      escribir("");
    }
  };

  // Si el puerto está ocupado por otro `serve`, se prueba el siguiente. Solo
  // con los puertos por defecto: si el usuario pidió uno, se respeta y se avisa.
  let servidor;
  let puertoReal;
  if (opciones.puerto === undefined) {
    let ultimoError;
    for (let intento = puerto; intento < puerto + 10; intento += 1) {
      const candidato = crearServidor({ ...opcionesServidor, puerto: intento });
      try {
        puertoReal = await candidato.iniciar();
        servidor = candidato;
        if (intento !== puerto) aviso(`el puerto ${puerto} estaba ocupado (¿otro «serve» abierto?): uso el ${intento}`);
        break;
      } catch (error) {
        ultimoError = error;
        if (!/EADDRINUSE|EACCES/.test(error.message)) throw error;
      }
    }
    if (servidor === undefined) {
      throw new CliError(
        `no he encontrado ningún puerto libre entre el ${puerto} y el ${puerto + 9}: cierra el otro «dsh-bridge serve» o indica --puerto. ` +
          `(${ultimoError instanceof Error ? ultimoError.message : "sin detalle"})`
      );
    }
  } else {
    servidor = crearServidor({ ...opcionesServidor, puerto });
    puertoReal = await servidor.iniciar();
  }

  const datos = servidor.datos;
  const ip = host === "0.0.0.0" ? ipLocal() ?? "127.0.0.1" : "127.0.0.1";

  // Solo se anuncia en la red si está abierto a la red: si escucha en localhost,
  // nadie de fuera podría llegar y anunciarse sería ruido (o una pista falsa).
  let respondedor;
  if (host === "0.0.0.0") {
    respondedor = crearRespondedor({ tcpPuerto: puertoReal, estado: () => servidor.estado });
    try {
      await respondedor.iniciar();
    } catch {
      respondedor = undefined;
      aviso("no he podido abrir el anuncio de descubrimiento (UDP 8788): se puede seguir usando con --ip");
    }
  }

  escribir("");
  escribir("  dsh-bridge · recibiendo conversaciones");
  escribir("  " + "─".repeat(58));
  escribir(`  Dirección : http://${ip}:${puertoReal}`);
  escribir(`  Código    : ${datos.codigo}   (un solo uso, caduca ${formatearFecha(datos.expira)})`);
  escribir(
    `  Destino   : ${
      preguntarDestino
        ? "te lo preguntaré al recibir (con «Nueva carpeta»)"
        : (workspace ?? "la carpeta del proyecto del otro equipo; si ya la tienes, se actualiza ahí")
    }`
  );
  escribir(`  Límite    : ${formatearBytes(maxBytes ?? 2 * 1024 * 1024 * 1024)} por bundle`);
  escribir(`  En la red : ${respondedor === undefined ? "solo por IP" : `se anuncia como «${respondedor.datos.nombre}» (UDP ${PUERTO_DESCUBRIR})`}`);
  escribir("");
  escribir("  En el otro equipo:");
  escribir("    dsh-bridge discover            (lo encuentra solo)");
  escribir(`    dsh-bridge send --ip ${ip} --puerto ${puertoReal} --codigo ${datos.codigo} --sesion <id>`);
  escribir("");
  if (host === "0.0.0.0") {
    aviso("escuchando en toda la red local: cualquiera que acierte el código podría enviar una conversación");
    aviso("si Windows pregunta por el firewall, permite solo redes privadas");
  } else {
    aviso("solo accesible desde este equipo; usa --red para abrirlo a la red local");
  }
  if (workspace === undefined && !preguntarDestino) aviso("sin --workspace: cada conversación irá a Documents\\recibidas con el nombre de la carpeta del otro equipo");
  escribir("  Ctrl+C para parar.");
  escribir("");

  await new Promise((resolver) => {
    const parar = () => {
      escribir("");
      escribir("parando…");
      Promise.allSettled([servidor.cerrar(), respondedor?.cerrar()]).then(() => resolver(undefined));
    };
    process.once("SIGINT", parar);
    process.once("SIGTERM", parar);
  });
  return 0;
}

/** Envía una o varias conversaciones al equipo que está escuchando. */
async function comandoSend(opciones) {
  const home = resolveHome(opciones["dsh-home"]);

  let ip = limpiarRuta(opciones.ip);
  let puerto = opciones.puerto === undefined ? 8787 : Number(opciones.puerto);

  if (opciones.buscar === true) {
    escribir("buscando equipos en la red durante 2 s…");
    const todos = await descubrir({ esperaMs: 2000 });
    const otros = todos.filter((equipo) => !equipo.esteEquipo);
    // Si solo está este equipo se usa igualmente: sirve para probar en un PC.
    const elegidos = otros.length > 0 ? otros : todos;
    if (elegidos.length === 0) throw new CliError("no he encontrado ningún equipo esperando; arranca el otro con «serve --red» o usa --ip");
    if (elegidos.length > 1) {
      for (const equipo of elegidos) escribir(`  ${equipo.nombre}  ${equipo.ip}  ${equipo.puerto}`);
      throw new CliError(`he encontrado ${elegidos.length} equipos: elige uno con --ip`);
    }
    if (otros.length === 0) aviso("el único equipo encontrado es este mismo: sigo con él (vale para probar en un solo PC)");
    ip = elegidos[0].ip;
    if (opciones.puerto === undefined) puerto = elegidos[0].puerto;
    escribir(`encontrado «${elegidos[0].nombre}» en ${ip}:${puerto}`);
  }

  if (ip === "") throw new CliError("indica la IP del otro equipo con --ip, o usa --buscar");
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new CliError(`puerto no válido: ${opciones.puerto}`);
  const codigo = limpiarRuta(opciones.codigo);
  if (!/^\d{6}$/.test(codigo)) throw new CliError("el código son 6 dígitos (--codigo 482913)");

  const sesiones = Array.isArray(opciones.sesion) ? opciones.sesion : opciones.sesion === undefined ? [] : [opciones.sesion];
  if (sesiones.length === 0) throw new CliError("indica qué conversación enviar con --sesion <id> (el id sale en `list`)");

  const { tipos, origen } = leerTipos(opciones);
  escribir(`emparejando con ${ip}:${puerto}…`);
  const { envios } = await enviarSesiones({
    home,
    sesiones,
    ip,
    puerto,
    codigo,
    tiposConocidos: tipos,
    origenCompat: origen,
    alEmpezar: (sesion) => escribir(`enviando ${sesion}…`)
  });

  escribir("");
  for (const envio of envios) {
    ok(`«${envio.titulo}» llegó a ${envio.respuesta.workspace}`);
    escribir(`  eventos   : ${envio.respuesta.eventos}`);
    escribir(`  adjuntos  : ${envio.respuesta.adjuntos?.copiados ?? 0} copiados, ${envio.respuesta.adjuntos?.yaEstaban ?? 0} ya estaban`);
    escribir(`  tamaño    : ${formatearBytes(envio.zipBytes)} en claro, ${formatearBytes(envio.cifradoBytes)} cifrado`);
  }
  return 0;
}

/** Abre la interfaz web local en el navegador. */
async function comandoUi(opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const puerto = opciones.puerto === undefined ? 8790 : Number(opciones.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new CliError(`puerto no válido: ${opciones.puerto}`);
  if (opciones.red === true) {
    throw new CliError("la interfaz solo se sirve en este equipo: puede leer tus conversaciones y no debe exponerse a la red");
  }

  const { tipos, origen } = leerTipos(opciones);
  const ui = crearUiServidor({ home, puerto, tiposConocidos: tipos, origenCompat: origen });
  const puertoReal = await ui.iniciar();
  const url = `http://127.0.0.1:${puertoReal}/`;

  escribir("");
  escribir("  dsh-bridge · interfaz");
  escribir("  " + "─".repeat(46));
  escribir(`  Abre en el navegador : ${url}`);
  escribir("  Solo accesible desde este equipo. Ctrl+C para parar.");
  escribir("");

  if (opciones.abrir === true) {
    const orden =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    try {
      spawn(orden[0], orden[1], { detached: true, stdio: "ignore" }).unref();
    } catch {
      aviso("no he podido abrir el navegador; copia la dirección a mano");
    }
  }

  await new Promise((resolver) => {
    const parar = () => {
      escribir("");
      escribir("parando…");
      ui.cerrar().then(() => resolver(undefined), () => resolver(undefined));
    };
    process.once("SIGINT", parar);
    process.once("SIGTERM", parar);
  });
  return 0;
}

/** Busca equipos con `serve` abierto en la red local. */
async function comandoDiscover(opciones) {
  const segundos = opciones.segundos === undefined ? 2 : Number(opciones.segundos);
  if (!Number.isFinite(segundos) || segundos <= 0 || segundos > 30) throw new CliError(`--segundos debe estar entre 1 y 30: ${opciones.segundos}`);
  const destino = opciones.destino === undefined ? "255.255.255.255" : limpiarRuta(opciones.destino);

  escribir(`preguntando en la red durante ${segundos} s…`);
  const encontrados = await descubrir({ destino, esperaMs: Math.round(segundos * 1000) });

  if (encontrados.length === 0) {
    aviso("no he encontrado ningún equipo esperando");
    escribir("comprueba que el otro equipo tenga abierto «dsh-bridge serve --red --workspace <carpeta>»");
    escribir("y que los dos estén en la misma red (el firewall de Windows debe permitir la aplicación)");
    return 1;
  }

  escribir("");
  const anchoNombre = Math.max(6, ...encontrados.map((equipo) => equipo.nombre.length));
  escribir(`  ${"EQUIPO".padEnd(anchoNombre)}  ${"IP".padEnd(15)}  PUERTO  ESTADO`);
  escribir(`  ${"─".repeat(anchoNombre + 40)}`);
  for (const equipo of encontrados) {
    const estado = equipo.emparejado ? "ya emparejado" : "esperando código";
    const propio = equipo.esteEquipo ? "  (este equipo)" : "";
    escribir(`  ${equipo.nombre.padEnd(anchoNombre)}  ${equipo.ip.padEnd(15)}  ${String(equipo.puerto).padEnd(6)}  ${estado}${propio}`);
  }
  escribir("");
  escribir("  Para enviar:");
  escribir("    dsh-bridge send --buscar --codigo <código> --sesion <id>");
  return 0;
}

//#endregion

//#region menú

async function cerrarApp() {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("taskkill", ["/IM", "DeepSeek Harness.exe", "/F"], { windowsHide: true });
  } catch {
    return !isAppRunning();
  }
  for (let intento = 0; intento < 50; intento += 1) {
    if (!isAppRunning()) return true;
    await dormir(200);
  }
  return !isAppRunning();
}

function abrirApp() {
  const asar = findAppAsar();
  if (asar === undefined) return false;
  const exe = path.join(path.dirname(path.dirname(asar)), "DeepSeek Harness.exe");
  if (!fs.existsSync(exe)) return false;
  try {
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

async function menuExportar(rl, home, tipos, origen) {
  escribir("leyendo conversaciones…");
  const sesiones = listSessions(home, { full: true });
  if (sesiones.length === 0) {
    aviso("no hay conversaciones en este equipo");
    return;
  }
  escribir("");
  escribir(tablaSesiones(sesiones, { indices: sesiones.slice(0, 15).map((_, indice) => indice + 1) }));
  escribir(sesiones.length > 15 ? `  … y ${sesiones.length - 15} más` : "");
  escribir("");

  const seleccion = await rl.question('¿Cuáles exporto? (1 · 1,3 · 2-4 · Enter para volver): ');
  let indices;
  try {
    indices = parsearSeleccion(seleccion, sesiones.length);
  } catch (error) {
    if (error instanceof SeleccionError) {
      aviso(error.message);
      return;
    }
    throw error;
  }
  if (indices.length === 0) return;

  const escrito = limpiarRuta(await rl.question(`¿Dónde guardo los ZIP? [${carpetaEscritorio()}, Enter = elegir carpeta]: `));
  const elegida = escrito === "" ? await elegirCarpeta({ titulo: "¿En qué carpeta guardo los ZIP?" }) : undefined;
  const destino = escrito !== "" ? escrito : elegida !== undefined ? limpiarRuta(elegida) : carpetaEscritorio();
  for (const indice of indices) {
    const sesion = sesiones[indice];
    try {
      const resultado = exportarSesion(home, sesion.id, destino, { tiposConocidos: tipos, origenCompat: origen });
      ok(`${path.basename(resultado.ruta)}  (${formatearBytes(resultado.bytes)}, ${resultado.meta.adjuntos.length} adjuntos)`);
      for (const nota of resultado.avisos) aviso(nota);
    } catch (error) {
      mal(`no se pudo exportar «${recortar(sesion.label, 40)}»: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  escribir("");
  aviso("los ZIP llevan las conversaciones sin cifrar: bórralos cuando estén importados");
}

async function menuImportar(rl, home, tipos) {
  const escrito = limpiarRuta(await rl.question("Ruta del ZIP (arrástralo aquí, Enter = elegirlo en una ventana): "));
  const elegido = escrito === "" ? await elegirArchivo({ titulo: "Elige el ZIP de la conversación" }) : undefined;
  const archivo = escrito !== "" ? escrito : elegido !== undefined ? limpiarRuta(elegido) : "";
  if (archivo === "") return;
  if (!fs.existsSync(archivo)) {
    mal(`no existe: ${archivo}`);
    return;
  }

  let plan;
  try {
    plan = analizarBundle(archivo, { tiposConocidos: tipos });
  } catch (error) {
    mal(error instanceof Error ? error.message : String(error));
    return;
  }

  escribir("");
  escribir(`conversación : ${plan.meta?.sesion?.titulo ?? "(sin título)"}`);
  escribir(`sesión       : ${plan.header.id}`);
  escribir(`eventos      : ${plan.eventos}`);
  escribir(`adjuntos     : ${plan.objetos.size}`);
  escribir(`viene de     : ${plan.header.cwd}`);
  if (plan.compatibilidad.total > 0) aviso(`se marcarán ${plan.compatibilidad.total} sucesos como ignorables`);
  escribir("");

  let registro;
  try {
    registro = leerRegistro(home);
  } catch {
    registro = undefined;
  }
  const workspaces = registro === undefined ? [] : registro.registro.global.workspaceIds.map((id) => registro.registro.tables.workspaces[id]);
  workspaces.forEach((ficha, indice) => {
    escribir(`  ${indice + 1}) ${recortar(ficha.title, 24).padEnd(26)} ${ficha.path}`);
  });
  escribir(`  0) otra carpeta…`);
  const eleccion = (await rl.question(`¿Dónde la instalo? [${workspaces.length > 0 ? "1" : "0"}]: `)).trim() || (workspaces.length > 0 ? "1" : "0");

  let workspace;
  if (eleccion === "0") {
    workspace = limpiarRuta(await rl.question("Carpeta del proyecto en este equipo: "));
    if (workspace === "") return;
  } else {
    const indice = Number(eleccion) - 1;
    if (!Number.isInteger(indice) || workspaces[indice] === undefined) {
      mal("opción no válida");
      return;
    }
    workspace = workspaces[indice].path;
  }

  let abierta = isAppRunning();
  if (abierta) {
    aviso("DeepSeek Harness está abierto y con la app abierta el registro se pierde al cerrarla.");
    const respuesta = (await rl.question("¿Lo cierro, importo y lo vuelvo a abrir? (s/n): ")).trim().toLowerCase();
    if (respuesta !== "s") {
      escribir("cancelado: cierra la app a mano y vuelve a intentarlo");
      return;
    }
    escribir("cerrando DeepSeek Harness…");
    abierta = !(await cerrarApp());
    if (abierta) {
      mal("no he podido cerrarla; ciérrala desde la bandeja del sistema y reintenta");
      return;
    }
  }

  try {
    const resultado = importarBundle(archivo, { home, workspace, tiposConocidos: tipos, appAbierta: false });
    ok(`importada en ${resultado.workspace}`);
    escribir(`  log      : ${resultado.rutaLog}`);
    escribir(`  adjuntos : ${resultado.adjuntos.copiados} copiados, ${resultado.adjuntos.yaExistian} ya estaban`);
    escribir(`  workspace: ${resultado.registro.creado ? "creado" : "ya existía"}`);
    for (const nota of resultado.avisos) aviso(nota);
  } catch (error) {
    mal(error instanceof Error ? error.message : String(error));
  } finally {
    if (abierta === false && isAppRunning() === false) {
      if (abrirApp()) escribir("volviendo a abrir DeepSeek Harness…");
    }
  }
}

async function menu(home, opciones) {
  if (process.stdin.isTTY !== true) {
    escribir(textoAyuda());
    aviso("el menú necesita una terminal interactiva; usa los comandos de arriba");
    return 1;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const { tipos, origen } = leerTipos(opciones);
  try {
    for (;;) {
      escribir("");
      escribir("  dsh-bridge · conversaciones de DeepSeek Harness");
      escribir("  " + "─".repeat(47));
      escribir("  1) Exportar una conversación a ZIP");
      escribir("  2) Importar un ZIP");
      escribir("  3) Enviar por red (abre la interfaz web)");
      escribir("  4) Recibir por red (queda escuchando con un código)");
      escribir("  5) Diagnóstico");
      escribir("  0) Salir");
      escribir("");
      const opcion = (await rl.question("  Opción: ")).trim();

      if (opcion === "0" || opcion.toLowerCase() === "q") break;
      if (opcion === "1") await menuExportar(rl, home, tipos, origen);
      else if (opcion === "2") await menuImportar(rl, home, tipos);
      else if (opcion === "3") {
        rl.close();
        return await comandoUi({ ...opciones, abrir: opciones.abrir ?? true });
      } else if (opcion === "4") {
        const carpeta = (await rl.question("  Carpeta del proyecto donde guardar lo que llegue: ")).trim();
        if (carpeta === "") {
          aviso("hace falta una carpeta de destino: sin ella solo se podría listar");
          continue;
        }
        rl.close();
        return await comandoServe({ ...opciones, red: true, workspace: carpeta });
      } else if (opcion === "5") comandoDoctor(opciones);
      else if (opcion !== "") aviso(`opción no válida: ${opcion}`);
      if (opcion !== "") await rl.question("  (Enter para continuar) ");
    }
  } finally {
    rl.close();
  }
  return 0;
}

//#endregion

async function principal(argv) {
  const { comando, posicionales, opciones } = parsearArgumentos(argv);
  // `--sin-dialogos` deja el programa preguntando por teclado, como antes de T21.
  if (opciones["sin-dialogos"] === true) process.env.DSH_BRIDGE_SIN_DIALOGOS = "1";

  // La ayuda y la versión no dependen de tener DeepSeek Harness instalado: se
  // atienden antes de buscar `~/.dsh`. Si no, `dsh-bridge --version` fallaría en
  // cualquier equipo donde la app no esté (un runner de CI, por ejemplo).
  if (comando === "help") {
    escribir(textoAyuda());
    return 0;
  }
  if (comando === "version") {
    escribir(`dsh-bridge ${VERSION}`);
    return 0;
  }

  const home = resolveHome(opciones["dsh-home"]);

  switch (comando) {
    case "list":
      return comandoList(opciones);
    case "export":
      return comandoExport(posicionales, opciones);
    case "import":
      return comandoImport(posicionales, opciones);
    case "doctor":
      return comandoDoctor(opciones);
    case "serve":
      return comandoServe(opciones);
    case "ui":
      return comandoUi(opciones);
    case "discover":
      return comandoDiscover(opciones);
    case "send":
      return comandoSend(opciones);
    case "menu":
      return menu(home, opciones);
    default:
      throw new CliError(`comando no soportado: ${comando}`);
  }
}

principal(process.argv.slice(2))
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    if (error instanceof CliError || error instanceof SeleccionError) {
      mal(error.message);
      process.exit(2);
    }
    mal(error instanceof Error ? error.message : String(error));
    if (process.env.DSH_BRIDGE_DEBUG === "1" && error instanceof Error && error.stack !== undefined) escribir(error.stack);
    process.exit(1);
  });
