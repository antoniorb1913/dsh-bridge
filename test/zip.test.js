/**
 * Tests del ZIP propio: escribir sin comprimir, leer store y deflate,
 * y rechazar lo que no debe entrar (rutas peligrosas, ZIP64, corrupción).
 *
 * Todo generado aquí: nunca se usan conversaciones reales (REGLA 3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { ZipError, createZip, crc32, readZip, validarNombreEntrada } from "../src/core/zip.js";

/**
 * Construye un ZIP con deflate, como lo haría otra herramienta (Explorer,
 * Commpressed-Archive…). Sirve para comprobar que sabemos leer lo ajeno.
 * @param {{name: string, data: Buffer}[]} entradas
 */
function zipConDeflate(entradas) {
  const locales = [];
  const centrales = [];
  let offset = 0;
  for (const { name, data } of entradas) {
    const nombre = Buffer.from(name, "utf8");
    const comprimido = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, nombre);

    offset += local.length + nombre.length + comprimido.length;
  }
  const centralDir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(centralDir.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...locales, centralDir, fin]);
}

test("ida y vuelta con texto, binario y un fichero vacío", () => {
  const entradas = [
    { name: "meta.json", data: Buffer.from('{"hola":"mundo"}', "utf8") },
    { name: "attachments/objects/ab/abcd", data: Buffer.from([0, 1, 2, 250, 255]) },
    { name: "vacio.txt", data: Buffer.alloc(0) }
  ];
  const leido = readZip(createZip(entradas));
  assert.equal(leido.size, 3);
  for (const { name, data } of entradas) {
    assert.deepEqual(leido.get(name), data, `contenido distinto en ${name}`);
  }
});

test("conserva nombres con acentos, emoji y subcarpetas", () => {
  const entradas = [
    { name: "carpeta/ñandú.txt", data: Buffer.from("acentos") },
    { name: "fotos/🍺-bar.webp", data: Buffer.from("emoji") },
    { name: "a/b/c/d.txt", data: Buffer.from("hondo") }
  ];
  const leido = readZip(createZip(entradas));
  assert.deepEqual([...leido.keys()].sort(), entradas.map((e) => e.name).sort());
  assert.equal(leido.get("fotos/🍺-bar.webp").toString(), "emoji");
});

test("lee un ZIP con deflate creado por otra herramienta", () => {
  const entradas = [
    { name: "hola.txt", data: Buffer.from("contenido comprimido ".repeat(50)) },
    { name: "datos/numero.bin", data: Buffer.from([9, 8, 7, 6]) }
  ];
  const leido = readZip(zipConDeflate(entradas));
  assert.equal(leido.size, 2);
  for (const { name, data } of entradas) assert.deepEqual(leido.get(name), data);
});

test("ignora las entradas de directorio, con / o con \\", () => {
  assert.equal(readZip(zipConDeflate([{ name: "carpeta/", data: Buffer.alloc(0) }])).size, 0);
  assert.equal(readZip(zipConDeflate([{ name: "carpeta\\", data: Buffer.alloc(0) }])).size, 0);
  assert.equal(
    readZip(zipConDeflate([
      { name: "carpeta\\", data: Buffer.alloc(0) },
      { name: "carpeta\\dentro.txt", data: Buffer.from("hola") }
    ])).size,
    1
  );
});

test("detecta un ZIP con el contenido alterado (CRC)", () => {
  const zip = createZip([{ name: "solo.txt", data: Buffer.from("contenido original") }]);
  const eocd = zip.length - 22;
  const inicioCentral = zip.readUInt32LE(eocd + 16);
  const danado = Buffer.from(zip);
  danado[inicioCentral - 1] ^= 0xff; // último byte de los datos
  assert.throws(() => readZip(danado), (error) => {
    assert.ok(error instanceof ZipError);
    assert.match(error.message, /CRC incorrecto/);
    return true;
  });
});

test("rechaza lo que no es un ZIP", () => {
  assert.throws(() => readZip(Buffer.from("no soy un zip")), /demasiado pequeño/i);
  assert.throws(() => readZip(Buffer.alloc(200, 7)), /no es un ZIP válido/);
});

test("rechaza ZIP64 con un mensaje claro", () => {
  const zip = createZip([{ name: "a.txt", data: Buffer.from("a") }]);
  const roto = Buffer.from(zip);
  roto.writeUInt16LE(0xffff, roto.length - 22 + 10); // total de entradas a 65535
  assert.throws(() => readZip(roto), /ZIP64/);
});

test("rechaza rutas peligrosas al leer un ZIP ajeno", () => {
  assert.throws(() => readZip(zipConDeflate([{ name: "../fuera.txt", data: Buffer.from("x") }])), /«\.\.»/);
  assert.throws(() => readZip(zipConDeflate([{ name: "/absoluta.txt", data: Buffer.from("x") }])), /absoluta/);
  assert.throws(() => readZip(zipConDeflate([{ name: "carpeta/../../fuera.txt", data: Buffer.from("x") }])), /«\.\.»/);
});

test("acepta (y normaliza) los nombres con barra invertida de Windows", () => {
  // `Compress-Archive` y el «Enviar a > carpeta comprimida» escriben `\`.
  const leido = readZip(
    zipConDeflate([
      { name: "carpeta\\dentro.txt", data: Buffer.from("hola") },
      { name: "attachments\\objects\\ab\\abcd", data: Buffer.from("binario") },
      { name: "..\\fuera.txt", data: Buffer.from("malo") }
    ].slice(0, 2))
  );
  assert.deepEqual([...leido.keys()].sort(), ["attachments/objects/ab/abcd", "carpeta/dentro.txt"]);
  assert.equal(leido.get("carpeta/dentro.txt").toString(), "hola");
});

test("una barra invertida no sirve para escapar del ZIP", () => {
  assert.throws(() => readZip(zipConDeflate([{ name: "..\\fuera.txt", data: Buffer.from("x") }])), /«\.\.»/);
});

test("no deja escribir rutas peligrosas", () => {
  assert.throws(() => createZip([{ name: "../fuera.txt", data: Buffer.from("x") }]), /«\.\.»/);
  assert.throws(() => createZip([{ name: "/absoluta.txt", data: Buffer.from("x") }]), /absoluta/);
  assert.throws(() => createZip([{ name: "", data: Buffer.from("x") }]), /sin nombre/);
  assert.throws(() => createZip([{ name: "a.txt", data: "no soy buffer" }]), /no es un Buffer/);
});

test("un ZIP vacío es válido y se lee vacío", () => {
  assert.equal(readZip(createZip([])).size, 0);
});

test("el CRC-32 coincide con el valor de referencia", () => {
  // Valor conocido de la comprobación estándar de CRC-32.
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("rechaza una bomba de descompresión por el tamaño declarado", () => {
  const entradas = [{ name: "log.bin", data: Buffer.alloc(64, 7) }];
  const zip = zipConDeflate(entradas);
  // Se miente en el índice central: la entrada dice pesar 3 GB.
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0, "debe haber índice central");
  zip.writeUInt32LE(3 * 1024 * 1024 * 1024, central + 24);

  assert.throws(() => readZip(zip), /declara .*MB y el tope es/);
});

test("el tope también se aplica a lo que realmente sale al inflar", () => {
  // Deflate de 10 MB de ceros: comprime a unos pocos KB, pero se declara poco
  // para colarse por la comprobación previa; el maxOutputLength lo corta.
  const datos = Buffer.alloc(10 * 1024 * 1024, 0);
  const zip = zipConDeflate([{ name: "gordo.bin", data: datos }]);
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(1024, central + 24); // declara 1 KB (mentira)
  assert.throws(() => readZip(zip, { limiteEntrada: 64 * 1024 }), ZipError);
});

test("valida los nombres de entrada", () => {
  assert.doesNotThrow(() => validarNombreEntrada("session/session.v4.jsonl.zstd"));
  assert.throws(() => validarNombreEntrada("a/../b"), ZipError);
  assert.throws(() => validarNombreEntrada("C:/Windows/x"), ZipError);
});
