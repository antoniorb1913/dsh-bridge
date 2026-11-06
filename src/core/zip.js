/**
 * ZIP mínimo, sin dependencias.
 *
 * Escribimos los ficheros SIN comprimir (`store`): el log ya va en Zstandard y
 * las imágenes ya están comprimidas, así que recomprimir solo gasta tiempo. El
 * resultado es un ZIP normal que Windows Explorer abre con doble clic.
 *
 * La lectura acepta `store` y `deflate`, para que también funcione con ZIP
 * creados por Explorer o por otras herramientas.
 *
 * Los nombres de entrada se validan en los dos sentidos: un ZIP es un fichero
 * que viene de fuera y sus rutas acaban escribiendo en disco, así que nunca se
 * aceptan rutas absolutas, `..` ni barras invertidas.
 */
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const tabla = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let valor = i;
    for (let bit = 0; bit < 8; bit += 1) {
      valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
    }
    tabla[i] = valor >>> 0;
  }
  return tabla;
})();

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN = 0x06054b50;
const LIMITE_ZIP64 = 0xffffffff;
const LIMITE_ENTRADAS = 0xffff;

/** Error de ZIP: fichero dañado, no soportado o con rutas peligrosas. */
export class ZipError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ZipError";
  }
}

/** CRC-32 (el que usa ZIP). */
export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Comprueba que el nombre de una entrada sea relativo y seguro.
 *
 * Al **leer** se aceptan barras invertidas porque Windows (`Compress-Archive`,
 * el «Enviar a > carpeta comprimida» de toda la vida) las escribe así, aunque
 * el estándar pida `/`. Al **escribir** no se permiten: siempre escribimos `/`.
 * @param {string} nombre
 * @param {{permitirBarrasInvertidas?: boolean}} [opciones]
 */
export function validarNombreEntrada(nombre, opciones = {}) {
  if (typeof nombre !== "string" || nombre.length === 0) throw new ZipError("entrada sin nombre");
  if (nombre.length > 0xffff) throw new ZipError(`nombre de entrada demasiado largo (${nombre.length} caracteres)`);
  if (opciones.permitirBarrasInvertidas !== true && nombre.includes("\\")) {
    throw new ZipError(`el nombre de entrada no puede llevar barras invertidas: ${nombre}`);
  }
  if (nombre.startsWith("/") || /^[A-Za-z]:/.test(nombre)) throw new ZipError(`ruta absoluta no permitida en el ZIP: ${nombre}`);
  if (nombre.split("/").some((tramo) => tramo === "..")) throw new ZipError(`ruta con «..» no permitida en el ZIP: ${nombre}`);
}

function dosDateTime(fecha) {
  const year = Math.max(1980, fecha.getFullYear());
  const dosTime = (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate();
  return { dosTime, dosDate };
}

/**
 * Construye un ZIP sin comprimir.
 * @param {{name: string, data: Buffer, date?: Date}[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  if (!Array.isArray(entries)) throw new ZipError("createZip espera una lista de entradas");
  if (entries.length > LIMITE_ENTRADAS) throw new ZipError(`demasiadas entradas para ZIP clásico (${entries.length})`);

  const partesLocales = [];
  const partesCentrales = [];
  let offset = 0;

  for (const entry of entries) {
    validarNombreEntrada(entry.name);
    if (!Buffer.isBuffer(entry.data)) throw new ZipError(`la entrada ${entry.name} no es un Buffer`);
    const data = entry.data;
    if (data.length > LIMITE_ZIP64) throw new ZipError(`la entrada ${entry.name} supera los 4 GB; ZIP64 no soportado`);

    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const { dosTime, dosDate } = dosDateTime(entry.date ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(FIRMA_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8); // método: store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    partesLocales.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(FIRMA_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    partesCentrales.push(central, name);

    offset += local.length + name.length + data.length;
    if (offset > LIMITE_ZIP64) throw new ZipError("el ZIP supera los 4 GB; ZIP64 no soportado");
  }

  const centralDir = Buffer.concat(partesCentrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(FIRMA_FIN, 0);
  fin.writeUInt16LE(0, 4);
  fin.writeUInt16LE(0, 6);
  fin.writeUInt16LE(entries.length, 8);
  fin.writeUInt16LE(entries.length, 10);
  fin.writeUInt32LE(centralDir.length, 12);
  fin.writeUInt32LE(offset, 16);
  fin.writeUInt16LE(0, 20);

  return Buffer.concat([...partesLocales, centralDir, fin]);
}

/**
 * Lee un ZIP a memoria (store o deflate).
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>}
 */
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new ZipError("readZip espera un Buffer");
  if (buffer.length < 22) throw new ZipError(`el archivo es demasiado pequeño para ser un ZIP (${buffer.length} bytes)`);

  // El índice final puede llevar hasta 64 KB de comentario detrás.
  let eocd = -1;
  const desde = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= desde; i -= 1) {
    if (buffer.readUInt32LE(i) === FIRMA_FIN) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("el archivo no es un ZIP válido (no encuentro el índice final)");

  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count === LIMITE_ENTRADAS || centralOffset === LIMITE_ZIP64) throw new ZipError("ZIP64 no soportado");
  if (centralOffset + 4 > buffer.length) throw new ZipError("el índice central apunta fuera del archivo");

  const files = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length) throw new ZipError(`índice central truncado en la entrada ${index}`);
    if (buffer.readUInt32LE(cursor) !== FIRMA_CENTRAL) throw new ZipError(`entrada central corrupta en el byte ${cursor}`);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    // Windows escribe `\`; se normaliza a `/` antes de validar y de comparar.
    const nombreNormalizado = name.replace(/\\/g, "/");
    if (nombreNormalizado.endsWith("/")) continue; // entrada de directorio: no es un fichero
    if (compressedSize === LIMITE_ZIP64 || uncompressedSize === LIMITE_ZIP64 || localOffset === LIMITE_ZIP64) {
      throw new ZipError(`la entrada ${name} usa ZIP64, no soportado`);
    }
    validarNombreEntrada(nombreNormalizado, { permitirBarrasInvertidas: true });
    if (localOffset + 30 > buffer.length) throw new ZipError(`cabecera local fuera del archivo en ${name}`);
    if (buffer.readUInt32LE(localOffset) !== FIRMA_LOCAL) throw new ZipError(`cabecera local corrupta en ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw new ZipError(`datos truncados en ${name}`);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new ZipError(`método de compresión no soportado (${method}) en ${name}`);

    if (data.length !== uncompressedSize) throw new ZipError(`tamaño inesperado en ${name}`);
    if (crc32(data) !== crc) throw new ZipError(`CRC incorrecto en ${name}: el ZIP está dañado`);
    files.set(nombreNormalizado, data);
  }
  return files;
}
