/**
 * Lectura de argumentos de la CLI.
 *
 * Se hace a mano (unas 60 líneas) para no meter una dependencia solo por esto,
 * y porque así los errores se pueden escribir en castellano y sin jerga.
 */
export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliError";
  }
}

/** Opciones que esperan un valor detrás. */
const CON_VALOR = new Set([
  "--dsh-home",
  "-o",
  "--salida",
  "--workspace",
  "--titulo",
  "--tipos-ignorables",
  "--puerto",
  "--ip",
  "--codigo",
  "--sesion",
  "--max",
  "--segundos",
  "--destino"
]);

/** Opciones que se pueden repetir y se acumulan en una lista. */
const MULTIVALOR = new Set(["--sesion"]);

/** Opciones que son solo un interruptor. */
const INTERRUPTORES = new Set([
  "--forzar",
  "--seco",
  "--json",
  "--full",
  "--rapido",
  "--si",
  "--quiet",
  "--red",
  "--abrir",
  "--buscar",
  "--sin-dialogos",
  "--help",
  "-h",
  "--version",
  "-v"
]);

export const COMANDOS = ["list", "export", "import", "ui", "serve", "send", "discover", "doctor", "help"];

const ALIAS_COMANDOS = {
  listar: "list",
  list: "list",
  exportar: "export",
  export: "export",
  importar: "import",
  import: "import",
  enviar: "send",
  send: "send",
  discover: "discover",
  descubrir: "discover",
  buscar: "discover",
  ui: "ui",
  interfaz: "ui",
  servir: "serve",
  serve: "serve",
  recibir: "serve",
  receive: "serve",
  doctor: "doctor",
  diagnostico: "doctor",
  ayuda: "help",
  help: "help"
};

/**
 * Traduce `process.argv` a algo manejable.
 *
 * @param {string[]} argv argumentos sin `node` ni la ruta del script
 * @returns {{comando: string, posicionales: string[], opciones: object}}
 */
export function parsearArgumentos(argv) {
  const opciones = {};
  const posicionales = [];

  for (let indice = 0; indice < argv.length; indice += 1) {
    const token = argv[indice];
    if (!token.startsWith("-")) {
      posicionales.push(token);
      continue;
    }
    if (CON_VALOR.has(token)) {
      const valor = argv[indice + 1];
      if (valor === undefined || valor.startsWith("-")) throw new CliError(`la opción ${token} necesita un valor detrás`);
      const clave = token.replace(/^-+/, "");
      if (MULTIVALOR.has(token)) opciones[clave] = [...(Array.isArray(opciones[clave]) ? opciones[clave] : []), valor];
      else opciones[clave] = valor;
      indice += 1;
      continue;
    }
    if (INTERRUPTORES.has(token)) {
      opciones[token.replace(/^-+/, "")] = true;
      continue;
    }
    throw new CliError(`opción desconocida: ${token}. Escribe dsh-bridge --help para ver las opciones`);
  }

  if (opciones.help === true || opciones.h === true) return { comando: "help", posicionales, opciones };
  if (opciones.version === true || opciones.v === true) return { comando: "version", posicionales, opciones };

  const primero = posicionales[0];
  if (primero === undefined) return { comando: "menu", posicionales, opciones };

  const comando = ALIAS_COMANDOS[primero.toLowerCase()];
  if (comando === undefined) {
    throw new CliError(`comando desconocido: ${primero}. Comandos: ${COMANDOS.join(", ")}`);
  }
  return { comando, posicionales: posicionales.slice(1), opciones };
}

/** Lista de tipos a mano desde `--tipos-ignorables a/b,c/d`. */
export function tiposManuales(opciones) {
  const crudo = opciones["tipos-ignorables"];
  if (typeof crudo !== "string") return undefined;
  const lista = crudo
    .split(",")
    .map((tipo) => tipo.trim())
    .filter(Boolean);
  return lista.length === 0 ? undefined : lista;
}
