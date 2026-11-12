/**
 * Tests de la comprobación del firewall. No tocan el sistema: la parte que
 * decide si una regla cubre el perfil activo es una función pura y el resto se
 * prueba con un ejecutor de mentira.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { comandoSugerido, cubreAlgunPerfil, estadoFirewall } from "../src/core/firewall.js";

test("una regla solo cubre el perfil que dice", () => {
  assert.equal(cubreAlgunPerfil([{ perfil: "Public" }], ["Private"]), false);
  assert.equal(cubreAlgunPerfil([{ perfil: "Private" }], ["Private"]), true);
  assert.equal(cubreAlgunPerfil([{ perfil: "Private" }], ["Public"]), false);
  assert.equal(cubreAlgunPerfil([{ perfil: "Any" }], ["Private"]), true);
  assert.equal(cubreAlgunPerfil([{ perfil: "Domain,Private" }], ["Private"]), true);
  assert.equal(cubreAlgunPerfil([], ["Private"]), false);
});

test("en otros sistemas no hay nada que comprobar", () => {
  const estado = estadoFirewall({ plataforma: "linux" });
  assert.deepEqual(estado, { comprobable: false, permite: true });
});

test("lee perfiles y reglas de la salida de PowerShell", () => {
  const ejecutar = (orden, argumentos) => {
    assert.equal(orden, "powershell");
    assert.ok(argumentos.includes("-Command"));
    return JSON.stringify({ perfiles: ["2"], reglas: [{ perfil: "Private" }] });
  };
  const estado = estadoFirewall({ plataforma: "win32", ejecutable: "C:\\node.exe", ejecutar });
  assert.equal(estado.comprobable, true);
  assert.deepEqual(estado.perfiles, ["Private"]);
  assert.equal(estado.permite, true);
});

test("si no hay reglas, no permite (el fallo que buscábamos)", () => {
  const ejecutar = () => JSON.stringify({ perfiles: ["Private"], reglas: [] });
  const estado = estadoFirewall({ plataforma: "win32", ejecutar });
  assert.equal(estado.permite, false);
});

test("si PowerShell falla, se considera no comprobable y no se avisa en falso", () => {
  const ejecutar = () => {
    throw new Error("permiso denegado");
  };
  const estado = estadoFirewall({ plataforma: "win32", ejecutar });
  assert.equal(estado.comprobable, false);
  assert.equal(estado.permite, true);
});

test("el comando sugerido va acotado al programa y a los dos puertos", () => {
  const [tcp, udp] = comandoSugerido("C:\\Program Files\\nodejs\\node.exe");
  assert.match(tcp, /-Direction Inbound/);
  assert.match(tcp, /-Protocol TCP -LocalPort 8787-8790/);
  assert.match(tcp, /-Profile Private/);
  assert.match(tcp, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.match(udp, /-Protocol UDP -LocalPort 8788/);
});
