/**
 * Exportar una conversación a un bundle ZIP portable.
 *
 * El bundle es un ZIP normal (se abre con doble clic en Windows) con:
 *
 *   meta.json                       manifiesto con checksums y procedencia
 *   session/session.v4.jsonl.zstd   el log, tal cual o adaptado al destino
 *   attachments/objects/<2>/<hash>  solo los adjuntos que la conversación cita
 *   LEEME.txt                       qué es esto y cómo importarlo
 *
 * Dos decisiones que importan:
 *   - Se copian **solo** los adjuntos citados (una conversación puede citar 559
 *     de un almacén con miles).
 *   - Si el log trae tipos de evento que el harness destino no conoce, se marcan
 *     como ignorables aquí mismo, dejando constancia en `meta.json`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { recogerAdjuntos } from "./attachments.js";
import { nombreBase } from "./paths.js";
import { analizarTipos, marcarIgnorables, tiposPendientes } from "./compat.js";
import { findSession, readProjectionMeta } from "./sessions.js";
import { createZip } from "./zip.js";
import { decodeLogBuffer, encodeLogString, splitHeader } from "./zstd.js";

/** Error de exportación: sesión inexistente, log ilegible o destino no escribible. */
export class PackError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PackError";
  }
}

export const FORMATO = "dsh-bridge/1";
const VERSION_TOOL = "0.2.0";

/** Nombre de fichero seguro a partir de un título: sin acentos, ni espacios raros. */
export function slugDe(texto, maximo = 40) {
  const limpio = String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const corto = limpio.slice(0, maximo).replace(/-+$/, "");
  return corto === "" ? "sin-titulo" : corto;
}

/** Nombre propuesto: dsh-sesion-<slug>-<AAAAMMDD>.zip */
export function nombreSugerido(titulo, fecha = new Date()) {
  const sello = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, "0")}${String(fecha.getDate()).padStart(2, "0")}`;
  return `dsh-sesion-${slugDe(titulo)}-${sello}.zip`;
}

function textoLeeme(meta) {
  return [
    "Conversación de DeepSeek Harness exportada con dsh-bridge",
    "",
    `Conversación : ${meta.sesion.titulo ?? "(sin título)"}`,
    `Sesión       : ${meta.sesion.id}`,
    `Exportada    : ${meta.generado.fecha}`,
    `Workspace    : ${meta.workspace.ruta}`,
    `Eventos      : ${meta.log.eventos}`,
    `Adjuntos     : ${meta.adjuntos.length}`,
    "",
    "Contenido del ZIP:",
    "  meta.json                       manifiesto (con los sha256 de todo)",
    `  ${meta.log.ruta}   el log de la sesión`,
    "  attachments/objects/…           imágenes y ficheros que la conversación cita",
    "",
    "Cómo importarla en otro equipo:",
    "  dsh-bridge import <este-zip> --workspace <carpeta del proyecto>",
    "",
    "Aviso: dentro van tus conversaciones e imágenes, sin cifrar.",
    "Borra este ZIP cuando ya esté importado y no lo subas a ningún sitio.",
    ""
  ].join("\n");
}

/**
 * Construye el bundle en memoria.
 *
 * @param {string} home
 * @param {string} sessionId
 * @param {{tiposConocidos?: Set<string>, origenCompat?: string, adaptar?: boolean, ahora?: Date}} [opciones]
 * @returns {{zip: Buffer, meta: object, avisos: string[], nombre: string}}
 */
export function construirBundle(home, sessionId, opciones = {}) {
  const ahora = opciones.ahora ?? new Date();
  const encontrada = findSession(home, sessionId);
  if (encontrada === undefined) throw new PackError(`no encuentro la sesión ${sessionId} en ${home}`);

  const original = fs.readFileSync(encontrada.logPath);
  let texto;
  try {
    texto = decodeLogBuffer(original);
  } catch (error) {
    throw new PackError(`el log de ${sessionId} no se puede leer: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const { header, body } = splitHeader(texto);
  const eventos = body.length === 0 ? 0 : body.replace(/\n$/, "").split("\n").length;
  const avisos = [];

  // Compatibilidad: si se sabe qué entiende el destino, se marca lo que sobra.
  let logFinal = original;
  const compatibilidad = { origen: opciones.origenCompat ?? "desconocido", marcados: {}, total: 0 };
  if (opciones.adaptar !== false && opciones.tiposConocidos instanceof Set) {
    const { desconocidos } = analizarTipos(texto, opciones.tiposConocidos);
    if (desconocidos.size > 0) {
      const parcheado = marcarIgnorables(texto, desconocidos);
      logFinal = encodeLogString(parcheado.texto);
      compatibilidad.marcados = Object.fromEntries(parcheado.marcados);
      compatibilidad.total = parcheado.total;
      avisos.push(
        `se marcaron ${parcheado.total} sucesos como ignorables para que el harness destino pueda leer el log: ` +
          `${[...desconocidos].join(", ")}`
      );
      const pendientes = tiposPendientes(parcheado.texto, opciones.tiposConocidos);
      if (pendientes.size > 0) throw new PackError(`quedan tipos sin resolver tras adaptar el log: ${[...pendientes].join(", ")}`);
    }
  }

  // Adjuntos citados (del texto ya adaptado; los hashes no cambian al marcarlos).
  const hashes = new Set();
  for (const coincidencia of texto.matchAll(/sha256:([0-9a-f]{64})/g)) hashes.add(coincidencia[1]);
  const { objetos, faltan } = recogerAdjuntos(home, hashes);
  if (faltan.length > 0) {
    avisos.push(`faltan ${faltan.length} adjunto(s) en el almacén local: ${faltan.map((h) => h.slice(0, 12) + "…").join(", ")}`);
  }

  const proyeccion = readProjectionMeta(home, header.id);
  const titulo = proyeccion?.title;
  const nombreLog = `session/session.v${header.version}.jsonl.zstd`;

  const meta = {
    formato: FORMATO,
    generado: {
      por: "dsh-bridge",
      version: VERSION_TOOL,
      fecha: ahora.toISOString(),
      node: process.version,
      plataforma: `${process.platform}-${process.arch}`
    },
    sesion: {
      id: header.id,
      version: header.version,
      cwd: header.cwd,
      createdAt: header.createdAt,
      isSeeded: header.isSeeded === true,
      agentPreset: header.agentPreset ?? null,
      titulo: titulo ?? null
    },
    workspace: { ruta: header.cwd, titulo: header.cwd ? nombreBase(header.cwd) : null },
    log: {
      ruta: nombreLog,
      bytes: logFinal.length,
      sha256: crypto.createHash("sha256").update(logFinal).digest("hex"),
      eventos,
      tipos: Object.fromEntries(analizarTipos(texto, opciones.tiposConocidos ?? new Set()).usados)
    },
    adjuntos: [...objetos.entries()].map(([hash, contenido]) => ({
      sha256: hash,
      bytes: contenido.length,
      ruta: `attachments/objects/${hash.slice(0, 2)}/${hash}`
    })),
    compatibilidad,
    avisos
  };

  const entradas = [
    { name: "meta.json", data: Buffer.from(JSON.stringify(meta, null, 2) + "\n", "utf8"), date: ahora },
    { name: "LEEME.txt", data: Buffer.from(textoLeeme(meta), "utf8"), date: ahora },
    { name: nombreLog, data: logFinal, date: ahora }
  ];
  for (const [hash, contenido] of objetos) {
    entradas.push({ name: `attachments/objects/${hash.slice(0, 2)}/${hash}`, data: contenido, date: ahora });
  }

  return { zip: createZip(entradas), meta, avisos, nombre: nombreSugerido(titulo ?? header.id, ahora) };
}

/**
 * Exporta a disco (escritura atómica).
 * @param {string} home
 * @param {string} sessionId
 * @param {string} destino ruta del .zip (si es una carpeta, se usa el nombre sugerido)
 * @param {object} [opciones]
 */
export function exportarSesion(home, sessionId, destino, opciones = {}) {
  const { zip, meta, avisos, nombre } = construirBundle(home, sessionId, opciones);

  let rutaFinal = path.resolve(destino);
  if (fs.existsSync(rutaFinal) && fs.statSync(rutaFinal).isDirectory()) rutaFinal = path.join(rutaFinal, nombre);
  else if (!/\.zip$/i.test(rutaFinal)) rutaFinal = path.join(rutaFinal, nombre);

  fs.mkdirSync(path.dirname(rutaFinal), { recursive: true });
  const temporal = `${rutaFinal}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporal, zip);
    fs.renameSync(temporal, rutaFinal);
  } catch (error) {
    try {
      fs.rmSync(temporal, { force: true });
    } catch {
      /* ya no está */
    }
    throw new PackError(`no se pudo escribir el bundle en ${rutaFinal}`, { cause: error });
  }

  return { ruta: rutaFinal, bytes: zip.length, meta, avisos, nombre };
}
