/**
 * Formato de la salida por pantalla: tamaños, fechas, tablas y selecciones.
 *
 * Separado de la CLI para poder probarlo sin terminal.
 */
import { nombreBase } from "../core/paths.js";

export class SeleccionError extends Error {
  constructor(message) {
    super(message);
    this.name = "SeleccionError";
  }
}

/** 1536 → "1,5 KB". */
export function formatearBytes(bytes) {
  const valor = Number(bytes);
  if (!Number.isFinite(valor) || valor < 0) return "?";
  if (valor < 1024) return `${valor} B`;
  const unidades = ["KB", "MB", "GB", "TB"];
  let numero = valor / 1024;
  let indice = 0;
  while (numero >= 1024 && indice < unidades.length - 1) {
    numero /= 1024;
    indice += 1;
  }
  const texto = numero >= 10 ? numero.toFixed(0) : numero.toFixed(1);
  return `${texto.replace(".", ",")} ${unidades[indice]}`;
}

/** Fecha corta en formato español: 07/11/2026 00:40. */
export function formatearFecha(valor) {
  const fecha = valor instanceof Date ? valor : new Date(Number(valor));
  if (Number.isNaN(fecha.getTime())) return "?";
  const dos = (n) => String(n).padStart(2, "0");
  return `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()} ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`;
}

/** Recorta a un ancho, con puntos suspensivos. */
export function recortar(texto, ancho) {
  const limpio = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (limpio.length <= ancho) return limpio;
  return limpio.slice(0, Math.max(0, ancho - 1)) + "…";
}

/**
 * Convierte lo que teclea el usuario en índices (base 0).
 * Acepta `1`, `1,3`, `1-4`, `1, 3-5`; vacío es «ninguno».
 *
 * @param {string} texto
 * @param {number} total cuántos elementos hay
 * @returns {number[]} índices sin repetir y en orden
 */
export function parsearSeleccion(texto, total) {
  const crudo = String(texto ?? "").trim();
  if (crudo === "") return [];
  const indices = new Set();

  for (const trozo of crudo.split(",")) {
    const parte = trozo.trim();
    if (parte === "") continue;

    const rango = /^(\d+)\s*-\s*(\d+)$/.exec(parte);
    if (rango !== null) {
      const desde = Number(rango[1]);
      const hasta = Number(rango[2]);
      if (desde < 1 || hasta < 1) throw new SeleccionError(`rango no válido: ${parte} (las listas empiezan en 1)`);
      if (desde > hasta) throw new SeleccionError(`rango al revés: ${parte}`);
      if (hasta > total) throw new SeleccionError(`el rango ${parte} se pasa: solo hay ${total}`);
      for (let numero = desde; numero <= hasta; numero += 1) indices.add(numero - 1);
      continue;
    }

    if (!/^\d+$/.test(parte)) throw new SeleccionError(`no entiendo «${parte}»: usa números como 1, 1,3 o 2-4`);
    const numero = Number(parte);
    if (numero < 1) throw new SeleccionError(`«${parte}» no vale: las listas empiezan en 1`);
    if (numero > total) throw new SeleccionError(`«${parte}» se pasa: solo hay ${total}`);
    indices.add(numero - 1);
  }

  return [...indices].sort((izquierda, derecha) => izquierda - derecha);
}

/**
 * Tabla de conversaciones.
 * @param {object[]} sesiones
 * @param {{indices?: number[], tituloAncho?: number}} [opciones]
 */
export function tablaSesiones(sesiones, opciones = {}) {
  const anchoTitulo = opciones.tituloAncho ?? 46;
  const numeros = opciones.indices ?? sesiones.map((_, indice) => indice + 1);
  const lineas = [];
  lineas.push("  #   CONVERSACIÓN" + " ".repeat(Math.max(1, anchoTitulo - 12)) + "CARPETA".padEnd(18) + "FECHA".padEnd(18) + "TAMAÑO".padStart(9) + "  IMÁG.");
  for (const numero of numeros) {
    const sesion = sesiones[numero - 1];
    if (sesion === undefined) continue;
    const titulo = recortar(sesion.label, anchoTitulo).padEnd(anchoTitulo);
    const carpeta = recortar(nombreBase(sesion.cwd ?? ""), 16).padEnd(18);
    const fecha = formatearFecha(sesion.mtime).padEnd(18);
    const tamano = formatearBytes(sesion.bytes).padStart(9);
    const imagenes = sesion.attachments === undefined ? "   -" : String(sesion.attachments).padStart(6);
    lineas.push(`  ${String(numero).padStart(2)}  ${titulo}${carpeta}${fecha}${tamano}  ${imagenes}`);
  }
  return lineas.join("\n");
}

/** Ayuda de la herramienta. */
export function textoAyuda() {
  return [
    "dsh-bridge — exportar e importar conversaciones de DeepSeek Harness",
    "",
    "USO",
    "  dsh-bridge                      menú interactivo",
    "  dsh-bridge list [--full] [--json]",
    "  dsh-bridge export <sesión> [-o <carpeta|fichero.zip>]",
    "  dsh-bridge import <bundle.zip> [--workspace <carpeta>] [--titulo <t>] [--forzar] [--seco]",
    "  dsh-bridge serve [--red] [--puerto 8787] [--codigo 123456] --workspace <carpeta>",
    "  dsh-bridge send --ip <ip> --codigo <6 dígitos> --sesion <id> [--sesion <id>…] [--puerto 8787]",
    "  dsh-bridge doctor [--json]",
    "",
    "OPCIONES",
    "  --dsh-home <ruta>      carpeta de datos de DeepSeek Harness (por defecto ~/.dsh)",
    "  --json                 salida para máquinas",
    "  --seco                 enseña lo que haría sin escribir nada",
    "  --forzar               reemplaza una sesión ya instalada (deja copia .bak)",
    "  --tipos-ignorables a/b,c/d   lista de tipos conocidos a mano (si no se puede leer la app)",
    "  --red                  en «serve»: escuchar en la red local (por defecto solo este equipo)",
    "  --puerto <n>           puerto del servidor (por defecto 8787)",
    "  --codigo <6 dígitos>   fija el código en vez de generarlo (para pruebas)",
    "  --ip <dirección>       en «send»: IP del equipo que escucha",
    "  --sesion <id>          en «send»: conversación a enviar (se puede repetir)",
    "  --max <MB>             en «serve»: tamaño máximo del bundle (por defecto 2.048 MB)",
    "  -h, --help             esta ayuda",
    "  -v, --version          versión",
    "",
    "EJEMPLOS",
    "  dsh-bridge list",
    "  dsh-bridge export session-1234 -o %USERPROFILE%\\Desktop",
    "  dsh-bridge import \"%USERPROFILE%\\Desktop\\dsh-sesion-bar-20261107.zip\" --workspace D:\\web",
    "  dsh-bridge serve --red --workspace D:\\proyectos\\web",
    "  dsh-bridge send --ip 192.168.1.50 --codigo 482913 --sesion session-1234",
    "",
    "AVISO: los bundles llevan tus conversaciones sin cifrar. Bórralos cuando estén importados.",
    ""
  ].join("\n");
}
