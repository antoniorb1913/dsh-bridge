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
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T4 · **Rama:** `feat/t7-registro` · **Commit:** `feat: registro de workspaces con invariantes y copia previa`
**Archivos:** `src/core/registry.js`, `test/registry.test.js`

- [x] Leer y validar el dominio `workspace` v2: orden que cubre la tabla, ruta única, sesión contada una sola vez (los tres motivos por los que la app no arrancaría)
- [x] Alta de workspace y asignación de sesión, **idempotente** (repetir no duplica ni toca `updatedAt`); reutiliza el workspace si la ruta solo cambia de mayúsculas o separadores
- [x] Desarchiva la sesión al instalarla y limpia la marca `pendingMutation`
- [x] Se niega a contar una sesión en dos workspaces y a escribir con la app abierta
- [x] Copia previa `.bak-<AAAAMMDDhhmmss>` y escritura atómica (`tmp` + `rename`)
- [x] 15 tests nuevos (74 en total) y **lectura real del registro de este PC: 0 problemas, 4 workspaces, 8 sesiones, y la del bar sale idempotente en seco**

### T8 · Compatibilidad de tipos de evento
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T2 · **Rama:** `feat/t8-compat` · **Commit:** `feat: compatibilidad de tipos de evento con el harness destino`
**Archivos:** `src/core/compat.js`, `test/compat.test.js`

- [x] Lista de tipos leída del `app.asar` del destino, del **literal** `KNOWN_SESSION_EVENT_TYPES = new Set([...])` (leer «alrededor» metía menciones de la documentación como tipos válidos: la primera versión colaba `job/registered` en un destino que no lo conocía)
- [x] Orden de precedencia: lista manual → asar → tabla de respaldo (0.2.0-rc.2), informando del origen
- [x] Marcado `ignorable:true` idempotente, línea a línea, sin tocar el resto y re-parseando cada línea parcheada
- [x] Comprobación final (`tiposPendientes`) para no escribir un log que el destino rechazaría
- [x] 10 tests nuevos (84 en total) y **comprobación real: 62 tipos del asar en 38 ms; el log del bar usa 32 tipos y ninguno queda desconocido**
- [x] **Hallazgo:** este PC ya está en **0.2.1-rc.5** (se actualizó el 29/10), y por eso el log del bar ya no necesita el parche de la semana pasada

---

## Fase 2 — Exportar e importar

### T9 · Exportar: bundle ZIP + `meta.json`
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T3, T5, T6 · **Rama:** `feat/t9-exportar` · **Commit:** `feat: exporta una conversación a un bundle ZIP con manifiesto`
**Archivos:** `src/core/pack.js`, `test/pack.test.js`

- [x] Bundle: `meta.json`, `LEEME.txt`, `session/session.v<N>.jsonl.zstd` y **solo** los adjuntos citados
- [x] `meta.json` con checksum del log, nº de eventos, tipos usados, adjuntos con tamaño y rutas, procedencia y avisos
- [x] Nombre seguro y previsible: `dsh-sesion-<titulo-sin-acentos>-<AAAAMMDD>.zip`
- [x] Adaptación de compatibilidad integrada: marca `ignorable` lo que el destino no conoce y lo anota en el manifiesto (`adaptar:false` para no tocar nada)
- [x] Avisos sin abortar: adjuntos ausentes en el almacén
- [x] Escritura atómica del ZIP (sin `.tmp` sueltos) y errores claros si la sesión no existe o el log está roto
- [x] 10 tests nuevos (94 en total) y **exportación real: 17 entradas, 4,1 MB, 174 ms, 2.530 eventos, 14 adjuntos**

### T10 · Importar: colocar, reescribir ruta y registrar
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T7, T8, T9 · **Rama:** `feat/t10-importar` · **Commit:** `feat: importa un bundle y registra la conversación en el workspace`
**Archivos:** `src/core/import.js`, `test/import.test.js`

- [x] Validar el bundle: manifiesto, formato `dsh-bridge/1`, **sha256 del log**, cabecera y coherencia con el manifiesto
- [x] Reescribir el `cwd` a la carpeta de este equipo y colocar el log en `sessions/<carpeta-derivada>/<id>/`
- [x] Adjuntos con dedupe y hash verificado; si el bundle no trae alguno, avisa y sigue
- [x] Registro del workspace reutilizando el que ya exista para esa ruta (no crea uno por conversación)
- [x] No escribe nada si la app está abierta; `en seco` informa sin tocar disco; `forzar` reemplaza dejando copia
- [x] 10 tests nuevos (105 en total) y **prueba de punta a punta con datos reales**: exportar la conversación «tarjeta» (4.182 KB, 14 adjuntos) e importarla en un almacén vacío → 2.530 eventos, 14 adjuntos, ruta reescrita, registro válido, y la segunda importación rechazada
- [x] **Fallo corregido:** al importar se reconstruía el log desde el cuerpo **sin adaptar**, así que se perdían las marcas `ignorable` (el log se habría escrito y la app lo habría rechazado). Lo destapó el test de adaptación
- [x] **Fallo de portabilidad corregido:** `path.basename` depende del sistema, así que una ruta de Windows leída en Linux daba el título del workspace como la ruta entera. Se sustituye por `nombreBase()` (en `paths.js`), que entiende los dos separadores; detectado al pasar la suite en WSL
- [x] Suite verde **en Windows (Node 26) y en WSL/Linux (Node 24)**: 105 pruebas, 0 fallos en los dos

### T11 · CLI en español + menú interactivo
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T10 · **Rama:** `feat/t11-cli` · **Commit:** `feat: CLI con menú para exportar e importar conversaciones`
**Archivos:** `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/cli.test.js`

- [x] `dsh-bridge` **sin argumentos abre el menú**: Exportar · Importar ZIP · Enviar por red (v0.2) · Recibir por red (v0.2) · Diagnóstico · Salir; si no hay terminal interactiva, enseña la ayuda en vez de colgarse
- [x] Exportar: tabla de conversaciones (título, carpeta, fecha, tamaño, imágenes), selección múltiple (`1,3,5`, `2-4`), carpeta destino y resumen por fichero
- [x] Importar: ruta del ZIP, resumen de lo que trae, lista de workspaces registrados + «otra carpeta», y **si la app está abierta ofrece cerrarla, importar y volver a abrirla**
- [x] Comandos sueltos: `list` (`--rapido` 87 ms / completo 924 ms), `export`, `import` (`--workspace`, `--forzar`, `--seco`), `doctor`, y `send`/`receive` que avisan de que llegan en la v0.2
- [x] `doctor` real: DSH, app abierta, tipos del asar, sesiones, carpetas verificadas, registro válido y adjuntos ausentes → **«todo en orden»**, código 0
- [x] Ayuda con ejemplos, alias en castellano (`listar`, `exportar`…) y códigos de salida (0 bien, 1 problemas, 2 error de uso)
- [x] 12 tests de la CLI (117 en total) y pruebas reales: ayuda, listado, doctor, exportación (4,1 MB, 2.530 eventos, 14 adjuntos) e importación en seco en un `DSH_HOME` falso
- [x] **Fallo corregido:** al cortar la salida (`| head`) el proceso terminaba con código 1 por `EPIPE`; ahora se cierra limpio

### T12 · Tests de integración con `DSH_HOME` falso
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T11 · **Rama:** `test/t12-integracion` · **Commit:** `test: ciclo completo exportar e importar sobre almacenes falsos`
**Archivos:** `test/ayudas/entorno.js`, `test/integracion.test.js`, `src/core/import.js`

- [x] `test/ayudas/entorno.js`: monta un almacén completo de mentira (tres conversaciones: texto, con fotos y con un **tipo de evento desconocido**, con caché de títulos y registro). Nunca datos reales
- [x] Ciclo completo: exportar las tres e importarlas en otro almacén → 3 logs, ruta reescrita, adjuntos completos, **un solo workspace con 3 sesiones**, registro sin problemas y recuento de adjuntos idéntico
- [x] Errores: **registro incoherente en el destino** (aborta sin escribir nada), ZIP truncado (no deja restos) y bundle sin fotos (avisa y el registro queda válido)
- [x] **La CLI se prueba de verdad**: se lanzan `list --json`, `doctor`, `export`, `import --seco` como procesos aparte y se comprueba su salida y su código de salida
- [x] **Mejora de robustez:** la importación ahora valida el registro del destino **antes** de escribir; si ya estaba roto, aborta en vez de dejar medio instalado algo que impide abrir la app
- [x] 8 tests nuevos (125 en total), verdes **en Windows (Node 26) y en WSL/Linux (Node 24)**

---

## Fase 3 — Publicación

### T13 · README (ES + EN), `docs/FORMATO.md` y CHANGELOG
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T12 · **Rama:** `docs/t13-readme` · **Commit:** `docs: README bilingüe, formato v4 y changelog`
**Archivos:** `README.md`, `docs/FORMATO.md`, `CHANGELOG.md`

- [x] `README.md` nuevo (sustituye el provisional de GitHub): el problema en tres piezas, requisitos, instalación, menú, comandos con ejemplos, qué lleva el ZIP, avisos de seguridad (cerrar la app, ZIP sin cifrar), instalación manual, límites conocidos, desarrollo y **sección en inglés**
- [x] `docs/FORMATO.md`: dónde vive todo, frames del log, sobre de eventos, `ignorable` y por qué un tipo desconocido rechaza el log entero, el registro `workspace` v2 con sus tres invariantes, la codificación de carpetas (comprobada contra 115 sesiones), adjuntos, caché de proyecciones y tabla de «qué puede romper la herramienta»
- [x] `CHANGELOG.md` 0.1.0 en formato Keep a Changelog, con lo añadido, los seis fallos corregidos y lo pendiente
- [x] Enlaces internos del README comprobados (los cinco apuntan a ficheros que existen)

### T14 · CI de GitHub Actions y metadatos del paquete
**Estado:** 👀 Esperando tu OK · **Depende de:** T13 · **Rama:** `chore/t14-ci` (la misma rama, con el arreglo)
**Archivos:** `.github/workflows/ci.yml`, `package.json`, `README.md`, `bin/dsh-bridge.js`, `test/integracion.test.js`

- [x] `ci.yml`: matriz **Ubuntu + Windows × Node 22.15 / 24 / 26**, en push a `main`, en cada PR y a mano (`workflow_dispatch`); `permissions: contents: read`
- [x] Segundo trabajo `empaquetado`: `npm pack --dry-run` y `node bin/dsh-bridge.js --version`, para que un paquete roto se vea antes de publicar
- [x] `package.json` revisado: `engines` a `>=22.15.0`, `bin` sin `./`, `scripts` con `start` y `doctor`, `homepage` y `bugs`; fuera un `main` que no aportaba (es una CLI)
- [x] Insignia de CI en el README
- [x] Comprobado en local lo que hará el CI: `npm pack --dry-run` → **17 ficheros, 38,9 kB** (entran `bin`, `src`, `docs/FORMATO.md`, README, CHANGELOG y LICENSE; **no** entran los tests ni `AGENTS/TAREAS/HISTORIAL`)
- [x] **El CI se ejecutó de verdad en el PR #17 y encontró un fallo:** los 6 trabajos de pruebas pasaron (Windows y Ubuntu, Node 22.15/24/26), pero el paso `dsh-bridge --version` fallaba en el runner porque el programa buscaba `~/.dsh` **antes** de atender `--help` y `--version`
- [x] **Corregido:** la ayuda y la versión se atienden sin tocar el disco; el resto de comandos siguen resolviendo `~/.dsh` con su error claro. Test nuevo que lo fija (con un `--dsh-home` inexistente): **126 pruebas, 0 fallos**

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
