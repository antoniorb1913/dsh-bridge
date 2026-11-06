/**
 * Tests de la CLI: argumentos, formato de salida y selecciones.
 * La CLI en sí solo orquesta; lo que se prueba aquí es lo que se puede probar
 * sin terminal.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CliError,
  parsearArgumentos,
  tiposManuales
} from "../src/cli/opciones.js";
import {
  SeleccionError,
  formatearBytes,
  formatearFecha,
  parsearSeleccion,
  recortar,
  tablaSesiones,
  textoAyuda
} from "../src/cli/formato.js";

test("sin argumentos se abre el menú; con --help, la ayuda", () => {
  assert.equal(parsearArgumentos([]).comando, "menu");
  assert.equal(parsearArgumentos(["--help"]).comando, "help");
  assert.equal(parsearArgumentos(["-h"]).comando, "help");
  assert.equal(parsearArgumentos(["-v"]).comando, "version");
  assert.equal(parsearArgumentos(["--version"]).comando, "version");
});

test("entiende los comandos y sus alias en castellano", () => {
  assert.equal(parsearArgumentos(["list"]).comando, "list");
  assert.equal(parsearArgumentos(["listar"]).comando, "list");
  assert.equal(parsearArgumentos(["exportar", "session-1"]).comando, "export");
  assert.equal(parsearArgumentos(["importar", "b.zip"]).comando, "import");
  assert.equal(parsearArgumentos(["diagnostico"]).comando, "doctor");
  assert.equal(parsearArgumentos(["enviar"]).comando, "send");
});

test("separa posicionales y opciones, con y sin valor", () => {
  const exportar = parsearArgumentos(["export", "session-abc", "-o", "C:\\temp"]);
  assert.deepEqual(exportar.posicionales, ["session-abc"]);
  assert.equal(exportar.opciones.o, "C:\\temp");

  const importar = parsearArgumentos(["import", "bundle.zip", "--workspace", "D:\\web", "--forzar", "--seco"]);
  assert.equal(importar.opciones.workspace, "D:\\web");
  assert.equal(importar.opciones.forzar, true);
  assert.equal(importar.opciones.seco, true);

  const conHome = parsearArgumentos(["--dsh-home", "C:\\datos\\.dsh", "list"]);
  assert.equal(conHome.comando, "list");
  assert.equal(conHome.opciones["dsh-home"], "C:\\datos\\.dsh");
});

test("los errores de argumentos son claros", () => {
  assert.throws(() => parsearArgumentos(["inventado"]), (error) => {
    assert.ok(error instanceof CliError);
    assert.match(error.message, /comando desconocido/);
    return true;
  });
  assert.throws(() => parsearArgumentos(["list", "--inventada"]), /opción desconocida/);
  assert.throws(() => parsearArgumentos(["import", "--workspace"]), /necesita un valor/);
});

test("la lista manual de tipos se parte por comas", () => {
  assert.deepEqual(tiposManuales({ "tipos-ignorables": "a/b, c/d" }), ["a/b", "c/d"]);
  assert.equal(tiposManuales({}), undefined);
  assert.equal(tiposManuales({ "tipos-ignorables": " , " }), undefined);
});

test("formatearBytes usa coma decimal y unidades cortas", () => {
  assert.equal(formatearBytes(0), "0 B");
  assert.equal(formatearBytes(512), "512 B");
  assert.equal(formatearBytes(1536), "1,5 KB");
  assert.equal(formatearBytes(1024 * 1024), "1,0 MB");
  assert.equal(formatearBytes(300 * 1024 * 1024), "300 MB");
  assert.equal(formatearBytes(-1), "?");
});

test("formatearFecha da dd/mm/aaaa hh:mm", () => {
  assert.equal(formatearFecha(new Date(2026, 10, 7, 0, 40)), "07/11/2026 00:40");
  assert.equal(formatearFecha("no es una fecha"), "?");
});

test("recortar respeta el ancho y añade puntos suspensivos", () => {
  assert.equal(recortar("hola", 10), "hola");
  assert.equal(recortar("hola mundo largo", 8), "hola mu…");
  assert.equal(recortar("  con   espacios  ", 20), "con espacios");
});

test("parsearSeleccion acepta números, listas y rangos", () => {
  assert.deepEqual(parsearSeleccion("1", 5), [0]);
  assert.deepEqual(parsearSeleccion("1,3", 5), [0, 2]);
  assert.deepEqual(parsearSeleccion("2-4", 5), [1, 2, 3]);
  assert.deepEqual(parsearSeleccion("3, 1, 3", 5), [0, 2]);
  assert.deepEqual(parsearSeleccion("", 5), []);
  assert.deepEqual(parsearSeleccion("1-2,4", 5), [0, 1, 3]);
});

test("parsearSeleccion rechaza lo que no tiene sentido", () => {
  for (const [texto, patron] of [
    ["0", /empiezan en 1/],
    ["abc", /no entiendo/],
    ["3-1", /al revés/],
    ["9", /se pasa/],
    ["1-9", /se pasa/]
  ]) {
    assert.throws(() => parsearSeleccion(texto, 3), (error) => {
      assert.ok(error instanceof SeleccionError);
      assert.match(error.message, patron);
      return true;
    });
  }
});

test("tablaSesiones alinea y resume cada conversación", () => {
  const sesiones = [
    {
      label: "Página web del bar",
      cwd: "D:\\Users\\MSI-PC\\Desktop\\web",
      mtime: new Date(2026, 10, 7, 0, 40),
      bytes: 297 * 1024 * 1024,
      attachments: 287
    },
    { label: "Otra conversación muy larga que hay que recortar sí o sí para que no rompa la tabla", cwd: "/home/msi/proyecto", mtime: new Date(2026, 9, 1, 12, 0), bytes: 2048, attachments: undefined }
  ];
  const tabla = tablaSesiones(sesiones);
  const lineas = tabla.split("\n");
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /CONVERSACIÓN/);
  assert.match(lineas[1], /Página web del bar/);
  assert.match(lineas[1], /web\s/);
  assert.match(lineas[1], /297 MB/);
  assert.match(lineas[1], /287/);
  assert.match(lineas[2], /…/);
  assert.match(lineas[2], /2,0 KB/);
});

test("la ayuda menciona los comandos y los ejemplos", () => {
  const ayuda = textoAyuda();
  for (const trozo of ["dsh-bridge", "list", "export", "import", "doctor", "--seco", "sin cifrar"]) {
    assert.ok(ayuda.includes(trozo), `la ayuda debería mencionar ${trozo}`);
  }
});
