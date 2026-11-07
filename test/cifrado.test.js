/**
 * Tests de cifrado: ida y vuelta, código distinto, paquete manipulado y
 * ficheros grandes en streaming.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CifradoError, cifrar, cifrarArchivo, derivarClave, descifrar, descifrarArchivo } from "../src/net/cifrado.js";

const CODIGO = "48291374";
const carpetaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-cifrado-"));

test("cifra y descifra un buffer", () => {
  const datos = Buffer.from("conversación de prueba, con acentos y ñ");
  const paquete = cifrar(datos, CODIGO);
  assert.ok(paquete.subarray(0, 4).toString() === "DSH1");
  assert.notDeepEqual(paquete, datos, "el paquete no debe parecerse al original");
  assert.deepEqual(descifrar(paquete, CODIGO), datos);
});

test("dos envíos del mismo contenido dan paquetes distintos (salt y nonce)", () => {
  const datos = Buffer.from("lo mismo");
  assert.notDeepEqual(cifrar(datos, CODIGO), cifrar(datos, CODIGO));
});

test("con otro código no se descifra", () => {
  const paquete = cifrar(Buffer.from("secreto"), CODIGO);
  assert.throws(() => descifrar(paquete, "111111"), CifradoError);
});

test("un solo byte cambiado invalida el paquete", () => {
  const paquete = cifrar(Buffer.from("contenido auténtico"), CODIGO);
  for (const posicion of [6, 20, paquete.length - 5, paquete.length - 1]) {
    const roto = Buffer.from(paquete);
    roto[posicion] ^= 0xff;
    assert.throws(() => descifrar(roto, CODIGO), CifradoError, `debería fallar al tocar el byte ${posicion}`);
  }
});

test("rechaza lo que no es un paquete de dsh-bridge", () => {
  assert.throws(() => descifrar(Buffer.from("no soy un paquete cifrado"), CODIGO), /demasiado pequeño/);
  const falso = Buffer.concat([Buffer.from("XXXX"), Buffer.alloc(60)]);
  assert.throws(() => descifrar(falso, CODIGO), /no es de dsh-bridge/);
});

test("derivarClave es determinista y depende del salt", () => {
  const salt = Buffer.alloc(16, 7);
  assert.deepEqual(derivarClave(CODIGO, salt), derivarClave(CODIGO, salt));
  assert.notDeepEqual(derivarClave(CODIGO, salt), derivarClave(CODIGO, Buffer.alloc(16, 8)));
  assert.equal(derivarClave(CODIGO, salt).length, 32);
  assert.throws(() => derivarClave("", salt), CifradoError);
  assert.throws(() => derivarClave(CODIGO, Buffer.alloc(5)), CifradoError);
});

test("cifra y descifra ficheros en streaming", async () => {
  const carpeta = carpetaTemporal();
  try {
    const original = path.join(carpeta, "original.bin");
    const contenido = crypto.randomBytes(3 * 1024 * 1024 + 123);
    fs.writeFileSync(original, contenido);

    const cifrado = path.join(carpeta, "cifrado.dshc");
    const salida = path.join(carpeta, "salida.bin");

    await cifrarArchivo(original, cifrado, CODIGO);
    assert.equal(fs.statSync(cifrado).size, contenido.length + 4 + 16 + 12 + 16);
    await descifrarArchivo(cifrado, salida, CODIGO);
    assert.deepEqual(fs.readFileSync(salida), contenido);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("un fichero cifrado con otro código no se descifra", async () => {
  const carpeta = carpetaTemporal();
  try {
    const original = path.join(carpeta, "original.bin");
    fs.writeFileSync(original, Buffer.from("datos un poco secretos"));
    const cifrado = path.join(carpeta, "cifrado.dshc");
    await cifrarArchivo(original, cifrado, CODIGO);
    await assert.rejects(() => descifrarArchivo(cifrado, path.join(carpeta, "x.bin"), "000000"), CifradoError);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("rechaza ficheros demasiado pequeños", async () => {
  const carpeta = carpetaTemporal();
  try {
    const pequeno = path.join(carpeta, "pequeno.bin");
    fs.writeFileSync(pequeno, Buffer.alloc(10));
    await assert.rejects(() => descifrarArchivo(pequeno, path.join(carpeta, "x.bin"), CODIGO), /demasiado pequeño/);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});
