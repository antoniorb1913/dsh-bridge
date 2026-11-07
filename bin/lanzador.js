/**
 * Lanzador para los accesos de doble clic (`recibir.cmd`, `enviar.cmd`).
 *
 * Existe porque cmd.exe no lleva bien los acentos ni los saltos de línea: el
 * `.cmd` se queda en tres líneas y todo lo que habla con el usuario se hace
 * aquí, en Node, que sí escribe UTF-8 sin sustos.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROGRAMA = path.join(AQUI, "dsh-bridge.js");

/** Arranca el programa de verdad, con la misma consola. */
function lanzar(argumentos) {
  const hijo = spawn(process.execPath, [PROGRAMA, ...argumentos], { stdio: "inherit" });
  for (const senal of ["SIGINT", "SIGTERM"]) {
    process.on(senal, () => {
      if (!hijo.killed) hijo.kill(senal);
    });
  }
  hijo.on("error", (error) => {
    console.error(`no se pudo arrancar el programa: ${error.message}`);
    process.exit(1);
  });
  hijo.on("exit", (codigo) => process.exit(codigo ?? 0));
}

/** Crea la carpeta; si el nombre no vale, propone la de por defecto. */
function prepararCarpeta(carpeta) {
  try {
    fs.mkdirSync(carpeta, { recursive: true });
    return carpeta;
  } catch (error) {
    const prohibidos = /[<>:"|?*]/.test(carpeta);
    console.error("");
    console.error(`  No se pudo crear la carpeta: ${carpeta}`);
    if (prohibidos) {
      console.error('  Un nombre de carpeta en Windows no puede llevar < > : " | ? *');
      console.error("  (y los textos entre comillas angulares de las instrucciones no son una ruta real)");
    } else {
      console.error(`  ${error.message}`);
    }
  }

  const porDefecto = path.join(os.homedir(), "Documents", "recibidas");
  try {
    fs.mkdirSync(porDefecto, { recursive: true });
    console.error(`  Sigo con esta, que sí existe: ${porDefecto}`);
    return porDefecto;
  } catch {
    console.error("  Tampoco puedo crear la carpeta de por defecto. Cierra y vuelve a abrirlo.");
    return undefined;
  }
}

async function recibir(extra) {
  const carpeta = extra[0] !== undefined && !extra[0].startsWith("-") ? extra.shift() : undefined;

  let elegida;
  if (carpeta !== undefined) {
    elegida = prepararCarpeta(carpeta);
    if (elegida === undefined) process.exit(1);
  }

  console.log("");
  if (elegida === undefined) {
    console.log("  Cuando llegue una conversación te preguntaré en qué carpeta quieres guardarla.");
    console.log("  (En ese diálogo puedes crear una carpeta nueva con el botón «Nueva carpeta»).");
  }
  lanzar(["serve", "--red", ...(elegida === undefined ? [] : ["--workspace", path.resolve(elegida)]), ...extra]);
}

function enviar(extra) {
  console.log("");
  lanzar(["ui", "--abrir", ...extra]);
}

const modo = process.argv[2];
const extra = process.argv.slice(3);

if (modo === "recibir") await recibir(extra);
else if (modo === "enviar") enviar(extra);
else if (modo === "menu") lanzar(extra);
else {
  console.error(`modo no reconocido: ${modo ?? "(ninguno)"}. Usa recibir, enviar o menu.`);
  process.exit(2);
}
