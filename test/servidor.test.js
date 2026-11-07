/**
 * Tests del servidor de recepción: código de un solo uso, caducidad, límite de
 * intentos, token y listado de conversaciones.
 *
 * Se arranca de verdad en 127.0.0.1 con puerto 0 (el que dé el sistema).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ServidorError, crearCodigo, crearServidor, ipLocal } from "../src/net/servidor.js";
import { crearCasaFalsa } from "./ayudas/entorno.js";

const CODIGO = "12345678";

/** Arranca un servidor con reloj controlado y devuelve todo lo necesario. */
async function montar(opciones = {}) {
  const casa = crearCasaFalsa();
  const reloj = { ahora: 1_000_000 };
  const servidor = crearServidor({
    home: casa.home,
    puerto: 0,
    host: "127.0.0.1",
    codigo: CODIGO,
    ahora: () => reloj.ahora,
    ...opciones
  });
  const puerto = await servidor.iniciar();
  return {
    casa,
    reloj,
    servidor,
    puerto,
    url: `http://127.0.0.1:${puerto}`,
    async cerrar() {
      await servidor.cerrar();
      fs.rmSync(casa.home, { recursive: true, force: true });
    }
  };
}

async function pedir(url, ruta, opciones = {}) {
  const respuesta = await fetch(url + ruta, opciones);
  const cuerpo = await respuesta.json().catch(() => ({}));
  return { codigo: respuesta.status, cuerpo };
}

test("el estado se puede consultar sin código y no lo revela", async () => {
  const montado = await montar();
  try {
    const { codigo, cuerpo } = await pedir(montado.url, "/estado");
    assert.equal(codigo, 200);
    assert.equal(cuerpo.app, "dsh-bridge");
    assert.equal(cuerpo.emparejado, false);
    assert.equal(cuerpo.bloqueado, false);
    assert.equal(cuerpo.intentosRestantes, 5);
    assert.equal(JSON.stringify(cuerpo).includes(CODIGO), false, "el estado no debe contener el código");
  } finally {
    await montado.cerrar();
  }
});

test("un código incorrecto descuenta intentos y acaba bloqueando", async () => {
  const montado = await montar();
  try {
    for (let intento = 1; intento <= 4; intento += 1) {
      const { codigo, cuerpo } = await pedir(montado.url, "/emparejar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codigo: "000000" })
      });
      assert.equal(codigo, 401);
      assert.equal(cuerpo.error, "codigo-incorrecto");
      assert.equal(cuerpo.intentosRestantes, 5 - intento);
      assert.equal(cuerpo.bloqueado, false);
    }

    const quinto = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: "000000" })
    });
    assert.equal(quinto.codigo, 401);
    assert.equal(quinto.cuerpo.bloqueado, true);
    assert.equal(quinto.cuerpo.intentosRestantes, 0);

    // Ya no se puede emparejar ni con el código bueno.
    const bueno = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: CODIGO })
    });
    assert.equal(bueno.codigo, 423);
    assert.equal(bueno.cuerpo.error, "bloqueado");
  } finally {
    await montado.cerrar();
  }
});

test("el código correcto se canjea por un token y muere al usarlo", async () => {
  const montado = await montar();
  try {
    const primero = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: CODIGO })
    });
    assert.equal(primero.codigo, 200);
    assert.match(primero.cuerpo.token, /^[0-9a-f]{64}$/);
    assert.equal(primero.cuerpo.protocolo, 1);

    // El mismo código ya no vale (un solo uso).
    const segundo = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: CODIGO })
    });
    assert.equal(segundo.codigo, 401);
  } finally {
    await montado.cerrar();
  }
});

test("el código caduca aunque no se use", async () => {
  const montado = await montar({ ttlMs: 1000 });
  try {
    montado.reloj.ahora += 1001;
    const { codigo, cuerpo } = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: CODIGO })
    });
    assert.equal(codigo, 410);
    assert.equal(cuerpo.error, "caducado");
  } finally {
    await montado.cerrar();
  }
});

test("sin token no se listan las conversaciones; con token, sí", async () => {
  const montado = await montar();
  try {
    const sinToken = await pedir(montado.url, "/sesiones");
    assert.equal(sinToken.codigo, 401);

    const tokenMalo = await pedir(montado.url, "/sesiones", { headers: { authorization: "Bearer " + "0".repeat(64) } });
    assert.equal(tokenMalo.codigo, 401);

    const { cuerpo } = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: CODIGO })
    });
    const conToken = await pedir(montado.url, "/sesiones", { headers: { authorization: `Bearer ${cuerpo.token}` } });
    assert.equal(conToken.codigo, 200);
    assert.equal(conToken.cuerpo.sesiones.length, 3);
    const titulos = conToken.cuerpo.sesiones.map((sesion) => sesion.titulo).sort();
    assert.deepEqual(titulos, ["Conversación con evento nuevo", "Conversación con fotos", "Conversación de texto"]);
    assert.ok(conToken.cuerpo.sesiones.every((sesion) => typeof sesion.bytes === "number"));
  } finally {
    await montado.cerrar();
  }
});

test("el token caduca", async () => {
  const montado = await montar({ ttlMs: 1000 });
  try {
    const { cuerpo } = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: CODIGO })
    });
    montado.reloj.ahora += 1001;
    const caducado = await pedir(montado.url, "/sesiones", { headers: { authorization: `Bearer ${cuerpo.token}` } });
    assert.equal(caducado.codigo, 401);
  } finally {
    await montado.cerrar();
  }
});

test("rutas y cuerpos raros se rechazan con 404 y 413", async () => {
  const montado = await montar();
  try {
    assert.equal((await pedir(montado.url, "/no-existe")).codigo, 404);

    const enorme = await pedir(montado.url, "/emparejar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: "1".repeat(70 * 1024) })
    });
    assert.equal(enorme.codigo, 413);
  } finally {
    await montado.cerrar();
  }
});

test("valida sus parámetros de arranque", async () => {
  assert.throws(() => crearServidor({ home: "" }), ServidorError);
  assert.throws(() => crearServidor({ home: "x", puerto: 70000 }), ServidorError);
  assert.throws(() => crearServidor({ home: "x", codigo: "1234567" }), ServidorError);
  assert.throws(() => crearServidor({ home: "x", codigo: "abcdef" }), ServidorError);

  const codigo = crearCodigo();
  assert.match(codigo, /^\d{8}$/);

  const ip = ipLocal();
  assert.ok(ip === undefined || /^\d+\.\d+\.\d+\.\d+$/.test(ip));
});
