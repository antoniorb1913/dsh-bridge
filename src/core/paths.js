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
  constructor(message, options) {
    super(message, options);
    this.name = "HomeError";
  }
}

/**
 * Localiza `~/.dsh`.
 *
 * Si el usuario indica una carpeta (`--dsh-home`), se respeta al pie de la
 * letra: si no existe, es un error, no una excusa para usar otra. Caer en
 * silencio al `~/.dsh` de siempre es cómo se importan sesiones en el sitio
 * equivocado.
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveHome(explicit) {
  if (explicit) {
    const resuelto = path.resolve(explicit);
    if (!fs.existsSync(resuelto)) throw new HomeError(`la carpeta indicada no existe: ${resuelto}`);
    if (!fs.statSync(resuelto).isDirectory()) throw new HomeError(`la ruta indicada no es una carpeta: ${resuelto}`);
    return resuelto;
  }

  const candidatos = [];
  if (process.env.DSH_HOME) candidatos.push(process.env.DSH_HOME);
  candidatos.push(path.join(os.homedir(), ".dsh"));
  if (process.env.USERPROFILE) candidatos.push(path.join(process.env.USERPROFILE, ".dsh"));

  for (const candidato of candidatos) {
    const resuelto = path.resolve(candidato);
    if (fs.existsSync(resuelto) && fs.statSync(resuelto).isDirectory()) return resuelto;
  }
  throw new HomeError(
    `no encuentro la carpeta de datos de DeepSeek Harness (probé: ${candidatos.join(", ")}). ` +
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

/**
 * Ruta absoluta canónica, como la calcula la app (`realpath`).
 * Es lo que se compara: `D:\Web` y `d:\web\` son la misma carpeta.
 * @param {string} target
 * @returns {string}
 */
export function canonicalize(target) {
  const resuelto = path.resolve(target);
  try {
    return fs.realpathSync.native(resuelto);
  } catch (error) {
    throw new HomeError(`la ruta no existe o no se puede resolver: ${resuelto}`, { cause: error });
  }
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
 *
 * Con una ruta indicada a mano se es estricto: o es esa, o no hay. Buscar por
 * libre y devolver otra instalación daría una lista de tipos equivocada sin
 * que nadie se diera cuenta.
 * @param {string} [explicit]
 * @returns {string | undefined}
 */
export function findAppAsar(explicit) {
  if (explicit) return fs.existsSync(explicit) ? explicit : undefined;

  const candidates = [];
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

/**
 * Último tramo de una ruta, sea del sistema que sea.
 *
 * `path.basename` depende de la plataforma: en Linux `path.basename("D:\\web")`
 * devuelve la cadena entera, porque la barra invertida no es separador. Aquí se
 * manejan rutas escritas en otro equipo (un bundle de Windows abierto en Linux,
 * o al revés), así que el nombre se saca a mano.
 * @param {string} ruta
 */
export function nombreBase(ruta) {
  const limpia = String(ruta ?? "").replace(/[\\/]+$/, "");
  const partes = limpia.split(/[\\/]/);
  return partes[partes.length - 1] || limpia;
}

/** Ruta del objeto de un adjunto a partir de su sha256. */
export function attachmentPath(home, sha256) {
  return path.join(attachmentsRoot(home), "objects", sha256.slice(0, 2), sha256);
}
