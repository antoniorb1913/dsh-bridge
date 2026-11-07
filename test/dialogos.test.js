/**
 * Tests de los diálogos nativos. No abren ventanas: comprueban qué comando se
 * construiría en cada sistema y que, sin entorno gráfico, se devuelve undefined
 * para que el programa siga preguntando por teclado.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { comandoDialogo, hayDialogos, nombreSugerido } from "../src/cli/dialogos.js";

test("en Windows se usa PowerShell con los diálogos de Windows Forms", () => {
  const abrir = comandoDialogo("abrir", { titulo: "Elige el ZIP", plataforma: "win32" });
  assert.equal(abrir.orden, "powershell");
  assert.deepEqual(abrir.argumentos.slice(0, 3), ["-NoProfile", "-STA", "-Command"]);
  assert.match(abrir.argumentos[3], /OpenFileDialog/);
  assert.match(abrir.argumentos[3], /ShowDialog\(\)/);
  assert.match(abrir.argumentos[3], /Élige|Elige el ZIP/);

  const guardar = comandoDialogo("guardar", { titulo: "Guardar", nombre: "copia.zip", plataforma: "win32" });
  assert.match(guardar.argumentos[3], /SaveFileDialog/);
  assert.match(guardar.argumentos[3], /copia\.zip/);
  assert.match(guardar.argumentos[3], /OverwritePrompt/);

  const carpeta = comandoDialogo("carpeta", { titulo: "¿Dónde?", plataforma: "win32" });
  assert.match(carpeta.argumentos[3], /FolderBrowserDialog/);
  assert.match(carpeta.argumentos[3], /SelectedPath/);
});

test("las comillas simples no rompen el guion de PowerShell", () => {
  const comando = comandoDialogo("abrir", { titulo: "Es de O'Brien", plataforma: "win32" });
  assert.match(comando.argumentos[3], /'Es de O''Brien'/, "la comilla simple se duplica");
});

test("en macOS se usa osascript", () => {
  assert.match(comandoDialogo("abrir", { plataforma: "darwin" }).argumentos[1], /choose file/);
  assert.match(comandoDialogo("guardar", { plataforma: "darwin", nombre: "x.zip" }).argumentos[1], /choose file name/);
  assert.match(comandoDialogo("carpeta", { plataforma: "darwin" }).argumentos[1], /choose folder/);
});

test("en Linux se usa zenity", () => {
  assert.match(comandoDialogo("abrir", { plataforma: "linux" }).argumentos[0], /--file-selection/);
  assert.match(comandoDialogo("guardar", { plataforma: "linux" }).argumentos.join(" "), /--save/);
  assert.match(comandoDialogo("carpeta", { plataforma: "linux" }).argumentos.join(" "), /--directory/);
});

test("sin entorno gráfico no hay diálogos", () => {
  assert.equal(hayDialogos({ plataforma: "linux", display: "", wayland: "" }), false);
  assert.equal(hayDialogos({ plataforma: "linux", display: ":0" }), true);
  assert.equal(hayDialogos({ plataforma: "linux", wayland: "wayland-0" }), true);
  assert.equal(hayDialogos({ plataforma: "win32" }), true);
  assert.equal(hayDialogos({ plataforma: "darwin" }), true);
  assert.equal(hayDialogos({ plataforma: "aix" }), false);
  assert.equal(hayDialogos({ plataforma: "win32", desactivado: true }), false);
});

test("un tipo desconocido no construye nada", () => {
  assert.equal(comandoDialogo("otro", { plataforma: "win32" }), undefined);
  assert.equal(comandoDialogo("abrir", { plataforma: "aix" }), undefined);
});

test("el nombre sugerido es previsible y seguro como nombre de fichero", () => {
  const nombre = nombreSugerido("Página web para Bar El Jardín / Netlify", new Date(2026, 10, 7));
  assert.equal(nombre, "dsh-sesion-pagina-web-para-bar-el-jardin-netlify-20261107.zip");
  assert.doesNotMatch(nombre, /[\\/:*?"<>|]/);
  assert.equal(nombreSugerido(undefined, new Date(2026, 0, 2)), "dsh-sesion-sesion-20260102.zip");
  assert.equal(nombreSugerido("ñandú y Ñ", new Date(2026, 0, 2)), "dsh-sesion-nandu-y-n-20260102.zip");
});
