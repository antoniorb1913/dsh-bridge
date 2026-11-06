/**
 * Tests del inventario de sesiones: listar sin descomprimir, títulos desde la
 * caché de proyecciones (y de reserva), adjuntos citados y sesiones dañadas.
 *
 * Todo se monta en un `DSH_HOME` falso en una carpeta temporal.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { projCachePath, sessionsRoot } from "../src/core/paths.js";
import { encodeLogString } from "../src/core/zstd.js";
import {
  attachmentHashes,
  findSession,
  findSessionLogs,
  firstUserPrompt,
  listSessions,
  readProjectionMeta,
  titleFromLog
} from "../src/core/sessions.js";

const ID1 = "session-11111111-1111-1111-1111-111111111111";
const ID2 = "session-22222222-2222-2222-2222-222222222222";
const ID3 = "session-33333333-3333-3333-3333-333333333333";
const BUCKET = "--D-Users-Ejemplo-Desktop-web--";

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-sessions-"));
}

function escribirSesion(home, { id, bucket = BUCKET, cwd = "D:\\Users\\Ejemplo\\Desktop\\web", eventos = [], version = 4 }) {
  const dir = path.join(sessionsRoot(home), bucket, id);
  fs.mkdirSync(dir, { recursive: true });
  const cabecera = JSON.stringify({
    type: "session",
    version,
    id,
    createdAt: 1793554845064,
    cwd,
    isSeeded: false,
    agentPreset: "standard"
  });
  const texto = [cabecera, ...eventos.map((evento) => JSON.stringify(evento))].join("\n") + "\n";
  const archivo = path.join(dir, `session.v${version}.jsonl.zstd`);
  fs.writeFileSync(archivo, encodeLogString(texto));
  return archivo;
}

function escribirProyeccion(home, id, { title, blank = false, model = null }) {
  const archivo = projCachePath(home, id);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(
    archivo,
    JSON.stringify({
      version: 7,
      record: {
        rows: {
          title: { val: title ?? null },
          sessionListMetadata: { val: { blank } },
          modelSelection: { val: { lastUsed: model } }
        }
      }
    })
  );
}

const eventoTitulo = (titulo) => ({ type: "session/title", seq: 1, time: 1, data: { title: titulo } });
const eventoUsuario = (texto) => ({
  type: "user/message",
  seq: 2,
  time: 2,
  data: { message: { role: "user", content: [{ type: "text", text: texto }] } }
});
const eventoImagen = (hash) => ({
  type: "tool/result",
  seq: 3,
  time: 3,
  data: { message: { role: "tool", content: [{ type: "image", attachment: { attachmentId: `sha256:${hash}` } }] } }
});

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

test("títulos desde la caché de proyecciones, sin descomprimir el log", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { id: ID1 });
    escribirSesion(home, { id: ID2 });
    escribirProyeccion(home, ID1, { title: "Página web del bar", model: "deepseek-flash" });

    const sesiones = listSessions(home);
    assert.equal(sesiones.length, 2);
    const primera = sesiones.find((s) => s.id === ID1);
    const segunda = sesiones.find((s) => s.id === ID2);
    assert.equal(primera.label, "Página web del bar");
    assert.equal(primera.model, "deepseek-flash");
    assert.equal(segunda.title, undefined);
    assert.equal(segunda.label, "(sin título)");
    assert.equal(segunda.attachments, undefined, "en modo rápido no se cuentan adjuntos");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("modo full: título de reserva del log y adjuntos sin repetir", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, {
      id: ID3,
      eventos: [eventoTitulo("Bar El Jardín"), eventoUsuario("hola"), eventoImagen(HASH_A), eventoImagen(HASH_B), eventoImagen(HASH_A)]
    });

    const [sesion] = listSessions(home, { full: true });
    assert.equal(sesion.title, "Bar El Jardín");
    assert.equal(sesion.label, "Bar El Jardín");
    assert.equal(sesion.attachments, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("sin título en la caché ni en el log, se usa el primer mensaje", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { id: ID2, eventos: [eventoUsuario("¿Cómo hago la carta en Netlify?")] });
    const [sesion] = listSessions(home, { full: true });
    assert.equal(sesion.title, undefined);
    assert.equal(sesion.label, "¿Cómo hago la carta en Netlify?");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("ordena de más reciente a más antigua por fecha del log", () => {
  const home = carpetaTemporal();
  try {
    const viejo = escribirSesion(home, { id: ID1 });
    const medio = escribirSesion(home, { id: ID2 });
    const nuevo = escribirSesion(home, { id: ID3 });
    fs.utimesSync(viejo, new Date("2026-01-01T10:00:00"), new Date("2026-01-01T10:00:00"));
    fs.utimesSync(medio, new Date("2026-06-01T10:00:00"), new Date("2026-06-01T10:00:00"));
    fs.utimesSync(nuevo, new Date("2026-11-01T10:00:00"), new Date("2026-11-01T10:00:00"));

    assert.deepEqual(listSessions(home).map((s) => s.id), [ID3, ID2, ID1]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("un log dañado se marca y no rompe la lista", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { id: ID1 });
    const roto = path.join(sessionsRoot(home), BUCKET, ID2, "session.v4.jsonl.zstd");
    fs.mkdirSync(path.dirname(roto), { recursive: true });
    fs.writeFileSync(roto, "esto no es zstd");

    const sesiones = listSessions(home);
    assert.equal(sesiones.length, 2);
    const danada = sesiones.find((s) => s.broken !== undefined);
    assert.ok(danada, "debería haber una sesión marcada como dañada");
    assert.match(danada.broken, /Zstandard|cabecera|inválida|demasiado/i);
    assert.ok(sesiones.some((s) => s.id === ID1 && s.broken === undefined));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("findSession acepta el id con y sin prefijo, y devuelve undefined si no está", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { id: ID1 });
    assert.equal(findSession(home, ID1).id, ID1);
    assert.equal(findSession(home, ID1.replace("session-", "")).id, ID1);
    assert.equal(findSession(home, "session-0000"), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("con dos versiones del log se toma la más alta y la otra queda como extra", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { id: ID1, version: 3 });
    escribirSesion(home, { id: ID1, version: 4 });
    const [entrada] = findSessionLogs(home);
    assert.equal(entrada.logVersion, 4);
    assert.equal(entrada.logName, "session.v4.jsonl.zstd");
    assert.deepEqual(entrada.extraLogs, ["session.v3.jsonl.zstd"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("ignora carpetas sin log y ficheros sueltos", () => {
  const home = carpetaTemporal();
  try {
    fs.mkdirSync(path.join(sessionsRoot(home), BUCKET, "carpeta-vacia"), { recursive: true });
    fs.writeFileSync(path.join(sessionsRoot(home), BUCKET, "suelto.txt"), "hola");
    escribirSesion(home, { id: ID1 });
    assert.equal(findSessionLogs(home).length, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("attachmentHashes no repite y valida la entrada", () => {
  const texto = `cita sha256:${HASH_A} y otra vez sha256:${HASH_A} y también sha256:${HASH_B}`;
  assert.deepEqual([...attachmentHashes(texto)].sort(), [HASH_B, HASH_A].sort());
  assert.equal(attachmentHashes("sin adjuntos").size, 0);
  assert.throws(() => attachmentHashes(Buffer.from("no soy texto")), TypeError);
});

test("titleFromLog tolera espacios en el JSON y se queda con el último título", () => {
  const conEspacios = '{"type": "session/title", "seq": 1, "time": 1, "data": { "title": "Primero" }}';
  const compacto = '{"type":"session/title","seq":2,"time":2,"data":{"title":"Segundo"}}';
  assert.equal(titleFromLog(conEspacios + "\n" + compacto + "\n"), "Segundo");
  assert.equal(titleFromLog("nada de nada"), undefined);
});

test("firstUserPrompt recorta el texto largo y descarta lo vacío", () => {
  const largo = "x".repeat(200);
  const texto = JSON.stringify({
    type: "user/message",
    seq: 1,
    time: 1,
    data: { message: { role: "user", content: [{ type: "text", text: largo }] } }
  });
  const recortado = firstUserPrompt(texto, 20);
  assert.equal(recortado.length, 20);
  assert.ok(recortado.endsWith("…"));
  assert.equal(firstUserPrompt("sin mensaje"), undefined);
});

test("readProjectionMeta tolera una caché rota", () => {
  const home = carpetaTemporal();
  try {
    const archivo = projCachePath(home, ID1);
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, "{no es json}");
    assert.equal(readProjectionMeta(home, ID1), undefined);
    assert.equal(readProjectionMeta(home, "session-inexistente"), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
