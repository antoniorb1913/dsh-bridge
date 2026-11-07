/**
 * Tests de la interfaz web: página con CSP y token, API protegida y un envío
 * real hecho desde la web (que es lo que hace el navegador).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { TIPOS_CONOCIDOS_020_RC2 } from "../src/core/compat.js";
import { sessionsRoot } from "../src/core/paths.js";
import { guardarRegistro, leerRegistro } from "../src/core/registry.js";
import { listSessions } from "../src/core/sessions.js";
import { crearServidor } from "../src/net/servidor.js";
import { crearUiServidor, paginaEstado } from "../src/net/ui.js";
import { carpetaTemporal, crearCasaFalsa } from "./ayudas/entorno.js";

const CODIGO = "135790";

async function montarUi() {
  const casa = crearCasaFalsa();
  const ui = crearUiServidor({ home: casa.home, puerto: 0, host: "127.0.0.1", tiposConocidos: TIPOS_CONOCIDOS_020_RC2, origenCompat: "respaldo" });
  const puerto = await ui.iniciar();
  return {
    casa,
    ui,
    url: `http://127.0.0.1:${puerto}`,
    token: ui.datos.token,
    async cerrar() {
      await ui.cerrar();
      fs.rmSync(casa.home, { recursive: true, force: true });
    }
  };
}

test("la página se sirve con CSP estricta y sin nada inline", async () => {
  const montado = await montarUi();
  try {
    const respuesta = await fetch(montado.url + "/");
    assert.equal(respuesta.status, 200);
    const csp = respuesta.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);

    const html = await respuesta.text();
    assert.match(html, /dsh-token/);
    assert.equal(/onclick|onload|<style/i.test(html), false, "el HTML no debe llevar código ni estilos inline");
    assert.match(html, /src="\/ui\.js"/);
    assert.match(html, /href="\/ui\.css"/);

    const css = await fetch(montado.url + "/ui.css");
    assert.match(css.headers.get("content-type"), /text\/css/);
    const js = await fetch(montado.url + "/ui.js");
    assert.match(js.headers.get("content-type"), /javascript/);
    const codigoJs = await js.text();
    assert.equal(/innerHTML/.test(codigoJs), false, "la interfaz debe pintar con textContent, no con innerHTML");
  } finally {
    await montado.cerrar();
  }
});

test("la API exige el token de la página", async () => {
  const montado = await montarUi();
  try {
    assert.equal((await fetch(montado.url + "/api/sesiones")).status, 401);
    assert.equal((await fetch(montado.url + "/api/sesiones", { headers: { "x-dsh-token": "otro" } })).status, 401);

    const conToken = await fetch(montado.url + "/api/sesiones", { headers: { "x-dsh-token": montado.token } });
    assert.equal(conToken.status, 200);
    const datos = await conToken.json();
    assert.equal(datos.sesiones.length, 3);
    assert.equal(datos.home, montado.casa.home, "la API dice de qué almacén lee");
    assert.deepEqual(
      datos.sesiones.map((sesion) => sesion.titulo).sort(),
      ["Conversación con evento nuevo", "Conversación con fotos", "Conversación de texto"]
    );
    assert.equal(typeof datos.sesiones[0].bytes, "number");
    assert.equal(typeof datos.sesiones[0].carpeta, "string");
  } finally {
    await montado.cerrar();
  }
});

test("la API valida lo que le llega", async () => {
  const montado = await montarUi();
  const cabeceras = { "x-dsh-token": montado.token, "content-type": "application/json" };
  try {
    const sinIp = await fetch(montado.url + "/api/enviar", { method: "POST", headers: cabeceras, body: JSON.stringify({ codigo: CODIGO, sesiones: ["x"] }) });
    assert.equal(sinIp.status, 400);
    assert.match((await sinIp.json()).detalle, /IP/);

    const codigoMalo = await fetch(montado.url + "/api/enviar", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ ip: "127.0.0.1", codigo: "12", sesiones: ["x"] })
    });
    assert.equal(codigoMalo.status, 400);
    assert.match((await codigoMalo.json()).detalle, /6 dígitos/);

    const sinSesiones = await fetch(montado.url + "/api/enviar", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ ip: "127.0.0.1", codigo: CODIGO, sesiones: [] })
    });
    assert.equal(sinSesiones.status, 400);

    assert.equal((await fetch(montado.url + "/api/trabajos/no-existe", { headers: { "x-dsh-token": montado.token } })).status, 404);
  } finally {
    await montado.cerrar();
  }
});

test("desde la interfaz se envía de verdad a otro equipo", async () => {
  const montado = await montarUi();
  const destino = carpetaTemporal("dsh-bridge-ui-destino-");
  const workspace = path.join(destino, "proyecto");
  fs.mkdirSync(workspace, { recursive: true });
  const receptor = crearServidor({
    home: destino,
    puerto: 0,
    host: "127.0.0.1",
    codigo: CODIGO,
    workspace,
    tiposConocidos: TIPOS_CONOCIDOS_020_RC2
  });
  const puertoReceptor = await receptor.iniciar();

  try {
    const respuesta = await fetch(montado.url + "/api/enviar", {
      method: "POST",
      headers: { "x-dsh-token": montado.token, "content-type": "application/json" },
      body: JSON.stringify({
        ip: "127.0.0.1",
        puerto: puertoReceptor,
        codigo: CODIGO,
        sesiones: [montado.casa.sesiones.imagenes]
      })
    });
    assert.equal(respuesta.status, 200);
    const { trabajo } = await respuesta.json();

    let estado;
    for (let intento = 0; intento < 60; intento += 1) {
      const consulta = await fetch(`${montado.url}/api/trabajos/${trabajo}`, { headers: { "x-dsh-token": montado.token } });
      estado = await consulta.json();
      if (estado.estado !== "en-curso") break;
      await new Promise((hecho) => setTimeout(hecho, 100));
    }

    assert.equal(estado.estado, "hecho", estado.mensaje);
    assert.equal(estado.resultado.envios.length, 1);
    assert.equal(estado.resultado.envios[0].respuesta.eventos, 3);

    const recibidas = listSessions(destino, { full: true });
    assert.equal(recibidas.length, 1);
    assert.equal(recibidas[0].attachments, 2);
  } finally {
    await receptor.cerrar();
    fs.rmSync(destino, { recursive: true, force: true });
    await montado.cerrar();
  }
});

test("un envío fallido queda como error con su mensaje", async () => {
  const montado = await montarUi();
  try {
    const respuesta = await fetch(montado.url + "/api/enviar", {
      method: "POST",
      headers: { "x-dsh-token": montado.token, "content-type": "application/json" },
      body: JSON.stringify({ ip: "127.0.0.1", puerto: 1, codigo: CODIGO, sesiones: [montado.casa.sesiones.texto] })
    });
    const { trabajo } = await respuesta.json();

    let estado;
    for (let intento = 0; intento < 40; intento += 1) {
      const consulta = await fetch(`${montado.url}/api/trabajos/${trabajo}`, { headers: { "x-dsh-token": montado.token } });
      estado = await consulta.json();
      if (estado.estado !== "en-curso") break;
      await new Promise((hecho) => setTimeout(hecho, 100));
    }
    assert.equal(estado.estado, "error");
    assert.match(estado.mensaje, /no se pudo conectar|ECONNREFUSED/);
  } finally {
    await montado.cerrar();
  }
});

test("separa las que ve la app de las que solo están en disco", async () => {
  const montado = await montarUi();
  try {
    // Se saca una conversación del registro: queda en disco pero la app no la ve.
    const { registro } = leerRegistro(montado.casa.home);
    const fuera = montado.casa.sesiones.texto;
    for (const id of registro.global.workspaceIds) {
      const ficha = registro.tables.workspaces[id];
      ficha.sessionIds = ficha.sessionIds.filter((sesionId) => sesionId !== fuera);
    }
    guardarRegistro(montado.casa.home, registro, { appAbierta: false });

    const respuesta = await fetch(montado.url + "/api/sesiones", { headers: { "x-dsh-token": montado.token } });
    const datos = await respuesta.json();
    assert.equal(datos.resumen.total, 3);
    assert.equal(datos.resumen.visibles, 2);
    assert.equal(datos.sesiones.find((sesion) => sesion.id === fuera).visible, false);
    assert.equal(datos.sesiones.filter((sesion) => sesion.visible).length, 2);
  } finally {
    await montado.cerrar();
  }
});

test("la página ofrece buscar equipos en la red", async () => {
  const montado = await montarUi();
  try {
    const html = await (await fetch(montado.url + "/")).text();
    assert.match(html, /Buscar en la red/);
    assert.match(html, /id="equipos"/);

    assert.equal((await fetch(montado.url + "/api/descubrir", { method: "POST" })).status, 401);

    const respuesta = await fetch(montado.url + "/api/descubrir", { method: "POST", headers: { "x-dsh-token": montado.token } });
    assert.equal(respuesta.status, 200);
    const datos = await respuesta.json();
    assert.ok(Array.isArray(datos.equipos), "debe devolver una lista de equipos");
  } finally {
    await montado.cerrar();
  }
});

test("el guion de la página es JavaScript válido y pinta con textContent", async () => {
  const montado = await montarUi();
  try {
    const js = await (await fetch(montado.url + "/ui.js")).text();
    assert.doesNotThrow(() => new vm.Script(js), "el JS del navegador debe compilar");
    assert.match(js, /textContent/);
  } finally {
    await montado.cerrar();
  }
});

test("la página de estado del receptor enseña el código y avisa si se usó", () => {
  const conCodigo = paginaEstado({ host: "192.168.1.50", puerto: 8787, codigo: "482913", expira: Date.now(), workspace: "D:\\web", emparejado: false });
  assert.match(conCodigo, /482913/);
  assert.match(conCodigo, /192\.168\.1\.50:8787/);
  assert.match(conCodigo, /\/estado\.css/, "los estilos van aparte, no inline");

  const usado = paginaEstado({ host: "127.0.0.1", puerto: 8787, codigo: "", expira: Date.now(), workspace: undefined, emparejado: true });
  assert.match(usado, /ya usado/);
  assert.match(usado, /sin asignar/);
});
