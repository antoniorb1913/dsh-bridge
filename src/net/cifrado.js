/**
 * Cifrado del transporte entre equipos.
 *
 * El secreto compartido es el **código de 8 dígitos**, que se teclea en los dos
 * lados y **nunca viaja por la red**. De él se deriva una clave con `scrypt`
 * (lento a propósito) y un `salt` aleatorio por envío; el resto es AES-256-GCM,
 * que además de cifrar autentica: si alguien toca un byte, falla.
 *
 * Formato del paquete (pensado para poder cifrar y descifrar en streaming, sin
 * cargar 300 MB en memoria):
 *
 *   [ "DSH1" 4 ][ salt 16 ][ nonce 12 ][ ciphertext … ][ tag 16 ]
 */
import crypto from "node:crypto";
import fs from "node:fs";

/** Error de cifrado: paquete inválido, código incorrecto o datos manipulados. */
export class CifradoError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CifradoError";
  }
}

const MAGIA = Buffer.from("DSH1", "ascii");
const LARGO_SALT = 16;
const LARGO_NONCE = 12;
const LARGO_TAG = 16;
const CABECERA = MAGIA.length + LARGO_SALT + LARGO_NONCE;

/**
 * Clave de 32 bytes a partir del código (que son 8 dígitos).
 * `scrypt` con N=2^14 cuesta ~50 ms: suficiente para el uso y caro para probar
 * un millón de códigos.
 * @param {string} codigo
 * @param {Buffer} salt
 */
export function derivarClave(codigo, salt) {
  if (typeof codigo !== "string" || codigo === "") throw new CifradoError("falta el código para cifrar");
  if (!Buffer.isBuffer(salt) || salt.length !== LARGO_SALT) throw new CifradoError("salt inválido");
  // N=2^15 (32 MB por intento): encarece mucho la fuerza bruta **offline** si
  // alguien captura el paquete en la red. Medido: ~50 ms aquí, y probar los
  // 100 millones de códigos de 8 dígitos pasaría de meses por núcleo.
  return crypto.scryptSync(codigo, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
}

/**
 * Cifra un buffer completo y devuelve el paquete.
 * @param {Buffer} datos
 * @param {string} codigo
 */
export function cifrar(datos, codigo) {
  if (!Buffer.isBuffer(datos)) throw new CifradoError("cifrar espera un Buffer");
  const salt = crypto.randomBytes(LARGO_SALT);
  const nonce = crypto.randomBytes(LARGO_NONCE);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivarClave(codigo, salt), nonce);
  const cifrado = Buffer.concat([cipher.update(datos), cipher.final()]);
  return Buffer.concat([MAGIA, salt, nonce, cifrado, cipher.getAuthTag()]);
}

/**
 * Descifra un paquete completo.
 * @param {Buffer} paquete
 * @param {string} codigo
 * @returns {Buffer}
 */
export function descifrar(paquete, codigo) {
  if (!Buffer.isBuffer(paquete)) throw new CifradoError("descifrar espera un Buffer");
  if (paquete.length < CABECERA + LARGO_TAG) throw new CifradoError("el paquete cifrado es demasiado pequeño");
  if (paquete.subarray(0, MAGIA.length).compare(MAGIA) !== 0) throw new CifradoError("el paquete no es de dsh-bridge");

  const salt = paquete.subarray(MAGIA.length, MAGIA.length + LARGO_SALT);
  const nonce = paquete.subarray(MAGIA.length + LARGO_SALT, CABECERA);
  const cifrado = paquete.subarray(CABECERA, paquete.length - LARGO_TAG);
  const tag = paquete.subarray(paquete.length - LARGO_TAG);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", derivarClave(codigo, salt), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]);
  } catch (error) {
    throw new CifradoError("no se pudo descifrar: el código no es el mismo o el paquete está dañado", { cause: error });
  }
}

/**
 * Cifra un fichero a otro fichero, en trozos.
 * @param {string} entrada
 * @param {string} salida
 * @param {string} codigo
 * @returns {Promise<{bytes: number}>}
 */
export async function cifrarArchivo(entrada, salida, codigo) {
  const salt = crypto.randomBytes(LARGO_SALT);
  const nonce = crypto.randomBytes(LARGO_NONCE);
  const cipher = crypto.createCipheriv("aes-256-gcm", derivarClave(codigo, salt), nonce);

  let escritos = 0;
  const destino = fs.createWriteStream(salida);
  destino.write(Buffer.concat([MAGIA, salt, nonce]));
  escritos += CABECERA;

  await new Promise((resolver, rechazar) => {
    const origen = fs.createReadStream(entrada, { highWaterMark: 1024 * 1024 });
    origen.on("data", (trozo) => {
      const cifrado = cipher.update(trozo);
      if (cifrado.length > 0) {
        destino.write(cifrado);
        escritos += cifrado.length;
      }
    });
    origen.on("error", rechazar);
    origen.on("end", () => {
      const resto = cipher.final();
      const tag = cipher.getAuthTag();
      destino.end(Buffer.concat([resto, tag]), () => {
        escritos += resto.length + tag.length;
        resolver(undefined);
      });
    });
  });

  return { bytes: escritos };
}

/**
 * Descifra un fichero a otro fichero, en trozos.
 * @param {string} entrada
 * @param {string} salida
 * @param {string} codigo
 * @returns {Promise<{bytes: number}>}
 */
export async function descifrarArchivo(entrada, salida, codigo) {
  const tamano = fs.statSync(entrada).size;
  if (tamano < CABECERA + LARGO_TAG) throw new CifradoError("el fichero cifrado es demasiado pequeño");

  const cabecera = Buffer.alloc(CABECERA);
  const fd = fs.openSync(entrada, "r");
  let tag;
  try {
    fs.readSync(fd, cabecera, 0, CABECERA, 0);
    tag = Buffer.alloc(LARGO_TAG);
    fs.readSync(fd, tag, 0, LARGO_TAG, tamano - LARGO_TAG);
  } finally {
    fs.closeSync(fd);
  }

  if (cabecera.subarray(0, MAGIA.length).compare(MAGIA) !== 0) throw new CifradoError("el paquete no es de dsh-bridge");
  const salt = cabecera.subarray(MAGIA.length, MAGIA.length + LARGO_SALT);
  const nonce = cabecera.subarray(MAGIA.length + LARGO_SALT, CABECERA);

  let decipher;
  try {
    decipher = crypto.createDecipheriv("aes-256-gcm", derivarClave(codigo, salt), nonce);
    decipher.setAuthTag(tag);
  } catch (error) {
    throw new CifradoError("no se pudo preparar el descifrado", { cause: error });
  }

  const desde = CABECERA;
  const hasta = tamano - LARGO_TAG; // exclusivo
  let escritos = 0;
  const destino = fs.createWriteStream(salida);

  await new Promise((resolver, rechazar) => {
    const origen = fs.createReadStream(entrada, { start: desde, end: hasta - 1, highWaterMark: 1024 * 1024 });
    origen.on("data", (trozo) => {
      try {
        const claro = decipher.update(trozo);
        if (claro.length > 0) {
          destino.write(claro);
          escritos += claro.length;
        }
      } catch (error) {
        rechazar(new CifradoError("no se pudo descifrar el contenido", { cause: error }));
      }
    });
    origen.on("error", rechazar);
    origen.on("end", () => {
      try {
        const resto = decipher.final();
        destino.end(resto, () => {
          escritos += resto.length;
          resolver(undefined);
        });
      } catch (error) {
        rechazar(new CifradoError("el código no es el mismo o el paquete está dañado", { cause: error }));
      }
    });
  });

  return { bytes: escritos };
}

export { CABECERA, LARGO_SALT, LARGO_NONCE, LARGO_TAG };
