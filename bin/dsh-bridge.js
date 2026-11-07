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
import { crearServidor, ipLocal } from "../src/net/servidor.js";
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

const VERSION = "0.1.0";

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

function comandoExport(posicionales, opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const id = posicionales[0];
  if (id === undefined) throw new CliError("indica qué conversación exportar (mira `dsh-bridge list`) o usa el menú");

  const { tipos, origen } = leerTipos(opciones);
  const destino = limpiarRuta(opciones.salida ?? opciones.o ?? carpetaEscritorio());
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

function comandoImport(posicionales, opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const archivo = limpiarRuta(posicionales[0]);
  if (archivo === undefined || archivo === "") throw new CliError("indica el fichero .zip a importar");

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
    workspace: opciones.workspace === undefined ? undefined : limpiarRuta(opciones.workspace),
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
 * Se queda escuchando para que otro equipo se empareje y envíe una conversación.
 * El código se enseña una vez, caduca y solo sirve una vez.
 */
async function comandoServe(opciones) {
  const home = resolveHome(opciones["dsh-home"]);
  const puerto = opciones.puerto === undefined ? 8787 : Number(opciones.puerto);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new CliError(`puerto no válido: ${opciones.puerto}`);

  const host = opciones.red === true ? "0.0.0.0" : "127.0.0.1";
  const servidor = crearServidor({ home, puerto, host, codigo: opciones.codigo });
  const puertoReal = await servidor.iniciar();
  const datos = servidor.datos;
  const ip = host === "0.0.0.0" ? ipLocal() ?? "127.0.0.1" : "127.0.0.1";

  escribir("");
  escribir("  dsh-bridge · recibiendo conversaciones");
  escribir("  " + "─".repeat(52));
  escribir(`  Dirección : http://${ip}:${puertoReal}`);
  escribir(`  Código    : ${datos.codigo}   (un solo uso, caduca ${formatearFecha(datos.expira)})`);
  escribir("");
  escribir("  En el otro equipo:");
  escribir(`    dsh-bridge send --ip ${ip} --puerto ${puertoReal}`);
  escribir("");
  if (host === "0.0.0.0") {
    aviso("escuchando en toda la red local: cualquiera que acierte el código podría enviar una conversación");
    aviso("si Windows pregunta por el firewall, permite solo redes privadas");
  } else {
    aviso("solo accesible desde este equipo; usa --red para abrirlo a la red local");
  }
  escribir("  Ctrl+C para parar.");
  escribir("");

  await new Promise((resolver) => {
    const parar = () => {
      escribir("");
      escribir("parando…");
      servidor.cerrar().then(() => resolver(undefined), () => resolver(undefined));
    };
    process.once("SIGINT", parar);
    process.once("SIGTERM", parar);
  });
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

  const destino = limpiarRuta(await rl.question(`¿Dónde guardo los ZIP? [${carpetaEscritorio()}]: `)) || carpetaEscritorio();
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
  const archivo = limpiarRuta(await rl.question("Ruta del ZIP (arrástralo aquí): "));
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
      escribir("  3) Enviar por red a otro PC        (v0.2)");
      escribir("  4) Recibir por red de otro PC      (v0.2)");
      escribir("  5) Diagnóstico");
      escribir("  0) Salir");
      escribir("");
      const opcion = (await rl.question("  Opción: ")).trim();

      if (opcion === "0" || opcion.toLowerCase() === "q") break;
      if (opcion === "1") await menuExportar(rl, home, tipos, origen);
      else if (opcion === "2") await menuImportar(rl, home, tipos);
      else if (opcion === "3" || opcion === "4") aviso("la transferencia por red llega en la v0.2; de momento se usa el ZIP");
      else if (opcion === "5") comandoDoctor(opciones);
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
    case "send":
      aviso("«send» llega en la próxima tarea (T17): enviar el ZIP cifrado por la red");
      escribir("de momento: exporta un ZIP y llévalo al otro equipo");
      return 2;
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
