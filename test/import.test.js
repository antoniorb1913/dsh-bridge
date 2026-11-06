/**
 * Tests de importación: validar el bundle, reescribir la ruta, copiar adjuntos,
 * registrar el workspace y no escribir nada si la app está abierta.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ImportError, analizarBundle, importarBundle } from "../src/core/import.js";
import { construirBundle } from "../src/core/pack.js";
import { attachmentPath, encodeSessionDirName, registryPath, sessionsRoot } from "../src/core/paths.js";
import { leerRegistro } from "../src/core/registry.js";
import { createZip, readZip } from "../src/core/zip.js";
import { decodeLogBuffer, encodeLogString, splitHeader } from "../src/core/zstd.js";

const SESION = "session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SESION_2 = "session-11111111-2222-3333-4444-555555555555";
const CONOCIDOS = new Set(["user/message", "tool/result", "session/title"]);

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const texto = (t) => ({ type: "user/message", seq: 0, time: 1, data: { message: { role: "user", content: [{ type: "text", text: t }] } } });
const imagen = (hash) => ({ type: "tool/result", seq: 1, time: 2, data: { message: { role: "tool", content: [{ type: "image", attachment: { attachmentId: `sha256:${hash}` } }] } } });
const carpetaTemporal = () => fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-import-"));

function escribirSesionOrigen(home, { id = SESION, cwd, eventos, adjuntos = [] }) {
  const dir = path.join(sessionsRoot(home), encodeSessionDirName(cwd), id);
  fs.mkdirSync(dir, { recursive: true });
  const cabecera = JSON.stringify({ type: "session", version: 4, id, createdAt: 1793554845064, cwd, isSeeded: false, agentPreset: "standard" });
  fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), encodeLogString([cabecera, ...eventos.map((e) => JSON.stringify(e))].join("\n") + "\n"));
  for (const contenido of adjuntos) {
    const hash = sha256(contenido);
    const destino = attachmentPath(home, hash);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
  }
}

/** Prepara un bundle con dos fotos citadas (y opcionalmente eventos extra). */
function prepararBundle({ cwd = "D:\\Users\\Origen\\Desktop\\web", id = SESION, conAdjuntos = true, extra = [], adaptar } = {}) {
  const origen = carpetaTemporal();
  const fotos = [Buffer.from("foto uno"), Buffer.from("foto dos")];
  const hashes = fotos.map(sha256);
  escribirSesionOrigen(origen, {
    id,
    cwd,
    eventos: [texto("hola"), ...(conAdjuntos ? hashes.map(imagen) : []), ...extra],
    adjuntos: conAdjuntos ? fotos : []
  });

  const { zip, meta } = construirBundle(origen, id, { tiposConocidos: CONOCIDOS, origenCompat: "asar", adaptar });
  const carpeta = carpetaTemporal();
  const archivo = path.join(carpeta, "bundle.zip");
  fs.writeFileSync(archivo, zip);
  fs.rmSync(origen, { recursive: true, force: true });
  return { archivo, carpeta, meta, hashes, zip };
}

const prepararDestino = () => ({ home: carpetaTemporal(), workspace: carpetaTemporal() });
const limpiar = (...dirs) => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));

test("importa una conversación con sus adjuntos y la registra", () => {
  const { archivo, carpeta, hashes } = prepararBundle();
  const { home, workspace } = prepararDestino();
  try {
    const resultado = importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false });

    assert.equal(resultado.sesionId, SESION);
    assert.equal(resultado.workspace, fs.realpathSync.native(workspace));
    assert.equal(resultado.adjuntos.copiados, 2);
    assert.deepEqual(resultado.adjuntos.faltan, []);
    assert.equal(resultado.registro.creado, true);
    assert.ok(fs.existsSync(resultado.rutaLog), "el log debería estar escrito");

    const log = decodeLogBuffer(fs.readFileSync(resultado.rutaLog));
    assert.equal(splitHeader(log).header.cwd, fs.realpathSync.native(workspace), "la ruta se reescribe");
    for (const hash of hashes) assert.ok(fs.existsSync(attachmentPath(home, hash)));

    const { registro } = leerRegistro(home);
    assert.equal(registro.global.workspaceIds.length, 1);
    assert.deepEqual(registro.tables.workspaces[resultado.registro.workspaceId].sessionIds, [SESION]);
  } finally {
    limpiar(carpeta, home, workspace);
  }
});

test("dos conversaciones en la misma carpeta comparten un solo workspace", () => {
  const primera = prepararBundle();
  const segunda = prepararBundle({ id: SESION_2 });
  const { home, workspace } = prepararDestino();
  try {
    const uno = importarBundle(primera.archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false });
    const dos = importarBundle(segunda.archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false });

    assert.equal(dos.registro.workspaceId, uno.registro.workspaceId, "no debe crear un workspace por conversación");
    assert.equal(dos.registro.creado, false);
    const { registro } = leerRegistro(home);
    assert.equal(registro.global.workspaceIds.length, 1);
    assert.deepEqual(registro.tables.workspaces[uno.registro.workspaceId].sessionIds, [SESION_2, SESION]);
  } finally {
    limpiar(primera.carpeta, segunda.carpeta, home, workspace);
  }
});

test("se niega a duplicar una sesión ya instalada, y con forzar deja copia", () => {
  const { archivo, carpeta } = prepararBundle();
  const { home, workspace } = prepararDestino();
  try {
    const primera = importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false });
    assert.throws(() => importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false }), (error) => {
      assert.ok(error instanceof ImportError);
      assert.match(error.message, /ya está instalada/);
      return true;
    });
    const forzada = importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false, forzar: true });
    assert.equal(forzada.reemplaza, true);
    const copias = fs.readdirSync(path.dirname(primera.rutaLog)).filter((n) => n.includes(".bak-"));
    assert.equal(copias.length, 1, "debería haber una copia de la sesión anterior");
  } finally {
    limpiar(carpeta, home, workspace);
  }
});

test("con la app abierta no escribe nada", () => {
  const { archivo, carpeta } = prepararBundle();
  const { home, workspace } = prepararDestino();
  try {
    assert.throws(() => importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: true }), (error) => {
      assert.ok(error instanceof ImportError);
      assert.match(error.message, /está abierto/);
      return true;
    });
    assert.equal(fs.existsSync(sessionsRoot(home)), false, "no debe haber escrito el log");
    assert.equal(fs.existsSync(registryPath(home)), false, "no debe haber escrito el registro");
  } finally {
    limpiar(carpeta, home, workspace);
  }
});

test("en seco informa de lo que haría sin escribir", () => {
  const { archivo, carpeta } = prepararBundle();
  const { home, workspace } = prepararDestino();
  try {
    const plan = importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, seco: true });
    assert.equal(plan.seco, true);
    assert.equal(plan.escrito, false);
    assert.equal(plan.reemplaza, false);
    assert.equal(fs.existsSync(sessionsRoot(home)), false);
    assert.equal(fs.existsSync(registryPath(home)), false);
  } finally {
    limpiar(carpeta, home, workspace);
  }
});

test("un workspace que no existe en este equipo da error claro", () => {
  const { archivo, carpeta } = prepararBundle();
  const { home } = prepararDestino();
  try {
    assert.throws(() => importarBundle(archivo, { home, workspace: path.join(home, "no-existe"), tiposConocidos: CONOCIDOS, appAbierta: false }), (error) => {
      assert.ok(error instanceof ImportError);
      assert.match(error.message, /no existe en este equipo/);
      return true;
    });
  } finally {
    limpiar(carpeta, home);
  }
});

test("un bundle manipulado se rechaza por el checksum del log", () => {
  const { zip, carpeta } = prepararBundle();
  const entradas = readZip(zip);
  const meta = JSON.parse(entradas.get("meta.json").toString("utf8"));
  meta.log.sha256 = "0".repeat(64);
  const manipulado = createZip(
    [...entradas].map(([nombre, data]) => ({
      name: nombre,
      data: nombre === "meta.json" ? Buffer.from(JSON.stringify(meta, null, 2)) : data
    }))
  );
  const archivo = path.join(carpeta, "manipulado.zip");
  fs.writeFileSync(archivo, manipulado);
  try {
    assert.throws(() => analizarBundle(archivo, { tiposConocidos: CONOCIDOS }), (error) => {
      assert.ok(error instanceof ImportError);
      assert.match(error.message, /no coincide con su checksum/);
      return true;
    });
  } finally {
    limpiar(carpeta);
  }
});

test("rechaza un ZIP sin manifiesto y uno con formato desconocido", () => {
  const carpeta = carpetaTemporal();
  try {
    const sinMeta = path.join(carpeta, "sin-meta.zip");
    fs.writeFileSync(sinMeta, createZip([{ name: "hola.txt", data: Buffer.from("hola") }]));
    assert.throws(() => analizarBundle(sinMeta, {}), /no tiene meta\.json/);

    const otroFormato = path.join(carpeta, "otro.zip");
    fs.writeFileSync(
      otroFormato,
      createZip([
        { name: "meta.json", data: Buffer.from(JSON.stringify({ formato: "otra-cosa/9", log: {} })) },
        { name: "session/session.v4.jsonl.zstd", data: Buffer.alloc(10) }
      ])
    );
    assert.throws(() => analizarBundle(otroFormato, {}), /formato de bundle no soportado/);

    const basura = path.join(carpeta, "basura.zip");
    fs.writeFileSync(basura, Buffer.from("esto no es un zip"));
    assert.throws(() => analizarBundle(basura, {}), Error);
  } finally {
    limpiar(carpeta);
  }
});

test("adapta al importar los tipos que este harness no conoce", () => {
  const raro = { type: "job/registered", seq: 5, time: 6, data: { job: "x" } };
  // Exportado SIN adaptar: así la adaptación tiene que ocurrir al importar.
  const { archivo, carpeta, meta } = prepararBundle({ conAdjuntos: false, extra: [raro], adaptar: false });
  const { home, workspace } = prepararDestino();
  try {
    assert.equal(meta.compatibilidad.total, 0, "el bundle debe venir sin adaptar");
    const resultado = importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false });
    assert.equal(resultado.compatibilidad.total, 1);
    assert.deepEqual(resultado.compatibilidad.marcados, { "job/registered": 1 });
    assert.ok(resultado.avisos.some((aviso) => aviso.includes("ignorables")));
    const log = decodeLogBuffer(fs.readFileSync(resultado.rutaLog));
    assert.match(log, /"ignorable":true/);
  } finally {
    limpiar(carpeta, home, workspace);
  }
});

test("si el bundle no trae un adjunto citado, avisa y sigue", () => {
  const { zip, carpeta } = prepararBundle();
  const { home, workspace } = prepararDestino();
  try {
    const sinAdjuntos = createZip([...readZip(zip)].filter(([nombre]) => !nombre.startsWith("attachments/")).map(([name, data]) => ({ name, data })));
    const archivo = path.join(carpeta, "sin-adjuntos.zip");
    fs.writeFileSync(archivo, sinAdjuntos);

    const resultado = importarBundle(archivo, { home, workspace, tiposConocidos: CONOCIDOS, appAbierta: false });
    assert.equal(resultado.adjuntos.copiados, 0);
    assert.equal(resultado.adjuntos.faltan.length, 2);
    assert.ok(resultado.avisos.some((aviso) => aviso.includes("no traía")));
    assert.ok(fs.existsSync(resultado.rutaLog), "el log se importa igual");
  } finally {
    limpiar(carpeta, home, workspace);
  }
});
