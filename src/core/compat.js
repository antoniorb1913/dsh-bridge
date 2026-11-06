/**
 * Compatibilidad de tipos de evento entre versiones de DeepSeek Harness.
 *
 * La app **rechaza el log entero** si encuentra un tipo de evento que no
 * conoce y que no está marcado como ignorable:
 *
 *   session ... contains event type "job/registered" (seq N) unknown to this
 *   harness and not marked ignorable; refusing to interpret the log
 *
 * El formato prevé ese caso: el sobre del suceso admite `ignorable: true` para
 * lo que se puede saltar sin reconstruir mal la sesión. Este módulo marca solo
 * esos sucesos, sin tocar nada más del log.
 *
 * ¿Qué tipos conoce el harness destino? Se leen de su `app.asar`, buscando la
 * tabla `KNOWN_SESSION_EVENT_TYPES` que lleva dentro. Si no se puede leer (otra
 * instalación, otro sistema de empaquetado), se usa la tabla de respaldo que hay
 * abajo, o la lista que pase el usuario a mano.
 */
import fs from "node:fs";

/** Error de compatibilidad: no se pudo saber qué entiende el destino. */
export class CompatError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CompatError";
  }
}

/**
 * Tipos que entiende DeepSeek Harness **0.2.0-rc.2** (y anteriores), extraídos
 * de su `app.asar`. Sirve de respaldo cuando no se puede leer el asar; es una
 * foto fija, no una verdad eterna: con otra versión puede faltar alguno.
 */
export const TIPOS_CONOCIDOS_020_RC2 = new Set([
  "agent-preset/selected",
  "agent/inbox/spliced",
  "approval/asked",
  "approval/decided",
  "approval/policy",
  "assistant/attempt",
  "assistant/message",
  "command/done",
  "command/run",
  "compaction/end",
  "compaction/prune",
  "compaction/start",
  "compaction/summary",
  "deliverables/presented",
  "developer/message",
  "feedback/message-delete",
  "feedback/message-put",
  "feedback/record",
  "goal/change",
  "hook/invoked",
  "hook/result",
  "image/offload",
  "llm/retry",
  "llm/retry-started",
  "model/selection",
  "permission/preset",
  "plan/mode",
  "request/context",
  "request/header",
  "sandbox/mode",
  "schedule/change",
  "session-log-deepseek/delivery-accepted",
  "session/end-seed",
  "session/title",
  "session/title-llm-request",
  "step/end",
  "step/start",
  "subagent/catalog",
  "subagent/descriptor",
  "subagent/model-selection-policy",
  "system/message",
  "team/member",
  "team/message/delivered",
  "team/message/queued",
  "team/task",
  "todo/write",
  "tool/call",
  "tool/ptc-dispatch",
  "tool/ptc-dispatch-start",
  "tool/result",
  "tool-workflow/agent-end",
  "tool-workflow/agent-start",
  "tool-workflow/run-end",
  "tool-workflow/run-start",
  "turn/end",
  "turn/start",
  "user/message",
  "web/deepseek-search-llm-request",
  "workspace/changes"
]);

const NOMBRE_TABLA = "KNOWN_SESSION_EVENT_TYPES";
const PATRON_TIPO = /"([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-/]*)"/g;

/**
 * Lee del `app.asar` los tipos de evento que conoce esa instalación.
 *
 * El asar es un archivo sin comprimir con un índice delante, así que se puede
 * buscar dentro. Pero hay que ser **preciso**: el símbolo aparece varias veces
 * (código, documentación, traducciones) y una búsqueda por proximidad mete
 * ruido — en pruebas, una mención suelta en los documentos colaba
 * `job/registered`, que es justo un tipo que esta versión NO conoce. Por eso se
 * lee el literal exacto: `KNOWN_SESSION_EVENT_TYPES = new Set([ "...", ... ])`.
 *
 * @param {string} rutaAsar
 * @returns {Set<string> | undefined} `undefined` si no se reconoce el formato
 */
export function tiposDesdeAsar(rutaAsar) {
  if (!fs.existsSync(rutaAsar)) throw new CompatError(`no existe el archivo de la app: ${rutaAsar}`);
  const contenido = fs.readFileSync(rutaAsar);
  const aguja = Buffer.from(NOMBRE_TABLA, "latin1");

  const tipos = new Set();
  let indice = contenido.indexOf(aguja);
  let ventanas = 0;
  while (indice !== -1 && ventanas < 12) {
    const desde = Math.max(0, indice - 120);
    const hasta = Math.min(contenido.length, indice + 12_000);
    const texto = contenido.subarray(desde, hasta).toString("latin1");

    const inicioLista = texto.indexOf("new Set([");
    if (inicioLista !== -1 && inicioLista < 200) {
      const finLista = texto.indexOf("])", inicioLista);
      if (finLista !== -1) {
        const literal = texto.slice(inicioLista + "new Set([".length, finLista);
        for (const coincidencia of literal.matchAll(PATRON_TIPO)) tipos.add(coincidencia[1]);
        // Una lista de verdad tiene decenas de tipos; un trozo suelto, no.
        if (tipos.size > 20) return tipos;
        tipos.clear();
      }
    }
    ventanas += 1;
    indice = contenido.indexOf(aguja, indice + 1);
  }

  return undefined;
}

/**
 * Decide qué lista de tipos usar.
 *
 * Orden: lista manual → `app.asar` → tabla de respaldo. Se informa del origen
 * para que el usuario sepa cuánto fiarse.
 *
 * @param {{manual?: Iterable<string>, rutaAsar?: string, usarRespaldo?: boolean}} [opciones]
 * @returns {{tipos: Set<string>, origen: "manual" | "asar" | "respaldo"}}
 */
export function tiposConocidos(opciones = {}) {
  if (opciones.manual !== undefined) {
    const tipos = new Set([...opciones.manual].map((tipo) => String(tipo).trim()).filter(Boolean));
    if (tipos.size === 0) throw new CompatError("la lista de tipos indicada a mano está vacía");
    return { tipos, origen: "manual" };
  }
  if (opciones.rutaAsar !== undefined) {
    const delAsar = tiposDesdeAsar(opciones.rutaAsar);
    if (delAsar !== undefined && delAsar.size > 10) return { tipos: delAsar, origen: "asar" };
    if (opciones.usarRespaldo === false) {
      throw new CompatError("no he podido reconocer los tipos de evento en el app.asar indicado");
    }
  }
  return { tipos: new Set(TIPOS_CONOCIDOS_020_RC2), origen: "respaldo" };
}

/**
 * Cuenta los tipos de evento que usa un log y señala los que el destino no
 * conoce.
 * @param {string} texto log completo (cabecera incluida)
 * @param {Set<string>} conocidos
 */
export function analizarTipos(texto, conocidos) {
  const usados = new Map();
  const desconocidos = new Set();
  const lineas = texto.split("\n");
  for (let indice = 1; indice < lineas.length; indice += 1) {
    const linea = lineas[indice];
    if (linea.trim() === "") continue;
    let evento;
    try {
      evento = JSON.parse(linea);
    } catch {
      throw new CompatError(`la línea ${indice + 1} del log no es JSON válido`);
    }
    const tipo = evento?.type;
    if (typeof tipo !== "string") continue;
    usados.set(tipo, (usados.get(tipo) ?? 0) + 1);
    if (!conocidos.has(tipo) && evento.ignorable !== true) desconocidos.add(tipo);
  }
  return { usados, desconocidos };
}

/**
 * Marca `ignorable: true` en los sucesos de los tipos indicados.
 *
 * Se inserta el campo en el sobre sin tocar nada más: el resto de la línea
 * queda byte a byte igual, y cada línea modificada se vuelve a parsear para
 * comprobar que sigue siendo JSON válido.
 *
 * @param {string} texto
 * @param {Iterable<string>} tipos
 * @returns {{texto: string, marcados: Map<string, number>, total: number}}
 */
export function marcarIgnorables(texto, tipos) {
  const objetivo = new Set(tipos);
  const marcados = new Map();
  let total = 0;
  const lineas = texto.split("\n");

  for (let indice = 1; indice < lineas.length; indice += 1) {
    const linea = lineas[indice];
    if (linea.trim() === "") continue;

    let evento;
    try {
      evento = JSON.parse(linea);
    } catch {
      throw new CompatError(`la línea ${indice + 1} del log no es JSON válido`);
    }
    if (typeof evento?.type !== "string" || !objetivo.has(evento.type) || evento.ignorable === true) continue;
    if (!linea.endsWith("}")) throw new CompatError(`la línea ${indice + 1} no acaba en «}»; no la toco`);

    const parcheada = linea.slice(0, -1) + ',"ignorable":true}';
    const comprobacion = JSON.parse(parcheada);
    if (comprobacion.ignorable !== true || comprobacion.seq !== evento.seq) {
      throw new CompatError(`el parcheo de la línea ${indice + 1} no cuadra; no escribo nada`);
    }
    lineas[indice] = parcheada;
    marcados.set(evento.type, (marcados.get(evento.type) ?? 0) + 1);
    total += 1;
  }

  return { texto: lineas.join("\n"), marcados, total };
}

/**
 * Comprobación final: qué tipos usaría el log que no conoce el destino.
 * Se llama antes de escribir para no dejar un fichero que la app rechazaría.
 * @param {string} texto
 * @param {Set<string>} conocidos
 */
export function tiposPendientes(texto, conocidos) {
  return analizarTipos(texto, conocidos).desconocidos;
}
