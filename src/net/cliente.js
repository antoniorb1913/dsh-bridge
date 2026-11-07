/**
 * Cliente de envío: emparejarse, exportar cada conversación, cifrarla y subirla.
 *
 * El código se teclea aquí y **no se manda** en ninguna petición: solo se usa
 * para derivar la clave con la que se cifra el bundle. El servidor, que tiene
 * su copia del código (lo generó él), deriva la misma clave y descifra.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { exportarSesion } from "../core/pack.js";
import { cifrarArchivo } from "./cifrado.js";

/** Error de red: servidor que no responde, código rechazado, envío fallido. */
export class RedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RedError";
  }
}

function peticionJson({ ip, puerto, ruta, metodo = "GET", cuerpo, token, timeoutMs = 5000 }) {
  return new Promise((resolver, rechazar) => {
    const datos = cuerpo === undefined ? undefined : Buffer.from(JSON.stringify(cuerpo), "utf8");
    const req = http.request(
      {
        host: ip,
        port: puerto,
        path: ruta,
        method: metodo,
        timeout: timeoutMs,
        headers: {
          ...(datos === undefined ? {} : { "content-type": "application/json", "content-length": datos.length }),
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
        }
      },
      (res) => {
        const trozos = [];
        res.on("data", (trozo) => trozos.push(trozo));
        res.on("end", () => {
          const crudo = Buffer.concat(trozos).toString("utf8");
          let json = {};
          try {
            json = crudo === "" ? {} : JSON.parse(crudo);
          } catch {
            json = { error: "respuesta-no-json", detalle: crudo.slice(0, 200) };
          }
          resolver({ codigo: res.statusCode ?? 0, datos: json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new RedError(`el servidor ${ip}:${puerto} no responde`)));
    req.on("error", (error) => rechazar(new RedError(`no se pudo conectar con ${ip}:${puerto}: ${error.message}`, { cause: error })));
    if (datos !== undefined) req.write(datos);
    req.end();
  });
}

/**
 * Emparejarse con el servidor y quedarse con el token.
 * @param {{ip: string, puerto: number, codigo: string}} datos
 * @returns {Promise<string>} token
 */
export async function emparejar({ ip, puerto, codigo }) {
  if (typeof codigo !== "string" || !/^\d{8}$/.test(codigo)) throw new RedError("el código son 8 dígitos");
  const { codigo: estado, datos } = await peticionJson({ ip, puerto, ruta: "/emparejar", metodo: "POST", cuerpo: { codigo } });
  if (estado === 200 && typeof datos.token === "string") return datos.token;
  if (estado === 401) throw new RedError(`código rechazado (quedan ${datos.intentosRestantes ?? 0} intentos)`);
  if (estado === 423) throw new RedError("el servidor está bloqueado por demasiados intentos: reinícialo");
  if (estado === 410) throw new RedError("el código ha caducado: reinicia el servidor");
  throw new RedError(`no se pudo emparejar (HTTP ${estado}): ${datos.detalle ?? datos.error ?? ""}`);
}

function subirArchivo({ ip, puerto, archivo, token, timeoutMs = 10 * 60 * 1000 }) {
  return new Promise((resolver, rechazar) => {
    const tamano = fs.statSync(archivo).size;
    const req = http.request(
      {
        host: ip,
        port: puerto,
        path: "/recibir",
        method: "POST",
        timeout: timeoutMs,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/octet-stream",
          "content-length": tamano
        }
      },
      (res) => {
        const trozos = [];
        res.on("data", (trozo) => trozos.push(trozo));
        res.on("end", () => {
          const crudo = Buffer.concat(trozos).toString("utf8");
          let json = {};
          try {
            json = crudo === "" ? {} : JSON.parse(crudo);
          } catch {
            json = { error: "respuesta-no-json", detalle: crudo.slice(0, 200) };
          }
          resolver({ codigo: res.statusCode ?? 0, datos: json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new RedError("el envío tardó demasiado y se canceló")));
    req.on("error", (error) => rechazar(new RedError(`fallo al enviar: ${error.message}`, { cause: error })));
    const origen = fs.createReadStream(archivo, { highWaterMark: 1024 * 1024 });
    origen.on("error", rechazar);
    origen.pipe(req);
  });
}

/**
 * Envía una o varias conversaciones a otro equipo.
 *
 * @param {{home: string, sesiones: string[], ip: string, puerto?: number, codigo: string,
 *          tiposConocidos?: Set<string>, origenCompat?: string,
 *          alEmpezar?: (sesion: string) => void}} opciones
 * @returns {Promise<{token: string, envios: object[]}>}
 */
export async function enviarSesiones(opciones) {
  const { home, sesiones, ip, codigo } = opciones;
  if (!Array.isArray(sesiones) || sesiones.length === 0) throw new RedError("indica al menos una conversación con --sesion");
  const puerto = opciones.puerto ?? 8787;

  const token = await emparejar({ ip, puerto, codigo });

  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bridge-envio-"));
  const envios = [];
  try {
    for (const sesion of sesiones) {
      if (typeof opciones.alEmpezar === "function") opciones.alEmpezar(sesion);
      const exportado = exportarSesion(home, sesion, temporal, {
        tiposConocidos: opciones.tiposConocidos,
        origenCompat: opciones.origenCompat
      });
      const cifrado = path.join(temporal, "bundle.dshc");
      const { bytes: bytesCifrados } = await cifrarArchivo(exportado.ruta, cifrado, codigo);
      const respuesta = await subirArchivo({ ip, puerto, archivo: cifrado, token });

      if (respuesta.codigo !== 200) {
        throw new RedError(
          `el servidor rechazó «${exportado.meta.sesion.titulo ?? sesion}» (HTTP ${respuesta.codigo}): ` +
            `${respuesta.datos.detalle ?? respuesta.datos.error ?? "sin detalle"}`
        );
      }
      envios.push({
        sesion,
        titulo: exportado.meta.sesion.titulo ?? sesion,
        zipBytes: exportado.bytes,
        cifradoBytes: bytesCifrados,
        respuesta: respuesta.datos
      });
      fs.rmSync(exportado.ruta, { force: true });
      fs.rmSync(cifrado, { force: true });
    }
  } finally {
    fs.rmSync(temporal, { recursive: true, force: true });
  }

  return { token, envios };
}
