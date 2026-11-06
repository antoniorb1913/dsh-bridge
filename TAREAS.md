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
**Estado:** ✅ Completada (2026-11-06) · **Depende de:** T1 · **Rama:** `feat/t2-log-zstd` · **Commit:** `feat: lee y escribe el log de sesión con cabecera y frames zstd`
**Archivos:** `src/core/zstd.js`, `test/zstd.test.js`

- [x] Revisado: se separa la cabecera con su salto de línea (lo que escribe la app), se valida el JSON y se lee el primer frame en trozos crecientes
- [x] **Fallo corregido:** al recomprimir se perdía el `\n` entre cabecera y primer evento, lo que habría dejado ilegibles todos los logs reescritos al importar
- [x] Tests: 10 casos con `node --test` — 1 y 2 frames, varios frames, ida y vuelta con acentos/emoji, checksum, cola rota, firma inválida, cabecera inválida, cabecera en frame > 64 KB y log de 400 KB
- [x] Comprobado con un log real (54.215.552 caracteres): recomprimir y volver a leer devuelve el texto idéntico

### T3 · ZIP propio (escribir sin comprimir, leer store y deflate)
**Estado:** ✅ Completada (2026-11-06) · **Depende de:** T1 · **Rama:** `feat/t3-zip` · **Commit:** `feat: lee y escribe ZIP con validación de rutas y compatibilidad Windows`
**Archivos:** `src/core/zip.js`, `test/zip.test.js`

- [x] Revisado: CRC32, cabeceras local/central/EOCD, lectura por directorio central y límites (4 GB / 65.535 entradas)
- [x] **Fallo corregido:** Windows (`Compress-Archive`, «Enviar a > carpeta comprimida») escribe los nombres con `\`; ahora se normalizan a `/` al leer y las entradas de directorio se ignoran
- [x] Rutas peligrosas (`..`, absolutas, `C:`) rechazadas al leer **y** al escribir
- [x] Tests: 14 casos, incluidos ZIP con deflate de otra herramienta, CRC alterado, ZIP64 y nombres con emoji
- [x] Comprobado contra las herramientas de Windows en los dos sentidos (Expand-Archive y Compress-Archive)

### T4 · Rutas de `~/.dsh` y nombre de carpeta de workspace
**Estado:** ✅ Completada (2026-11-06) · **Depende de:** T1, T2 · **Rama:** `feat/t4-rutas-workspace` · **Commit:** `feat: resuelve rutas de DSH y codifica el nombre de carpeta del workspace`
**Archivos:** `src/core/paths.js`, `test/paths.test.js`

- [x] Localizar `~/.dsh` (`--dsh-home`, `DSH_HOME`, `~/.dsh`): si indicas carpeta, **se respeta o es error**; ya no cae en silencio a `~/.dsh`
- [x] `canonicalize` con `realpath` y mensaje claro si la ruta no existe; `samePath` sin distinguir mayúsculas, separadores ni barra final
- [x] Codificador de carpeta verificado contra **las 115 sesiones reales de este PC** (12 carpetas): **0 desajustes**
- [x] `findAppAsar` estricto cuando se indica ruta a mano (mejor no adivinar la lista de tipos de evento)
- [x] 14 tests nuevos (38 en total): Windows, Linux, WSL, espacios, raíz, home falso con una sesión mal colocada

### T5 · Inventario de sesiones: cabeceras, títulos y adjuntos citados
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T2 · **Rama:** `feat/t5-inventario` · **Commit:** `feat: inventario de sesiones con títulos y adjuntos`
**Archivos:** `src/core/sessions.js`, `test/sessions.test.js`

- [x] Listar sin descomprimir: cabecera del primer frame y `stat` una sola vez por sesión
- [x] Título desde `session_projcache`; reserva en el log (`session/title`, ahora tolera JSON con espacios y se queda con el último) y en el primer mensaje del usuario
- [x] Adjuntos citados (`sha256:…`) sin repetir, con validación de entrada
- [x] **Fallo corregido:** bucle infinito al buscar el último título si el evento venía con espacios (regex sin bandera `g`); lo detectó la propia suite al colgarse
- [x] Código muerto fuera (`readSessionMeta`); orden estable por fecha y, a igualdad, por id
- [x] 12 tests nuevos (50 en total) y **comprobación real: 115 sesiones en 41 ms (rápido) y 907 ms (completo), 111 con título**

### T6 · Adjuntos: referencias y copia con deduplicación
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T5 · **Rama:** `feat/t6-adjuntos` · **Commit:** `feat: adjuntos con verificación de hash y dedupe`
**Archivos:** `src/core/attachments.js`, `test/attachments.test.js`

- [x] Resolver `attachments/v1/objects/<2 hex>/<sha256>` con el hash validado (nada de rutas raras)
- [x] `recogerAdjuntos` (exportar) e `instalarAdjuntos` (importar) copiando solo lo citado
- [x] Dedupe por existencia: lo que ya está no se reescribe; escritura atómica sin dejar temporales
- [x] **El contenido se verifica contra su hash** antes de escribir: un bundle manipulado no entra
- [x] Los que faltan se devuelven aparte, sin abortar
- [x] 9 tests nuevos (59 en total) y **comprobación real: 5 sesiones con adjuntos, 587 referencias, 0 ausentes**

### T7 · Registro de workspaces (`storages/workspace.json`)
**Estado:** 👀 Esperando tu OK · **Depende de:** T4 · **Rama propuesta:** `feat/t7-registro`
**Archivos:** `src/core/registry.js`, `test/registry.test.js`

- [x] Leer y validar el dominio `workspace` v2: orden que cubre la tabla, ruta única, sesión contada una sola vez (los tres motivos por los que la app no arrancaría)
- [x] Alta de workspace y asignación de sesión, **idempotente** (repetir no duplica ni toca `updatedAt`); reutiliza el workspace si la ruta solo cambia de mayúsculas o separadores
- [x] Desarchiva la sesión al instalarla y limpia la marca `pendingMutation`
- [x] Se niega a contar una sesión en dos workspaces y a escribir con la app abierta
- [x] Copia previa `.bak-<AAAAMMDDhhmmss>` y escritura atómica (`tmp` + `rename`)
- [x] 15 tests nuevos (74 en total) y **lectura real del registro de este PC: 0 problemas, 4 workspaces, 8 sesiones, y la del bar sale idempotente en seco**

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

### T11 · CLI en español + menú interactivo
**Estado:** ⏳ Pendiente · **Depende de:** T10 · **Rama propuesta:** `feat/t11-cli`
**`bin/dsh-bridge.js`**

- `dsh-bridge` **sin argumentos abre el menú**: Exportar · Importar ZIP · Enviar por red · Recibir por red · Diagnóstico · Salir
- Exportar: lista numerada de conversaciones (título, workspace, fecha, tamaño, nº de imágenes), selección múltiple (`1,3,5`), destino del ZIP y barra de progreso
- Importar: ruta del ZIP, resumen de lo que trae y elección de workspace destino; si la app está abierta, ofrece cerrarla y volver a abrirla al terminar
- Los mismos comandos sin menú para automatizar: `list`, `export`, `import`, `send`, `receive`, `doctor`
- Ayuda, códigos de salida, mensajes claros y sin jerga
- `doctor`: comprueba `~/.dsh`, valida el codificador de carpetas, detecta la app abierta y la versión del harness
- Tests de humo de los comandos y del menú (entrada simulada por stdin)

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
- **2026-11-06** — A petición del usuario se añadió la **REGLA 6** a `AGENTS.md` (revisión obligatoria cuando avisa de que ya está subido a GitHub). Viaja en el mismo commit de T1, que todavía no está subido.
