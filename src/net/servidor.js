/**
 * Servidor de recepción de `dsh-bridge` (la mitad «recibir» de la v0.2).
 *
 * Sirve para que otro equipo de la red local pueda emparejarse y, en la tarea
 * siguiente, enviar un bundle. Tres reglas que no se negocian:
 *
 *   1. **Por defecto solo escucha en localhost.** Abrirse a la red es una
 *      decisión explícita (`host: "0.0.0.0"`), y se avisa.
 *   2. **Código de 8 dígitos, un solo uso, con caducidad y límite de intentos.**
 *      Se compara en tiempo constante y nunca se devuelve al cliente.
 *   3. **El resto de la conversación va con un token** que se emite al
 *      emparejarse y caduca; sin token no se lista ni se recibe nada.
 *
 * El bundle viaja **cifrado** (ver `cifrado.js`): aquí se guarda en un temporal,
 * se descifra en streaming con el código y se instala con el mismo módulo que
 * usa la importación desde ZIP. Nunca se escribe nada sin pasar el descifrado.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { importarBundle, ImportError } from "../core/import.js";
import { listSessions } from "../core/sessions.js";
import { CifradoError, descifrarArchivo } from "./cifrado.js";
import { CspUi, ESTILOS_ESTADO, paginaEstado } from "./ui.js";

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

/** Código nuevo de 8 dígitos, sin sesgo y siempre con los ceros delante. */
export function crearCodigo() {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
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
 * Guarda el cuerpo de la petición en un fichero, sin cargarlo en memoria.
 *
 * Cualquier fallo (tamaño, conexión cortada, disco) cancela la escritura y
 * rechaza; **nunca** se escribe en un stream ya cerrado, que es lo que tumbaba
 * el proceso con un envío demasiado grande.
 *
 * @returns {Promise<number>} bytes escritos
 */
function recibirArchivo(req, destino, maximo) {
  return new Promise((resolver, rechazar) => {
    const salida = fs.createWriteStream(destino);
    let total = 0;
    let fallado = false;

    const fallar = (error) => {
      if (fallado) return;
      fallado = true;
      if (!salida.destroyed) salida.destroy();
      rechazar(error);
    };

    salida.on("error", (error) => fallar(new ServidorError(`no se pudo guardar el bundle: ${error.message}`)));

    req.on("data", (trozo) => {
      if (fallado) return;
      total += trozo.length;
      if (total > maximo) {
        fallar(new ServidorError(`el bundle supera el límite de ${Math.round(maximo / (1024 * 1024))} MB`));
        req.resume();
        return;
      }
      if (!salida.writable) {
        fallar(new ServidorError("el destino del bundle ya no acepta datos"));
        return;
      }
      salida.write(trozo);
    });
    req.on("error", (error) => fallar(new ServidorError(`la conexión se cortó: ${error.message}`)));
    req.on("aborted", () => fallar(new ServidorError("el envío se interrumpió")));
    req.on("end", () => {
      if (fallado) return;
      salida.end(() => resolver(total));
    });
  });
}

/**
 * Servidor de recepción.
 *
 * @param {{home: string, puerto?: number, host?: string, codigo?: string,
 *          ttlMs?: number, intentosMax?: number, ahora?: () => number,
 *          workspace?: string, forzar?: boolean, maxBytes?: number,
 *          tiposConocidos?: Set<string>}} opciones
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
  const maxBytes = opciones.maxBytes ?? 2 * 1024 * 1024 * 1024;
  const workspace = opciones.workspace;

  const codigoInicial = opciones.codigo ?? crearCodigo();
  if (!/^\d{8}$/.test(codigoInicial)) throw new ServidorError(`el código debe tener 8 dígitos: ${codigoInicial}`);

  const estado = {
    /** El código se guarda aunque se canjee: hace falta para descifrar. */
    codigo: codigoInicial,
    codigoCanjeado: false,
    codigoExpira: ahora() + ttlMs,
    intentos: 0,
    bloqueado: false,
    token: undefined,
    tokenExpira: 0,
    emparejado: false,
    ultimoRecibido: undefined
  };

  const datosServidor = () => ({
    host,
    puerto: servidor.address()?.port ?? puertoPedido,
    codigo: estado.codigoCanjeado ? "" : estado.codigo,
    expira: new Date(estado.codigoExpira),
    ttlMs,
    emparejado: estado.emparejado,
    workspace
  });

  const tokenValido = (req) => {
    const autorizacion = String(req.headers.authorization ?? "");
    const token = autorizacion.startsWith("Bearer ") ? autorizacion.slice(7) : "";
    if (estado.token === undefined || token === "") return false;
    if (ahora() > estado.tokenExpira) return false;
    return codigoIgual(estado.token, token);
  };

  const servidor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/estado.html")) {
        responder(res, 200, paginaEstado({ ...datosServidor() }), "text/html; charset=utf-8", { "content-security-policy": CspUi });
        return;
      }
      if (req.method === "GET" && url.pathname === "/estado.css") {
        responder(res, 200, ESTILOS_ESTADO, "text/css; charset=utf-8");
        return;
      }

      if (req.method === "GET" && url.pathname === "/estado") {
        responder(res, 200, {
          app: "dsh-bridge",
          protocolo: VERSION_PROTOCOLO,
          emparejado: estado.emparejado,
          bloqueado: estado.bloqueado,
          intentosRestantes: Math.max(0, intentosMax - estado.intentos),
          aceptaBundles: typeof workspace === "string" || typeof opciones.elegirDestino === "function",
          expira: new Date(estado.codigoExpira).toISOString()
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/emparejar") {
        if (estado.bloqueado) {
          responder(res, 423, { error: "bloqueado", detalle: "demasiados intentos: reinicia el servidor para generar un código nuevo" });
          return;
        }
        if (estado.codigoCanjeado) {
          // El código se conserva para descifrar, pero ya no empareja a nadie más.
          responder(res, 401, { error: "codigo-usado", detalle: "ese código ya se usó: reinicia el servidor para generar otro" });
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
        // El código no se puede volver a usar para emparejarse, pero se
        // conserva para derivar la clave de descifrado del envío.
        estado.codigoCanjeado = true;
        estado.emparejado = true;
        estado.token = crypto.randomBytes(32).toString("hex");
        estado.tokenExpira = ahora() + ttlMs;
        responder(res, 200, { token: estado.token, protocolo: VERSION_PROTOCOLO, expira: new Date(estado.tokenExpira).toISOString() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/sesiones") {
        if (!tokenValido(req)) {
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

      if (req.method === "POST" && url.pathname === "/recibir") {
        if (!tokenValido(req)) {
          responder(res, 401, { error: "no-autorizado" });
          req.resume();
          return;
        }

        // Hace falta alguna forma de decidir el destino: fija (`--workspace`) o
        // resolviéndolo al vuelo con el bundle ya descifrado.
        if (typeof workspace !== "string" && typeof opciones.elegirDestino !== "function") {
          responder(res, 400, { error: "sin-destino", detalle: "arranca `serve` con --workspace <carpeta> para poder recibir" });
          req.resume();
          return;
        }

        const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-recibe-"));
        const cifrado = path.join(temporal, "bundle.dshc");
        const zip = path.join(temporal, "bundle.zip");

        // Si el cliente ya dice cuánto pesa y no cabe, se corta antes de mover un byte.
        const declarado = Number(req.headers["content-length"]);
        if (Number.isFinite(declarado) && declarado > maxBytes) {
          responder(res, 413, {
            error: "demasiado-grande",
            detalle: `el bundle pesa ${Math.round(declarado / (1024 * 1024))} MB y el servidor acepta hasta ${Math.round(maxBytes / (1024 * 1024))} MB`,
            maxMB: Math.round(maxBytes / (1024 * 1024))
          });
          req.resume();
          fs.rmSync(temporal, { recursive: true, force: true });
          return;
        }

        try {
          await recibirArchivo(req, cifrado, maxBytes);
          await descifrarArchivo(cifrado, zip, estado.codigo);

          // Con el bundle ya en claro se decide el destino: manda lo que diga el
          // resolutor (diálogo, carpeta del emisor…) y, si no hay, la fija.
          let destino = workspace;
          if (typeof opciones.elegirDestino === "function") {
            try {
              const resuelto = await opciones.elegirDestino(zip);
              if (typeof resuelto === "string" && resuelto !== "") destino = resuelto;
            } catch {
              // Si el resolutor falla se intenta con la carpeta fija.
            }
          }
          if (typeof destino !== "string" || destino === "") {
            responder(res, 409, { error: "sin-destino", detalle: "no se pudo decidir dónde guardar la conversación en el equipo que recibe" });
            return;
          }
          fs.mkdirSync(destino, { recursive: true });

          const resultado = importarBundle(zip, {
            home,
            workspace: destino,
            tiposConocidos: opciones.tiposConocidos,
            appAbierta: false,
            forzar: opciones.forzar === true
          });
          estado.ultimoRecibido = { sesion: resultado.sesionId, cuando: new Date().toISOString() };
          if (typeof opciones.alRecibir === "function") {
            try {
              opciones.alRecibir(resultado);
            } catch {
              // Un fallo al avisar no puede tumbar una recepción que ya está hecha.
            }
          }
          responder(res, 200, {
            ok: true,
            protocolo: VERSION_PROTOCOLO,
            sesion: resultado.sesionId,
            eventos: resultado.eventos,
            workspace: resultado.workspace,
            adjuntos: { copiados: resultado.adjuntos.copiados, yaEstaban: resultado.adjuntos.yaExistian, faltan: resultado.adjuntos.faltan.length },
            avisos: resultado.avisos
          });
        } catch (error) {
          if (error instanceof CifradoError) {
            responder(res, 400, { error: "descifrado", detalle: error.message });
            return;
          }
          if (error instanceof ImportError) {
            responder(res, 409, { error: "importacion", detalle: error.message });
            return;
          }
          throw error;
        } finally {
          fs.rmSync(temporal, { recursive: true, force: true });
        }
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
    /** Datos que se enseñan por consola (el código desaparece al canjearlo). */
    get datos() {
      return datosServidor();
    },
    get estado() {
      return {
        emparejado: estado.emparejado,
        bloqueado: estado.bloqueado,
        intentos: estado.intentos,
        codigoExpira: estado.codigoExpira,
        tokenExpira: estado.tokenExpira,
        ultimoRecibido: estado.ultimoRecibido
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
