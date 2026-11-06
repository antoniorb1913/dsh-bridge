/**
 * Tests de adjuntos: recoger lo citado, instalar con dedupe, verificar el hash
 * y no dejar temporales.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AttachmentError,
  adjuntosQueFaltan,
  esHashValido,
  huella,
  instalarAdjuntos,
  leerAdjunto,
  recogerAdjuntos,
  rutaAdjunto,
  tamanoAdjuntos
} from "../src/core/attachments.js";
import { attachmentsRoot } from "../src/core/paths.js";

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-att-"));
}

/** Mete un adjunto en el almacén y devuelve su hash. */
function guardarAdjunto(home, contenido) {
  const hash = huella(contenido);
  const destino = rutaAdjunto(home, hash);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido);
  return hash;
}

test("recoge solo los adjuntos citados y avisa de los que faltan", () => {
  const home = carpetaTemporal();
  try {
    const uno = guardarAdjunto(home, Buffer.from("primera foto"));
    const dos = guardarAdjunto(home, Buffer.from("segunda foto"));
    const perdido = huella(Buffer.from("no está en el almacén"));

    const { objetos, faltan, bytes } = recogerAdjuntos(home, [uno, dos, perdido, uno]);
    assert.equal(objetos.size, 2);
    assert.deepEqual(faltan, [perdido]);
    assert.equal(bytes, "primera foto".length + "segunda foto".length);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("instala en el destino creando la carpeta del prefijo", () => {
  const destino = carpetaTemporal();
  try {
    const contenido = Buffer.from("contenido binario de prueba");
    const hash = huella(contenido);
    const resultado = instalarAdjuntos(destino, new Map([[hash, contenido]]), [hash]);

    assert.deepEqual(resultado, { copiados: 1, yaExistian: 0, faltan: [], bytes: contenido.length });
    const esperado = path.join(attachmentsRoot(destino), "objects", hash.slice(0, 2), hash);
    assert.ok(fs.existsSync(esperado), "el adjunto debería estar en su ruta");
    assert.deepEqual(fs.readFileSync(esperado), contenido);
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test("no reescribe lo que ya existe (dedupe)", () => {
  const destino = carpetaTemporal();
  try {
    const contenido = Buffer.from("foto compartida");
    const hash = huella(contenido);
    const primero = instalarAdjuntos(destino, new Map([[hash, contenido]]), [hash]);
    const mtime = fs.statSync(rutaAdjunto(destino, hash)).mtimeMs;

    const segundo = instalarAdjuntos(destino, new Map([[hash, Buffer.from("otra cosa")]]), [hash]);
    assert.equal(primero.copiados, 1);
    assert.equal(segundo.copiados, 0);
    assert.equal(segundo.yaExistian, 1);
    assert.equal(fs.statSync(rutaAdjunto(destino, hash)).mtimeMs, mtime, "no debería haberse tocado");
    assert.equal(fs.readFileSync(rutaAdjunto(destino, hash)).toString(), "foto compartida");
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test("un adjunto que no cuadra con su hash no entra", () => {
  const destino = carpetaTemporal();
  try {
    const bonito = Buffer.from("contenido bueno");
    const hashEsperado = huella(bonito);
    const tramposo = Buffer.from("contenido cambiado");

    assert.throws(() => instalarAdjuntos(destino, new Map([[hashEsperado, tramposo]]), [hashEsperado]), (error) => {
      assert.ok(error instanceof AttachmentError);
      assert.match(error.message, /no coincide con su hash/);
      return true;
    });
    assert.equal(fs.existsSync(rutaAdjunto(destino, hashEsperado)), false, "no debe quedar nada escrito");
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test("rechaza hashes que no son sha256 (y no sirven para escapar rutas)", () => {
  const home = carpetaTemporal();
  try {
    assert.equal(esHashValido("a".repeat(64)), true);
    assert.equal(esHashValido("A".repeat(64)), false);
    assert.equal(esHashValido("../../evil"), false);
    assert.equal(esHashValido("a".repeat(63)), false);
    for (const malo of ["../../evil", "a".repeat(63), "", "zz".repeat(32)]) {
      assert.throws(() => rutaAdjunto(home, malo), AttachmentError);
      assert.throws(() => recogerAdjuntos(home, [malo]), AttachmentError);
      assert.throws(() => instalarAdjuntos(home, new Map(), [malo]), AttachmentError);
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("si falta un adjunto se avisa y no aborta", () => {
  const destino = carpetaTemporal();
  try {
    const presente = Buffer.from("está");
    const hashPresente = huella(presente);
    const hashAusente = huella(Buffer.from("no viaja en el bundle"));

    const resultado = instalarAdjuntos(destino, new Map([[hashPresente, presente]]), [hashPresente, hashAusente]);
    assert.equal(resultado.copiados, 1);
    assert.deepEqual(resultado.faltan, [hashAusente]);
    assert.equal(fs.existsSync(rutaAdjunto(destino, hashAusente)), false);
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test("no deja ficheros temporales tras instalar", () => {
  const destino = carpetaTemporal();
  try {
    const contenido = Buffer.from("sin restos");
    const hash = huella(contenido);
    instalarAdjuntos(destino, new Map([[hash, contenido]]), [hash]);
    const sueltos = [];
    const recorrer = (dir) => {
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(ruta);
        else if (entrada.name.includes(".tmp-")) sueltos.push(ruta);
      }
    };
    recorrer(attachmentsRoot(destino));
    assert.deepEqual(sueltos, []);
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
});

test("leerAdjunto devuelve undefined si no está y el contenido si está", () => {
  const home = carpetaTemporal();
  try {
    const contenido = Buffer.from([1, 2, 3, 4]);
    const hash = guardarAdjunto(home, contenido);
    assert.deepEqual(leerAdjunto(home, hash), contenido);
    assert.equal(leerAdjunto(home, huella(Buffer.from("no"))), undefined);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("adjuntosQueFaltan y tamanoAdjuntos informan sin escribir nada", () => {
  const home = carpetaTemporal();
  try {
    const contenido = Buffer.from("peso");
    const presente = guardarAdjunto(home, contenido);
    const ausente = huella(Buffer.from("otro"));

    assert.deepEqual(adjuntosQueFaltan(home, [presente, ausente, presente]), [ausente]);
    assert.deepEqual(tamanoAdjuntos(home, [presente, ausente]), { presentes: 1, bytes: contenido.length });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
