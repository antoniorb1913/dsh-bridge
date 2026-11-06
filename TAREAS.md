# TAREAS.md — dsh-bridge

Tablero de trabajo. **Una sola** tarea en 🔧 En curso a la vez y nunca se avanza sin el «sí» del usuario (REGLA 1).

**Estados:** ⏳ Pendiente · 🔧 En curso · 👀 Esperando tu OK · ✅ Completada · ⛔ Bloqueada

**Dependencias:** una tarea no empieza hasta que sus dependencias estén ✅.

---

## Fase 0 — Arranque

### T1 · Ubicación del proyecto, documentos de trabajo y esqueleto base
**Estado:** ✅ Completada (2026-11-06)
**Depende de:** —
**Rama:** `docs/t1-base-proyecto` · **Commit:** `docs: añade documentación de trabajo y esqueleto base`

- [x] Proyecto ubicado en `D:\Users\MSI-PC\Desktop\dsh\dsh-bridge` (el clon de GitHub)
- [x] `AGENTS.md` con información, stack, estructura y **las 5 reglas adaptadas a este proyecto** (CLI en Node, sin las normas web: esas quedan reservadas para la UI de la v0.2)
- [x] `TAREAS.md` (este tablero) y `HISTORIAL.md` (registro)
- [x] Esqueleto: `package.json`, `LICENSE` (MIT), `.gitignore` y los cuatro borradores del núcleo
- [x] Tu «sí» y registro en `HISTORIAL.md` (2026-11-06)

---

## Fase 1 — Núcleo: leer el almacén de DeepSeek Harness

### T2 · Log de sesión: frames Zstandard y cabecera
**Estado:** ⏳ Pendiente · **Depende de:** T1 · **Rama propuesta:** `feat/t2-log-zstd`
**Borrador ya escrito:** `src/core/zstd.js`

- Revisar `readFrames`/`decodeLogBuffer`/`encodeLogString` y la lectura rápida de cabecera
- Tests: log de 1 y 2 frames, cola rota, cabecera inválida, ida y vuelta (decodificar → recomprimir → decodificar)

### T3 · ZIP propio (escribir sin comprimir, leer store y deflate)
**Estado:** ⏳ Pendiente · **Depende de:** T1 · **Rama propuesta:** `feat/t3-zip`
**Borrador ya escrito:** `src/core/zip.js`

- Revisar CRC32, cabeceras local/central/EOCD y la lectura por directorio central
- Tests: ida y vuelta con varios ficheros, acentos y rutas con `/`, ZIP corrupto, ZIP hecho con otra herramienta (deflate)

### T4 · Rutas de `~/.dsh` y nombre de carpeta de workspace
**Estado:** ⏳ Pendiente · **Depende de:** T1, T2 · **Rama propuesta:** `feat/t4-rutas-workspace`
**Borrador ya escrito:** `src/core/paths.js`

- Localizar `~/.dsh` (`--dsh-home`, `DSH_HOME`, `%USERPROFILE%`)
- `realpath` y comparación de rutas como Windows
- Codificador de carpeta (`D:\...\web` → `--D-Users-...-web--`) y **verificación contra las sesiones reales** del equipo
- Tests con rutas de Windows, Linux y WSL, espacios incluidos

### T5 · Inventario de sesiones: cabeceras, títulos y adjuntos citados
**Estado:** ⏳ Pendiente · **Depende de:** T2 · **Rama propuesta:** `feat/t5-inventario`
**Borrador ya escrito:** `src/core/sessions.js`

- Listar sesiones sin descomprimir logs completos (solo primer frame)
- Título desde `session_projcache`, con reserva en el propio log y en el primer mensaje
- Contar adjuntos citados (`sha256:…`) sin repetir
- Tests con un `DSH_HOME` falso de tres sesiones

### T6 · Adjuntos: referencias y copia con deduplicación
**Estado:** ⏳ Pendiente · **Depende de:** T5 · **Rama propuesta:** `feat/t6-adjuntos`

- Resolver `attachments/v1/objects/<2 hex>/<sha256>`
- Copiar solo lo citado, sin repetir lo que ya existe
- Detectar adjuntos que faltan y avisar (no abortar)
- Tests: copia, dedupe, hueco en el almacén

### T7 · Registro de workspaces (`storages/workspace.json`)
**Estado:** ⏳ Pendiente · **Depende de:** T4 · **Rama propuesta:** `feat/t7-registro`
**`src/core/registry.js`**

- Leer y validar el dominio `workspace` v2 (orden, ruta única, sesión contada una vez)
- Alta de workspace y asignación de sesión, idempotente
- Copia previa (`.bak-<fecha>`) y escritura atómica
- Tests: alta nueva, repetida, sesión duplicada en dos workspaces, registro inexistente

### T8 · Compatibilidad de tipos de evento
**Estado:** ⏳ Pendiente · **Depende de:** T2 · **Rama propuesta:** `feat/t8-compat`
**`src/core/compat.js`**

- Lista de tipos que entiende una versión, leída del `app.asar` del equipo destino
- Marcar como `ignorable` solo lo desconocido, con copia del log original
- Fallo claro si no se puede averiguar la lista (`--tipos-ignorables` manual)
- Tests: log con `job/registered`, lista leída de un asar de mentira, log sin cambios

---

## Fase 2 — Exportar e importar

### T9 · Exportar: bundle ZIP + `meta.json`
**Estado:** ⏳ Pendiente · **Depende de:** T3, T5, T6 · **Rama propuesta:** `feat/t9-exportar`
**`src/core/pack.js`**

- `meta.json`: versión del tool, fecha, cabecera de la sesión, workspace de origen, tipos de evento usados, adjuntos con tamaño y checksum
- Contenido: `session/session.v<N>.jsonl.zstd`, `attachments/objects/<2>/<sha256>`, `LEEME.txt`
- Tests: bundle completo, sesión sin adjuntos, checksum correcto

### T10 · Importar: colocar, reescribir ruta y registrar
**Estado:** ⏳ Pendiente · **Depende de:** T7, T8, T9 · **Rama propuesta:** `feat/t10-importar`
**`src/core/import.js`**

- Validar el bundle (checksums, cabecera, versión de formato)
- Reescribir `cwd` al workspace destino y colocar el log en la carpeta correcta
- Adjuntos, registro del workspace y comprobación final
- `--dry-run`, `--force`, aviso si la app está abierta
- Tests: importación limpia, cambio de ruta, workspace ya existente, bundle dañado

### T11 · CLI en español: `list`, `export`, `import`, `doctor`
**Estado:** ⏳ Pendiente · **Depende de:** T10 · **Rama propuesta:** `feat/t11-cli`
**`bin/dsh-bridge.js`**

- Ayuda, códigos de salida, mensajes claros y sin jerga
- `doctor`: comprueba `~/.dsh`, valida el codificador de carpetas, detecta la app abierta y la versión del harness
- Tests de humo de los cuatro comandos

### T12 · Tests de integración con `DSH_HOME` falso
**Estado:** ⏳ Pendiente · **Depende de:** T11 · **Rama propuesta:** `test/t12-integracion`

- Fixtures generadas (nunca conversaciones reales): una sesión con texto, una con imagen, una con evento desconocido
- Ciclo export → import en un almacén vacío y comprobación de que queda coherente
- Casos de error: ZIP dañado, adjunto que falta, registro inconsistente

---

## Fase 3 — Publicación

### T13 · README (ES + EN), `docs/FORMATO.md` y CHANGELOG
**Estado:** ⏳ Pendiente · **Depende de:** T12 · **Rama propuesta:** `docs/t13-readme`
**Sustituye el `README.md` provisional que creó GitHub**

- Qué es, para quién, instalación, cuatro comandos con ejemplos, límites y avisos
- `docs/FORMATO.md`: frames, sobre de eventos, `ignorable`, registro, adjuntos — lo aprendido del formato v4
- `CHANGELOG.md` con 0.1.0

### T14 · CI de GitHub Actions y metadatos del paquete
**Estado:** ⏳ Pendiente · **Depende de:** T13 · **Rama propuesta:** `chore/t14-ci`

- Matriz Windows + Ubuntu, Node 22 / 24 / 26, `npm test`
- Revisar `files`, `engines`, `bin` y `repository` de `package.json`

### T15 · Prueba real entre los dos equipos
**Estado:** ⏳ Pendiente · **Depende de:** T14 · **Rama propuesta:** `test/t15-prueba-real`

- Exportar en el portátil e importar en el sobremesa (y al revés)
- Comprobar que la app lista y abre la conversación, con imágenes
- Ajustar lo que falle y dejarlo en `HISTORIAL.md`

---

## Fase 4 — v0.2: red local

### T16 · Servidor de recepción (`serve`)
**Estado:** ⏳ Pendiente · **Depende de:** T15 · **Rama propuesta:** `feat/t16-servidor`

- HTTP en la red local, código de 6 dígitos de un solo uso, caducidad y límite de intentos
- Mostrar IP, puerto y código por consola

### T17 · Envío (`send`) con cifrado
**Estado:** ⏳ Pendiente · **Depende de:** T16 · **Rama propuesta:** `feat/t17-envio`

- Cliente que empuja una o varias sesiones
- Cifrado AES-256-GCM con clave derivada del código (scrypt + salt): el código nunca viaja

### T18 · Interfaz web mínima
**Estado:** ⏳ Pendiente · **Depende de:** T17 · **Rama propuesta:** `feat/t18-ui-web`

- Servida por el propio tool (sin instalar nada en el otro equipo)
- Listar sesiones, elegir, ver progreso; CSP estricta y `textContent` (REGLA 3, apartado «Interfaz web»)

### T19 · Descubrimiento en la red (`discover`)
**Estado:** ⏳ Pendiente · **Depende de:** T18 · **Rama propuesta:** `feat/t19-descubrir`

- UDP broadcast para encontrar equipos con `serve` sin escribir IPs a mano

### T20 · Tests de red, documentación y cierre de v0.2
**Estado:** ⏳ Pendiente · **Depende de:** T19 · **Rama propuesta:** `test/t20-cierre-v02`

- Tests de servidor y cliente, README de la parte de red, `CHANGELOG.md` 0.2.0

---

## Notas

- La rama de trabajo actual es `main`; el usuario crea la rama de cada tarea (REGLA 4).
- Los cuatro borradores (`zstd.js`, `zip.js`, `paths.js`, `sessions.js`) están escritos **sin tests**: por eso sus tareas siguen ⏳ y consisten en revisarlos, completarlos y cubrirlos.
