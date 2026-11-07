/**
 * Servidor de recepción de `dsh-bridge` (la mitad «recibir» de la v0.2).
 *
 * Sirve para que otro equipo de la red local pueda emparejarse y, en la tarea
 * siguiente, enviar un bundle. Tres reglas que no se negocian:
 *
 *   1. **Por defecto solo escucha en localhost.** Abrirse a la red es una
 *      decisión explícita (`host: "0.0.0.0"`), y se avisa.
 *   2. **Código de 6 dígitos, un solo uso, con caducidad y límite de intentos.**
 *      Se compara en tiempo constante y nunca se devuelve al cliente.
 *   3. **El resto de la conversación va con un token** que se emite al
 *      emparejarse y caduca; sin token no se lista ni se recibe nada.
 *
 * Lo que hace aquí es solo HTTP y estado: el transporte del bundle (cifrado)
 * llega en la tarea siguiente.
 */
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";

import { listSessions } from "../core/sessions.js";

/** Error del servidor: puerto ocupado, código mal formado, etc. */
export class ServidorError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ServidorError";
  }
}

export const VERSION_PROTOCOLO = 1;
const LIMITE_CUERPO = 64 * 1024;

/** IPv4 de la red local, la que hay que darle al otro equipo. */
export function ipLocal() {
  const interfaces = os.networkInterfaces();
  const candidatas = [];
  for (const direcciones of Object.values(interfaces)) {
    for (const direccion of direcciones ?? []) {
      if (direccion.family !== "IPv4" || direccion.internal) continue;
      candidatas.push(direccion.address);
    }
  }
  const privada = candidatas.find((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  return privada ?? candidatas[0];
}

/** Código nuevo de 6 dígitos, sin sesgo y siempre con los ceros delante. */
export function crearCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Comparación en tiempo constante para no delatar el código por el tiempo. */
function codigoIgual(esperado, recibido) {
  const a = Buffer.from(String(esperado).padEnd(8, " "));
  const b = Buffer.from(String(recibido ?? "").padEnd(8, " "));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function responder(res, codigoHttp, datos, cabecerasExtra = {}) {
  const cuerpo = Buffer.from(JSON.stringify(datos), "utf8");
  res.writeHead(codigoHttp, {
    "content-type": "application/json; charset=utf-8",
    "content-length": cuerpo.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...cabecerasExtra
  });
  res.end(cuerpo);
}

function leerCuerpo(req, limite = LIMITE_CUERPO) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    let total = 0;
    let superado = false;
    req.on("data", (trozo) => {
      if (superado) return;
      total += trozo.length;
      if (total > limite) {
        // Se deja de acumular y se contesta 413; el resto se descarta para que
        // la respuesta pueda salir entera antes de cerrar la conexión.
        superado = true;
        trozos.length = 0;
        rechazar(new ServidorError("el cuerpo de la petición es demasiado grande"));
        return;
      }
      trozos.push(trozo);
    });
    req.on("end", () => {
      if (!superado) resolver(Buffer.concat(trozos));
    });
    req.on("error", (error) => {
      if (!superado) rechazar(error);
    });
  });
}

async function leerJson(req) {
  const crudo = await leerCuerpo(req);
  if (crudo.length === 0) return {};
  try {
    return JSON.parse(crudo.toString("utf8"));
  } catch {
    throw new ServidorError("el cuerpo no es JSON válido");
  }
}

/**
 * Servidor de recepción.
 *
 * @param {{home: string, puerto?: number, host?: string, codigo?: string,
 *          ttlMs?: number, intentosMax?: number, ahora?: () => number}} opciones
 */
export function crearServidor(opciones) {
  const home = opciones.home;
  if (typeof home !== "string" || home === "") throw new ServidorError("falta la carpeta de datos de DeepSeek Harness (home)");

  const puertoPedido = opciones.puerto ?? 8787;
  if (!Number.isInteger(puertoPedido) || puertoPedido < 0 || puertoPedido > 65535) throw new ServidorError(`puerto no válido: ${puertoPedido}`);
  const host = opciones.host ?? "127.0.0.1";
  const ttlMs = opciones.ttlMs ?? 10 * 60 * 1000;
  const intentosMax = opciones.intentosMax ?? 5;
  const ahora = opciones.ahora ?? (() => Date.now());

  const codigoInicial = opciones.codigo ?? crearCodigo();
  if (!/^\d{6}$/.test(codigoInicial)) throw new ServidorError(`el código debe tener 6 dígitos: ${codigoInicial}`);

  const estado = {
    codigo: codigoInicial,
    codigoExpira: ahora() + ttlMs,
    intentos: 0,
    bloqueado: false,
    token: undefined,
    tokenExpira: 0,
    emparejado: false
  };

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/estado") {
        responder(res, 200, {
          app: "dsh-bridge",
          protocolo: VERSION_PROTOCOLO,
          emparejado: estado.emparejado,
          bloqueado: estado.bloqueado,
          intentosRestantes: Math.max(0, intentosMax - estado.intentos),
          expira: new Date(estado.codigoExpira).toISOString()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/emparejar") {
        if (estado.bloqueado) {
          responder(res, 423, { error: "bloqueado", detalle: "demasiados intentos: reinicia el servidor para generar un código nuevo" });
          return;
        }
        if (ahora() > estado.codigoExpira) {
          responder(res, 410, { error: "caducado", detalle: "el código ha caducado: reinicia el servidor" });
          return;
        }
        const cuerpo = await leerJson(req);
        if (!codigoIgual(estado.codigo, cuerpo.codigo)) {
          estado.intentos += 1;
          if (estado.intentos >= intentosMax) estado.bloqueado = true;
          responder(res, 401, {
            error: "codigo-incorrecto",
            intentosRestantes: Math.max(0, intentosMax - estado.intentos),
            bloqueado: estado.bloqueado
          });
          return;
        }
        // Un solo uso: el código muere al emparejarse.
        estado.codigo = "";
        estado.emparejado = true;
        estado.token = crypto.randomBytes(32).toString("hex");
        estado.tokenExpira = ahora() + ttlMs;
        responder(res, 200, { token: estado.token, protocolo: VERSION_PROTOCOLO, expira: new Date(estado.tokenExpira).toISOString() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/sesiones") {
        const autorizacion = String(req.headers.authorization ?? "");
        const token = autorizacion.startsWith("Bearer ") ? autorizacion.slice(7) : "";
        if (estado.token === undefined || token === "" || ahora() > estado.tokenExpira || !codigoIgual(estado.token, token)) {
          responder(res, 401, { error: "no-autorizado" });
          return;
        }
        const sesiones = listSessions(home, { full: true }).map((sesion) => ({
          id: sesion.id,
          titulo: sesion.label,
          workspace: sesion.cwd,
          bytes: sesion.bytes,
          adjuntos: sesion.attachments ?? 0,
          fecha: sesion.mtime
        }));
        responder(res, 200, { protocolo: VERSION_PROTOCOLO, sesiones });
        return;
      }

      responder(res, 404, { error: "no-encontrado" });
    } catch (error) {
      if (error instanceof ServidorError) {
        // 413 y cierre ordenado: se descarta lo que quede por llegar.
        responder(res, 413, { error: "peticion-invalida", detalle: error.message }, { connection: "close" });
        req.resume();
        return;
      }
      responder(res, 500, { error: "error-interno" });
    }
  });

  return {
    /** Datos que se enseñan por consola (el código solo aquí). */
    get datos() {
      return {
        host,
        puerto: servidor.address()?.port ?? puertoPedido,
        codigo: estado.codigo,
        expira: new Date(estado.codigoExpira),
        ttlMs,
        emparejado: estado.emparejado
      };
    },
    get estado() {
      return {
        emparejado: estado.emparejado,
        bloqueado: estado.bloqueado,
        intentos: estado.intentos,
        codigoExpira: estado.codigoExpira,
        tokenExpira: estado.tokenExpira
      };
    },
    /** Arranca y devuelve el puerto real (útil con puerto 0). */
    async iniciar() {
      await new Promise((resolver, rechazar) => {
        servidor.once("error", (error) => rechazar(new ServidorError(`no se pudo abrir el puerto ${puertoPedido}: ${error.message}`, { cause: error })));
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
