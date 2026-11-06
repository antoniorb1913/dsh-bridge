/**
 * Inventario de sesiones de una instalación de DeepSeek Harness.
 *
 * Cada sesión es una carpeta `sessions/<workspace-codificado>/<session-id>/`
 * con un log `session.v<N>.jsonl.zstd`. La cabecera del log (primer frame) trae
 * `id`, `version`, `cwd`, `createdAt`, `agentPreset`. El título no está en la
 * cabecera: la app lo guarda en `storages/session_projcache/sessions/<id>.json`
 * y, si no existe, se puede sacar del log.
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
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const bucketPath = path.join(root, bucket.name);
    for (const sessionDir of fs.readdirSync(bucketPath, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue;
      const dirPath = path.join(bucketPath, sessionDir.name);
      const logs = fs
        .readdirSync(dirPath)
        .map((name) => ({ name, match: LOG_NAME.exec(name) }))
        .filter((entry) => entry.match !== null)
        .map((entry) => ({ name: entry.name, version: Number(entry.match[1]) }))
        .sort((left, right) => right.version - left.version);
      if (logs.length === 0) continue;
      found.push({
        bucket: bucket.name,
        sessionDirName: sessionDir.name,
        sessionDir: dirPath,
        logName: logs[0].name,
        logPath: path.join(dirPath, logs[0].name),
        logVersion: logs[0].version,
        extraLogs: logs.slice(1).map((entry) => entry.name)
      });
    }
  }
  return found;
}

/** Metadatos baratos: cabecera, tamaño y fecha del fichero. */
export function readSessionMeta(logPath) {
  const stat = fs.statSync(logPath);
  const buffer = fs.readFileSync(logPath);
  const text = decodeLogBuffer(buffer);
  const { header, body } = splitHeader(text);
  const events = body.length === 0 ? 0 : body.replace(/\n$/, "").split("\n").length;
  return {
    header,
    events,
    bytes: stat.size,
    mtime: stat.mtime,
    text
  };
}

/**
 * Título y estado de la caché de proyecciones.
 * @param {string} home
 * @param {string} sessionId
 */
export function readProjectionMeta(home, sessionId) {
  const file = projCachePath(home, sessionId);
  if (!fs.existsSync(file)) return undefined;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = data?.record?.rows ?? {};
    const title = rows.title?.val ?? null;
    const listMeta = rows.sessionListMetadata?.val ?? null;
    return {
      title: typeof title === "string" && title.trim() !== "" ? title : undefined,
      blank: listMeta?.blank === true,
      lastPromptAt: listMeta?.lastPromptAt ?? null,
      model: rows.modelSelection?.val?.lastUsed ?? null
    };
  } catch {
    return undefined;
  }
}

/** Saca el título del propio log (evento `session/title`). */
export function titleFromLog(text) {
  const marker = '"type":"session/title"';
  let index = text.indexOf(marker);
  while (index !== -1) {
    const start = text.lastIndexOf("\n", index) + 1;
    const end = text.indexOf("\n", index);
    try {
      const event = JSON.parse(text.slice(start, end === -1 ? undefined : end));
      const title = event?.data?.title ?? event?.data?.value;
      if (typeof title === "string" && title.trim() !== "") return title.trim();
    } catch {
      /* sigue buscando */
    }
    index = text.indexOf(marker, index + marker.length);
  }
  return undefined;
}

/** Primer mensaje del usuario, como etiqueta de emergencia. */
export function firstUserPrompt(text, limit = 90) {
  const marker = '"type":"user/message"';
  const index = text.indexOf(marker);
  if (index === -1) return undefined;
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  try {
    const event = JSON.parse(text.slice(start, end === -1 ? undefined : end));
    const content = event?.data?.message?.content;
    const parts = Array.isArray(content) ? content : [];
    const piece = parts.find((part) => part?.type === "text" && typeof part.text === "string");
    if (!piece) return undefined;
    const clean = piece.text.replace(/\s+/g, " ").trim();
    return clean.length > limit ? clean.slice(0, limit - 1) + "…" : clean;
  } catch {
    return undefined;
  }
}

/**
 * Lista las sesiones, ordenadas de más reciente a más antigua.
 * Por defecto solo lee la cabecera (rápido, incluso con 300 MB de logs);
 * `full` descomprime los logs para sacar título de reserva y nº de adjuntos.
 * @param {string} home
 * @param {{full?: boolean}} [options]
 */
export function listSessions(home, options = {}) {
  const sessions = [];
  for (const entry of findSessionLogs(home)) {
    let header;
    let text = null;
    try {
      if (options.full) {
        text = decodeLogBuffer(fs.readFileSync(entry.logPath));
        header = splitHeader(text).header;
      } else {
        header = readLogHeader(entry.logPath);
      }
    } catch (error) {
      sessions.push({
        ...entry,
        id: entry.sessionDirName,
        broken: error instanceof Error ? error.message : String(error),
        bytes: fs.statSync(entry.logPath).size,
        mtime: fs.statSync(entry.logPath).mtime
      });
      continue;
    }
    const projection = readProjectionMeta(home, header.id);
    const title = projection?.title ?? (text !== null ? titleFromLog(text) : undefined);
    const prompt = text !== null && title === undefined ? firstUserPrompt(text) : undefined;
    sessions.push({
      ...entry,
      id: header.id,
      version: header.version,
      cwd: header.cwd,
      createdAt: header.createdAt,
      isSeeded: header.isSeeded === true,
      agentPreset: header.agentPreset ?? null,
      bytes: fs.statSync(entry.logPath).size,
      mtime: fs.statSync(entry.logPath).mtime,
      title,
      label: title ?? prompt ?? "(sin título)",
      blank: projection?.blank ?? false,
      lastPromptAt: projection?.lastPromptAt ?? null,
      attachments: text !== null ? attachmentHashes(text).size : undefined
    });
  }
  sessions.sort((left, right) => right.mtime - left.mtime);
  return sessions;
}

/** Busca una sesión por id (con o sin prefijo `session-`). */
export function findSession(home, id) {
  const wanted = id.startsWith("session-") ? id : `session-${id}`;
  const sessions = listSessions(home, { full: false });
  return sessions.find((session) => session.id === wanted || session.id === id);
}

/**
 * Hashes de los adjuntos que cita un log.
 * @param {string} text
 * @returns {Set<string>}
 */
export function attachmentHashes(text) {
  const hashes = new Set();
  const pattern = /sha256:([0-9a-f]{64})/g;
  let match;
  while ((match = pattern.exec(text)) !== null) hashes.add(match[1]);
  return hashes;
}
