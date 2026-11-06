/**
 * Inventario de sesiones de una instalación de DeepSeek Harness.
 *
 * Cada sesión es una carpeta `sessions/<workspace-codificado>/<session-id>/`
 * con un log `session.v<N>.jsonl.zstd`. La cabecera del log (primer frame) trae
 * `id`, `version`, `cwd`, `createdAt`, `agentPreset`.
 *
 * El título no está en la cabecera: la app lo guarda en
 * `storages/session_projcache/sessions/<id>.json`. Si esa caché no existe (por
 * ejemplo, en una sesión recién importada que aún no se ha abierto), el modo
 * `full` lo busca dentro del log y, como último recurso, usa el primer mensaje
 * del usuario como etiqueta.
 *
 * La regla de oro es no descomprimir 300 MB para pintar una lista: por defecto
 * solo se lee la cabecera (el primer frame) de cada log.
 */
import fs from "node:fs";
import path from "node:path";
import { projCachePath, sessionsRoot } from "./paths.js";
import { decodeLogBuffer, readLogHeader, splitHeader } from "./zstd.js";

const LOG_NAME = /^session\.v(\d+)\.jsonl\.zstd$/;

/**
 * Recorre `sessions/` y devuelve cada log encontrado.
 * @param {string} home
 */
export function findSessionLogs(home) {
  const root = sessionsRoot(home);
  const encontrados = [];
  if (!fs.existsSync(root)) return encontrados;

  for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const rutaBucket = path.join(root, bucket.name);
    for (const carpetaSesion of fs.readdirSync(rutaBucket, { withFileTypes: true })) {
      if (!carpetaSesion.isDirectory()) continue;
      const rutaSesion = path.join(rutaBucket, carpetaSesion.name);
      const logs = fs
        .readdirSync(rutaSesion)
        .map((nombre) => ({ nombre, match: LOG_NAME.exec(nombre) }))
        .filter((entrada) => entrada.match !== null)
        .map((entrada) => ({ nombre: entrada.nombre, version: Number(entrada.match[1]) }))
        .sort((izquierda, derecha) => derecha.version - izquierda.version);
      if (logs.length === 0) continue;
      encontrados.push({
        bucket: bucket.name,
        sessionDirName: carpetaSesion.name,
        sessionDir: rutaSesion,
        logName: logs[0].nombre,
        logPath: path.join(rutaSesion, logs[0].nombre),
        logVersion: logs[0].version,
        extraLogs: logs.slice(1).map((entrada) => entrada.nombre)
      });
    }
  }
  return encontrados;
}

/**
 * Título y estado según la caché de proyecciones de la app.
 * @param {string} home
 * @param {string} sessionId
 */
export function readProjectionMeta(home, sessionId) {
  const archivo = projCachePath(home, sessionId);
  if (!fs.existsSync(archivo)) return undefined;
  try {
    const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
    const filas = datos?.record?.rows ?? {};
    const titulo = filas.title?.val ?? null;
    const lista = filas.sessionListMetadata?.val ?? null;
    return {
      title: typeof titulo === "string" && titulo.trim() !== "" ? titulo : undefined,
      blank: lista?.blank === true,
      lastPromptAt: lista?.lastPromptAt ?? null,
      model: filas.modelSelection?.val?.lastUsed ?? null
    };
  } catch {
    return undefined;
  }
}

/**
 * Localiza en el texto la línea que contiene un tipo de evento.
 * Devuelve la primera o la última coincidencia según `desdeElFinal`.
 */
function lineaDelEvento(text, tipo, desdeElFinal) {
  const patron = new RegExp(`"type"\\s*:\\s*"${tipo.replace("/", "\\/")}"`, "g");
  let indice = -1;
  let coincidencia;
  while ((coincidencia = patron.exec(text)) !== null) {
    indice = coincidencia.index;
    if (!desdeElFinal) break;
  }
  return indice < 0 ? undefined : recortarLinea(text, indice);
}

function recortarLinea(text, indice) {
  const inicio = text.lastIndexOf("\n", indice) + 1;
  const fin = text.indexOf("\n", indice);
  return text.slice(inicio, fin === -1 ? undefined : fin);
}

/**
 * Título escrito por la propia app (`session/title`). Si hay varios, vale el
 * último: es el que el usuario dejó puesto.
 * @param {string} text
 */
export function titleFromLog(text) {
  const linea = lineaDelEvento(text, "session/title", true);
  if (linea === undefined) return undefined;
  try {
    const evento = JSON.parse(linea);
    const titulo = evento?.data?.title ?? evento?.data?.value;
    if (typeof titulo === "string" && titulo.trim() !== "") return titulo.trim();
  } catch {
    /* título ilegible: se sigue con la etiqueta de reserva */
  }
  return undefined;
}

/**
 * Primer mensaje del usuario, como etiqueta de emergencia.
 * @param {string} text
 * @param {number} [limit]
 */
export function firstUserPrompt(text, limit = 90) {
  const linea = lineaDelEvento(text, "user/message", false);
  if (linea === undefined) return undefined;
  try {
    const evento = JSON.parse(linea);
    const contenido = evento?.data?.message?.content;
    const partes = Array.isArray(contenido) ? contenido : [];
    const trozo = partes.find((parte) => parte?.type === "text" && typeof parte.text === "string");
    if (!trozo) return undefined;
    const limpio = trozo.text.replace(/\s+/g, " ").trim();
    if (limpio === "") return undefined;
    return limpio.length > limit ? limpio.slice(0, limit - 1) + "…" : limpio;
  } catch {
    return undefined;
  }
}

/**
 * Lista las sesiones, de la más reciente a la más antigua.
 *
 * Sin opciones solo lee la cabecera (rápido con cualquier tamaño). Con
 * `full: true` descomprime cada log para sacar el título de reserva y contar
 * los adjuntos citados; es lo que se usa al exportar.
 * @param {string} home
 * @param {{full?: boolean}} [options]
 */
export function listSessions(home, options = {}) {
  const sesiones = [];
  for (const entrada of findSessionLogs(home)) {
    const info = fs.statSync(entrada.logPath);
    let header;
    let text = null;
    try {
      if (options.full === true) {
        text = decodeLogBuffer(fs.readFileSync(entrada.logPath));
        header = splitHeader(text).header;
      } else {
        header = readLogHeader(entrada.logPath);
      }
    } catch (error) {
      sesiones.push({
        ...entrada,
        id: entrada.sessionDirName,
        broken: error instanceof Error ? error.message : String(error),
        bytes: info.size,
        mtime: info.mtime
      });
      continue;
    }

    const proyeccion = readProjectionMeta(home, header.id);
    const titulo = proyeccion?.title ?? (text !== null ? titleFromLog(text) : undefined);
    const prompt = text !== null && titulo === undefined ? firstUserPrompt(text) : undefined;
    sesiones.push({
      ...entrada,
      id: header.id,
      version: header.version,
      cwd: header.cwd,
      createdAt: header.createdAt,
      isSeeded: header.isSeeded === true,
      agentPreset: header.agentPreset ?? null,
      model: proyeccion?.model ?? null,
      bytes: info.size,
      mtime: info.mtime,
      title: titulo,
      label: titulo ?? prompt ?? "(sin título)",
      blank: proyeccion?.blank ?? false,
      lastPromptAt: proyeccion?.lastPromptAt ?? null,
      attachments: text !== null ? attachmentHashes(text).size : undefined
    });
  }

  sesiones.sort((izquierda, derecha) => {
    const diferencia = derecha.mtime.getTime() - izquierda.mtime.getTime();
    return diferencia !== 0 ? diferencia : String(izquierda.id).localeCompare(String(derecha.id));
  });
  return sesiones;
}

/** Busca una sesión por id (con o sin el prefijo `session-`). */
export function findSession(home, id) {
  const buscado = String(id).startsWith("session-") ? String(id) : `session-${id}`;
  for (const entrada of findSessionLogs(home)) {
    try {
      const header = readLogHeader(entrada.logPath);
      if (header.id === buscado) return { ...entrada, id: header.id, header };
    } catch {
      /* log ilegible: se ignora al buscar */
    }
  }
  return undefined;
}

/**
 * Hashes de los adjuntos que cita un log (`sha256:<64 hex>`), sin repetir.
 * @param {string} text
 * @returns {Set<string>}
 */
export function attachmentHashes(text) {
  if (typeof text !== "string") throw new TypeError("attachmentHashes espera el texto del log");
  const hashes = new Set();
  const patron = /sha256:([0-9a-f]{64})/g;
  let coincidencia;
  while ((coincidencia = patron.exec(text)) !== null) hashes.add(coincidencia[1]);
  return hashes;
}
