/**
 * Tests del registro de workspaces: invariantes que la app exige al arrancar,
 * alta idempotente, desarchivado, copia previa y escritura atómica.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RegistryError,
  asegurarWorkspace,
  exigirRegistroValido,
  guardarRegistro,
  leerRegistro,
  registrarSesion,
  registroVacio,
  validarRegistro
} from "../src/core/registry.js";
import { registryPath } from "../src/core/paths.js";

const SESION = "session-11111111-2222-3333-4444-555555555555";

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-reg-"));
}

function registroCon(workspaces, global = {}) {
  return {
    unit: { name: "workspace", version: 2 },
    global: { initialized: true, workspaceIds: Object.keys(workspaces), archivedSessionIds: [], pinnedSessionIds: [], ...global },
    tables: { workspaces }
  };
}

test("el registro vacío tiene la forma que espera la app", () => {
  const vacio = registroVacio();
  assert.deepEqual(vacio.unit, { name: "workspace", version: 2 });
  assert.equal(vacio.global.initialized, false);
  assert.deepEqual(vacio.tables.workspaces, {});
  assert.deepEqual(validarRegistro(vacio), []);
});

test("leerRegistro sin fichero devuelve uno vacío y avisa de que no existe", () => {
  const home = carpetaTemporal();
  try {
    const { registro, existe, ruta } = leerRegistro(home);
    assert.equal(existe, false);
    assert.equal(ruta, registryPath(home));
    assert.equal(registro.global.initialized, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("leerRegistro conserva defaultWorkspaceId y rellena lo que falte", () => {
  const home = carpetaTemporal();
  try {
    const ruta = registryPath(home);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify({ unit: { name: "workspace", version: 2 }, global: { initialized: true, workspaceIds: [], defaultWorkspaceId: "abc" }, tables: { workspaces: {} } }));
    const { registro, existe } = leerRegistro(home);
    assert.equal(existe, true);
    assert.equal(registro.global.defaultWorkspaceId, "abc");
    assert.deepEqual(registro.global.archivedSessionIds, []);
    assert.deepEqual(registro.global.pinnedSessionIds, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("leerRegistro no traga un fichero corrupto", () => {
  const home = carpetaTemporal();
  try {
    const ruta = registryPath(home);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, "{no es json}");
    assert.throws(() => leerRegistro(home), RegistryError);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("validarRegistro detecta las incoherencias que impiden arrancar la app", () => {
  const bueno = registroCon({ a: { path: "D:\\web", title: "web", sessionIds: [SESION], createdAt: "x", updatedAt: "x" } });
  assert.deepEqual(validarRegistro(bueno), []);

  const ordenRoto = registroCon({ a: { path: "D:\\web", title: "web", sessionIds: [], createdAt: "x", updatedAt: "x" } }, { workspaceIds: ["a", "fantasma"] });
  assert.match(validarRegistro(ordenRoto).join(" "), /inexistente/);

  const rutaDuplicada = registroCon({
    a: { path: "D:\\web", title: "web", sessionIds: [], createdAt: "x", updatedAt: "x" },
    b: { path: "d:\\WEB", title: "otra", sessionIds: [], createdAt: "x", updatedAt: "x" }
  });
  assert.match(validarRegistro(rutaDuplicada).join(" "), /la reclaman/);

  const sesionDoble = registroCon({
    a: { path: "D:\\web", title: "web", sessionIds: [SESION], createdAt: "x", updatedAt: "x" },
    b: { path: "D:\\otra", title: "otra", sessionIds: [SESION], createdAt: "x", updatedAt: "x" }
  });
  assert.match(validarRegistro(sesionDoble).join(" "), /la cuentan/);

  const huerfano = registroCon(
    {
      a: { path: "D:\\web", title: "web", sessionIds: [], createdAt: "x", updatedAt: "x" },
      b: { path: "D:\\otra", title: "otra", sessionIds: [], createdAt: "x", updatedAt: "x" }
    },
    { workspaceIds: ["a"] }
  );
  assert.match(validarRegistro(huerfano).join(" "), /no está en el orden/);
});

test("exigirRegistroValido lanza con todos los problemas juntos", () => {
  const roto = registroCon({ a: { path: "D:\\web", title: "web", sessionIds: [], createdAt: "x", updatedAt: "x" } }, { workspaceIds: ["a", "fantasma"] });
  assert.throws(() => exigirRegistroValido(roto), (error) => {
    assert.ok(error instanceof RegistryError);
    assert.match(error.message, /inexistente/);
    return true;
  });
});

test("asegurarWorkspace crea el workspace y lo pone el primero", () => {
  const registro = registroVacio();
  const { workspaceId, creado, cambios } = asegurarWorkspace(registro, { path: "D:\\Users\\MSI-PC\\Desktop\\web", sessionId: SESION });

  assert.equal(creado, true);
  assert.equal(registro.global.workspaceIds[0], workspaceId);
  assert.equal(registro.global.initialized, true);
  assert.deepEqual(registro.tables.workspaces[workspaceId].sessionIds, [SESION]);
  assert.equal(registro.tables.workspaces[workspaceId].title, "web");
  assert.ok(cambios.includes("workspace creado (" + workspaceId + ")"));
  assert.deepEqual(validarRegistro(registro), []);
});

test("asegurarWorkspace es idempotente: la segunda vez no cambia nada", () => {
  const registro = registroVacio();
  const primera = asegurarWorkspace(registro, { path: "D:\\web", sessionId: SESION });
  const updatedAt = registro.tables.workspaces[primera.workspaceId].updatedAt;

  const segunda = asegurarWorkspace(registro, { path: "D:\\web", sessionId: SESION });
  assert.equal(segunda.workspaceId, primera.workspaceId);
  assert.deepEqual(segunda.cambios, []);
  assert.equal(registro.tables.workspaces[primera.workspaceId].updatedAt, updatedAt);
  assert.equal(Object.keys(registro.tables.workspaces).length, 1);
});

test("asegurarWorkspace reconoce la misma ruta escrita distinto", () => {
  const registro = registroVacio();
  const primera = asegurarWorkspace(registro, { path: "D:\\Users\\MSI-PC\\Desktop\\web", sessionId: SESION });
  const segunda = asegurarWorkspace(registro, { path: "d:/users/msi-pc/desktop/WEB", sessionId: "session-otra" });
  assert.equal(segunda.workspaceId, primera.workspaceId);
  assert.equal(Object.keys(registro.tables.workspaces).length, 1);
});

test("asegurarWorkspace desarchiva la sesión y limpia la marca pendiente", () => {
  const registro = registroCon(
    { a: { path: "D:\\web", title: "web", sessionIds: [], createdAt: "x", updatedAt: "x" } },
    { archivedSessionIds: [SESION], pendingMutation: { operation: "create", workspaceId: "a" } }
  );
  const { cambios } = asegurarWorkspace(registro, { path: "D:\\web", sessionId: SESION });
  assert.deepEqual(registro.global.archivedSessionIds, []);
  assert.equal(registro.global.pendingMutation, undefined);
  assert.ok(cambios.some((cambio) => cambio.includes("desarchivada")));
});

test("asegurarWorkspace se niega a contar la sesión en dos workspaces", () => {
  const registro = registroCon({ a: { path: "D:\\web", title: "web", sessionIds: [SESION], createdAt: "x", updatedAt: "x" } });
  assert.throws(() => asegurarWorkspace(registro, { path: "D:\\otra-carpeta", sessionId: SESION }), (error) => {
    assert.ok(error instanceof RegistryError);
    assert.match(error.message, /ya está asignada/);
    return true;
  });
});

test("guardarRegistro escribe JSON válido, deja copia previa y no deja temporales", () => {
  const home = carpetaTemporal();
  try {
    const ruta = registryPath(home);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(registroVacio()));

    const registro = registroVacio();
    asegurarWorkspace(registro, { path: "D:\\web", sessionId: SESION });
    const { copia } = guardarRegistro(home, registro, { appAbierta: false });

    assert.ok(copia && fs.existsSync(copia), "debería existir la copia previa");
    assert.match(path.basename(copia), /^workspace\.json\.bak-\d{14}$/);

    const leido = JSON.parse(fs.readFileSync(ruta, "utf8"));
    assert.deepEqual(validarRegistro(leido), []);
    assert.match(fs.readFileSync(ruta, "utf8"), /\n {2}"unit"/, "se espera JSON con dos espacios");

    const sueltos = fs.readdirSync(path.dirname(ruta)).filter((n) => n.includes(".tmp-"));
    assert.deepEqual(sueltos, [], "no deben quedar temporales");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guardarRegistro se niega con DeepSeek Harness abierto", () => {
  const home = carpetaTemporal();
  try {
    const registro = registroVacio();
    assert.throws(() => guardarRegistro(home, registro, { appAbierta: true }), (error) => {
      assert.ok(error instanceof RegistryError);
      assert.match(error.message, /está abierto/);
      return true;
    });
    assert.equal(fs.existsSync(registryPath(home)), false, "no debería haber escrito nada");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("guardarRegistro no escribe un registro incoherente", () => {
  const home = carpetaTemporal();
  const registro = registroCon({ a: { path: "D:\\web", title: "web", sessionIds: [SESION], createdAt: "x", updatedAt: "x" } }, { workspaceIds: ["a", "fantasma"] });
  assert.throws(() => guardarRegistro(home, registro, { appAbierta: false }), /incoherente/);
});

test("registrarSesion en seco no escribe y la segunda vez no hay cambios", () => {
  const home = carpetaTemporal();
  try {
    const seco = registrarSesion(home, { path: "D:\\web", sessionId: SESION }, { seco: true });
    assert.equal(seco.escrito, false);
    assert.equal(fs.existsSync(registryPath(home)), false);

    const primera = registrarSesion(home, { path: "D:\\web", sessionId: SESION }, { appAbierta: false });
    assert.equal(primera.escrito, true);
    assert.equal(primera.creado, true);
    assert.equal(primera.copia, undefined, "sin fichero previo no hay nada que copiar");

    const segunda = registrarSesion(home, { path: "D:\\web", sessionId: SESION }, { appAbierta: false });
    assert.deepEqual(segunda.cambios, []);
    assert.equal(segunda.workspaceId, primera.workspaceId);
    assert.ok(segunda.copia && fs.existsSync(segunda.copia), "la segunda sí debe dejar copia");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
