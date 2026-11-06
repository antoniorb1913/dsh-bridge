/**
 * Tests de rutas: localizar `~/.dsh`, canonicalizar, comparar rutas y derivar
 * el nombre de carpeta que DeepSeek Harness usa para cada workspace.
 *
 * Todo se monta en carpetas temporales (nunca se toca el `~/.dsh` real).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  HomeError,
  nombreBase,
  attachmentPath,
  attachmentsRoot,
  canonicalize,
  encodeSessionDirName,
  findAppAsar,
  isAppRunning,
  projCachePath,
  registryPath,
  resolveHome,
  samePath,
  sessionsRoot,
  verifySessionDirNames
} from "../src/core/paths.js";

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-paths-"));
}

/** Escribe un log mínimo (un frame) con la cabecera indicada. */
function escribirLog(home, bucket, id, cwd) {
  const dir = path.join(sessionsRoot(home), bucket, id);
  fs.mkdirSync(dir, { recursive: true });
  const cabecera = JSON.stringify({ type: "session", version: 4, id, createdAt: 1793554845064, cwd, isSeeded: false }) + "\n";
  fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(cabecera, "utf8")));
}

test("respeta la carpeta indicada con --dsh-home", () => {
  const home = carpetaTemporal();
  try {
    assert.equal(resolveHome(home), path.resolve(home));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("falla si la carpeta indicada no existe (no cae en ~/.dsh)", () => {
  const inexistente = path.join(carpetaTemporal(), "no-existe");
  assert.throws(() => resolveHome(inexistente), (error) => {
    assert.ok(error instanceof HomeError);
    assert.match(error.message, /no existe/);
    return true;
  });
});

test("falla si la ruta indicada es un fichero", () => {
  const carpeta = carpetaTemporal();
  const fichero = path.join(carpeta, "un-fichero.txt");
  fs.writeFileSync(fichero, "hola");
  try {
    assert.throws(() => resolveHome(fichero), /no es una carpeta/);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("usa DSH_HOME cuando no se indica carpeta", () => {
  const home = carpetaTemporal();
  const anterior = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    assert.equal(resolveHome(), path.resolve(home));
  } finally {
    if (anterior === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = anterior;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("sin DSH_HOME: devuelve ~/.dsh si existe, y si no, error claro", () => {
  const anterior = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  try {
    const porDefecto = path.join(os.homedir(), ".dsh");
    if (fs.existsSync(porDefecto)) assert.equal(resolveHome(), path.resolve(porDefecto));
    else assert.throws(() => resolveHome(), /no encuentro la carpeta de datos/);
  } finally {
    if (anterior !== undefined) process.env.DSH_HOME = anterior;
  }
});

test("canonicalize devuelve la ruta real y falla si no existe", () => {
  const carpeta = carpetaTemporal();
  try {
    assert.equal(canonicalize(carpeta), fs.realpathSync.native(carpeta));
    assert.throws(() => canonicalize(path.join(carpeta, "fantasma")), HomeError);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("samePath compara como Windows: mayúsculas, separadores y barra final", () => {
  assert.ok(samePath("D:\\Users\\MSI-PC\\Desktop\\web", "d:/users/msi-pc/desktop/web/"));
  assert.ok(samePath("D:\\web", "D:/web"));
  assert.ok(!samePath("D:\\web", "D:\\web2"));
});

test("nombreBase saca el último tramo en rutas de cualquier sistema", () => {
  // Una ruta de Windows leída en Linux y una de Linux leída en Windows: el
  // `path.basename` de la plataforma se equivoca en los dos casos.
  assert.equal(nombreBase("D:\\Users\\MSI-PC\\Desktop\\web"), "web");
  assert.equal(nombreBase("D:\\Users\\MSI-PC\\Desktop\\JARDIN\\bar\\"), "bar");
  assert.equal(nombreBase("/home/msi-pc/proyecto"), "proyecto");
  assert.equal(nombreBase("/mnt/d/Users/MSI-PC/Desktop/web/"), "web");
  assert.equal(nombreBase("web"), "web");
  assert.equal(nombreBase(""), "");
});

test("el nombre de carpeta reproduce los casos reales del equipo", () => {
  // Sacados de las carpetas que hay hoy en ~/.dsh/sessions
  assert.equal(encodeSessionDirName("D:\\Users\\MSI-PC\\Desktop\\web"), "--D-Users-MSI-PC-Desktop-web--");
  assert.equal(encodeSessionDirName("D:\\Users\\MSI-PC\\Desktop\\JARDIN\\bar"), "--D-Users-MSI-PC-Desktop-JARDIN-bar--");
  assert.equal(
    encodeSessionDirName("/mnt/d/Users/MSI-PC/Desktop/videos"),
    "--mnt-d-Users-MSI-PC-Desktop-videos--"
  );
  assert.equal(encodeSessionDirName("/home/msi-pc/nintendo ds"), "--home-msi-pc-nintendo~0020ds--");
});

test("el nombre de carpeta escapa espacios y limpia separadores repetidos", () => {
  assert.equal(encodeSessionDirName("C:\\a b\\c"), "--C-a~0020b-c--");
  assert.equal(encodeSessionDirName("D:\\x\\\\y\\\\\\z"), "--D-x-y-z--");
  assert.equal(encodeSessionDirName("D:\\Users\\MSI-PC\\Desktop\\web\\"), "--D-Users-MSI-PC-Desktop-web--");
});

test("verifySessionDirNames detecta una sesión guardada en la carpeta equivocada", () => {
  const home = carpetaTemporal();
  try {
    escribirLog(home, "--D-Users-MSI-PC-Desktop-web--", "session-1", "D:\\Users\\MSI-PC\\Desktop\\web");
    escribirLog(home, "--home-msi-pc-nintendo~0020ds--", "session-2", "/home/msi-pc/nintendo ds");
    // Esta está a propósito en una carpeta que no le corresponde.
    escribirLog(home, "--carpeta-equivocada--", "session-3", "D:\\Users\\MSI-PC\\Desktop\\JARDIN\\bar");

    const { checked, mismatches } = verifySessionDirNames(home);
    assert.equal(checked.length, 3);
    assert.equal(mismatches.length, 1);
    assert.equal(mismatches[0].session, "session-3");
    assert.equal(mismatches[0].expected, "--D-Users-MSI-PC-Desktop-JARDIN-bar--");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("verifySessionDirNames no se rompe con un home sin sesiones", () => {
  const home = carpetaTemporal();
  try {
    assert.deepEqual(verifySessionDirNames(home), { checked: [], mismatches: [] });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("las rutas derivadas cuelgan del home", () => {
  const home = path.join("C:", "datos", ".dsh");
  assert.equal(sessionsRoot(home), path.join(home, "sessions"));
  assert.equal(attachmentsRoot(home), path.join(home, "attachments", "v1"));
  assert.equal(registryPath(home), path.join(home, "storages", "workspace.json"));
  assert.equal(projCachePath(home, "session-abc"), path.join(home, "storages", "session_projcache", "sessions", "session-abc.json"));
  const hash = "ab12".padEnd(64, "0");
  assert.equal(attachmentPath(home, hash), path.join(home, "attachments", "v1", "objects", "ab", hash));
});

test("isAppRunning se puede desactivar para pruebas", () => {
  const anterior = process.env.DSH_BRIDGE_SKIP_APP_CHECK;
  process.env.DSH_BRIDGE_SKIP_APP_CHECK = "1";
  try {
    assert.equal(isAppRunning(), false);
  } finally {
    if (anterior === undefined) delete process.env.DSH_BRIDGE_SKIP_APP_CHECK;
    else process.env.DSH_BRIDGE_SKIP_APP_CHECK = anterior;
  }
});

test("findAppAsar devuelve undefined si la ruta indicada no existe", () => {
  assert.equal(findAppAsar(path.join(os.tmpdir(), "no-hay-asar", "app.asar")), undefined);
});
