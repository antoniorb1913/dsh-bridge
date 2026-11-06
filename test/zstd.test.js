/**
 * Tests del log de sesión: frames Zstandard, cabecera y recompresión.
 *
 * Todo se genera aquí mismo: nunca se usan conversaciones reales (REGLA 3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  LogFormatError,
  decodeLogBuffer,
  encodeLogString,
  readFrames,
  readLogHeader,
  splitHeader
} from "../src/core/zstd.js";

const ID = "session-11111111-2222-3333-4444-555555555555";
const CWD = "D:\\Users\\Ejemplo\\Desktop\\web";

function cabecera(extra = {}) {
  return JSON.stringify({
    type: "session",
    version: 4,
    id: ID,
    createdAt: 1793554845064,
    cwd: CWD,
    isSeeded: false,
    agentPreset: "standard",
    ...extra
  });
}

function evento(seq, texto) {
  return JSON.stringify({
    type: "user/message",
    seq,
    time: 1793554845064 + seq,
    data: { message: { role: "user", content: [{ type: "text", text: texto }] } }
  });
}

function logTexto(eventos = ["hola", "¿qué tal?", "adiós 👋"]) {
  return [cabecera(), ...eventos.map((texto, indice) => evento(indice, texto))].join("\n") + "\n";
}

function comprimir(texto) {
  return zlib.zstdCompressSync(Buffer.from(texto, "utf8"), {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 }
  });
}

test("la cabecera va en el primer frame y los eventos en el segundo", () => {
  const texto = logTexto();
  const buffer = encodeLogString(texto);

  const { frames, tornStart } = readFrames(buffer);
  assert.equal(tornStart, undefined);
  assert.equal(frames.length, 2);

  const primerFrame = zlib.zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString("utf8");
  // La app mete el salto de línea final dentro del primer frame (comprobado en logs reales).
  assert.equal(primerFrame, cabecera() + "\n");
  assert.equal(splitHeader(texto).headerLine, cabecera() + "\n");
});

test("ida y vuelta exacta, con acentos y emoji", () => {
  const texto = logTexto(["acentos: ñ á é í ó ú", "emoji: 👋🍺", "comillas: \" y \\ y \ttabulador"]);
  const recuperado = decodeLogBuffer(encodeLogString(texto));
  assert.equal(recuperado, texto);
});

test("un log sin eventos tiene un solo frame y cuerpo vacío", () => {
  const texto = cabecera() + "\n";
  const buffer = comprimir(texto);
  assert.equal(readFrames(buffer).frames.length, 1);

  const { header, body } = splitHeader(decodeLogBuffer(buffer));
  assert.equal(header.id, ID);
  assert.equal(header.cwd, CWD);
  assert.equal(body, "");
});

test("los frames que escribimos llevan checksum", () => {
  const buffer = encodeLogString(logTexto());
  const { frames } = readFrames(buffer);
  for (const frame of frames) {
    const descriptor = buffer.readUInt8(frame.start + 4);
    assert.equal((descriptor & 0x04) !== 0, true, "el frame debería declarar checksum");
  }
});

test("detecta la cola rota de una copia interrumpida", () => {
  const buffer = encodeLogString(logTexto());
  const cortado = buffer.subarray(0, buffer.length - 6);
  assert.throws(() => decodeLogBuffer(cortado), (error) => {
    assert.ok(error instanceof LogFormatError);
    assert.match(error.message, /frame incompleto/);
    return true;
  });
});

test("rechaza ficheros que no son Zstandard", () => {
  assert.throws(() => decodeLogBuffer(Buffer.from("esto no es un log de sesión")), LogFormatError);
});

test("rechaza cabeceras que no son de sesión", () => {
  assert.throws(() => splitHeader(JSON.stringify({ type: "otra-cosa" }) + "\n"), /cabecera de sesión/);
  assert.throws(() => splitHeader(JSON.stringify({ type: "session" }) + "\n"), /cabecera de sesión/);
  assert.throws(() => splitHeader("sin salto de línea"), /primera línea de cabecera/);
  assert.throws(() => splitHeader("{no es json}\n"), /JSON válido/);
});

test("lee la cabecera de un log grande sin descomprimir los eventos", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-zstd-"));
  try {
    // Datos aleatorios: así el fichero NO se queda en unos pocos KB al comprimir.
    const eventos = Array.from(
      { length: 4000 },
      (_, indice) => `mensaje ${indice} ` + crypto.randomBytes(64).toString("hex")
    );
    const texto = logTexto(eventos);
    const archivo = path.join(carpeta, "session.v4.jsonl.zstd");
    fs.writeFileSync(archivo, encodeLogString(texto));
    const tamano = fs.statSync(archivo).size;
    assert.ok(tamano > 200_000, `el fichero de prueba debería ser grande (es de ${tamano} bytes)`);

    const header = readLogHeader(archivo);
    assert.equal(header.id, ID);
    assert.equal(header.version, 4);
    assert.equal(header.cwd, CWD);

    // Y el log completo sigue siendo legible.
    assert.equal(decodeLogBuffer(fs.readFileSync(archivo)), texto);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("lee la cabecera aunque el primer frame pase de 64 KB", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-zstd-"));
  try {
    const relleno = crypto.randomBytes(120_000).toString("hex");
    const cabeceraGrande = cabecera({ nota: relleno });
    const archivo = path.join(carpeta, "session.v4.jsonl.zstd");
    fs.writeFileSync(archivo, comprimir(cabeceraGrande + "\n" + evento(0, "hola") + "\n"));

    const { frames } = readFrames(fs.readFileSync(archivo));
    assert.ok(frames[0].end > 64 * 1024, `el primer frame mide ${frames[0].end} bytes`);

    const header = readLogHeader(archivo);
    assert.equal(header.id, ID);
    assert.equal(header.nota, relleno);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("lee varios frames sueltos seguidos", () => {
  const buffer = Buffer.concat([comprimir("a"), comprimir("b"), comprimir("c")]);
  const { frames } = readFrames(buffer);
  assert.equal(frames.length, 3);
  const textos = frames.map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString("utf8"));
  assert.deepEqual(textos, ["a", "b", "c"]);
});
