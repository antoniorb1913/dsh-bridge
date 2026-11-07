/**
 * Diálogos nativos para elegir ficheros y carpetas, sin dependencias.
 *
 * En Windows se usa un diálogo de PowerShell (`System.Windows.Forms`), en macOS
 * `osascript` y en Linux `zenity` o `kdialog`. Si no hay entorno gráfico —o el
 * usuario escribe en una tubería, o algo falla— estas funciones devuelven
 * `undefined` y quien llama sigue pidiendo la ruta por teclado: el diálogo es
 * una comodidad, nunca un requisito.
 *
 * Se puede desactivar del todo con la variable `DSH_BRIDGE_SIN_DIALOGOS=1`.
 */
import { spawn } from "node:child_process";
import os from "node:os";

/** Error de diálogo (solo para casos de uso interno; hacia fuera se devuelve undefined). */
export class DialogoError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "DialogoError";
  }
}

/** Comillas simples seguras para incrustar cadenas en PowerShell o osascript. */
function entreComillas(texto) {
  return `'${String(texto).replace(/'/g, "''")}'`;
}

/**
 * ¿Se pueden usar diálogos? Se puede forzar el entorno en las pruebas.
 * @param {{plataforma?: string, display?: string, wayland?: string, desactivado?: boolean}} entorno
 */
export function hayDialogos(entorno = {}) {
  const plataforma = entorno.plataforma ?? process.platform;
  if (entorno.desactivado === true || process.env.DSH_BRIDGE_SIN_DIALOGOS === "1") return false;
  if (plataforma === "win32") return true;
  if (plataforma === "darwin") return true;
  if (plataforma !== "linux") return false;
  const display = entorno.display ?? process.env.DISPLAY;
  const wayland = entorno.wayland ?? process.env.WAYLAND_DISPLAY;
  return Boolean(display || wayland);
}

/**
 * Construye el comando nativo. Es una función pura: lo que se ejecuta se puede
 * probar sin abrir ninguna ventana.
 *
 * @param {"abrir"|"guardar"|"carpeta"} tipo
 * @param {{titulo?: string, nombre?: string, filtro?: string, carpetaInicial?: string,
 *          plataforma?: string}} opciones
 * @returns {{orden: string, argumentos: string[]} | undefined}
 */
export function comandoDialogo(tipo, opciones = {}) {
  const plataforma = opciones.plataforma ?? process.platform;
  const titulo = opciones.titulo ?? "dsh-bridge";
  const filtro = opciones.filtro ?? "Ficheros ZIP (*.zip)|*.zip|Todos los ficheros (*.*)|*.*";

  if (plataforma === "win32") {
    const inicio = opciones.carpetaInicial === undefined ? "" : `; $d.InitialDirectory=${entreComillas(opciones.carpetaInicial)}`;
    if (tipo === "abrir") {
      const guion =
        "Add-Type -AssemblyName System.Windows.Forms; " +
        "$d=New-Object System.Windows.Forms.OpenFileDialog; " +
        `$d.Title=${entreComillas(titulo)}; $d.Filter=${entreComillas(filtro)}${inicio}; ` +
        "if($d.ShowDialog() -eq 'OK'){Write-Output $d.FileName}";
      return { orden: "powershell", argumentos: ["-NoProfile", "-STA", "-Command", guion] };
    }
    if (tipo === "guardar") {
      const guion =
        "Add-Type -AssemblyName System.Windows.Forms; " +
        "$d=New-Object System.Windows.Forms.SaveFileDialog; " +
        `$d.Title=${entreComillas(titulo)}; $d.Filter=${entreComillas(filtro)}; ` +
        `$d.FileName=${entreComillas(opciones.nombre ?? "dsh-sesion.zip")}; ` +
        `$d.OverwritePrompt=$true${inicio}; ` +
        "if($d.ShowDialog() -eq 'OK'){Write-Output $d.FileName}";
      return { orden: "powershell", argumentos: ["-NoProfile", "-STA", "-Command", guion] };
    }
    if (tipo === "carpeta") {
      const guion =
        "Add-Type -AssemblyName System.Windows.Forms; " +
        "$d=New-Object System.Windows.Forms.FolderBrowserDialog; " +
        `$d.Description=${entreComillas(titulo)}; $d.ShowNewFolderButton=$true${inicio}; ` +
        "if($d.ShowDialog() -eq 'OK'){Write-Output $d.SelectedPath}";
      return { orden: "powershell", argumentos: ["-NoProfile", "-STA", "-Command", guion] };
    }
    return undefined;
  }

  if (plataforma === "darwin") {
    const predeterminado = opciones.nombre === undefined ? "" : ` default name ${entreComillas(opciones.nombre)}`;
    if (tipo === "abrir") {
      return { orden: "osascript", argumentos: ["-e", `POSIX path of (choose file with prompt ${entreComillas(titulo)})`] };
    }
    if (tipo === "guardar") {
      return { orden: "osascript", argumentos: ["-e", `POSIX path of (choose file name with prompt ${entreComillas(titulo)}${predeterminado})`] };
    }
    if (tipo === "carpeta") {
      return { orden: "osascript", argumentos: ["-e", `POSIX path of (choose folder with prompt ${entreComillas(titulo)})`] };
    }
    return undefined;
  }

  if (plataforma === "linux") {
    if (tipo === "abrir") return { orden: "zenity", argumentos: ["--file-selection", `--title=${titulo}`, `--file-filter=${filtro.replace(/\|/g, " ")}`] };
    if (tipo === "guardar") {
      const nombre = opciones.nombre ?? "dsh-sesion.zip";
      return { orden: "zenity", argumentos: ["--file-selection", "--save", `--filename=${nombre}`, `--title=${titulo}`] };
    }
    if (tipo === "carpeta") return { orden: "zenity", argumentos: ["--file-selection", "--directory", `--title=${titulo}`] };
  }

  return undefined;
}

/** Ejecuta el comando y devuelve su salida, o undefined si se cancela o falla. */
function ejecutar(orden, argumentos) {
  return new Promise((resolver) => {
    let proceso;
    try {
      proceso = spawn(orden, argumentos, { windowsHide: true });
    } catch {
      resolver(undefined);
      return;
    }
    let salida = "";
    proceso.stdout?.on("data", (trozo) => {
      salida += trozo.toString("utf8");
    });
    proceso.on("error", () => resolver(undefined));
    proceso.on("close", (codigo) => {
      const texto = salida.trim();
      resolver(codigo === 0 && texto !== "" ? texto : undefined);
    });
  });
}

/** Pregunta al usuario con el diálogo del sistema y devuelve la ruta elegida. */
async function preguntar(tipo, opciones) {
  if (!hayDialogos()) return undefined;
  const comando = comandoDialogo(tipo, opciones);
  if (comando === undefined) return undefined;
  try {
    return await ejecutar(comando.orden, comando.argumentos);
  } catch {
    return undefined;
  }
}

/** Elige un fichero existente. */
export function elegirArchivo(opciones = {}) {
  return preguntar("abrir", opciones);
}

/** Elige una carpeta existente. */
export function elegirCarpeta(opciones = {}) {
  return preguntar("carpeta", opciones);
}

/** Pide un nombre y sitio para guardar. */
export function guardarComo(opciones = {}) {
  return preguntar("guardar", opciones);
}

/** Nombre sugerido para un bundle, con la fecha del día. */
export function nombreSugerido(titulo, fecha = new Date()) {
  const limpio = String(titulo ?? "sesion")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "sesion";
  const dos = (n) => String(n).padStart(2, "0");
  return `dsh-sesion-${limpio}-${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}.zip`;
}

/** Escritorio del usuario, la carpeta que se propone por defecto. */
export function carpetaPropuesta() {
  return os.homedir();
}
