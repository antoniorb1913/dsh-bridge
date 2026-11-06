/**
 * Importar un bundle (`dsh-bridge/1`) en un equipo.
 *
 * Cuatro pasos, en este orden y con la misma idea que la importación manual que
 * hicimos el primer día:
 *
 *   1. **Validar** el bundle: manifiesto, sha256 del log, cabecera y que la
 *      sesión no esté ya instalada (salvo `forzar`).
 *   2. **Reescribir la ruta**: el `cwd` de la cabecera pasa a ser la carpeta de
 *      este equipo, y el log se coloca en `sessions/<carpeta-derivada>/<id>/`.
 *   3. **Adjuntos**: se copian los que vienen, con dedupe y hash verificado.
 *   4. **Registrar el workspace**: sin esto la app no lista la conversación.
 *
 * Se comprueba **antes de escribir** que DeepSeek Harness esté cerrado: con la
 * app abierta el registro se pierde al cerrarse (nos pasó).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { instalarAdjuntos } from "./attachments.js";
import { analizarTipos, marcarIgnorables, tiposPendientes } from "./compat.js";
import { canonicalize, encodeSessionDirName, isAppRunning, nombreBase, sessionsRoot } from "./paths.js";
import { registrarSesion } from "./registry.js";
import { readZip } from "./zip.js";
import { decodeLogBuffer, encodeLogString, splitHeader } from "./zstd.js";

/** Error de importación: bundle inválido, sesión ya instalada o app abierta. */
export class ImportError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ImportError";
  }
}

/**
 * Busca la carpeta de una sesión ya instalada.
 * @returns {string | undefined} ruta del log existente
 */
function logInstalado(home, sessionId) {
  const root = sessionsRoot(home);
  if (!fs.existsSync(root)) return undefined;
  for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const candidato = path.join(root, bucket.name, sessionId);
    if (!fs.existsSync(candidato)) continue;
    const log = fs.readdirSync(candidato).find((nombre) => /^session\.v\d+\.jsonl\.zstd$/.test(nombre));
    if (log !== undefined) return path.join(candidato, log);
  }
  return undefined;
}

function escribirAtomico(destino, contenido) {
  const temporal = `${destino}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.writeFileSync(temporal, contenido);
    fs.renameSync(temporal, destino);
  } catch (error) {
    try {
      fs.rmSync(temporal, { force: true });
    } catch {
      /* ya no está */
    }
    throw error;
  }
}

/**
 * Lee y valida un bundle sin escribir nada.
 * @param {string} archivoZip
 * @param {{tiposConocidos?: Set<string>}} [opciones]
 */
export function analizarBundle(archivoZip, opciones = {}) {
  if (!fs.existsSync(archivoZip)) throw new ImportError(`no existe el fichero: ${archivoZip}`);
  const entradas = readZip(fs.readFileSync(archivoZip));

  const crudoMeta = entradas.get("meta.json");
  if (crudoMeta === undefined) throw new ImportError("el ZIP no tiene meta.json: ¿es un bundle de dsh-bridge?");
  let meta;
  try {
    meta = JSON.parse(crudoMeta.toString("utf8"));
  } catch (error) {
    throw new ImportError("el meta.json del bundle no es JSON válido", { cause: error });
  }
  if (meta?.formato !== "dsh-bridge/1") throw new ImportError(`formato de bundle no soportado: ${JSON.stringify(meta?.formato)}`);

  const rutaLog = meta?.log?.ruta;
  const log = rutaLog === undefined ? undefined : entradas.get(rutaLog);
  if (log === undefined) throw new ImportError(`el bundle no contiene el log que anuncia el manifiesto (${rutaLog})`);

  const huella = crypto.createHash("sha256").update(log).digest("hex");
  if (meta?.log?.sha256 !== huella) {
    throw new ImportError(
      `el log del bundle no coincide con su checksum (esperaba ${String(meta?.log?.sha256).slice(0, 12)}… y es ${huella.slice(0, 12)}…): el ZIP está dañado`
    );
  }

  let texto;
  try {
    texto = decodeLogBuffer(log);
  } catch (error) {
    throw new ImportError(`el log del bundle no se puede leer: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const { header, body } = splitHeader(texto);
  if (meta?.sesion?.id !== undefined && meta.sesion.id !== header.id) {
    throw new ImportError(`el manifiesto dice sesión ${meta.sesion.id} pero el log es ${header.id}`);
  }

  // Compatibilidad con el harness de este equipo.
  let textoFinal = texto;
  const avisos = [];
  const compatibilidad = { pendientes: [], marcados: {}, total: 0 };
  if (opciones.tiposConocidos instanceof Set) {
    const { desconocidos } = analizarTipos(texto, opciones.tiposConocidos);
    if (desconocidos.size > 0) {
      if (opciones.adaptar === false) {
        compatibilidad.pendientes = [...desconocidos];
        throw new ImportError(
          `el harness de este equipo no conoce estos tipos de evento: ${[...desconocidos].join(", ")}. ` +
            "Vuelve a exportar con adaptación o importa con adaptar:true"
        );
      }
      const parcheado = marcarIgnorables(texto, desconocidos);
      textoFinal = parcheado.texto;
      compatibilidad.marcados = Object.fromEntries(parcheado.marcados);
      compatibilidad.total = parcheado.total;
      avisos.push(`se marcaron ${parcheado.total} sucesos como ignorables (${[...desconocidos].join(", ")}) para que esta versión pueda leer el log`);
      if (tiposPendientes(textoFinal, opciones.tiposConocidos).size > 0) throw new ImportError("quedan tipos de evento sin resolver tras adaptar el log");
    }
  }

  // Adjuntos: solo los que vienen en el bundle, con su hash comprobado después.
  const objetos = new Map();
  for (const [nombre, contenido] of entradas) {
    if (!nombre.startsWith("attachments/objects/")) continue;
    const hash = path.basename(nombre);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ImportError(`nombre de adjunto inválido en el bundle: ${nombre}`);
    objetos.set(hash, contenido);
  }

  // El cuerpo tiene que ser el ya adaptado: es lo que se escribirá en disco.
  const cuerpoFinal = splitHeader(textoFinal).body;
  const eventos = cuerpoFinal.length === 0 ? 0 : cuerpoFinal.replace(/\n$/, "").split("\n").length;
  return { meta, header, body: cuerpoFinal, texto: textoFinal, log, objetos, eventos, avisos, compatibilidad, entradas };
}

/**
 * Importa el bundle.
 *
 * @param {string} archivoZip
 * @param {{home: string, workspace?: string, title?: string, seco?: boolean,
 *          forzar?: boolean, appAbierta?: boolean, tiposConocidos?: Set<string>,
 *          adaptar?: boolean, ahora?: Date}} opciones
 * @returns {object} resumen de lo hecho
 */
export function importarBundle(archivoZip, opciones) {
  const home = opciones.home;
  if (typeof home !== "string" || home === "") throw new ImportError("falta la carpeta de datos de DeepSeek Harness (home)");

  const analizado = analizarBundle(archivoZip, opciones);
  const { meta, header, objetos, eventos, avisos, compatibilidad } = analizado;
  const avisosTotales = [...avisos];

  // Carpeta destino: la indicada o la de origen del bundle.
  const rutaDeclarada = opciones.workspace ?? header.cwd ?? meta?.sesion?.cwd;
  if (rutaDeclarada === undefined) throw new ImportError("el bundle no dice dónde instalarse; indica el workspace");
  let rutaCanonica;
  try {
    rutaCanonica = canonicalize(rutaDeclarada);
  } catch (error) {
    throw new ImportError(`la carpeta del workspace no existe en este equipo: ${rutaDeclarada}. Créala o indica otra con --workspace`, { cause: error });
  }
  if (!fs.statSync(rutaCanonica).isDirectory()) throw new ImportError(`la ruta del workspace no es una carpeta: ${rutaCanonica}`);

  const sessionId = header.id;
  const yaInstalada = logInstalado(home, sessionId);
  if (yaInstalada !== undefined && opciones.forzar !== true) {
    throw new ImportError(`la sesión ya está instalada en este equipo (${yaInstalada}). Usa --forzar para reemplazarla (se guarda copia)`);
  }

  // Con la app abierta el registro se pierde al cerrarla: se comprueba antes de escribir nada.
  if (opciones.seco !== true) {
    const abierta = opciones.appAbierta === undefined ? isAppRunning() : opciones.appAbierta === true;
    if (abierta) {
      throw new ImportError(
        "DeepSeek Harness está abierto. Ciérralo del todo (icono de la bandeja → Salir) y vuelve a intentarlo: " +
          "con la app abierta, el registro que escribamos se puede perder al cerrarse"
      );
    }
  }

  // Cabecera con la ruta de este equipo.
  const cabeceraNueva = { ...header, cwd: rutaCanonica };
  const textoFinal = JSON.stringify(cabeceraNueva) + "\n" + analizado.body;
  const logFinal = encodeLogString(textoFinal);

  const carpetaSesion = path.join(sessionsRoot(home), encodeSessionDirName(rutaCanonica), sessionId);
  const nombreLog = `session.v${header.version}.jsonl.zstd`;
  const rutaLogDestino = path.join(carpetaSesion, nombreLog);

  const titulo = opciones.title ?? meta?.sesion?.titulo ?? nombreBase(rutaCanonica);

  if (opciones.seco === true) {
    return {
      seco: true,
      sesionId: sessionId,
      eventos,
      workspace: rutaCanonica,
      rutaLog: rutaLogDestino,
      reemplaza: yaInstalada !== undefined,
      adjuntos: { porCopiar: objetos.size, citados: new Set() },
      compatibilidad,
      avisos: avisosTotales,
      escrito: false
    };
  }

  // 1. Copia previa y log.
  if (yaInstalada !== undefined) {
    const sello = (opciones.ahora ?? new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    fs.copyFileSync(yaInstalada, `${yaInstalada}.bak-${sello}`);
    avisosTotales.push(`la sesión anterior se guardó como ${path.basename(yaInstalada)}.bak-${sello}`);
  }
  escribirAtomico(rutaLogDestino, logFinal);

  // 2. Adjuntos citados por el log.
  const citados = new Set();
  for (const coincidencia of textoFinal.matchAll(/sha256:([0-9a-f]{64})/g)) citados.add(coincidencia[1]);
  const adjuntos = instalarAdjuntos(home, objetos, citados);
  if (adjuntos.faltan.length > 0) {
    avisosTotales.push(`el bundle no traía ${adjuntos.faltan.length} adjunto(s) que la conversación cita; se han dejado sin copiar`);
  }

  // 3. Registro del workspace (sin esto la app no la lista).
  const registro = registrarSesion(home, { path: rutaCanonica, title: titulo, sessionId }, { appAbierta: false });

  return {
    seco: false,
    sesionId: sessionId,
    eventos,
    workspace: rutaCanonica,
    rutaLog: rutaLogDestino,
    reemplaza: yaInstalada !== undefined,
    adjuntos,
    registro,
    compatibilidad,
    avisos: avisosTotales,
    escrito: true
  };
}
