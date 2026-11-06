/**
 * Ayudas para montar un `DSH_HOME` de mentira completo en los tests.
 *
 * Todo se genera aquí: nunca se usan conversaciones reales (REGLA 3).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { attachmentPath, encodeSessionDirName, projCachePath, sessionsRoot } from "../../src/core/paths.js";
import { registroVacio, asegurarWorkspace, guardarRegistro } from "../../src/core/registry.js";
import { encodeLogString } from "../../src/core/zstd.js";

export const sha256 = (contenido) => crypto.createHash("sha256").update(contenido).digest("hex");

export function carpetaTemporal(prefijo = "dsh-bridge-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

/** Evento de mensaje del usuario. */
export const mensaje = (secuencia, texto) => ({
  type: "user/message",
  seq: secuencia,
  time: 1793554845000 + secuencia,
  data: { message: { role: "user", content: [{ type: "text", text: texto }] } }
});

/** Evento con una imagen adjunta. */
export const imagen = (secuencia, hash) => ({
  type: "tool/result",
  seq: secuencia,
  time: 1793554845000 + secuencia,
  data: { message: { role: "tool", content: [{ type: "image", attachment: { attachmentId: `sha256:${hash}`, mediaType: "image/png" } }] } }
});

/** Evento de tipo que esta versión no conoce. */
export const eventoRaro = (secuencia) => ({ type: "job/registered", seq: secuencia, time: 1793554845000 + secuencia, data: { job: "x" } });

/** Título en la caché de proyecciones, como lo guarda la app. */
export function escribirTitulo(home, sessionId, titulo) {
  const archivo = projCachePath(home, sessionId);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify({ version: 7, record: { rows: { title: { val: titulo }, sessionListMetadata: { val: { blank: false } } } } }));
}

/**
 * Crea una sesión completa en un home falso.
 *
 * @param {string} home
 * @param {{id: string, cwd: string, titulo?: string, eventos?: object[], fotos?: Buffer[]}} datos
 * @returns {string} ruta del log escrito
 */
export function crearSesion(home, datos) {
  const { id, cwd, titulo, eventos = [mensaje(0, "hola")], fotos = [] } = datos;
  const carpeta = path.join(sessionsRoot(home), encodeSessionDirName(cwd), id);
  fs.mkdirSync(carpeta, { recursive: true });

  const cabecera = JSON.stringify({ type: "session", version: 4, id, createdAt: 1793554845064, cwd, isSeeded: false, agentPreset: "standard" });
  const log = path.join(carpeta, "session.v4.jsonl.zstd");
  fs.writeFileSync(log, encodeLogString([cabecera, ...eventos.map((evento) => JSON.stringify(evento))].join("\n") + "\n"));

  for (const foto of fotos) {
    const ruta = attachmentPath(home, sha256(foto));
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, foto);
  }
  if (titulo !== undefined) escribirTitulo(home, id, titulo);
  return log;
}

/**
 * Monta un almacén con tres conversaciones: una de texto, una con imágenes y
 * una con un evento que esta versión no conoce.
 *
 * @param {{cwd?: string, registrar?: boolean}} [opciones]
 */
export function crearCasaFalsa(opciones = {}) {
  const home = carpetaTemporal("dsh-bridge-home-");
  const cwd = opciones.cwd ?? path.join(home, "proyecto");
  fs.mkdirSync(cwd, { recursive: true });

  const fotos = [Buffer.from("foto uno"), Buffer.from("foto dos")];
  const hashes = fotos.map(sha256);

  const sesiones = {
    texto: "session-00000000-0000-4000-8000-000000000001",
    imagenes: "session-00000000-0000-4000-8000-000000000002",
    rara: "session-00000000-0000-4000-8000-000000000003"
  };

  crearSesion(home, { id: sesiones.texto, cwd, titulo: "Conversación de texto", eventos: [mensaje(0, "solo texto")] });
  crearSesion(home, {
    id: sesiones.imagenes,
    cwd,
    titulo: "Conversación con fotos",
    eventos: [mensaje(0, "mira estas fotos"), imagen(1, hashes[0]), imagen(2, hashes[1])],
    fotos
  });
  const logRara = crearSesion(home, {
    id: sesiones.rara,
    cwd,
    titulo: "Conversación con evento nuevo",
    eventos: [mensaje(0, "esto trae un tipo nuevo"), eventoRaro(1)]
  });

  if (opciones.registrar !== false) {
    const registro = registroVacio();
    for (const id of Object.values(sesiones)) asegurarWorkspace(registro, { path: cwd, sessionId: id });
    guardarRegistro(home, registro, { appAbierta: false });
  }

  return { home, cwd, sesiones, fotos, hashes, logRara };
}
