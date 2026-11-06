/**
 * Registro de workspaces de DeepSeek Harness (`storages/workspace.json`).
 *
 * Es el fichero que decide qué conversaciones se ven. El dominio `workspace`
 * versión 2 tiene tres partes:
 *
 *   unit     { name: "workspace", version: 2 }
 *   global   { initialized, workspaceIds (orden), archivedSessionIds,
 *              pinnedSessionIds, defaultWorkspaceId?, pendingMutation? }
 *   tables.workspaces  { <id>: { path, title, sessionIds, createdAt, updatedAt } }
 *
 * La app **valida este fichero al arrancar y aborta si está incoherente**
 * (`workspace domain is inconsistent: …`). Por eso aquí se comprueba antes de
 * escribir, y por eso se guarda una copia previa: es el único fichero del
 * almacén cuyo estropicio impide abrir DeepSeek Harness.
 *
 * Tres invariantes que se respetan siempre:
 *   1. `workspaceIds` referencia exactamente las entradas de la tabla (ni más
 *      ni menos), sin repetir.
 *   2. Una ruta pertenece a un solo workspace.
 *   3. Una sesión está contada por un solo workspace.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { isAppRunning, nombreBase, registryPath, samePath } from "./paths.js";

/** Error del registro: fichero incoherente, sesión ya asignada o app abierta. */
export class RegistryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RegistryError";
  }
}

const VERSION = 2;

/** Registro vacío, con la forma exacta que escribe la app. */
export function registroVacio() {
  return {
    unit: { name: "workspace", version: VERSION },
    global: {
      initialized: false,
      workspaceIds: [],
      archivedSessionIds: [],
      pinnedSessionIds: []
    },
    tables: { workspaces: {} }
  };
}

/**
 * Lee el registro. Si no existe devuelve uno vacío y `existe: false`; quien
 * llame decide si eso es un problema (en un DSH recién instalado lo normal es
 * que aún no haya fichero).
 * @param {string} home
 */
export function leerRegistro(home) {
  const ruta = registryPath(home);
  if (!fs.existsSync(ruta)) return { registro: registroVacio(), ruta, existe: false };

  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(ruta, "utf8"));
  } catch (error) {
    throw new RegistryError(`el registro de workspaces no es JSON válido (${ruta}). No lo toco.`, { cause: error });
  }
  if (datos === null || typeof datos !== "object") throw new RegistryError(`el registro de workspaces está vacío o no es un objeto (${ruta})`);

  // Rellena lo que falte con los valores que la propia app usa por defecto.
  const registro = {
    ...datos,
    unit: datos.unit ?? { name: "workspace", version: VERSION },
    global: {
      initialized: datos.global?.initialized === true,
      workspaceIds: Array.isArray(datos.global?.workspaceIds) ? [...datos.global.workspaceIds] : [],
      archivedSessionIds: Array.isArray(datos.global?.archivedSessionIds) ? [...datos.global.archivedSessionIds] : [],
      pinnedSessionIds: Array.isArray(datos.global?.pinnedSessionIds) ? [...datos.global.pinnedSessionIds] : [],
      ...(datos.global?.defaultWorkspaceId === undefined ? {} : { defaultWorkspaceId: datos.global.defaultWorkspaceId })
    },
    tables: { workspaces: { ...(datos.tables?.workspaces ?? {}) } }
  };
  return { registro, ruta, existe: true };
}

/**
 * Comprueba las invariantes. Devuelve la lista de problemas (vacía si está bien).
 * @param {object} registro
 * @returns {string[]}
 */
export function validarRegistro(registro) {
  const problemas = [];
  if (registro?.unit?.name !== "workspace") problemas.push(`unit.name inesperado: ${JSON.stringify(registro?.unit?.name)}`);
  if (registro?.unit?.version !== VERSION) problemas.push(`versión de dominio inesperada: ${JSON.stringify(registro?.unit?.version)} (se esperaba ${VERSION})`);

  const tabla = registro?.tables?.workspaces;
  const orden = registro?.global?.workspaceIds;
  if (tabla === null || typeof tabla !== "object") return [...problemas, "falta tables.workspaces"];
  if (!Array.isArray(orden)) return [...problemas, "falta global.workspaceIds"];

  const vistos = new Set();
  for (const id of orden) {
    if (vistos.has(id)) problemas.push(`el orden repite el workspace ${id}`);
    vistos.add(id);
    if (tabla[id] === undefined) problemas.push(`el orden referencia un workspace inexistente: ${id}`);
  }
  if (registro.global.initialized === true && orden.length !== Object.keys(tabla).length) {
    const huerfano = Object.keys(tabla).find((id) => !vistos.has(id));
    problemas.push(`el workspace ${huerfano ?? "desconocido"} no está en el orden`);
  }

  const rutas = new Map();
  const sesiones = new Map();
  for (const [id, ficha] of Object.entries(tabla)) {
    for (const campo of ["path", "title", "sessionIds", "createdAt", "updatedAt"]) {
      if (ficha?.[campo] === undefined) problemas.push(`el workspace ${id} no tiene ${campo}`);
    }
    if (typeof ficha?.path !== "string") {
      problemas.push(`el workspace ${id} tiene una ruta que no es texto`);
      continue;
    }
    const previo = rutas.get(ficha.path.toLowerCase());
    if (previo !== undefined) problemas.push(`la ruta ${ficha.path} la reclaman ${previo} y ${id}`);
    rutas.set(ficha.path.toLowerCase(), id);

    if (!Array.isArray(ficha.sessionIds)) continue;
    for (const sessionId of ficha.sessionIds) {
      const dueno = sesiones.get(sessionId);
      if (dueno !== undefined) problemas.push(`la sesión ${sessionId} la cuentan ${dueno} y ${id}`);
      sesiones.set(sessionId, id);
    }
  }
  return problemas;
}

/** Lanza si el registro no es válido (con el detalle de todos los problemas). */
export function exigirRegistroValido(registro) {
  const problemas = validarRegistro(registro);
  if (problemas.length > 0) {
    throw new RegistryError(`el registro de workspaces es incoherente y DeepSeek Harness no arrancaría:\n - ${problemas.join("\n - ")}`);
  }
  return registro;
}

/**
 * Garantiza que existe un workspace para `ruta` y que la sesión está dentro.
 *
 * Es idempotente: repetir la llamada no duplica nada ni cambia `updatedAt` si
 * no hay nada que cambiar.
 *
 * @param {object} registro
 * @param {{path: string, title?: string, sessionId: string}} datos `path` debe venir ya canonicalizado
 * @returns {{workspaceId: string, creado: boolean, cambios: string[]}}
 */
export function asegurarWorkspace(registro, datos) {
  const { path: ruta, sessionId } = datos;
  if (typeof ruta !== "string" || ruta === "") throw new RegistryError("falta la ruta del workspace");
  if (typeof sessionId !== "string" || sessionId === "") throw new RegistryError("falta el id de la sesión");

  const tabla = registro.tables.workspaces;
  const global = registro.global;
  const cambios = [];

  // La sesión no puede estar contada por otro workspace: la app no arrancaría.
  const dueno = Object.entries(tabla).find(([, ficha]) => Array.isArray(ficha?.sessionIds) && ficha.sessionIds.includes(sessionId));
  if (dueno !== undefined && !samePath(tabla[dueno[0]].path, ruta)) {
    throw new RegistryError(
      `la sesión ${sessionId} ya está asignada al workspace «${tabla[dueno[0]].title}» (${tabla[dueno[0]].path}); ` +
        "no se puede meter en dos a la vez sin romper el registro"
    );
  }

  let workspaceId = Object.keys(tabla).find((id) => samePath(tabla[id]?.path ?? "", ruta));
  const ahora = new Date().toISOString();

  if (workspaceId === undefined) {
    workspaceId = crypto.randomUUID();
    tabla[workspaceId] = {
      path: ruta,
      title: datos.title && String(datos.title).trim() !== "" ? String(datos.title).trim() : nombreBase(ruta) || ruta,
      sessionIds: [sessionId],
      createdAt: ahora,
      updatedAt: ahora
    };
    global.workspaceIds = [workspaceId, ...global.workspaceIds];
    global.initialized = true;
    cambios.push(`workspace creado (${workspaceId})`);
  } else {
    const ficha = tabla[workspaceId];
    if (!Array.isArray(ficha.sessionIds)) ficha.sessionIds = [];
    if (!ficha.sessionIds.includes(sessionId)) {
      ficha.sessionIds = [sessionId, ...ficha.sessionIds];
      ficha.updatedAt = ahora;
      cambios.push("sesión añadida al workspace");
    }
    if (!global.workspaceIds.includes(workspaceId)) {
      global.workspaceIds = [workspaceId, ...global.workspaceIds];
      cambios.push("workspace devuelto al orden");
    }
    global.initialized = true;
  }

  // Una sesión archivada no se vería: se desarchiva al instalarla.
  if (global.archivedSessionIds.includes(sessionId)) {
    global.archivedSessionIds = global.archivedSessionIds.filter((id) => id !== sessionId);
    cambios.push("sesión desarchivada");
  }

  // Marca de operación a medias: la app la usa para recuperarse; al terminar, fuera.
  if (global.pendingMutation !== undefined) {
    delete global.pendingMutation;
    cambios.push("marca de operación pendiente limpiada");
  }

  return { workspaceId, creado: cambios.some((cambio) => cambio.startsWith("workspace creado")), cambios };
}

/**
 * Guarda el registro con copia previa y escritura atómica.
 *
 * Con DeepSeek Harness abierto el fichero se puede sobrescribir al cerrar la
 * app (tiene el registro en memoria), así que por defecto se niega a escribir.
 *
 * @param {string} home
 * @param {object} registro
 * @param {{appAbierta?: boolean, ahora?: Date}} [opciones]
 *   `appAbierta` permite fijar el estado en pruebas; si no se pasa, se comprueba.
 * @returns {{ruta: string, copia: string | undefined, bytes: number}}
 */
export function guardarRegistro(home, registro, opciones = {}) {
  const ruta = registryPath(home);
  exigirRegistroValido(registro);

  const abierta = opciones.appAbierta === undefined ? isAppRunning() : opciones.appAbierta === true;
  if (abierta) {
    throw new RegistryError(
      "DeepSeek Harness está abierto: cerraría la app antes de escribir el registro, " +
        "porque al cerrarse puede sobrescribirlo con lo que tiene en memoria"
    );
  }

  fs.mkdirSync(path.dirname(ruta), { recursive: true });

  let copia;
  if (fs.existsSync(ruta)) {
    const sello = (opciones.ahora ?? new Date()).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    copia = `${ruta}.bak-${sello}`;
    fs.copyFileSync(ruta, copia);
  }

  const contenido = JSON.stringify(registro, null, 2) + "\n";
  const temporal = `${ruta}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.writeFileSync(temporal, contenido, "utf8");
    fs.renameSync(temporal, ruta);
  } catch (error) {
    try {
      fs.rmSync(temporal, { force: true });
    } catch {
      /* el temporal ya no está */
    }
    throw new RegistryError(`no se pudo escribir el registro de workspaces (${ruta})`, { cause: error });
  }

  return { ruta, copia, bytes: Buffer.byteLength(contenido) };
}

/**
 * Atajo que hace las tres cosas: leer, asegurar el workspace y guardar.
 * @param {string} home
 * @param {{path: string, title?: string, sessionId: string}} datos
 * @param {{appAbierta?: boolean, seco?: boolean}} [opciones] `seco` = no escribir
 */
export function registrarSesion(home, datos, opciones = {}) {
  const { registro, ruta, existe } = leerRegistro(home);
  const { workspaceId, creado, cambios } = asegurarWorkspace(registro, datos);

  if (opciones.seco === true) {
    return { ruta, existe, workspaceId, creado, cambios, escrito: false, copia: undefined };
  }
  const guardado = guardarRegistro(home, registro, { appAbierta: opciones.appAbierta });
  return { ruta, existe, workspaceId, creado, cambios, escrito: true, copia: guardado.copia };
}
