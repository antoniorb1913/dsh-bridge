/**
 * Tests del descubrimiento: el equipo que recibe se anuncia por UDP y el que
 * envía lo encuentra sin escribir la IP. Se hace por unidifusión a 127.0.0.1
 * para que funcione en cualquier máquina, incluida la del CI.
 */
import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import fs from "node:fs";
import path from "node:path";

import { TIPOS_CONOCIDOS_020_RC2 } from "../src/core/compat.js";
import { listSessions } from "../src/core/sessions.js";
import { DescubrirError, PREGUNTA, crearRespondedor, descubrir } from "../src/net/descubrir.js";
import { enviarSesiones } from "../src/net/cliente.js";
import { crearServidor } from "../src/net/servidor.js";
import { carpetaTemporal, crearCasaFalsa } from "./ayudas/entorno.js";

async function montarRespondedor(opciones = {}) {
  const respondedor = crearRespondedor({ puerto: 0, host: "127.0.0.1", tcpPuerto: 8787, nombre: "equipo-de-prueba", ...opciones });
  const puerto = await respondedor.iniciar();
  return { respondedor, puerto, async cerrar() { await respondedor.cerrar(); } };
}

test("el equipo que recibe contesta a quien pregunta", async () => {
  const montado = await montarRespondedor();
  try {
    const encontrados = await descubrir({ puerto: montado.puerto, destino: "127.0.0.1", esperaMs: 600, repeticiones: 2 });
    assert.equal(encontrados.length, 1);
    assert.equal(encontrados[0].ip, "127.0.0.1");
    assert.equal(encontrados[0].nombre, "equipo-de-prueba");
    assert.equal(encontrados[0].puerto, 8787);
    assert.equal(encontrados[0].emparejado, false);
  } finally {
    await montado.cerrar();
  }
});

test("la respuesta no lleva el código ni nada del contenido", async () => {
  const montado = await montarRespondedor({ estado: () => ({ emparejado: true, codigo: "123456" }) });
  try {
    const respuesta = await new Promise((resolver, rechazar) => {
      const socket = dgram.createSocket("udp4");
      socket.on("message", (mensaje) => {
        socket.close();
        resolver(mensaje.toString("utf8"));
      });
      socket.on("error", rechazar);
      socket.bind(0, "127.0.0.1", () => {
        socket.send(Buffer.from(PREGUNTA), montado.puerto, "127.0.0.1", () => {});
      });
      setTimeout(() => rechazar(new Error("sin respuesta")), 2000);
    });

    assert.equal(respuesta.includes("123456"), false, "el código no puede viajar en el anuncio");
    const datos = JSON.parse(respuesta);
    assert.equal(datos.app, "dsh-bridge");
    assert.equal(datos.puerto, 8787);
    assert.equal(datos.emparejado, true);
    assert.equal(Object.keys(datos).sort().join(","), "app,emparejado,nombre,protocolo,puerto");
  } finally {
    await montado.cerrar();
  }
});

test("sin nadie escuchando no se encuentra nada", async () => {
  const encontrados = await descubrir({ puerto: 9, destino: "127.0.0.1", esperaMs: 300, repeticiones: 1 });
  assert.deepEqual(encontrados, []);
});

test("mensajes que no son la pregunta se ignoran", async () => {
  const montado = await montarRespondedor();
  try {
    const socket = dgram.createSocket("udp4");
    await new Promise((resolver) => socket.bind(0, "127.0.0.1", resolver));
    socket.send(Buffer.from("hola"), montado.puerto, "127.0.0.1", () => {});
    socket.send(Buffer.from(JSON.stringify({ app: "otra" })), montado.puerto, "127.0.0.1", () => {});
    await new Promise((hecho) => setTimeout(hecho, 100));
    socket.close();

    // Sigue contestando a la pregunta buena.
    const encontrados = await descubrir({ puerto: montado.puerto, destino: "127.0.0.1", esperaMs: 500, repeticiones: 1 });
    assert.equal(encontrados.length, 1);
  } finally {
    await montado.cerrar();
  }
});

test("cerrar dos veces no rompe", async () => {
  const montado = await montarRespondedor();
  await montado.respondedor.cerrar();
  await montado.respondedor.cerrar();
});

test("valida sus parámetros", () => {
  assert.throws(() => crearRespondedor({ tcpPuerto: 0 }), DescubrirError);
  assert.throws(() => crearRespondedor({ tcpPuerto: 70000 }), DescubrirError);
  assert.throws(() => crearRespondedor({ tcpPuerto: 8787, puerto: -1 }), DescubrirError);
});

test("descubrir, encontrar y enviar: el ciclo completo", async () => {
  const casa = crearCasaFalsa();
  const destino = carpetaTemporal("dsh-bridge-descubre-");
  const workspace = path.join(destino, "proyecto");
  fs.mkdirSync(workspace, { recursive: true });
  const servidor = crearServidor({ home: destino, puerto: 0, host: "127.0.0.1", codigo: "445566", workspace, tiposConocidos: TIPOS_CONOCIDOS_020_RC2 });
  const puertoServidor = await servidor.iniciar();
  const respondedor = crearRespondedor({
    puerto: 0,
    host: "127.0.0.1",
    tcpPuerto: puertoServidor,
    nombre: "receptor",
    estado: () => servidor.estado
  });
  const puertoDescubrir = await respondedor.iniciar();

  try {
    const encontrados = await descubrir({ puerto: puertoDescubrir, destino: "127.0.0.1", esperaMs: 500, repeticiones: 1 });
    assert.equal(encontrados.length, 1);
    assert.equal(encontrados[0].puerto, puertoServidor);
    assert.equal(encontrados[0].emparejado, false);

    await enviarSesiones({
      home: casa.home,
      sesiones: [casa.sesiones.texto],
      ip: encontrados[0].ip,
      puerto: encontrados[0].puerto,
      codigo: "445566",
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    assert.equal(listSessions(destino).length, 1);
    assert.equal(servidor.estado.emparejado, true);

    // Después de emparejar, el anuncio lo dice.
    const segunda = await descubrir({ puerto: puertoDescubrir, destino: "127.0.0.1", esperaMs: 500, repeticiones: 1 });
    assert.equal(segunda[0].emparejado, true);
  } finally {
    await respondedor.cerrar();
    await servidor.cerrar();
    fs.rmSync(casa.home, { recursive: true, force: true });
    fs.rmSync(destino, { recursive: true, force: true });
  }
});
