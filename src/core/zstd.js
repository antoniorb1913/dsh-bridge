/**
 * Lectura y escritura del log de una sesión de DeepSeek Harness.
 *
 * En disco el log (`session.v<N>.jsonl.zstd`) es una secuencia de frames
 * Zstandard independientes, con una exigencia del formato: el PRIMER frame
 * contiene exactamente la línea de cabecera (`{"type":"session",...}`) y los
 * siguientes contienen los eventos, uno por línea (JSONL).
 *
 * Recompressamos con checksum porque es lo que escribe la propia app: al
 * reescribir un log conviene que no se note la diferencia.
 *
 * Este módulo no sabe nada de sesiones ni de rutas: solo de bytes.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
const PASO_LECTURA_INICIAL = 64 * 1024;

/** Error de formato: el fichero no es un log de sesión legible. */
export class LogFormatError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LogFormatError";
  }
}

/**
 * Recorre los frames del buffer sin descomprimir.
 * Si el buffer termina a mitad de un frame devuelve `tornStart` con el byte
 * donde empezaba ese frame: es la señal de «cola rota» (copia interrumpida).
 * @param {Buffer} buffer
 * @returns {{frames: {start: number, end: number}[], tornStart: number | undefined}}
 */
export function readFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new LogFormatError(`firma Zstandard inválida en el byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new LogFormatError(`cabecera Zstandard corrupta en el byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new LogFormatError(`bloque Zstandard reservado en el byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames, tornStart: undefined };
}

/**
 * Descomprime el log completo a texto.
 * @param {Buffer} buffer
 * @returns {string}
 */
export function decodeLogBuffer(buffer) {
  const { frames, tornStart } = readFrames(buffer);
  if (frames.length === 0) throw new LogFormatError("el archivo no contiene ningún frame Zstandard");
  if (tornStart !== undefined) {
    throw new LogFormatError("el log termina con un frame incompleto (cola rota); expórtalo de nuevo con la app cerrada");
  }
  const partes = frames.map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
  return Buffer.concat(partes).toString("utf8");
}

/**
 * Separa la línea de cabecera del resto de eventos.
 *
 * `headerLine` **incluye el salto de línea final**: es exactamente el contenido
 * del primer frame, tal y como lo escribe la app (comprobado en logs reales).
 * @param {string} text
 * @returns {{header: any, headerLine: string, body: string}}
 */
export function splitHeader(text) {
  const newline = text.indexOf("\n");
  if (newline < 0) throw new LogFormatError("el log no tiene una primera línea de cabecera");
  const headerLine = text.slice(0, newline + 1);
  let header;
  try {
    header = JSON.parse(headerLine);
  } catch (error) {
    throw new LogFormatError("la cabecera del log no es JSON válido", { cause: error });
  }
  if (header === null || typeof header !== "object" || header.type !== "session" || typeof header.id !== "string") {
    throw new LogFormatError("la primera línea no es una cabecera de sesión válida");
  }
  return { header, headerLine, body: text.slice(newline + 1) };
}

/**
 * Vuelve a comprimir un log completo (cabecera en el primer frame).
 * @param {string} text
 * @returns {Buffer}
 */
export function encodeLogString(text) {
  const { headerLine, body } = splitHeader(text);
  const partes = [zlib.zstdCompressSync(Buffer.from(headerLine, "utf8"), CHECKSUM_OPTS)];
  if (body.length > 0) partes.push(zlib.zstdCompressSync(Buffer.from(body, "utf8"), CHECKSUM_OPTS));
  return Buffer.concat(partes);
}

/**
 * Lee solo la cabecera, sin descomprimir los eventos: es lo que permite
 * listar cien sesiones sin abrir cien logs de 34 MB.
 *
 * Lee un trozo y lo va doblando si la cabecera no cabe; un frame de cabecera
 * normal ocupa unos cientos de bytes.
 * @param {string} file
 * @returns {any}
 */
export function readLogHeader(file) {
  const total = fs.statSync(file).size;
  let limite = PASO_LECTURA_INICIAL;
  for (;;) {
    const buffer = leerPrefijo(file, Math.min(limite, total));
    const fin = finPrimerFrame(buffer);
    if (fin !== undefined) {
      const texto = zlib.zstdDecompressSync(buffer.subarray(0, fin)).toString("utf8");
      return splitHeader(texto).header;
    }
    if (buffer.length >= total) {
      throw new LogFormatError(`no se pudo leer la cabecera de ${file}: el primer frame no cabe en el fichero`);
    }
    limite *= 16;
  }
}

/** @param {string} file @param {number} bytes */
function leerPrefijo(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const leidos = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, leidos);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Final del primer frame, o `undefined` si el trozo leído se queda a medias
 * (entonces hay que leer más).
 * @param {Buffer} buffer
 * @returns {number | undefined}
 */
function finPrimerFrame(buffer) {
  const { frames } = readFrames(buffer);
  return frames.length > 0 ? frames[0].end : undefined;
}

export { ZSTD_MAGIC };
