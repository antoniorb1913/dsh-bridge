/**
 * Comprobación del firewall de Windows para el receptor.
 *
 * El caso que nos costó encontrar: Windows tenía permiso de entrada para Node
 * **solo en el perfil público** y para **otro** `node.exe` distinto del que usa
 * el programa. Resultado: el equipo podía enviar y no podía recibir, sin ningún
 * mensaje que lo explicara.
 *
 * Aquí se mira, en solo lectura: qué perfiles están activos y qué reglas de
 * entrada permiten este ejecutable. Si no cuadra, se devuelve el comando exacto
 * que hay que ejecutar como administrador.
 */
import { execFileSync } from "node:child_process";

/** Nombre del perfil de Windows a partir del número que devuelve `Get-NetConnectionProfile`. */
const PERFILES = { 1: "Domain", 2: "Private", 3: "Public", 4: "Private" };

/**
 * ¿Alguna regla cubre alguno de los perfiles activos? Función pura.
 * @param {Array<{perfil: string}>} reglas
 * @param {string[]} activos
 */
export function cubreAlgunPerfil(reglas, activos) {
  const activosNormalizados = activos.map((perfil) => String(perfil).toLowerCase());
  return reglas.some((regla) => {
    const cubiertos = String(regla.perfil ?? "")
      .split(",")
      .map((perfil) => perfil.trim().toLowerCase())
      .filter(Boolean);
    if (cubiertos.includes("any")) return true;
    return cubiertos.some((perfil) => activosNormalizados.includes(perfil));
  });
}

/** Comando que el usuario debe ejecutar como administrador (solo Windows). */
export function comandoSugerido(ejecutable = process.execPath) {
  return [
    `New-NetFirewallRule -DisplayName "dsh-bridge TCP" -Direction Inbound -Program "${ejecutable}" -Protocol TCP -LocalPort 8787-8790 -Profile Private -Action Allow`,
    `New-NetFirewallRule -DisplayName "dsh-bridge UDP" -Direction Inbound -Program "${ejecutable}" -Protocol UDP -LocalPort 8788 -Profile Private -Action Allow`
  ];
}

/**
 * Estado del firewall para que el receptor pueda aceptar conexiones.
 * @param {{ejecutable?: string, plataforma?: string, ejecutar?: Function}} opciones
 * @returns {{comprobable: boolean, permite: boolean, perfiles?: string[], reglas?: object[], comando?: string[]}}
 */
export function estadoFirewall(opciones = {}) {
  const plataforma = opciones.plataforma ?? process.platform;
  const ejecutable = opciones.ejecutable ?? process.execPath;
  if (plataforma !== "win32") return { comprobable: false, permite: true };
  // Las pruebas y los scripts no deben depender del firewall del equipo.
  if (process.env.DSH_BRIDGE_SKIP_FIREWALL_CHECK === "1") return { comprobable: false, permite: true };

  const guion = [
    "$ErrorActionPreference='Stop';",
    "$perfiles = @(Get-NetConnectionProfile | ForEach-Object { $_.NetworkCategory }) | Sort-Object -Unique;",
    `$programa = '${String(ejecutable).replace(/'/g, "''")}';`,
    "$reglas = @();",
    "try {",
    "  $reglas = @(Get-NetFirewallApplicationFilter -Program $programa | ForEach-Object { $_.InstanceID } | ForEach-Object { Get-NetFirewallRule -Name $_ -ErrorAction SilentlyContinue } | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' } | ForEach-Object { @{ perfil = [string]$_.Profile } })",
    "} catch { $reglas = @() }",
    "[pscustomobject]@{ perfiles = @($perfiles | ForEach-Object { [string]$_ }); reglas = @($reglas) } | ConvertTo-Json -Compress -Depth 4"
  ].join(" ");

  try {
    const ejecutar = opciones.ejecutar ?? ((orden, args) => execFileSync(orden, args, { encoding: "utf8", timeout: 20000 }));
    const salida = ejecutar("powershell", ["-NoProfile", "-NonInteractive", "-Command", guion]);
    const datos = JSON.parse(String(salida).trim() || "{}");
    const activos = (datos.perfiles ?? []).map((perfil) => PERFILES[perfil] ?? String(perfil));
    const reglas = datos.reglas ?? [];
    return { comprobable: true, permite: cubreAlgunPerfil(reglas, activos.length > 0 ? activos : ["Private"]), perfiles: activos, reglas };
  } catch {
    return { comprobable: false, permite: true };
  }
}
