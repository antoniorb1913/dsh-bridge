/**
 * Tests de red: un servidor de verdad y el cliente enviando por loopback.
 * Comprueba el ciclo completo: emparejar, exportar, cifrar, subir, descifrar e
 * importar en el almacén destino.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { TIPOS_CONOCIDOS_020_RC2 } from "../src/core/compat.js";
import { canonicalize, sessionsRoot } from "../src/core/paths.js";
import { leerRegistro, validarRegistro } from "../src/core/registry.js";
import { listSessions } from "../src/core/sessions.js";
import { decodeLogBuffer } from "../src/core/zstd.js";
import { RedError, emparejar, enviarSesiones } from "../src/net/cliente.js";
import { cifrar } from "../src/net/cifrado.js";
import { crearServidor } from "../src/net/servidor.js";
import { carpetaTemporal, crearCasaFalsa } from "./ayudas/entorno.js";

const CODIGO = "482913";

/** Monta origen, destino y servidor escuchando en un puerto libre. */
async function montarRed(opciones = {}) {
  const origen = crearCasaFalsa();
  const destino = carpetaTemporal("dsh-bridge-destino-");
  const workspace = path.join(destino, "proyecto");
  fs.mkdirSync(workspace, { recursive: true });

  const servidor = crearServidor({
    home: destino,
    puerto: 0,
    host: "127.0.0.1",
    codigo: CODIGO,
    workspace,
    tiposConocidos: TIPOS_CONOCIDOS_020_RC2,
    ...opciones
  });
  const puerto = await servidor.iniciar();

  return {
    origen,
    destino,
    workspace,
    servidor,
    puerto,
    ip: "127.0.0.1",
    async cerrar() {
      await servidor.cerrar();
      fs.rmSync(origen.home, { recursive: true, force: true });
      fs.rmSync(destino, { recursive: true, force: true });
    }
  };
}

test("envía una conversación por la red y queda importada", async () => {
  const red = await montarRed();
  try {
    const { envios } = await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.imagenes],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2,
      origenCompat: "respaldo"
    });

    assert.equal(envios.length, 1);
    assert.equal(envios[0].respuesta.ok, true);
    assert.equal(envios[0].respuesta.eventos, 3);
    assert.equal(envios[0].respuesta.adjuntos.copiados, 2);
    assert.ok(envios[0].cifradoBytes > envios[0].zipBytes * 0.9, "lo cifrado no debe encogerse");

    // El destino tiene la conversación, con la ruta reescrita y el registro bien.
    const sesiones = listSessions(red.destino, { full: true });
    assert.equal(sesiones.length, 1);
    assert.equal(sesiones[0].attachments, 2);
    const cabecera = JSON.parse(decodeLogBuffer(fs.readFileSync(sesiones[0].logPath)).split("\n")[0]);
    assert.equal(cabecera.cwd, canonicalize(red.workspace));
    assert.deepEqual(validarRegistro(leerRegistro(red.destino).registro), []);
  } finally {
    await red.cerrar();
  }
});

test("envía varias conversaciones en una sola sesión de red", async () => {
  const red = await montarRed();
  try {
    const { envios } = await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto, red.origen.sesiones.imagenes],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    assert.equal(envios.length, 2);
    assert.equal(listSessions(red.destino).length, 2);
  } finally {
    await red.cerrar();
  }
});

test("con el código equivocado no se empareja y no se envía nada", async () => {
  const red = await montarRed();
  try {
    await assert.rejects(
      () =>
        enviarSesiones({
          home: red.origen.home,
          sesiones: [red.origen.sesiones.texto],
          ip: red.ip,
          puerto: red.puerto,
          codigo: "000000",
          tiposConocidos: TIPOS_CONOCIDOS_020_RC2
        }),
      (error) => {
        assert.ok(error instanceof RedError);
        assert.match(error.message, /código rechazado/);
        return true;
      }
    );
    assert.equal(fs.existsSync(sessionsRoot(red.destino)), false);
  } finally {
    await red.cerrar();
  }
});

test("un segundo envío exige un código nuevo (el código es de un solo uso)", async () => {
  const red = await montarRed();
  try {
    const envio = {
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    };
    await enviarSesiones(envio);
    await assert.rejects(() => enviarSesiones(envio), (error) => {
      assert.ok(error instanceof RedError);
      assert.match(error.message, /código rechazado/);
      return true;
    });
    assert.equal(listSessions(red.destino).length, 1, "no debe haber entrado nada nuevo");
  } finally {
    await red.cerrar();
  }
});

test("sin workspace el servidor empareja pero rechaza los bundles", async () => {
  const red = await montarRed({ workspace: undefined });
  try {
    const token = await emparejar({ ip: red.ip, puerto: red.puerto, codigo: CODIGO });
    assert.match(token, /^[0-9a-f]{64}$/);

    const estado = await new Promise((resolver, rechazar) => {
      http
        .get({ host: red.ip, port: red.puerto, path: "/estado" }, (res) => {
          const trozos = [];
          res.on("data", (trozo) => trozos.push(trozo));
          res.on("end", () => resolver(JSON.parse(Buffer.concat(trozos).toString())));
        })
        .on("error", rechazar);
    });
    assert.equal(estado.aceptaBundles, false);

    const cuerpo = cifrar(Buffer.from("nada que importar"), CODIGO);
    const respuesta = await new Promise((resolver, rechazar) => {
      const peticion = http.request(
        {
          host: red.ip,
          port: red.puerto,
          path: "/recibir",
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-length": cuerpo.length }
        },
        (res) => {
          const trozos = [];
          res.on("data", (trozo) => trozos.push(trozo));
          res.on("end", () => resolver({ codigo: res.statusCode, cuerpo: Buffer.concat(trozos).toString() }));
        }
      );
      peticion.on("error", rechazar);
      peticion.end(cuerpo);
    });

    assert.equal(respuesta.codigo, 400);
    assert.match(respuesta.cuerpo, /sin-destino/);
    assert.equal(fs.existsSync(sessionsRoot(red.destino)), false);
  } finally {
    await red.cerrar();
  }
});

test("un cuerpo manipulado se rechaza al descifrar", async () => {
  const red = await montarRed();
  try {
    // Emparejarse de verdad y mandar basura cifrada.
    const servidor = http.createServer();
    servidor.close();
    const token = await emparejar({ ip: red.ip, puerto: red.puerto, codigo: CODIGO });

    const respuesta = await new Promise((resolver, rechazar) => {
      const peticion = http.request(
        {
          host: red.ip,
          port: red.puerto,
          path: "/recibir",
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-length": 100 }
        },
        (res) => {
          const trozos = [];
          res.on("data", (trozo) => trozos.push(trozo));
          res.on("end", () => resolver({ codigo: res.statusCode, cuerpo: Buffer.concat(trozos).toString() }));
        }
      );
      peticion.on("error", rechazar);
      peticion.end(Buffer.alloc(100, 0x7a));
    });

    assert.equal(respuesta.codigo, 400);
    assert.match(respuesta.cuerpo, /descifrado|no es de dsh-bridge|pequeño/);
    assert.equal(fs.existsSync(sessionsRoot(red.destino)), false);
  } finally {
    await red.cerrar();
  }
});

test("el servidor avisa por consola cuando recibe algo", async () => {
  let aviso;
  const red = await montarRed({ alRecibir: (resultado) => { aviso = resultado; } });
  try {
    await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    assert.ok(aviso !== undefined, "el receptor debe avisar de lo que llega");
    assert.equal(aviso.titulo, "Conversación de texto");
    assert.ok(aviso.eventos > 0);
    assert.equal(aviso.workspace, red.workspace);
    assert.equal(typeof aviso.adjuntos.copiados, "number");
  } finally {
    await red.cerrar();
  }
});

test("un fallo al avisar no tumba la recepción", async () => {
  const red = await montarRed({
    alRecibir: () => {
      throw new Error("el aviso se rompe");
    }
  });
  try {
    await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    assert.equal(listSessions(red.destino).length, 1, "la conversación debe quedar importada igual");
  } finally {
    await red.cerrar();
  }
});

test("el receptor puede preguntar la carpeta y usarla al importar", async () => {
  const destinoElegido = carpetaTemporal("dsh-bridge-elegida-");
  const preguntas = [];
  const red = await montarRed({
    workspace: undefined,
    elegirDestino: async () => {
      preguntas.push("pregunta");
      return destinoElegido;
    }
  });
  try {
    await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    assert.equal(preguntas.length, 1, "debe preguntar una vez por cada conversación");
    const recibidas = listSessions(red.destino, { full: true });
    assert.equal(recibidas.length, 1);
    assert.equal(recibidas[0].cwd, destinoElegido, "la conversación va a la carpeta elegida, no a la fija");
  } finally {
    fs.rmSync(destinoElegido, { recursive: true, force: true });
    await red.cerrar();
  }
});

test("si no se elige carpeta, el envío se rechaza y no se importa nada", async () => {
  const red = await montarRed({ workspace: undefined, elegirDestino: async () => undefined });
  try {
    await assert.rejects(
      () =>
        enviarSesiones({
          home: red.origen.home,
          sesiones: [red.origen.sesiones.texto],
          ip: red.ip,
          puerto: red.puerto,
          codigo: CODIGO,
          tiposConocidos: TIPOS_CONOCIDOS_020_RC2
        }),
      (error) => {
        assert.ok(error instanceof RedError);
        assert.match(error.message, /409|sin-destino|rechazó/i);
        return true;
      }
    );
    assert.equal(fs.existsSync(sessionsRoot(red.destino)), false);
  } finally {
    await red.cerrar();
  }
});

test("un fallo al preguntar tampoco importa nada", async () => {
  const red = await montarRed({
    workspace: undefined,
    elegirDestino: async () => {
      throw new Error("se rompió el diálogo");
    }
  });
  try {
    await assert.rejects(() =>
      enviarSesiones({
        home: red.origen.home,
        sesiones: [red.origen.sesiones.texto],
        ip: red.ip,
        puerto: red.puerto,
        codigo: CODIGO,
        tiposConocidos: TIPOS_CONOCIDOS_020_RC2
      })
    );
    assert.equal(fs.existsSync(sessionsRoot(red.destino)), false);
  } finally {
    await red.cerrar();
  }
});

test("si el receptor cancela, la conversación va a la carpeta del emisor", async () => {
  const espejo = carpetaTemporal("dsh-bridge-espejo-");
  const red = await montarRed({
    workspace: undefined,
    elegirDestino: async () => {
      // Lo que hace el CLI al cancelar: devuelve la carpeta espejo del emisor.
      const destino = path.join(espejo, "bar");
      fs.mkdirSync(destino, { recursive: true });
      return destino;
    }
  });
  try {
    await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    const recibidas = listSessions(red.destino, { full: true });
    assert.equal(recibidas.length, 1);
    assert.equal(recibidas[0].cwd, path.join(espejo, "bar"));
  } finally {
    fs.rmSync(espejo, { recursive: true, force: true });
    await red.cerrar();
  }
});

test("el servidor apunta lo último que ha recibido", async () => {
  const red = await montarRed();
  try {
    assert.equal(red.servidor.estado.ultimoRecibido, undefined);
    await enviarSesiones({
      home: red.origen.home,
      sesiones: [red.origen.sesiones.texto],
      ip: red.ip,
      puerto: red.puerto,
      codigo: CODIGO,
      tiposConocidos: TIPOS_CONOCIDOS_020_RC2
    });
    assert.equal(red.servidor.estado.ultimoRecibido.sesion, red.origen.sesiones.texto);
  } finally {
    await red.cerrar();
  }
});

test("un bundle demasiado grande se rechaza y el servidor sigue vivo", async () => {
  // Regresión: con el límite superado el servidor se caía (escribía en un
  // stream ya cerrado), así que cualquiera podía tumbar el receptor.
  const red = await montarRed({ maxBytes: 4096 });
  try {
    const token = await emparejar({ ip: red.ip, puerto: red.puerto, codigo: CODIGO });
    const grande = Buffer.alloc(20 * 1024, 7);

    const respuesta = await new Promise((resolver, rechazar) => {
      const peticion = http.request(
        {
          host: red.ip,
          port: red.puerto,
          path: "/recibir",
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-length": grande.length }
        },
        (res) => {
          const trozos = [];
          res.on("data", (trozo) => trozos.push(trozo));
          res.on("end", () => resolver({ codigo: res.statusCode, cuerpo: Buffer.concat(trozos).toString() }));
        }
      );
      peticion.on("error", rechazar);
      peticion.end(grande);
    });

    assert.equal(respuesta.codigo, 413);
    assert.match(respuesta.cuerpo, /demasiado-grande|supera el límite/);

    // Y sigue en pie: /estado responde.
    const estado = await new Promise((resolver, rechazar) => {
      http
        .get({ host: red.ip, port: red.puerto, path: "/estado" }, (res) => {
          const trozos = [];
          res.on("data", (trozo) => trozos.push(trozo));
          res.on("end", () => resolver(JSON.parse(Buffer.concat(trozos).toString())));
        })
        .on("error", rechazar);
    });
    assert.equal(estado.app, "dsh-bridge");
    assert.equal(fs.existsSync(sessionsRoot(red.destino)), false, "no debe quedar nada a medias");
  } finally {
    await red.cerrar();
  }
});
