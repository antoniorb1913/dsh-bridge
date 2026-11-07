# dsh-bridge

[![CI](https://github.com/antoniorb1913/dsh-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/antoniorb1913/dsh-bridge/actions/workflows/ci.yml)

**Exporta e importa conversaciones de DeepSeek Harness entre equipos.**
Un ZIP portable, un menú en castellano y —lo importante— las tres cosas que la app no hace sola.

> Estado: **v0.2** — exportar e importar por consola/menú, y **transferencia por la red
> local** con código de un solo uso, cifrado e interfaz web.

---

## El problema

DeepSeek Harness guarda cada conversación en `~/.dsh`, en tu equipo, y no tiene forma
de llevarla a otro. Copiar la carpeta no basta: al hacerlo a mano descubrimos que
faltan tres piezas y el síntoma siempre es el mismo — *«la sesión está en disco, pero
la app no la lista»*:

1. **El registro del workspace** (`~/.dsh/storages/workspace.json`). Sin una entrada
   ahí, la conversación existe pero es invisible. Además, la app **valida ese fichero
   al arrancar y aborta** si está incoherente.
2. **La ruta**. El log guarda en su cabecera la carpeta del proyecto del equipo de
   origen; si no se reescribe, la app no la reconoce (`realpath`, no el texto).
3. **Los tipos de evento**. Si el harness de destino es más antiguo y el log trae un
   evento que no conoce, **rechaza el log entero**… salvo que ese evento esté marcado
   como `ignorable`.

A eso se suma lo obvio: los adjuntos (las imágenes) viven aparte, por hash, y hay que
llevarse solo los que la conversación cita.

`dsh-bridge` hace esas cuatro cosas y avisa de todo lo que no puede hacer.

## Requisitos

- **Node.js ≥ 22.15** (usa `node:zlib` con Zstandard, sin dependencias).
- DeepSeek Harness instalado y usado al menos una vez (para tener `~/.dsh`).
- Windows, Linux o macOS. Probado en Windows 11 (Node 26) y WSL/Ubuntu (Node 24).

## Instalación

Todavía no está publicado en npm; se usa desde el repositorio:

```bash
git clone https://github.com/antoniorb1913/dsh-bridge.git
cd dsh-bridge
node bin/dsh-bridge.js --help
```

Si lo quieres como comando en el PATH, enlázalo con `npm link`.

## Uso

### El menú

```bash
node bin/dsh-bridge.js
```

```
  dsh-bridge · conversaciones de DeepSeek Harness
  ───────────────────────────────────────────────
  1) Exportar una conversación a ZIP
  2) Importar un ZIP
  3) Enviar por red (abre la interfaz web)
  4) Recibir por red (queda escuchando con un código)
  5) Diagnóstico
  0) Salir
```

### Los comandos

```bash
# qué conversaciones hay
node bin/dsh-bridge.js list

# exportar una (el id sale en `list`)
node bin/dsh-bridge.js export session-1234 -o %USERPROFILE%\Desktop

# importar el ZIP en otro equipo, en la carpeta del proyecto
node bin/dsh-bridge.js import "C:\Users\tu-usuario\Desktop\dsh-sesion-bar-20261107.zip" --workspace D:\proyectos\web

# ¿está todo en su sitio? (DSH, app abierta, carpetas, registro, adjuntos)
node bin/dsh-bridge.js doctor
```

`list` sin más lee los logs para sacar títulos y contar imágenes (en un equipo con 115
conversaciones tarda menos de un segundo). Con `--rapido` solo lee las cabeceras: 87 ms.
Con `--json` devuelve datos para scripts.

## Por red, sin USB

Los dos equipos tienen que estar en la misma red local y con el programa descargado en
ambos (sigue sin dependencias).

**1. En el que recibe:**

```bash
node bin/dsh-bridge.js serve --red --workspace D:\proyectos\web
```

```
  dsh-bridge · recibiendo conversaciones
  ──────────────────────────────────────────────────────────
  Dirección : http://192.168.1.50:8787
  Código    : 482913   (un solo uso, caduca 07/11/2026 14:05)
  Destino   : D:\proyectos\web
  Límite    : 2,0 GB por bundle
  En la red : se anuncia como «PORTATIL» (UDP 8788)
```

**2. En el que envía:**

```bash
# ¿quién hay esperando?
node bin/dsh-bridge.js discover

# o directamente, sin escribir la IP
node bin/dsh-bridge.js send --buscar --codigo 482913 --sesion session-1234
```

```
✔ «Página web para Bar El Jardín en Netlify» llegó a D:\proyectos\web
  eventos   : 22179
  adjuntos  : 559 copiados, 0 ya estaban
  tamaño    : 693 MB en claro, 693 MB cifrado
```

**3. Si prefieres el ratón:**

```bash
node bin/dsh-bridge.js ui --abrir
```

Una página en tu equipo (`127.0.0.1:8790`) con la lista de conversaciones, el formulario
con la IP y el código, un botón de búsqueda en la red y la barra de progreso.

### Cómo viaja y qué se protege

- El contenido va **cifrado con AES-256-GCM**; la clave sale del código con `scrypt` y un
  `salt` aleatorio por envío. **El código nunca viaja por la red.**
- El código es de **un solo uso**, caduca a los 10 minutos, admite 5 intentos y bloquea.
- Cifrado y descifrado van **en streaming**: una conversación de 693 MB no ocupa 693 MB
  de memoria (medido: ~60 MB por proceso).
- `serve` escucha solo en este equipo salvo que uses `--red`; sin `--workspace` puede
  listar pero no recibir.
- La interfaz web (`ui`) **solo existe en localhost** y exige un token por sesión; no se
  expone a la red a propósito.

### Lo que hay que saber antes de usarlo

- **Cierra DeepSeek Harness antes de importar.** Si está abierta, tiene el registro en
  memoria y lo sobrescribe al cerrarse: la conversación quedaría invisible otra vez.
  El menú se ofrece a cerrarla y volver a abrirla; la CLI te lo dice y se para.
- **El ZIP lleva tus conversaciones sin cifrar.** Bórralo cuando esté importado y no lo
  subas a ningún sitio.
- **No uses la misma conversación en dos equipos a la vez**: cada copia escribe su
  propio historial y divergen.
- Si el harness de destino es **más antiguo**, el log se adapta automáticamente
  (marcando lo desconocido como `ignorable`) y se te avisa de qué se ha marcado.
- La primera vez, **Windows preguntará por el firewall**: permite solo redes privadas.

## Qué hay dentro del ZIP

```
dsh-sesion-<titulo>-<AAAAMMDD>.zip
├─ meta.json                        manifiesto: sha256 del log, eventos, adjuntos, procedencia
├─ LEEME.txt                        explicación para humanos
├─ session/session.v4.jsonl.zstd    el log de la conversación
└─ attachments/objects/<2>/<hash>   solo las imágenes y ficheros que la conversación cita
```

Se abre con doble clic en Windows: es un ZIP normal. El `meta.json` permite comprobar
la integridad con cualquier herramienta (`sha256sum`) y la importación **lo verifica**.

## Diagnóstico

`doctor` mira justo lo que falló durante la migración manual:

```
datos de DSH : C:\Users\tu-usuario\.dsh
app abierta  : no
app.asar     : ...\DeepSeek Harness\resources\app.asar
tipos evento : 62 (asar)
sesiones     : 115
carpetas     : 115 comprobadas, 0 en carpeta que no toca
registro     : C:\Users\tu-usuario\.dsh\storages\workspace.json
workspaces   : 4, 0 problema(s)
adjuntos     : 5 sesión(es) revisadas, 0 referencia(s) sin fichero

✔ todo en orden
```

Códigos de salida: `0` bien, `1` hay problemas (el detalle va en la salida), `2` error
de uso.

## Instalación manual (si algo falla)

El script hace lo mismo que se hacía a mano:

1. Copia `~/.dsh/storages/workspace.json` a `workspace.json.bak-<fecha>`.
2. Escribe el log en `~/.dsh/sessions/<carpeta-derivada>/<session-id>/`.
3. Copia los adjuntos citados a `~/.dsh/attachments/v1/objects/`.
4. Añade la sesión al workspace y reordena `workspaceIds`.

Si algo se estropea, el `.bak-<fecha>` y la copia del log anterior (`*.bak-<fecha>`) te
devuelven al estado de antes.

## Límites conocidos

- La app **no tiene API** para esto: se escribe en su almacén. Si una versión futura
  cambia el formato (`session.v5`, `workspace` v3) habrá que adaptar la herramienta;
  `doctor` y la validación previa están para que falle claro y a tiempo.
- El formato de log es `v4` y el registro es el dominio `workspace` v2 (los de la
  versión 0.2.x del harness).
- No sincroniza en vivo ni fusiona: transfiere una conversación de un equipo a otro.

## Desarrollo

```bash
npm test          # 125 pruebas con node:test, sin dependencias
```

- `src/core/`: el formato y las garantías (log, ZIP, rutas, adjuntos, registro,
  compatibilidad, bundle e instalación).
- `src/cli/`: argumentos, tablas y selecciones.
- `bin/dsh-bridge.js`: orquesta.
- `test/ayudas/entorno.js`: monta un `DSH_HOME` de mentira completo. Los tests nunca
  usan conversaciones reales.
- `docs/FORMATO.md`: lo que aprendimos del formato, con detalles que no están en
  ningún sitio.

Las normas de trabajo del proyecto (ciclo de tareas, estados, cómo se sube) están en
[`AGENTS.md`](AGENTS.md), con el tablero en [`TAREAS.md`](TAREAS.md) y el registro de lo
hecho en [`HISTORIAL.md`](HISTORIAL.md).

## English

`dsh-bridge` exports and imports **DeepSeek Harness** conversations between machines.

DeepSeek Harness keeps every session under `~/.dsh` and has no export/import. Copying
the folder is not enough: the workspace registry, the session's `cwd` and the event
types the target build knows must all line up, or the app simply won't list the
conversation.

```bash
git clone https://github.com/antoniorb1913/dsh-bridge.git
cd dsh-bridge
node bin/dsh-bridge.js            # interactive menu (Spanish)
node bin/dsh-bridge.js list
node bin/dsh-bridge.js export <session-id> -o ~/Desktop
node bin/dsh-bridge.js import bundle.zip --workspace ~/projects/web
node bin/dsh-bridge.js doctor
```

**Over the network (v0.2):** the receiving machine runs
`serve --red --workspace <folder>` and shows a six-digit one-time code; the sending one
runs `send --buscar --codigo <code> --sesion <id>` (discovery over UDP), or
`ui --abrir` for a local web page with a list, buttons and a progress bar. The bundle
travels encrypted with AES-256-GCM, the key derived from the code with scrypt; the code
itself never goes over the wire.

Requires Node ≥ 22.15 and zero dependencies. **Close DeepSeek Harness before importing**:
it keeps the registry in memory and overwrites it on exit. Bundles contain your
conversations **unencrypted** — delete them after importing. Format details (v4 log,
`workspace` v2 registry, `ignorable` events) are documented in
[`docs/FORMATO.md`](docs/FORMATO.md).

## Licencia

MIT. Ver [LICENSE](LICENSE).
