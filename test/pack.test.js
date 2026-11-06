/**
 * Tests de exportación: el bundle ZIP con su manifiesto, los adjuntos citados,
 * la adaptación de compatibilidad y los avisos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PackError, construirBundle, exportarSesion, nombreSugerido, slugDe } from "../src/core/pack.js";
import { attachmentsRoot, projCachePath, sessionsRoot } from "../src/core/paths.js";
import { readZip } from "../src/core/zip.js";
import { decodeLogBuffer, encodeLogString } from "../src/core/zstd.js";

const SESION = "session-11111111-2222-3333-4444-555555555555";
const BUCKET = "--D-Users-Ejemplo-Desktop-web--";
const CWD = "D:\\Users\\Ejemplo\\Desktop\\web";
const CONOCIDOS = new Set(["user/message", "assistant/message", "tool/result", "session/title"]);

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-pack-"));
}

function escribirSesion(home, { id = SESION, eventos = [] } = {}) {
  const dir = path.join(sessionsRoot(home), BUCKET, id);
  fs.mkdirSync(dir, { recursive: true });
  const cabecera = JSON.stringify({ type: "session", version: 4, id, createdAt: 1793554845064, cwd: CWD, isSeeded: false, agentPreset: "standard" });
  const texto = [cabecera, ...eventos.map((evento) => JSON.stringify(evento))].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), encodeLogString(texto));
  return path.join(dir, "session.v4.jsonl.zstd");
}

const sha256 = (contenido) => crypto.createHash("sha256").update(contenido).digest("hex");

function guardarAdjunto(home, contenido) {
  const hash = sha256(contenido);
  const destino = path.join(attachmentsRoot(home), "objects", hash.slice(0, 2), hash);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
  return hash;
}

const texto = (t) => ({ type: "user/message", seq: 0, time: 1, data: { message: { role: "user", content: [{ type: "text", text: t }] } } });
const imagen = (hash) => ({ type: "tool/result", seq: 1, time: 2, data: { message: { role: "tool", content: [{ type: "image", attachment: { attachmentId: `sha256:${hash}` } }] } } });

test("slugDe limpia acentos, espacios y mayúsculas", () => {
  assert.equal(slugDe("Página web para Bar El Jardín en Netlify"), "pagina-web-para-bar-el-jardin-en-netlify");
  assert.equal(slugDe("   "), "sin-titulo");
  assert.equal(slugDe("¿Qué? ¡Ya!"), "que-ya");
  const nombre = nombreSugerido("Página web del bar", new Date("2026-11-07T10:00:00"));
  assert.equal(nombre, "dsh-sesion-pagina-web-del-bar-20261107.zip");
});

test("construye el bundle con manifiesto, log y adjuntos citados", () => {
  const home = carpetaTemporal();
  try {
    const hashA = guardarAdjunto(home, Buffer.from("foto A"));
    const hashB = guardarAdjunto(home, Buffer.from("foto B"));
    guardarAdjunto(home, Buffer.from("foto que la sesión NO cita"));
    escribirSesion(home, { eventos: [texto("hola"), imagen(hashA), imagen(hashB)] });
    fs.mkdirSync(path.dirname(projCachePath(home, SESION)), { recursive: true });
    fs.writeFileSync(projCachePath(home, SESION), JSON.stringify({ record: { rows: { title: { val: "Bar El Jardín" } } } }));

    const { zip, meta, avisos } = construirBundle(home, SESION, { tiposConocidos: CONOCIDOS });
    const entradas = readZip(zip);

    assert.ok(entradas.has("meta.json"));
    assert.ok(entradas.has("LEEME.txt"));
    assert.ok(entradas.has("session/session.v4.jsonl.zstd"));
    assert.ok(entradas.has(`attachments/objects/${hashA.slice(0, 2)}/${hashA}`));
    assert.equal(entradas.size, 5, "los adjuntos no citados no deben viajar");
    assert.deepEqual(avisos, []);

    assert.equal(meta.formato, "dsh-bridge/1");
    assert.equal(meta.sesion.id, SESION);
    assert.equal(meta.sesion.titulo, "Bar El Jardín");
    assert.equal(meta.adjuntos.length, 2);
    const log = entradas.get("session/session.v4.jsonl.zstd");
    assert.equal(meta.log.sha256, sha256(log));
    assert.equal(meta.log.bytes, log.length);
    assert.equal(meta.log.eventos, 3);
    assert.match(entradas.get("LEEME.txt").toString(), /Aviso: dentro van tus conversaciones/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("una sesión sin adjuntos genera un bundle sin carpeta attachments", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { eventos: [texto("solo texto")] });
    const { zip, meta } = construirBundle(home, SESION, { tiposConocidos: CONOCIDOS });
    const entradas = readZip(zip);
    assert.deepEqual(meta.adjuntos, []);
    assert.equal([...entradas.keys()].filter((n) => n.startsWith("attachments/")).length, 0);
    assert.equal(entradas.size, 3);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("marca como ignorable lo que el destino no conoce y lo deja anotado", () => {
  const home = carpetaTemporal();
  try {
    const raro = { type: "job/registered", seq: 2, time: 3, data: { job: "x" } };
    escribirSesion(home, { eventos: [texto("hola"), raro] });

    const { zip, meta, avisos } = construirBundle(home, SESION, { tiposConocidos: CONOCIDOS, origenCompat: "asar" });
    assert.equal(meta.compatibilidad.origen, "asar");
    assert.deepEqual(meta.compatibilidad.marcados, { "job/registered": 1 });
    assert.equal(meta.compatibilidad.total, 1);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /ignorables/);

    const log = decodeLogBuffer(readZip(zip).get("session/session.v4.jsonl.zstd"));
    const lineas = log.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lineas[2].ignorable, true);
    assert.equal(lineas[2].seq, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("con adaptar:false no se toca el log aunque haya tipos raros", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { eventos: [texto("hola"), { type: "job/registered", seq: 1, time: 2, data: {} }] });
    const { zip, meta } = construirBundle(home, SESION, { tiposConocidos: CONOCIDOS, adaptar: false });
    assert.equal(meta.compatibilidad.total, 0);
    const log = decodeLogBuffer(readZip(zip).get("session/session.v4.jsonl.zstd"));
    assert.equal(/ignorable/.test(log), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("si falta un adjunto se avisa y se exporta igual", () => {
  const home = carpetaTemporal();
  try {
    const presente = guardarAdjunto(home, Buffer.from("está"));
    const ausente = sha256(Buffer.from("no está"));
    escribirSesion(home, { eventos: [texto("hola"), imagen(presente), imagen(ausente)] });

    const { zip, meta, avisos } = construirBundle(home, SESION, { tiposConocidos: CONOCIDOS });
    assert.equal(meta.adjuntos.length, 1);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /faltan 1 adjunto/);
    assert.equal(readZip(zip).size, 4);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("exportarSesion escribe el ZIP en disco y respeta el nombre sugerido", () => {
  const home = carpetaTemporal();
  const destino = carpetaTemporal();
  try {
    escribirSesion(home, { eventos: [texto("hola")] });
    const resultado = exportarSesion(home, SESION, destino, { tiposConocidos: CONOCIDOS });
    assert.ok(fs.existsSync(resultado.ruta), "el ZIP debería existir");
    assert.match(path.basename(resultado.ruta), /^dsh-sesion-[a-z0-9-]+-\d{8}\.zip$/);
    assert.equal(readZip(fs.readFileSync(resultado.ruta)).size, 3);

    const sueltos = fs.readdirSync(destino).filter((n) => n.includes(".tmp-"));
    assert.deepEqual(sueltos, [], "no deben quedar temporales");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test("exportar una sesión inexistente da un error claro", () => {
  const home = carpetaTemporal();
  try {
    assert.throws(() => construirBundle(home, "session-no-existe", { tiposConocidos: CONOCIDOS }), (error) => {
      assert.ok(error instanceof PackError);
      assert.match(error.message, /no encuentro la sesión/);
      return true;
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("un log ilegible se rechaza sin exportar nada", () => {
  const home = carpetaTemporal();
  try {
    const dir = path.join(sessionsRoot(home), BUCKET, SESION);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), "no es zstd");
    assert.throws(() => construirBundle(home, SESION, { tiposConocidos: CONOCIDOS }), PackError);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("el manifiesto se puede volver a leer como JSON (ida y vuelta)", () => {
  const home = carpetaTemporal();
  try {
    escribirSesion(home, { eventos: [texto("hola")] });
    const { zip } = construirBundle(home, SESION, { tiposConocidos: CONOCIDOS });
    const meta = JSON.parse(readZip(zip).get("meta.json").toString("utf8"));
    assert.equal(meta.formato, "dsh-bridge/1");
    assert.ok(Array.isArray(meta.adjuntos));
    assert.equal(typeof meta.log.sha256, "string");
    assert.equal(meta.log.sha256.length, 64);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
