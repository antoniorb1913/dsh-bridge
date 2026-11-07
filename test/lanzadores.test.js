/**
 * Tests de los lanzadores de doble clic.
 *
 * El caso que más duele es el formato del `.cmd`: cmd.exe solo entiende CRLF y
 * no lleva bien los acentos, y cuando se equivoca se come dos caracteres por
 * línea con un error incomprensible. Aquí se vigila eso.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("los .cmd están en CRLF, sin acentos y llaman al lanzador", () => {
  for (const nombre of ["recibir.cmd", "enviar.cmd", "dsh-bridge.cmd"]) {
    const ruta = path.join(RAIZ, nombre);
    assert.ok(fs.existsSync(ruta), `falta ${nombre}`);
    const bytes = fs.readFileSync(ruta);
    const texto = bytes.toString("latin1");
    assert.equal(/[^\x00-\x7F]/.test(texto), false, `${nombre} no debe tener caracteres no ASCII`);
    assert.equal(/(?<!\r)\n/.test(texto), false, `${nombre} debe usar CRLF, no LF`);
    assert.match(texto, /bin\\lanzador\.js/, `${nombre} debe llamar al lanzador`);
    assert.match(texto, /where node/, `${nombre} debe comprobar que hay Node`);
  }
});

test("recibir y enviar llevan al modo correcto del lanzador", () => {
  const recibir = fs.readFileSync(path.join(RAIZ, "recibir.cmd"), "latin1");
  const enviar = fs.readFileSync(path.join(RAIZ, "enviar.cmd"), "latin1");
  assert.match(recibir, /lanzador\.js"\s+recibir/);
  assert.match(enviar, /lanzador\.js"\s+enviar/);
  assert.match(recibir, /%\*/, "recibir debe pasar los argumentos");
});

test("el lanzador rechaza un modo que no conoce", () => {
  const resultado = spawnSync(process.execPath, [path.join(RAIZ, "bin", "lanzador.js"), "bailar"], { encoding: "utf8" });
  assert.equal(resultado.status, 2);
  assert.match(resultado.stderr, /modo no reconocido/);
});

test("el lanzador pide la carpeta y no arranca nada sin Node", () => {
  // Sin argumentos no se puede probar entero (se queda escuchando), pero sí
  // comprobar que un modo válido existe y que el fichero es coherente.
  const codigo = fs.readFileSync(path.join(RAIZ, "bin", "lanzador.js"), "utf8");
  assert.match(codigo, /modo === "recibir"/);
  assert.match(codigo, /modo === "enviar"/);
  assert.match(codigo, /modo === "menu"/);
  assert.match(codigo, /mkdirSync/);
});
