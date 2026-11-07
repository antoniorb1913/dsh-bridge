/**
 * Descubrimiento en la red local: encontrar el equipo que está recibiendo sin
 * tener que copiar la IP a mano.
 *
 * Es UDP y va a lo justo: un latido de pregunta y una respuesta con el nombre
 * del equipo y el puerto. **Nunca viaja el código**, ni el número de
 * conversaciones, ni nada del contenido. Si el servidor no está abierto a la
 * red (`--red`), ni siquiera hay a quién preguntar.
 */
import dgram from "node:dgram";
import os from "node:os";

/** Error de descubrimiento. */
export class DescubrirError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "DescubrirError";
  }
}

export const PUERTO_DESCUBRIR = 8788;
export const PREGUNTA = "DSH-BRIDGE?";
export const PROTOCOLO = 1;

/**
 * Responde a las preguntas de descubrimiento mientras el servidor escucha.
 *
 * @param {{puerto?: number, tcpPuerto: number, nombre?: string,
 *          estado?: () => object, host?: string}} opciones
 */
export function crearRespondedor(opciones) {
  const puerto = opciones.puerto ?? PUERTO_DESCUBRIR;
  const tcpPuerto = opciones.tcpPuerto;
  if (!Number.isInteger(tcpPuerto) || tcpPuerto < 1 || tcpPuerto > 65535) throw new DescubrirError(`puerto TCP no válido: ${tcpPuerto}`);
  if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) throw new DescubrirError(`puerto de descubrimiento no válido: ${puerto}`);

  const nombre = opciones.nombre ?? os.hostname();
  const host = opciones.host ?? "0.0.0.0";
  const estado = opciones.estado ?? (() => ({}));
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  let escuchando = false;

  socket.on("message", (mensaje, remitente) => {
    if (mensaje.toString("utf8").trim() !== PREGUNTA) return;
    const extra = estado();
    const respuesta = JSON.stringify({
      app: "dsh-bridge",
      protocolo: PROTOCOLO,
      nombre,
      puerto: tcpPuerto,
      emparejado: extra.emparejado === true
    });
    socket.send(Buffer.from(respuesta, "utf8"), remitente.port, remitente.address, () => {});
  });

  socket.on("error", () => {
    escuchando = false;
  });

  return {
    get datos() {
      return { puerto: socket.address()?.port ?? puerto, tcpPuerto, nombre };
    },
    async iniciar() {
      await new Promise((resolver, rechazar) => {
        socket.once("error", (error) => rechazar(new DescubrirError(`no se pudo escuchar el descubrimiento: ${error.message}`, { cause: error })));
        socket.bind(puerto, host, () => {
          try {
            socket.setBroadcast(true);
          } catch {
            // Sin difusión el descubrimiento sigue funcionando por unidifusión.
          }
          escuchando = true;
          resolver(undefined);
        });
      });
      return socket.address()?.port ?? puerto;
    },
    async cerrar() {
      if (!escuchando) return;
      escuchando = false;
      await new Promise((resolver) => {
        try {
          socket.close(() => resolver(undefined));
        } catch {
          resolver(undefined);
        }
      });
    }
  };
}

/**
 * Pregunta quién hay en la red y recoge las respuestas.
 *
 * @param {{puerto?: number, destino?: string, esperaMs?: number, repeticiones?: number}} opciones
 * @returns {Promise<Array<{ip: string, nombre: string, puerto: number, emparejado: boolean, esteEquipo: boolean}>>}
 */
export function descubrir(opciones = {}) {
  const puerto = opciones.puerto ?? PUERTO_DESCUBRIR;
  const destino = opciones.destino ?? "255.255.255.255";
  const esperaMs = opciones.esperaMs ?? 1500;
  const repeticiones = opciones.repeticiones ?? 3;
  const nombrePropio = os.hostname();

  return new Promise((resolver, rechazar) => {
    const encontrados = new Map();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    const terminar = () => {
      try {
        socket.close();
      } catch {
        // ya cerrado
      }
      resolver([...encontrados.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)));
    };

    socket.on("message", (mensaje, remitente) => {
      let datos;
      try {
        datos = JSON.parse(mensaje.toString("utf8"));
      } catch {
        return;
      }
      if (datos === null || typeof datos !== "object" || datos.app !== "dsh-bridge") return;
      if (typeof datos.puerto !== "number") return;
      encontrados.set(remitente.address, {
        ip: remitente.address,
        nombre: typeof datos.nombre === "string" ? datos.nombre : remitente.address,
        puerto: datos.puerto,
        emparejado: datos.emparejado === true,
        esteEquipo: datos.nombre === nombrePropio
      });
    });

    socket.on("error", (error) => {
      rechazar(new DescubrirError(`no se pudo preguntar en la red: ${error.message}`, { cause: error }));
    });

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // sin difusión se puede usar un --destino concreto
      }
      const pregunta = Buffer.from(PREGUNTA, "utf8");
      for (let intento = 0; intento < repeticiones; intento += 1) {
        setTimeout(() => {
          socket.send(pregunta, puerto, destino, () => {});
        }, intento * Math.max(50, Math.round(esperaMs / repeticiones)));
      }
      setTimeout(terminar, esperaMs);
    });
  });
}
