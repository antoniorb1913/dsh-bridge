/**
 * Adjuntos de una conversación.
 *
 * DeepSeek Harness guarda cada adjunto (imágenes, ficheros) una sola vez, por
 * contenido, en `attachments/v1/objects/<2 primeros hex>/<sha256>`. Los eventos
 * del log solo citan el hash: `attachmentId: "sha256:<64 hex>"`.
 *
 * De ahí salen las tres reglas de este módulo:
 *   1. Al exportar se copian **solo** los citados, no todo el almacén.
 *   2. Al importar se copia con **dedupe**: lo que ya está no se reescribe.
 *   3. El hash se verifica antes de escribir. Un adjunto que no cuadra con su
 *      nombre es un bundle corrupto (o algo peor) y no entra.
 *
 * Faltar un adjunto no aborta: se avisa y se sigue, porque una conversación sin
 * una foto sigue siendo útil, y el usuario decide.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { attachmentPath } from "./paths.js";

/** Error de adjuntos: hash inválido, contenido que no cuadra o escritura fallida. */
export class AttachmentError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AttachmentError";
  }
}

const PATRON_HASH = /^[0-9a-f]{64}$/;

/** ¿Es un sha256 en hexadecimal minúscula? */
export function esHashValido(hash) {
  return typeof hash === "string" && PATRON_HASH.test(hash);
}

function exigirHash(hash) {
  if (!esHashValido(hash)) throw new AttachmentError(`hash de adjunto inválido: ${String(hash).slice(0, 80)}`);
  return hash;
}

/** Ruta del objeto dentro del almacén, comprobando el hash. */
export function rutaAdjunto(home, hash) {
  return attachmentPath(home, exigirHash(hash));
}

/** sha256 del contenido, en hexadecimal. */
export function huella(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Lee un adjunto del almacén.
 * @returns {Buffer | undefined} `undefined` si no existe
 */
export function leerAdjunto(home, hash) {
  const ruta = rutaAdjunto(home, hash);
  return fs.existsSync(ruta) ? fs.readFileSync(ruta) : undefined;
}

/**
 * Recoge del almacén los adjuntos citados, para exportarlos.
 * No lanza si falta alguno: los devuelve aparte.
 * @param {string} home
 * @param {Iterable<string>} citados
 * @returns {{objetos: Map<string, Buffer>, faltan: string[], bytes: number}}
 */
export function recogerAdjuntos(home, citados) {
  const objetos = new Map();
  const faltan = [];
  let bytes = 0;
  for (const hash of citados) {
    exigirHash(hash);
    if (objetos.has(hash)) continue;
    const contenido = leerAdjunto(home, hash);
    if (contenido === undefined) {
      faltan.push(hash);
      continue;
    }
    objetos.set(hash, contenido);
    bytes += contenido.length;
  }
  return { objetos, faltan, bytes };
}

/** Escribe un fichero de forma atómica (temporal + rename). */
function escribirAtomico(destino, contenido) {
  const temporal = `${destino}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  try {
    fs.writeFileSync(temporal, contenido);
    fs.renameSync(temporal, destino);
  } catch (error) {
    try {
      fs.rmSync(temporal, { force: true });
    } catch {
      /* el temporal ya no está */
    }
    throw error;
  }
}

/**
 * Instala en el almacén destino los adjuntos de un bundle.
 *
 * Verifica el contenido contra su hash antes de escribir y no reescribe lo que
 * ya existe (dedupe). Los que no vienen en el bundle se devuelven en `faltan`.
 *
 * @param {string} home destino
 * @param {Map<string, Buffer>} objetos contenido del bundle (hash → bytes)
 * @param {Iterable<string>} citados hashes que la conversación necesita
 * @returns {{copiados: number, yaExistian: number, faltan: string[], bytes: number}}
 */
export function instalarAdjuntos(home, objetos, citados) {
  let copiados = 0;
  let yaExistian = 0;
  let bytes = 0;
  const faltan = [];
  const vistos = new Set();

  for (const hash of citados) {
    exigirHash(hash);
    if (vistos.has(hash)) continue;
    vistos.add(hash);

    const destino = attachmentPath(home, hash);
    if (fs.existsSync(destino)) {
      yaExistian += 1;
      continue;
    }

    const contenido = objetos.get(hash);
    if (contenido === undefined) {
      faltan.push(hash);
      continue;
    }
    if (!Buffer.isBuffer(contenido)) throw new AttachmentError(`el adjunto ${hash.slice(0, 12)}… no es binario`);
    const real = huella(contenido);
    if (real !== hash) {
      throw new AttachmentError(
        `el adjunto ${hash.slice(0, 12)}… no coincide con su hash (el bundle está dañado): esperaba ${hash.slice(0, 12)}… y es ${real.slice(0, 12)}…`
      );
    }

    escribirAtomico(destino, contenido);
    copiados += 1;
    bytes += contenido.length;
  }

  return { copiados, yaExistian, faltan, bytes };
}

/** Cuenta cuántos de los citados no están en el almacén (sin copiar nada). */
export function adjuntosQueFaltan(home, citados) {
  const faltan = [];
  for (const hash of new Set(citados)) {
    exigirHash(hash);
    if (!fs.existsSync(attachmentPath(home, hash))) faltan.push(hash);
  }
  return faltan;
}

/** Tamaño total de los adjuntos presentes de una lista de hashes. */
export function tamanoAdjuntos(home, citados) {
  let bytes = 0;
  let presentes = 0;
  for (const hash of new Set(citados)) {
    exigirHash(hash);
    const ruta = attachmentPath(home, hash);
    if (!fs.existsSync(ruta)) continue;
    presentes += 1;
    bytes += fs.statSync(ruta).size;
  }
  return { presentes, bytes };
}
