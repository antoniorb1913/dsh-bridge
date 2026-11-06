# El formato de DeepSeek Harness, por dentro

Lo que aprendimos migrando conversaciones de verdad. No hay documentación pública de
esto: sale de leer los ficheros, compararlos con los que escribe la app y probar. Si
algún día la herramienta deja de funcionar, este documento es el mapa.

> Versión estudiada: harness **0.2.0-rc.2** y **0.2.1-rc.5**, formato de log **v4** y
> dominio de registro **`workspace` v2**.

## 1. Dónde vive todo

```
~/.dsh/
├─ sessions/
│  └─ <workspace-codificado>/          p. ej. --D-Users-MS-PC-Desktop-web--
│     └─ <session-id>/                 session-7f56faee-…
│        ├─ session.v4.jsonl.zstd      el log (lo único imprescindible)
│        └─ original-…bak              copias que deja dsh-bridge
├─ attachments/
│  └─ v1/objects/<2 hex>/<sha256>      imágenes y ficheros, por contenido
├─ storages/
│  ├─ workspace.json                   registro de workspaces (dominio v2)
│  └─ session_projcache/sessions/<id>.json   caché de títulos y contadores
└─ profiles/                           configuración de plugins (no hace falta tocarla)
```

## 2. El log

Es una secuencia de **frames Zstandard independientes**, uno detrás de otro, sin índice.
La peculiaridad: **el primer frame contiene exactamente la línea de cabecera, con su
salto de línea**; los siguientes frames contienen los eventos, uno por línea (JSONL).

```
[frame 1]  {"type":"session","version":4,"id":"session-…","cwd":"D:\\web",…}\n
[frame 2]  {"type":"user/message","seq":0,…}\n{"type":"step/start",…}\n…
```

Consecuencias prácticas:

- Se puede leer **solo la cabecera** descomprimiendo el primer frame: así se listan
  cientos de conversaciones sin descomprimir gigabytes (`readLogHeader`).
- Al reescribir un log hay que respetar los dos frames. Si se juntan cabecera y primer
  evento en el mismo trozo, o se pierde el `\n`, la app ya no lo lee.
- Cada frame llevaba checksum (`ZSTD_c_checksumFlag`) cuando lo escribía la app.

### La cabecera

```json
{"type":"session","version":4,"id":"session-…","createdAt":1793554845064,
 "cwd":"D:\\Users\\…\\web","isSeeded":false,"agentPreset":"standard"}
```

`cwd` es la carpeta del proyecto **en el equipo de origen**. Es lo que hay que
reescribir al importar, y se compara por ruta canónica (`realpath`), no por texto.

### Los eventos

Cada línea es un objeto con este sobre:

| Campo | Obligatorio | Qué es |
|---|---|---|
| `type` | sí | tipo de evento (`user/message`, `tool/result`, `turn/start`…) |
| `seq` | sí | número entero creciente, sin huecos de orden |
| `time` | sí | milisegundos desde época |
| `data` | sí | carga del evento (forma según el tipo) |
| `surfaceOp` | no | operación sobre la «superficie» de la conversación |
| `sourceEventSeqs` | no | procedencia (qué eventos originaron este) |
| `ignorable` | no | **`true` = el lector puede saltárselo sin miedo** |

Claves desconocidas en el sobre: error. `ignorable` solo admite `true`.

### Tipos de evento y versiones

Cada build del harness lleva una lista fija, `KNOWN_SESSION_EVENT_TYPES`, con los tipos
que entiende. Al leer un log guardado:

```
si tipo ∉ lista  y  ignorable ≠ true  →  rechaza el log entero
```

El mensaje es explícito:

```
session … contains event type "job/registered" (seq 12644) unknown to this harness
and not marked ignorable; refusing to interpret the log
```

Es lo que nos pasó: una conversación venía de una versión con trabajos en segundo plano
(`job/registered`, `job/settled`) y el harness de destino era anterior. La solución es
marcar esos eventos con `ignorable: true`; el resto del log queda intacto.

**Cómo saber qué entiende un equipo.** La lista está en su `resources/app.asar`, en el
literal:

```js
const KNOWN_SESSION_EVENT_TYPES = new Set([ "agent-preset/selected", … ]);
```

⚠️ Buscar el símbolo y quedarse con las cadenas de alrededor **no vale**: el asar
incluye documentación y traducciones que mencionan tipos, y se cuelan. Hay que leer el
literal `new Set([ … ])`. Nos pasó: la primera versión colaba `job/registered` en un
destino que no lo conocía.

## 3. El registro de workspaces (`storages/workspace.json`)

Es el fichero que decide **qué se ve** en la barra lateral. Dominio `workspace`
versión 2:

```json
{
  "unit": { "name": "workspace", "version": 2 },
  "global": {
    "initialized": true,
    "defaultWorkspaceId": "…",
    "workspaceIds": ["id1", "id2"],
    "archivedSessionIds": [],
    "pinnedSessionIds": []
  },
  "tables": {
    "workspaces": {
      "id1": {
        "path": "D:\\Users\\…\\web",
        "title": "web",
        "sessionIds": ["session-…"],
        "createdAt": "2026-11-05T10:42:27.407Z",
        "updatedAt": "2026-11-05T10:42:27.407Z"
      }
    }
  }
}
```

`workspaceIds` es **el orden** de la barra lateral y la app lo usa como fuente de
verdad. Tres invariantes que se validan **al arrancar** (y si fallan, la app no abre):

1. `workspaceIds` referencia exactamente los workspaces de la tabla: ni más ni menos,
   sin repetir.
2. Una **ruta** pertenece a un solo workspace.
3. Una **sesión** está contada por un solo workspace.

Detalles que importan:

- `path` es una ruta **canónica** (`realpath`). `D:\Web` y `d:/web/` son la misma.
- Al crear un workspace, la app lo pone **el primero** de `workspaceIds`.
- `archivedSessionIds` esconde conversaciones sin quitar sus ficheros ni su sitio.
- `pendingMutation` es una marca de operación a medias; la app la usa para recuperarse.
- Escribir este fichero **con la app abierta** es perder el cambio: tiene el registro en
  memoria y lo reescribe al cerrarse. Nos costó una tarde.

## 4. El nombre de la carpeta de un workspace

`sessions/` no usa el nombre del proyecto, sino la ruta codificada:

| Ruta del workspace | Carpeta |
|---|---|
| `D:\Users\MSI-PC\Desktop\web` | `--D-Users-MSI-PC-Desktop-web--` |
| `/mnt/d/Users/MSI-PC/Desktop/web` | `--mnt-d-Users-MSI-PC-Desktop-web--` |
| `/home/msi-pc/Nintendo DS` | `--home-msi-pc-Nintendo~0020DS--` |

Regla derivada (y comprobada contra 115 sesiones reales, 12 carpetas, 0 desajustes):

1. Los espacios se escapan como `~0020`.
2. Cada carácter que no sea `[A-Za-z0-9._~-]` pasa a `-` (incluidos `:`, `\` y `/`).
3. Se colapsan los `-` repetidos y se recortan los extremos.
4. Se envuelve en `--` por los dos lados.

Si esta regla falla en un caso raro, el log acabaría en una carpeta que la app no mira
y el síntoma sería «no aparece». `dsh-bridge doctor` lo comprueba: recorre todas las
sesiones, recalcula la carpeta desde el `cwd` de cada cabecera y avisa de las que no
casan.

## 5. Los adjuntos

- Viven en `attachments/v1/objects/<2 primeros hex del hash>/<sha256>`.
- Los eventos los citan como `attachmentId: "sha256:<64 hex>"` (imágenes y ficheros).
- El nombre es el hash del contenido: si el contenido no cuadra, algo se manipuló.
- Se copian **solo los citados**. En un equipo real, una conversación citaba 559
  adjuntos (682 MB) y el almacén tenía muchos más.

## 6. La caché de proyecciones

`storages/session_projcache/sessions/<id>.json` guarda el estado derivado del log
(título, contadores, modelo…). **Es descartable**: si falta o está rota, la app relee el
log y la reconstruye. `dsh-bridge` la usa solo para leer títulos rápido y no la escribe
nunca.

El título también puede estar dentro del log, en un evento `session/title`; si hay
varios, vale el último.

## 7. Qué puede romper la herramienta

| Cambio en la app | Qué pasaría | Cómo nos enteramos |
|---|---|---|
| `session.v5` | No leemos el log | `doctor` lo marca como log dañado; los tests fallan |
| `unit.version` del registro ≠ 2 | No escribimos el registro | Validación previa con mensaje claro |
| Nuevos campos obligatorios en el sobre | Rechazo al leer | Tests con fixtures propias |
| Cambio en la codificación de carpetas | La sesión no aparece | `doctor` compara contra las sesiones reales |
| Cambio en `attachments/` | Se copian mal o no se encuentran | `doctor` cuenta referencias sin fichero |

Ninguna de estas cosas se arregla sola: hay que adaptar el código. Pero todas fallan
**con un mensaje** y sin dejar el almacén a medias, que era el objetivo.
