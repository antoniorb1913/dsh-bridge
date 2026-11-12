/**
 * Tests de integración: el ciclo completo exportar → importar sobre almacenes
 * falsos, más la CLI ejecutada de verdad como proceso aparte.
 *
 * Ningún dato real: todo lo monta `test/ayudas/entorno.js`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ImportError, importarBundle } from "../src/core/import.js";
import { exportarSesion } from "../src/core/pack.js";
import { attachmentPath, canonicalize, registryPath, sessionsRoot } from "../src/core/paths.js";
import { leerRegistro, validarRegistro } from "../src/core/registry.js";
import { attachmentHashes, listSessions } from "../src/core/sessions.js";
import { createZip, readZip } from "../src/core/zip.js";
import { decodeLogBuffer } from "../src/core/zstd.js";
import { TIPOS_CONOCIDOS_020_RC2 } from "../src/core/compat.js";
import { carpetaTemporal, crearCasaFalsa } from "./ayudas/entorno.js";

const RAIZ = path.resolve(import.meta.dirname, "..");
const BIN = path.join(RAIZ, "bin", "dsh-bridge.js");

/** Ejecuta la CLI como proceso aparte y devuelve stdout, stderr y código. */
function cli(argumentos) {
  try {
    // Los almacenes son falsos: no tiene sentido que la comprobación de «app
    // abierta» mire el equipo donde corren las pruebas.
    const stdout = execFileSync(process.execPath, [BIN, ...argumentos], {
      encoding: "utf8",
      env: { ...process.env, DSH_BRIDGE_SKIP_APP_CHECK: "1", DSH_BRIDGE_SKIP_FIREWALL_CHECK: "1" }
    });
    return { stdout, stderr: "", codigo: 0 };
  } catch (error) {
    return {
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? ""),
      codigo: typeof error.status === "number" ? error.status : 1
    };
  }
}

/** Crea un almacén destino vacío con su carpeta de proyecto. */
function destinoVacio(nombre = "destino") {
  const home = carpetaTemporal("dsh-bridge-" + nombre + "-");
  const workspace = path.join(home, "proyecto");
  fs.mkdirSync(workspace, { recursive: true });
  return { home, workspace };
}

test("ciclo completo: exportar tres conversaciones e importarlas en otro equipo", () => {
  const origen = crearCasaFalsa();
  const destino = destinoVacio();
  const zips = carpetaTemporal("dsh-bridge-zips-");
  try {
    const exportados = [];
    for (const id of Object.values(origen.sesiones)) {
      const resultado = exportarSesion(origen.home, id, zips, { tiposConocidos: TIPOS_CONOCIDOS_020_RC2, origenCompat: "respaldo" });
      exportados.push(resultado);
    }
    assert.equal(exportados.length, 3);
    assert.ok(exportados.some((e) => e.meta.compatibilidad.total === 1), "la conversación rara debería llevar la marca ignorable");

    const importados = exportados.map((exportado) =>
      importarBundle(exportado.ruta, {
        home: destino.home,
        workspace: destino.workspace,
        tiposConocidos: TIPOS_CONOCIDOS_020_RC2,
        appAbierta: false
      })
    );
    assert.equal(importados.length, 3);
    assert.ok(importados.every((r) => r.escrito === true));

    // 1. Las tres conversaciones están y se leen.
    const sesiones = listSessions(destino.home, { full: true });
    assert.equal(sesiones.length, 3);
    assert.equal(sesiones.filter((s) => s.broken !== undefined).length, 0);

    // 2. La ruta se ha reescrito a la carpeta de este equipo.
    const esperado = canonicalize(destino.workspace);
    for (const sesion of sesiones) {
      const cabecera = JSON.parse(decodeLogBuffer(fs.readFileSync(sesion.logPath)).split("\n")[0]);
      assert.equal(cabecera.cwd, esperado);
    }

    // 3. Todos los adjuntos citados están en el almacén.
    for (const sesion of sesiones) {
      const hashes = attachmentHashes(decodeLogBuffer(fs.readFileSync(sesion.logPath)));
      for (const hash of hashes) assert.ok(fs.existsSync(attachmentPath(destino.home, hash)), `falta ${hash.slice(0, 8)}`);
    }

    // 4. El registro es coherente y hay un solo workspace con tres sesiones.
    const { registro } = leerRegistro(destino.home);
    assert.deepEqual(validarRegistro(registro), []);
    assert.equal(registro.global.workspaceIds.length, 1);
    assert.equal(registro.tables.workspaces[registro.global.workspaceIds[0]].sessionIds.length, 3);

    // 5. Los eventos no han cambiado de número (solo se añadió una marca).
    const recuentoOrigen = listSessions(origen.home, { full: true }).map((s) => s.attachments).sort();
    const recuentoDestino = sesiones.map((s) => s.attachments).sort();
    assert.deepEqual(recuentoDestino, recuentoOrigen);
  } finally {
    for (const dir of [origen.home, destino.home, zips]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un registro incoherente en el destino aborta sin escribir nada", () => {
  const origen = crearCasaFalsa();
  const destino = destinoVacio();
  const zips = carpetaTemporal("dsh-bridge-zips-");
  try {
    const exportado = exportarSesion(origen.home, origen.sesiones.texto, zips, { tiposConocidos: TIPOS_CONOCIDOS_020_RC2 });

    // Registro roto: dos workspaces se reparten la misma sesión.
    fs.mkdirSync(path.dirname(registryPath(destino.home)), { recursive: true });
    fs.writeFileSync(
      registryPath(destino.home),
      JSON.stringify({
        unit: { name: "workspace", version: 2 },
        global: { initialized: true, workspaceIds: ["a", "b"], archivedSessionIds: [], pinnedSessionIds: [] },
        tables: {
          workspaces: {
            a: { path: destino.workspace, title: "uno", sessionIds: [origen.sesiones.texto], createdAt: "x", updatedAt: "x" },
            b: { path: destino.workspace + "-2", title: "dos", sessionIds: [origen.sesiones.texto], createdAt: "x", updatedAt: "x" }
          }
        }
      })
    );

    assert.throws(() => importarBundle(exportado.ruta, { home: destino.home, workspace: destino.workspace, tiposConocidos: TIPOS_CONOCIDOS_020_RC2, appAbierta: false }), (error) => {
      assert.ok(error instanceof ImportError);
      assert.match(error.message, /incoherente/);
      return true;
    });
    assert.equal(fs.existsSync(sessionsRoot(destino.home)), false, "no debe haber escrito ningún log");
  } finally {
    for (const dir of [origen.home, destino.home, zips]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("un bundle truncado no deja restos a medias", () => {
  const origen = crearCasaFalsa();
  const destino = destinoVacio();
  const zips = carpetaTemporal("dsh-bridge-zips-");
  try {
    const exportado = exportarSesion(origen.home, origen.sesiones.imagenes, zips, { tiposConocidos: TIPOS_CONOCIDOS_020_RC2 });
    const roto = path.join(zips, "truncado.zip");
    const contenido = fs.readFileSync(exportado.ruta);
    fs.writeFileSync(roto, contenido.subarray(0, Math.floor(contenido.length / 2)));

    assert.throws(() => importarBundle(roto, { home: destino.home, workspace: destino.workspace, tiposConocidos: TIPOS_CONOCIDOS_020_RC2, appAbierta: false }), Error);
    assert.equal(fs.existsSync(sessionsRoot(destino.home)), false);
  } finally {
    for (const dir of [origen.home, destino.home, zips]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("si el bundle llega sin algunas fotos, avisa y el registro queda válido", () => {
  const origen = crearCasaFalsa();
  const destino = destinoVacio();
  const zips = carpetaTemporal("dsh-bridge-zips-");
  try {
    const exportado = exportarSesion(origen.home, origen.sesiones.imagenes, zips, { tiposConocidos: TIPOS_CONOCIDOS_020_RC2 });
    const entradas = readZip(fs.readFileSync(exportado.ruta));
    const sinFotos = createZip([...entradas].filter(([nombre]) => !nombre.startsWith("attachments/")).map(([name, data]) => ({ name, data })));
    const archivo = path.join(zips, "sin-fotos.zip");
    fs.writeFileSync(archivo, sinFotos);

    const resultado = importarBundle(archivo, { home: destino.home, workspace: destino.workspace, tiposConocidos: TIPOS_CONOCIDOS_020_RC2, appAbierta: false });
    assert.equal(resultado.adjuntos.copiados, 0);
    assert.equal(resultado.adjuntos.faltan.length, 2);
    assert.ok(resultado.avisos.some((aviso) => aviso.includes("no traía")));

    const { registro } = leerRegistro(destino.home);
    assert.deepEqual(validarRegistro(registro), []);
    assert.equal(listSessions(destino.home).length, 1);
  } finally {
    for (const dir of [origen.home, destino.home, zips]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("la CLI lista, diagnostica y exporta contra un almacén falso", () => {
  const casa = crearCasaFalsa();
  const salida = carpetaTemporal("dsh-bridge-salida-");
  try {
    const listado = cli(["list", "--json", "--dsh-home", casa.home]);
    assert.equal(listado.codigo, 0, listado.stderr);
    const sesiones = JSON.parse(listado.stdout);
    assert.equal(sesiones.length, 3);
    assert.ok(sesiones.some((sesion) => sesion.label === "Conversación con fotos"));

    const diagnostico = cli(["doctor", "--dsh-home", casa.home]);
    assert.equal(diagnostico.codigo, 0, diagnostico.stdout + diagnostico.stderr);
    assert.match(diagnostico.stdout, /todo en orden/);
    assert.match(diagnostico.stdout, /sesiones\s+:\s+3/);

    const exportacion = cli(["export", casa.sesiones.imagenes, "--dsh-home", casa.home, "-o", salida]);
    assert.equal(exportacion.codigo, 0, exportacion.stderr);
    assert.match(exportacion.stdout, /adjuntos\s+:\s+2/);
    assert.equal(fs.readdirSync(salida).filter((nombre) => nombre.endsWith(".zip")).length, 1);
  } finally {
    for (const dir of [casa.home, salida]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("la CLI importa en seco sin tocar el disco", () => {
  const origen = crearCasaFalsa();
  const destino = destinoVacio();
  const zips = carpetaTemporal("dsh-bridge-zips-");
  try {
    const exportado = exportarSesion(origen.home, origen.sesiones.texto, zips, { tiposConocidos: TIPOS_CONOCIDOS_020_RC2 });
    const seco = cli(["import", exportado.ruta, "--dsh-home", destino.home, "--workspace", destino.workspace, "--seco"]);
    assert.equal(seco.codigo, 0, seco.stderr);
    assert.match(seco.stdout, /en seco: no se ha escrito nada/);
    assert.equal(fs.existsSync(sessionsRoot(destino.home)), false);
    assert.equal(fs.existsSync(registryPath(destino.home)), false);
  } finally {
    for (const dir of [origen.home, destino.home, zips]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reimportar reemplaza solo y deja copia del anterior", () => {
  const origen = crearCasaFalsa();
  const destino = destinoVacio();
  const zips = carpetaTemporal("dsh-bridge-zips-");
  try {
    const exportado = exportarSesion(origen.home, origen.sesiones.texto, zips, { tiposConocidos: TIPOS_CONOCIDOS_020_RC2 });
    const primera = cli(["import", exportado.ruta, "--dsh-home", destino.home, "--workspace", destino.workspace]);
    assert.equal(primera.codigo, 0, primera.stderr);
    assert.match(primera.stdout, /importada en/);

    // La segunda vez no hay banderas que recordar: se reemplaza y avisa.
    const segunda = cli(["import", exportado.ruta, "--dsh-home", destino.home, "--workspace", destino.workspace]);
    assert.equal(segunda.codigo, 0, segunda.stderr);
    assert.match(segunda.stdout, /actualizada en/, "debe decir que la ha actualizado");
    assert.match(segunda.stdout, /la sesión anterior se guardó como/, "y que hay copia de la anterior");
    assert.equal(listSessions(destino.home).length, 1, "sigue habiendo una sola copia");
  } finally {
    for (const dir of [origen.home, destino.home, zips]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("la CLI explica los errores de uso sin volcar trazas", () => {
  const comandoMalo = cli(["inventado"]);
  assert.equal(comandoMalo.codigo, 2);
  assert.match(comandoMalo.stdout, /comando desconocido/);

  const sinZona = cli(["import", "no-existe.zip", "--dsh-home", carpetaTemporal("dsh-bridge-vacio-")]);
  assert.equal(sinZona.codigo, 1);
  assert.match(sinZona.stdout, /no existe el fichero/);
});

test("la ayuda y la versión funcionan sin DeepSeek Harness instalado", () => {
  // En un equipo sin la app no hay ~/.dsh: los dos comandos más básicos tienen
  // que responder igual (esto rompió el CI, que corre en un runner vacío).
  const sinDsh = path.join(carpetaTemporal("dsh-bridge-sin-"), "no-existe");

  const version = cli(["--version", "--dsh-home", sinDsh]);
  assert.equal(version.codigo, 0, version.stdout + version.stderr);
  assert.match(version.stdout, /^dsh-bridge \d+\.\d+\.\d+/m);

  const ayuda = cli(["--help", "--dsh-home", sinDsh]);
  assert.equal(ayuda.codigo, 0, ayuda.stdout + ayuda.stderr);
  assert.match(ayuda.stdout, /USO/);

  // Y lo que sí necesita la app, falla con un mensaje claro.
  const listado = cli(["list", "--dsh-home", sinDsh]);
  assert.equal(listado.codigo, 1);
  assert.match(listado.stdout, /no existe|no encuentro/);
});
