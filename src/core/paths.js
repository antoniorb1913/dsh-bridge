/**
 * Rutas de DeepSeek Harness y el nombre de carpeta que la app usa para cada
 * workspace.
 *
 * `~/.dsh` contiene:
 *   sessions/<workspace-codificado>/<session-id>/session.v<N>.jsonl.zstd
 *   attachments/v1/objects/<2 hex>/<sha256>
 *   storages/workspace.json          (registro de workspaces)
 *   storages/session_projcache/...   (cachés que la app reconstruye sola)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readLogHeader } from "./zstd.js";

export class HomeError extends Error {
  constructor(message) {
    super(message);
    this.name = "HomeError";
  }
}

/**
 * Localiza `~/.dsh`.
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveHome(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.DSH_HOME) candidates.push(process.env.DSH_HOME);
  candidates.push(path.join(os.homedir(), ".dsh"));
  if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, ".dsh"));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  }
  throw new HomeError(
    `no encuentro la carpeta de datos de DeepSeek Harness (probé: ${candidates.join(", ")}). ` +
      "Usa --dsh-home para indicarla."
  );
}

export function sessionsRoot(home) {
  return path.join(home, "sessions");
}

export function attachmentsRoot(home) {
  return path.join(home, "attachments", "v1");
}

export function registryPath(home) {
  return path.join(home, "storages", "workspace.json");
}

export function projCachePath(home, sessionId) {
  return path.join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
}

/** Ruta absoluta canónica, como la calcula la app (`realpath`). */
export function canonicalize(target) {
  const resolved = path.resolve(target);
  return fs.realpathSync.native(resolved);
}

/** Compara rutas como lo hace Windows: sin distinguir mayúsculas ni separadores. */
export function samePath(left, right) {
  const normalize = (value) => String(value).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * Nombre de carpeta que DeepSeek Harness deriva de la ruta de un workspace.
 *
 * Derivado de las carpetas reales del equipo, p. ej.:
 *   D:\Users\MSI-PC\Desktop\web      -> --D-Users-MSI-PC-Desktop-web--
 *   /mnt/d/Users/MSI-PC/Desktop/web  -> --mnt-d-Users-MSI-PC-Desktop-web--
 *   /home/msi-pc/Nintendo DS         -> --home-msi-pc-Nintendo~0020DS--
 *
 * Los espacios se escapan como `~0020`, los separadores se convierten en `-`,
 * se colapsan las repeticiones y se recorta por ambos extremos.
 * @param {string} workspacePath
 * @returns {string}
 */
export function encodeSessionDirName(workspacePath) {
  const escaped = String(workspacePath).replace(/ /g, "~0020");
  const body = escaped
    .replace(/[^A-Za-z0-9._~-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return `--${body}--`;
}

/**
 * Comprueba el codificador contra las carpetas que ya existen en el equipo.
 * Si todas las sesiones guardadas vuelven a producir su carpeta, el algoritmo
 * es el correcto para esta plataforma.
 * @param {string} home
 */
export function verifySessionDirNames(home) {
  const root = sessionsRoot(home);
  const checked = [];
  const mismatches = [];
  if (!fs.existsSync(root)) return { checked, mismatches };
  for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const bucketPath = path.join(root, bucket.name);
    for (const sessionDir of fs.readdirSync(bucketPath, { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue;
      const dirPath = path.join(bucketPath, sessionDir.name);
      const logName = fs.readdirSync(dirPath).find((name) => /^session\.v\d+\.jsonl\.zstd$/.test(name));
      if (!logName) continue;
      let cwd;
      try {
        cwd = readLogHeader(path.join(dirPath, logName)).cwd;
      } catch {
        continue;
      }
      if (!cwd) continue;
      const expected = encodeSessionDirName(cwd);
      checked.push({ bucket: bucket.name, session: sessionDir.name, cwd, expected });
      if (expected !== bucket.name) mismatches.push({ bucket: bucket.name, session: sessionDir.name, cwd, expected });
    }
  }
  return { checked, mismatches };
}

/**
 * ¿Está la app abierta? Escribir el registro de workspaces con la app en
 * marcha puede perderse al cerrar, así que la importación lo comprueba antes.
 * @returns {boolean}
 */
export function isAppRunning() {
  if (process.env.DSH_BRIDGE_SKIP_APP_CHECK === "1") return false;
  if (process.platform !== "win32") {
    try {
      const out = execFileSync("pgrep", ["-f", "deepseek-harness"], { encoding: "utf8", timeout: 4000 });
      return out.trim().length > 0;
    } catch {
      return false;
    }
  }
  try {
    const out = execFileSync("tasklist", ["/fi", "imagename eq DeepSeek Harness.exe"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true
    });
    return /DeepSeek Harness\.exe/i.test(out);
  } catch {
    return false;
  }
}

/**
 * Busca el `app.asar` de la instalación (de ahí se leen los tipos de evento
 * que entiende esa versión del harness).
 * @param {string} [explicit]
 * @returns {string | undefined}
 */
export function findAppAsar(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.DSH_APP_ASAR) candidates.push(process.env.DSH_APP_ASAR);
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    candidates.push(path.join(local, "Programs", "DeepSeek Harness", "resources", "app.asar"));
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    candidates.push(path.join(programFiles, "DeepSeek Harness", "resources", "app.asar"));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/DeepSeek Harness.app/Contents/Resources/app.asar");
  } else {
    candidates.push("/opt/DeepSeek Harness/resources/app.asar");
    candidates.push(path.join(os.homedir(), ".local", "share", "deepseek-harness", "resources", "app.asar"));
  }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

/** Ruta del objeto de un adjunto a partir de su sha256. */
export function attachmentPath(home, sha256) {
  return path.join(attachmentsRoot(home), "objects", sha256.slice(0, 2), sha256);
}
