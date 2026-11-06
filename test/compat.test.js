/**
 * Tests de compatibilidad de tipos de evento: detectar lo que el destino no
 * conoce, marcarlo como ignorable sin tocar el resto y leer la lista del asar.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CompatError,
  TIPOS_CONOCIDOS_020_RC2,
  analizarTipos,
  marcarIgnorables,
  tiposConocidos,
  tiposDesdeAsar,
  tiposPendientes
} from "../src/core/compat.js";

const CONOCIDOS = new Set(["user/message", "session/title", "tool/result", "turn/start", "turn/end"]);

function logTexto(tipos) {
  const cabecera = JSON.stringify({ type: "session", version: 4, id: "session-abc", cwd: "D:\\web", createdAt: 1 });
  const eventos = tipos.map((tipo, indice) =>
    JSON.stringify({ type: tipo, seq: indice, time: 1, data: { message: { role: "user", content: [{ type: "text", text: "hola" }] } } })
  );
  return [cabecera, ...eventos].join("\n") + "\n";
}

function carpetaTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-compat-"));
}

test("analizarTipos cuenta los tipos y señala los desconocidos", () => {
  const texto = logTexto(["user/message", "job/registered", "user/message", "job/settled"]);
  const { usados, desconocidos } = analizarTipos(texto, CONOCIDOS);

  assert.equal(usados.get("user/message"), 2);
  assert.equal(usados.get("job/registered"), 1);
  assert.deepEqual([...desconocidos].sort(), ["job/registered", "job/settled"]);
});

test("lo que ya viene marcado como ignorable no cuenta como desconocido", () => {
  const cabecera = JSON.stringify({ type: "session", version: 4, id: "session-abc", cwd: "D:\\web", createdAt: 1 });
  const evento = JSON.stringify({ type: "job/registered", seq: 0, time: 1, data: {}, ignorable: true });
  const { desconocidos } = analizarTipos(cabecera + "\n" + evento + "\n", CONOCIDOS);
  assert.equal(desconocidos.size, 0);
});

test("marcarIgnorables marca solo lo desconocido y deja el resto intacto", () => {
  const texto = logTexto(["user/message", "job/registered", "tool/result", "job/settled"]);
  const { texto: parcheado, marcados, total } = marcarIgnorables(texto, ["job/registered", "job/settled"]);

  assert.equal(total, 2);
  assert.deepEqual([...marcados.entries()].sort(), [["job/registered", 1], ["job/settled", 1]]);

  const originales = texto.split("\n");
  const parcheadas = parcheado.split("\n");
  assert.equal(originales.length, parcheadas.length);
  assert.equal(parcheadas[0], originales[0], "la cabecera no se toca");
  assert.equal(parcheadas[1], originales[1], "un suceso conocido no se toca");
  assert.match(parcheadas[2], /"ignorable":true}$/);

  for (const linea of parcheadas.filter((l) => l.trim() !== "")) assert.doesNotThrow(() => JSON.parse(linea));
  assert.equal(tiposPendientes(parcheado, CONOCIDOS).size, 0);
});

test("marcarIgnorables es idempotente", () => {
  const texto = logTexto(["job/registered"]);
  const primera = marcarIgnorables(texto, ["job/registered"]);
  const segunda = marcarIgnorables(primera.texto, ["job/registered"]);
  assert.equal(primera.total, 1);
  assert.equal(segunda.total, 0);
  assert.equal(segunda.texto, primera.texto);
});

test("marcarIgnorables no hace nada en un log sin eventos", () => {
  const cabecera = JSON.stringify({ type: "session", version: 4, id: "session-abc", cwd: "D:\\web", createdAt: 1 }) + "\n";
  const { texto, total } = marcarIgnorables(cabecera, ["job/registered"]);
  assert.equal(total, 0);
  assert.equal(texto, cabecera);
});

test("un log con una línea rota se rechaza entero, sin parchear nada", () => {
  const roto = JSON.stringify({ type: "session", version: 4, id: "session-abc", cwd: "D:\\web" }) + "\n{no es json}\n";
  assert.throws(() => marcarIgnorables(roto, ["job/registered"]), CompatError);
});

test("tiposDesdeAsar lee la tabla de un asar de mentira", () => {
  const carpeta = carpetaTemporal();
  try {
    const asar = path.join(carpeta, "app.asar");
    const lista = ["user/message", "tool/result", "session/title", "turn/start", "turn/end", "tool/call"];
    const tipos = Array.from({ length: 22 }, (_, i) => (i < lista.length ? lista[i] : `relleno/tipo-${i}`));
    const literal = tipos.map((tipo) => `"${tipo}"`).join(",");
    const cebo = `const KNOWN_SESSION_EVENT_TYPES = new Set([${literal}]);`;
    // Ruido alrededor: una mención suelta que NO debe colarse.
    const ruido = 'documentación: un harness nuevo escribió "job/registered" y hay que marcarlo';
    fs.writeFileSync(
      asar,
      Buffer.concat([Buffer.alloc(64, 0), Buffer.from(ruido, "latin1"), Buffer.from(cebo, "latin1"), Buffer.alloc(64, 0)])
    );

    const leidos = tiposDesdeAsar(asar);
    assert.ok(leidos instanceof Set);
    assert.equal(leidos.size, 22);
    assert.ok(leidos.has("user/message"));
    assert.ok(leidos.has("tool/result"));
    assert.equal(leidos.has("job/registered"), false, "una mención en la documentación no es un tipo conocido");
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("tiposDesdeAsar devuelve undefined si no reconoce el contenido", () => {
  const carpeta = carpetaTemporal();
  try {
    const asar = path.join(carpeta, "app.asar");
    fs.writeFileSync(asar, Buffer.alloc(500, 7));
    assert.equal(tiposDesdeAsar(asar), undefined);
    assert.throws(() => tiposDesdeAsar(path.join(carpeta, "no-existe.asar")), CompatError);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("tiposConocidos respeta el orden: manual, asar, respaldo", () => {
  const manual = tiposConocidos({ manual: ["uno/dos", "tres/cuatro"] });
  assert.equal(manual.origen, "manual");
  assert.deepEqual([...manual.tipos], ["uno/dos", "tres/cuatro"]);
  assert.throws(() => tiposConocidos({ manual: [] }), CompatError);

  const respaldo = tiposConocidos();
  assert.equal(respaldo.origen, "respaldo");
  assert.ok(respaldo.tipos.has("tool/result"));

  const carpeta = carpetaTemporal();
  try {
    const asar = path.join(carpeta, "app.asar");
    const tipos = Array.from({ length: 24 }, (_, i) => `tipo${i}/evento${i}`);
    const cebo = `KNOWN_SESSION_EVENT_TYPES = new Set([${tipos.map((t) => `"${t}"`).join(",")}])`;
    fs.writeFileSync(asar, Buffer.from(cebo, "latin1"));
    const delAsar = tiposConocidos({ rutaAsar: asar });
    assert.equal(delAsar.origen, "asar");
    assert.equal(delAsar.tipos.size, 24);

    const basura = path.join(carpeta, "basura.asar");
    fs.writeFileSync(basura, Buffer.alloc(200, 1));
    assert.throws(() => tiposConocidos({ rutaAsar: basura, usarRespaldo: false }), CompatError);
    assert.equal(tiposConocidos({ rutaAsar: basura }).origen, "respaldo");
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("la tabla de respaldo incluye los tipos del formato v4", () => {
  for (const tipo of ["user/message", "assistant/message", "tool/call", "tool/result", "turn/start", "turn/end", "session/title", "request/header"]) {
    assert.ok(TIPOS_CONOCIDOS_020_RC2.has(tipo), `falta ${tipo}`);
  }
  assert.equal(TIPOS_CONOCIDOS_020_RC2.has("job/registered"), false, "job/* es justo lo que no conocía 0.2.0");
});
