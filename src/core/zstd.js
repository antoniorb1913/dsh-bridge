/**
 * Lectura y escritura del log de una sesión de DeepSeek Harness.
 *
 * En disco el log (`session.v<N>.jsonl.zstd`) es una secuencia de frames
 * Zstandard independientes, con una exigencia del formato: el PRIMER frame
 * contiene exactamente la línea de cabecera (`{"type":"session",...}`) y los
 * siguientes contienen los eventos, uno por línea (JSONL).
 *
 * Escribimos cada frame con checksum, que es lo que produce la propia app.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const ZSTD_MAGIC = 0xfd2fb528;
const CHECKSUM_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };
const ZSTD_HEADER_OPTS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } };

export class LogFormatError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LogFormatError";
  }
}

/**
 * Recorre los frames del buffer sin descomprimir.
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
  const chunks = frames.map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Descomprime el log de un archivo.
 * @param {string} file
 * @returns {string}
 */
export function decodeLogFile(file) {
  return decodeLogBuffer(fs.readFileSync(file));
}

/**
 * Separa la línea de cabecera del resto de eventos.
 * @param {string} text
 * @returns {{header: any, headerLine: string, body: string}}
 */
export function splitHeader(text) {
  const newline = text.indexOf("\n");
  if (newline < 0) throw new LogFormatError("el log no tiene una primera línea de cabecera");
  const headerLine = text.slice(0, newline);
  const header = JSON.parse(headerLine);
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
  const parts = [zlib.zstdCompressSync(Buffer.from(headerLine, "utf8"), CHECKSUM_OPTS)];
  if (body.length > 0) parts.push(zlib.zstdCompressSync(Buffer.from(body, "utf8"), CHECKSUM_OPTS));
  return Buffer.concat(parts);
}

/**
 * Lee solo la cabecera, sin descomprimir los 34 MB de eventos.
 * @param {string} file
 * @returns {any}
 */
export function readLogHeader(file) {
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.alloc(64 * 1024);
    const read = fs.readSync(fd, chunk, 0, chunk.length, 0);
    const buffer = chunk.subarray(0, read);
    let frames = [];
    let tornStart;
    try {
      ({ frames, tornStart } = readFrames(buffer));
    } catch {
      tornStart = 0;
    }
    if (frames.length === 0 || tornStart !== undefined) {
      throw new LogFormatError(`no se pudo leer la cabecera de ${file} (frame inicial mayor de ${chunk.length} bytes)`);
    }
    const text = zlib.zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString("utf8");
    return splitHeader(text).header;
  } finally {
    fs.closeSync(fd);
  }
}

/** Comprueba que un buffer sea un log de sesión legible. */
export function assertLogFile(file) {
  const buffer = fs.readFileSync(file);
  const text = decodeLogBuffer(buffer);
  const { header } = splitHeader(text);
  return { header, bytes: buffer.length, text };
}

export { ZSTD_HEADER_OPTS };
