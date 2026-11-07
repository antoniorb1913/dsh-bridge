/**
 * Interfaz web local: la misma transferencia que hace `send`, pero con ratón.
 *
 * Se sirve desde el propio programa en `127.0.0.1` y **solo** desde ahí: la
 * página puede leer tu almacén y mandar conversaciones, así que no se expone a
 * la red. Tres detalles de seguridad que no son opcionales:
 *
 *   1. **Token por sesión** en un `<meta>` de la página; toda llamada a la API
 *      lo exige en la cabecera `x-dsh-token`. Sin él, otra página del navegador
 *      podría leer tus conversaciones.
 *   2. **CSP estricta** y nada de código inline: el HTML no lleva ni un `onclick`
 *      ni un `<style>`; todo va en `/ui.js` y `/ui.css`.
 *   3. La página pinta los datos con `textContent`, nunca con `innerHTML`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import { listSessions } from "../core/sessions.js";
import { leerRegistro } from "../core/registry.js";
import { enviarSesiones } from "./cliente.js";
import { descubrir } from "./descubrir.js";

/** Error de la interfaz web. */
export class UiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UiError";
  }
}

const CspUi =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="dsh-token" content="__TOKEN__">
<title>dsh-bridge</title>
<link rel="stylesheet" href="/ui.css">
</head>
<body>
<header>
  <h1>dsh-bridge</h1>
  <p class="sub">Enviar conversaciones de DeepSeek Harness a otro equipo</p>
</header>

<main>
  <section class="panel">
    <h2>1 · ¿A dónde?</h2>
    <div class="fila">
      <label>IP del otro equipo <input id="ip" placeholder="192.168.1.50" autocomplete="off"></label>
      <label>Puerto <input id="puerto" value="8787" size="6"></label>
      <label>Código <input id="codigo" placeholder="482913" size="8" inputmode="numeric"></label>
    </div>
    <div class="acciones">
      <button id="buscar" type="button" class="secundario">Buscar en la red</button>
      <select id="equipos" hidden>
        <option value="">— elige un equipo —</option>
      </select>
    </div>
    <p class="pista" id="aviso-red">Los enseña el otro equipo al ejecutar <code>dsh-bridge serve --red --workspace &lt;carpeta&gt;</code>.</p>
  </section>

  <section class="panel">
    <h2>2 · ¿Qué conversaciones? <span id="contador" class="chip">cargando…</span></h2>
    <p class="pista">Almacén: <span id="almacen">—</span></p>
    <div class="acciones">
      <button id="refrescar" type="button" class="secundario">Refrescar lista</button>
      <button id="ninguna" type="button" class="secundario">Quitar selección</button>
      <label class="en-linea">Ver
        <select id="filtro">
          <option value="visibles">Solo las que ve tu app</option>
          <option value="todas">Todas (incluidas las no registradas)</option>
        </select>
      </label>
    </div>
    <div class="tabla" id="tabla"></div>
  </section>

  <section class="panel">
    <h2>3 · Enviar</h2>
    <button id="enviar" type="button">Enviar seleccionadas</button>
    <div class="progreso" id="progreso" hidden>
      <div class="barra"><div class="relleno" id="relleno"></div></div>
      <p id="estado"></p>
    </div>
    <ul id="resultados" class="resultados"></ul>
  </section>
</main>

<footer>
  <p>Todo va por tu red local, cifrado con AES-256-GCM. El código no viaja.</p>
</footer>
<script src="/ui.js"></script>
</body>
</html>
`;

const ESTILOS = `:root {
  color-scheme: light dark;
  --fondo: #0f1115;
  --panel: #171a21;
  --borde: #2a2f3a;
  --texto: #e6e8ee;
  --tenue: #9aa3b2;
  --acento: #4f8cff;
  --ok: #3fbf7f;
  --mal: #e5534b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--fondo);
  color: var(--texto);
  padding: 24px;
  max-width: 1100px;
  margin-inline: auto;
}
header h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.02em; }
.sub { margin: 0 0 20px; color: var(--tenue); }
.panel {
  background: var(--panel);
  border: 1px solid var(--borde);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.panel h2 { margin: 0 0 12px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--tenue); }
.fila { display: flex; gap: 16px; flex-wrap: wrap; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--tenue); }
input {
  background: #0b0d11;
  border: 1px solid var(--borde);
  border-radius: 6px;
  color: var(--texto);
  padding: 8px 10px;
  font-size: 14px;
}
input:focus { outline: 2px solid var(--acento); outline-offset: 1px; }
button {
  background: var(--acento);
  color: #fff;
  border: 0;
  border-radius: 8px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: default; }
button.secundario { background: transparent; border: 1px solid var(--borde); color: var(--texto); font-weight: 500; padding: 6px 10px; font-size: 13px; }
.acciones { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
.en-linea { flex-direction: row; align-items: center; gap: 8px; font-size: 13px; }
select {
  background: #0b0d11;
  border: 1px solid var(--borde);
  border-radius: 6px;
  color: var(--texto);
  padding: 6px 8px;
  font-size: 13px;
}
.tabla { border-top: 1px solid var(--borde); }
.fila-sesion {
  display: grid;
  grid-template-columns: 28px 1fr 130px 120px 90px 70px;
  gap: 10px;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid var(--borde);
  font-size: 13px;
}
.fila-sesion.cabecera { color: var(--tenue); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.fila-sesion .titulo { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.chip { font-size: 11px; background: #222836; color: var(--tenue); border-radius: 999px; padding: 2px 8px; letter-spacing: 0; text-transform: none; }
.pista { color: var(--tenue); font-size: 12px; margin: 10px 0 0; }
code { background: #0b0d11; border: 1px solid var(--borde); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.progreso { margin-top: 14px; }
.barra { height: 10px; background: #0b0d11; border: 1px solid var(--borde); border-radius: 999px; overflow: hidden; }
.relleno { height: 100%; width: 0%; background: var(--acento); transition: width 0.2s linear; }
.resultados { list-style: none; padding: 0; margin: 12px 0 0; font-size: 13px; }
.resultados li { padding: 6px 0; border-bottom: 1px solid var(--borde); }
.ok { color: var(--ok); }
.mal { color: var(--mal); }
footer { color: var(--tenue); font-size: 12px; margin-top: 8px; }
`;

const GUION = `(() => {
  "use strict";
  const meta = document.querySelector('meta[name="dsh-token"]');
  const token = meta === null ? "" : meta.getAttribute("content");
  const cabeceras = { "x-dsh-token": token, "content-type": "application/json" };

  const $ = (id) => document.getElementById(id);
  const tabla = $("tabla");
  const contador = $("contador");
  const boton = $("enviar");
  const progreso = $("progreso");
  const relleno = $("relleno");
  const estado = $("estado");
  const resultados = $("resultados");

  let sesiones = [];

  const aKB = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    const unidades = ["KB", "MB", "GB"];
    let valor = bytes / 1024;
    let i = 0;
    while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i += 1; }
    return (valor >= 10 ? valor.toFixed(0) : valor.toFixed(1)).replace(".", ",") + " " + unidades[i];
  };
  const fecha = (valor) => {
    const d = new Date(valor);
    const dos = (n) => String(n).padStart(2, "0");
    return dos(d.getDate()) + "/" + dos(d.getMonth() + 1) + "/" + d.getFullYear() + " " + dos(d.getHours()) + ":" + dos(d.getMinutes());
  };

  function filaCabecera() {
    const fila = document.createElement("div");
    fila.className = "fila-sesion cabecera";
    for (const texto of ["", "conversación", "carpeta", "fecha", "tamaño", "imág."]) {
      const celda = document.createElement("span");
      celda.textContent = texto;
      if (texto === "tamaño" || texto === "imág.") celda.className = "num";
      fila.append(celda);
    }
    return fila;
  }

  const pintar = () => {
    const filtro = $("filtro").value;
    const lista = filtro === "todas" ? sesiones : sesiones.filter((sesion) => sesion.visible);
    tabla.replaceChildren(filaCabecera());
    for (const sesion of lista) {
      const fila = document.createElement("div");
      fila.className = "fila-sesion";

      const casilla = document.createElement("input");
      casilla.type = "checkbox";
      casilla.value = sesion.id;
      casilla.setAttribute("aria-label", "seleccionar " + sesion.titulo);
      fila.append(casilla);

      const titulo = document.createElement("span");
      titulo.className = "titulo";
      titulo.textContent = sesion.titulo;
      titulo.title = sesion.titulo;
      if (!sesion.visible) {
        const marca = document.createElement("span");
        marca.className = "chip";
        marca.textContent = "no registrada";
        marca.title = "Está en disco, pero la app no la enseña: su workspace no está registrado";
        titulo.append(" ", marca);
      }
      fila.append(titulo);

      const carpeta = document.createElement("span");
      carpeta.className = "titulo";
      carpeta.textContent = sesion.carpeta;
      fila.append(carpeta);

      const cuando = document.createElement("span");
      cuando.textContent = fecha(sesion.fecha);
      fila.append(cuando);

      const tamano = document.createElement("span");
      tamano.className = "num";
      tamano.textContent = aKB(sesion.bytes);
      fila.append(tamano);

      const adjuntos = document.createElement("span");
      adjuntos.className = "num";
      adjuntos.textContent = sesion.adjuntos;
      fila.append(adjuntos);

      tabla.append(fila);
    }
    const visibles = sesiones.filter((sesion) => sesion.visible).length;
    contador.textContent = visibles === sesiones.length ? sesiones.length + " conversaciones" : visibles + " visibles · " + sesiones.length + " en disco";
  };

  async function cargar() {
    contador.textContent = "cargando…";
    try {
      const respuesta = await fetch("/api/sesiones", { headers: cabeceras });
      if (!respuesta.ok) throw new Error("HTTP " + respuesta.status);
      const datos = await respuesta.json();
      sesiones = datos.sesiones;
      $("almacen").textContent = typeof datos.home === "string" ? datos.home : "—";
      pintar();
    } catch (error) {
      contador.textContent = "no se pudo cargar la lista";
      estado.textContent = "Error al cargar: " + error.message;
    }
  }

  function seleccionadas() {
    return [...tabla.querySelectorAll("input[type=checkbox]:checked")].map((casilla) => casilla.value);
  }

  async function enviar() {
    const elegidas = seleccionadas();
    resultados.replaceChildren();
    if (elegidas.length === 0) {
      estado.textContent = "Marca al menos una conversación.";
      progreso.hidden = false;
      return;
    }
    boton.disabled = true;
    progreso.hidden = false;
    relleno.style.width = "0%";
    estado.textContent = "Emparejando con el otro equipo…";

    try {
      const respuesta = await fetch("/api/enviar", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({
          ip: $("ip").value.trim(),
          puerto: $("puerto").value.trim(),
          codigo: $("codigo").value.trim(),
          sesiones: elegidas
        })
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) throw new Error(datos.detalle || datos.error || ("HTTP " + respuesta.status));
      seguir(datos.trabajo);
    } catch (error) {
      estado.textContent = "No se pudo enviar: " + error.message;
      estado.className = "mal";
      boton.disabled = false;
    }
  }

  async function seguir(id) {
    for (;;) {
      await new Promise((hecho) => setTimeout(hecho, 500));
      let datos;
      try {
        const respuesta = await fetch("/api/trabajos/" + encodeURIComponent(id), { headers: cabeceras });
        datos = await respuesta.json();
      } catch (error) {
        estado.textContent = "Se perdió el contacto con el programa: " + error.message;
        boton.disabled = false;
        return;
      }
      const porcentaje = datos.total === 0 ? 0 : Math.round((datos.hechos / datos.total) * 100);
      relleno.style.width = porcentaje + "%";
      estado.textContent = datos.mensaje;
      estado.className = datos.estado === "error" ? "mal" : "";

      if (datos.estado !== "en-curso") {
        if (datos.estado === "hecho") {
          estado.className = "ok";
          for (const envio of datos.resultado.envios) {
            const elemento = document.createElement("li");
            elemento.className = "ok";
            elemento.textContent =
              "✔ " + envio.titulo + " · " + envio.respuesta.eventos + " eventos · " +
              (envio.respuesta.adjuntos === undefined ? 0 : envio.respuesta.adjuntos.copiados) + " adjuntos";
            resultados.append(elemento);
          }
        }
        boton.disabled = false;
        return;
      }
    }
  }

  async function buscar() {
    const botonBuscar = $("buscar");
    const aviso = $("aviso-red");
    botonBuscar.disabled = true;
    botonBuscar.textContent = "buscando…";
    aviso.className = "pista";
    aviso.textContent = "preguntando en la red durante 2 s…";
    try {
      const respuesta = await fetch("/api/descubrir", { method: "POST", headers: cabeceras });
      const datos = await respuesta.json();
      const lista = $("equipos");
      lista.replaceChildren();
      const vacio = document.createElement("option");
      vacio.value = "";
      vacio.textContent = "— elige un equipo —";
      lista.append(vacio);
      for (const equipo of datos.equipos) {
        const opcion = document.createElement("option");
        opcion.value = equipo.ip + "|" + equipo.puerto;
        opcion.textContent = equipo.nombre + " · " + equipo.ip + ":" + equipo.puerto + (equipo.esteEquipo ? " (este equipo)" : "");
        lista.append(opcion);
      }
      lista.hidden = datos.equipos.length === 0;
      if (datos.equipos.length === 0) {
        aviso.className = "pista mal";
        aviso.textContent =
          "No he encontrado ningún equipo. Arranca el otro con «dsh-bridge serve --red --workspace <carpeta>» y que los dos estén en la misma red.";
      } else {
        aviso.className = "pista ok";
        aviso.textContent = datos.equipos.length === 1 ? "1 equipo encontrado: elígelo en la lista." : datos.equipos.length + " equipos encontrados: elige uno en la lista.";
      }
    } catch (error) {
      aviso.className = "pista mal";
      aviso.textContent = "Fallo al buscar: " + error.message;
    } finally {
      botonBuscar.disabled = false;
      botonBuscar.textContent = "Buscar en la red";
    }
  }

  $("refrescar").addEventListener("click", cargar);
  $("buscar").addEventListener("click", buscar);
  $("equipos").addEventListener("change", (evento) => {
    const [ip, puerto] = String(evento.target.value).split("|");
    if (ip) $("ip").value = ip;
    if (puerto) $("puerto").value = puerto;
  });
  $("ninguna").addEventListener("click", () => {
    for (const casilla of tabla.querySelectorAll("input[type=checkbox]")) casilla.checked = false;
  });
  $("filtro").addEventListener("change", pintar);
  boton.addEventListener("click", enviar);
  cargar();
})();
`;

function responder(res, codigo, cuerpo, tipo, extra = {}) {
  res.writeHead(codigo, {
    "content-type": tipo,
    "content-length": Buffer.byteLength(cuerpo),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra
  });
  res.end(cuerpo);
}

/**
 * Devuelve una función que dice si la app enseña una conversación: tiene que
 * estar apuntada en algún workspace del registro y no estar archivada. Si el
 * registro no se puede leer, se considera todo visible (mejor pecar de listo).
 */
function calcularVisibles(home) {
  try {
    const { registro } = leerRegistro(home);
    const archivadas = new Set(registro.global.archivedSessionIds ?? []);
    const contadas = new Set();
    for (const id of registro.global.workspaceIds ?? []) {
      const ficha = registro.tables.workspaces[id];
      if (ficha === undefined) continue;
      for (const sesionId of ficha.sessionIds ?? []) contadas.add(sesionId);
    }
    return (sesionId) => contadas.has(sesionId) && !archivadas.has(sesionId);
  } catch {
    return () => true;
  }
}

function leerJson(req) {  return new Promise((resolver, rechazar) => {
    const trozos = [];
    let total = 0;
    req.on("data", (trozo) => {
      total += trozo.length;
      if (total > 64 * 1024) {
        rechazar(new UiError("cuerpo demasiado grande"));
        req.resume();
        return;
      }
      trozos.push(trozo);
    });
    req.on("error", rechazar);
    req.on("end", () => {
      if (total > 64 * 1024) return;
      try {
        resolver(trozos.length === 0 ? {} : JSON.parse(Buffer.concat(trozos).toString("utf8")));
      } catch {
        rechazar(new UiError("el cuerpo no es JSON válido"));
      }
    });
  });
}

/**
 * Servidor de la interfaz web.
 *
 * @param {{home: string, host?: string, puerto?: number, tiposConocidos?: Set<string>,
 *          origenCompat?: string}} opciones
 */
export function crearUiServidor(opciones) {
  const home = opciones.home;
  if (typeof home !== "string" || home === "") throw new UiError("falta la carpeta de datos de DeepSeek Harness (home)");
  const host = opciones.host ?? "127.0.0.1";
  const puertoPedido = opciones.puerto ?? 8790;
  if (!Number.isInteger(puertoPedido) || puertoPedido < 0 || puertoPedido > 65535) throw new UiError(`puerto no válido: ${puertoPedido}`);

  const token = crypto.randomBytes(16).toString("hex");
  const trabajos = new Map();
  const pagina = PAGINA.replace("__TOKEN__", token);

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/") {
        responder(res, 200, pagina, "text/html; charset=utf-8", { "content-security-policy": CspUi });
        return;
      }
      if (req.method === "GET" && url.pathname === "/ui.css") {
        responder(res, 200, ESTILOS, "text/css; charset=utf-8");
        return;
      }
      if (req.method === "GET" && url.pathname === "/ui.js") {
        responder(res, 200, GUION, "text/javascript; charset=utf-8");
        return;
      }

      // A partir de aquí, token obligatorio.
      if (String(req.headers["x-dsh-token"] ?? "") !== token) {
        responder(res, 401, JSON.stringify({ error: "no-autorizado" }), "application/json; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sesiones") {
        const esVisible = calcularVisibles(home);
        const sesiones = listSessions(home, { full: true }).map((sesion) => ({
          id: sesion.id,
          titulo: sesion.label,
          carpeta: sesion.cwd === undefined ? "" : sesion.cwd.split(/[\\/]/).pop() ?? "",
          fecha: sesion.mtime,
          bytes: sesion.bytes,
          adjuntos: sesion.attachments ?? 0,
          // La app solo enseña las apuntadas en workspace.json; las demás están
          // en disco pero son invisibles en su barra lateral.
          visible: esVisible(sesion.id)
        }));
        const visibles = sesiones.filter((sesion) => sesion.visible).length;
        // Se devuelve también el almacén: si alguien arrancó la interfaz con
        // otro `--dsh-home`, se ve en la propia página y no hay dudas.
        responder(res, 200, JSON.stringify({ home, resumen: { total: sesiones.length, visibles }, sesiones }), "application/json; charset=utf-8");
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/descubrir") {
        const equipos = await descubrir({ esperaMs: 2000 });
        responder(res, 200, JSON.stringify({ equipos }), "application/json; charset=utf-8");
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/enviar") {
        const cuerpo = await leerJson(req);
        const ip = String(cuerpo.ip ?? "").trim();
        const codigo = String(cuerpo.codigo ?? "").trim();
        const puerto = Number(cuerpo.puerto ?? 8787);
        const sesiones = Array.isArray(cuerpo.sesiones) ? cuerpo.sesiones.map(String) : [];

        if (ip === "") throw new UiError("falta la IP del otro equipo");
        if (!/^\d{6}$/.test(codigo)) throw new UiError("el código son 6 dígitos");
        if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new UiError("puerto no válido");
        if (sesiones.length === 0) throw new UiError("no has marcado ninguna conversación");

        const id = crypto.randomBytes(8).toString("hex");
        const trabajo = { id, estado: "en-curso", hechos: 0, total: sesiones.length, mensaje: "Emparejando…", resultado: undefined };
        trabajos.set(id, trabajo);

        // Se lanza en segundo plano: la página va preguntando por el estado.
        enviarSesiones({
          home,
          sesiones,
          ip,
          puerto,
          codigo,
          tiposConocidos: opciones.tiposConocidos,
          origenCompat: opciones.origenCompat,
          alEmpezar: (sesion) => {
            trabajo.mensaje = "Enviando " + sesion + "…";
          }
        })
          .then((resultado) => {
            trabajo.estado = "hecho";
            trabajo.hechos = sesiones.length;
            trabajo.mensaje = "Enviado: " + resultado.envios.length + " conversación(es)";
            trabajo.resultado = resultado;
          })
          .catch((error) => {
            trabajo.estado = "error";
            trabajo.mensaje = error instanceof Error ? error.message : String(error);
          })
          .finally(() => {
            trabajo.hechos = trabajo.estado === "hecho" ? sesiones.length : trabajo.hechos;
          });

        responder(res, 200, JSON.stringify({ trabajo: id }), "application/json; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/trabajos/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/trabajos/".length));
        const trabajo = trabajos.get(id);
        if (trabajo === undefined) {
          responder(res, 404, JSON.stringify({ error: "trabajo-desconocido" }), "application/json; charset=utf-8");
          return;
        }
        responder(res, 200, JSON.stringify(trabajo), "application/json; charset=utf-8");
        return;
      }

      responder(res, 404, JSON.stringify({ error: "no-encontrado" }), "application/json; charset=utf-8");
    } catch (error) {
      const codigo = error instanceof UiError ? 400 : 500;
      responder(res, codigo, JSON.stringify({ error: codigo === 400 ? "peticion-invalida" : "error-interno", detalle: error.message }), "application/json; charset=utf-8");
    }
  });

  return {
    get datos() {
      return { host, puerto: servidor.address()?.port ?? puertoPedido, token };
    },
    get trabajos() {
      return trabajos;
    },
    async iniciar() {
      await new Promise((resolver, rechazar) => {
        servidor.once("error", (error) => rechazar(new UiError(`no se pudo abrir el puerto ${puertoPedido}: ${error.message}`, { cause: error })));
        servidor.listen(puertoPedido, host, () => resolver(undefined));
      });
      return servidor.address()?.port ?? puertoPedido;
    },
    async cerrar() {
      if (!servidor.listening) return;
      await new Promise((resolver) => servidor.close(() => resolver(undefined)));
    }
  };
}

/** Página mínima de estado para el servidor de recepción (`serve`). */
export function paginaEstado(datos) {
  const filas = [
    ["Dirección", `http://${datos.host}:${datos.puerto}`],
    ["Código", datos.codigo === "" ? "(ya usado)" : datos.codigo],
    ["Caduca", new Date(datos.expira).toLocaleString("es-ES")],
    ["Destino", datos.workspace ?? "(sin asignar)"],
    ["Emparejado", datos.emparejado ? "sí" : "no"]
  ];
  const cuerpo = filas
    .map(([clave, valor]) => `<dt>${clave}</dt><dd>${String(valor).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</dd>`)
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>dsh-bridge · recibiendo</title>
<link rel="stylesheet" href="/estado.css"></head>
<body><h1>dsh-bridge · recibiendo</h1><dl>${cuerpo}</dl>
<p class="pista">En el otro equipo: <code>dsh-bridge send --ip ${datos.host} --puerto ${datos.puerto} --codigo &lt;código&gt; --sesion &lt;id&gt;</code></p>
</body></html>`;
}

/** Hoja de estilos de la página de estado (servida aparte: nada inline). */
export const ESTILOS_ESTADO = `body { font-family: system-ui, sans-serif; background: #0f1115; color: #e6e8ee; padding: 24px; margin: 0; }
h1 { font-size: 20px; margin: 0 0 16px; }
dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 16px; margin: 0 0 18px; }
dt { color: #9aa3b2; font-size: 13px; }
dd { margin: 0; font-size: 14px; }
.pista { color: #9aa3b2; font-size: 13px; }
code { background: #0b0d11; border: 1px solid #2a2f3a; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
`;

export { CspUi };
