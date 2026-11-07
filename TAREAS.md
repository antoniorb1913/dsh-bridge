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
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T13 · **Rama:** `chore/t14-ci` · **Commits:** `chore: CI en Ubuntu y Windows y metadatos del paquete` + `fix: --version y --help funcionan sin DeepSeek Harness instalado`
**Archivos:** `.github/workflows/ci.yml`, `package.json`, `README.md`, `bin/dsh-bridge.js`, `test/integracion.test.js`

- [x] `ci.yml`: matriz **Ubuntu + Windows × Node 22.15 / 24 / 26**, en push a `main`, en cada PR y a mano (`workflow_dispatch`); `permissions: contents: read`
- [x] Segundo trabajo `empaquetado`: `npm pack --dry-run` y `node bin/dsh-bridge.js --version`, para que un paquete roto se vea antes de publicar
- [x] `package.json` revisado: `engines` a `>=22.15.0`, `bin` sin `./`, `scripts` con `start` y `doctor`, `homepage` y `bugs`; fuera un `main` que no aportaba (es una CLI)
- [x] Insignia de CI en el README
- [x] Comprobado en local lo que hará el CI: `npm pack --dry-run` → **17 ficheros, 38,9 kB** (entran `bin`, `src`, `docs/FORMATO.md`, README, CHANGELOG y LICENSE; **no** entran los tests ni `AGENTS/TAREAS/HISTORIAL`)
- [x] **El CI se ejecutó de verdad en el PR #17 y encontró un fallo:** los 6 trabajos de pruebas pasaron (Windows y Ubuntu, Node 22.15/24/26), pero el paso `dsh-bridge --version` fallaba en el runner porque el programa buscaba `~/.dsh` **antes** de atender `--help` y `--version`
- [x] **Corregido:** la ayuda y la versión se atienden sin tocar el disco; el resto de comandos siguen resolviendo `~/.dsh` con su error claro. Test nuevo que lo fija (con un `--dsh-home` inexistente): **126 pruebas, 0 fallos**
- [x] **CI en verde:** PR #18 (run `2d93d09`) y push a `main` (`3cb9b6e0`) con los **7 trabajos correctos**

### T15 · Prueba real entre los dos equipos
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T14 · **Rama:** `test/t15-prueba-real` · **Commit:** `test: prueba real de importación entre los dos equipos`
**Archivos:** `TAREAS.md`, `HISTORIAL.md` (+ el ZIP generado, que no entra al repo)

- [x] Exportada **esta misma conversación** con la CLI: `dsh-sesion-pleta-a-deepseek-standard-mode-20261107.zip`, 3,6 MB, 3.474 eventos, 5 adjuntos (`export session-ee2a578c… -o Escritorio`)
- [x] Instrucciones para el otro PC en `Escritorio\LEEME-PORTATIL.txt` (clonar, `doctor`, cerrar la app, importar, comprobar)
- [x] **En el portátil:** `git clone`, `doctor`, DSH cerrado e importación con `--workspace`
- [x] **Comprobado por el usuario: la conversación aparece y se abre en el portátil**
- [x] **Con esto la v0.1 está completa**: exportar aquí → importar allí → seguir trabajando

---

## Fase 4 — v0.2: red local

### T16 · Servidor de recepción (`serve`)
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T15 · **Rama:** `feat/t16-servidor` · **Commit:** `feat: servidor de recepción con código de un solo uso`
**Archivos:** `src/net/servidor.js`, `test/servidor.test.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`

- [x] HTTP con `node:http`, sin dependencias: `GET /estado`, `POST /emparejar`, `GET /sesiones`
- [x] **Código de 6 dígitos, un solo uso, con caducidad (10 min) y máximo de 5 intentos**; comparación en tiempo constante y el código nunca se devuelve
- [x] Al acertar se emite un **token** (32 bytes) para el resto de la sesión, con su propia caducidad; sin token no se lista nada
- [x] **Por defecto solo escucha en `127.0.0.1`**; `--red` lo abre a la red local, avisando del riesgo y enseñando la IP; límite de cuerpo (64 KB) con 413 y conexión cerrada
- [x] `dsh-bridge serve` enseña dirección, código y caducidad, y propone el comando del otro equipo; `Ctrl+C` para parar
- [x] 8 tests nuevos (134 en total) y **prueba real**: servidor arrancado, `/estado` sin código, emparejado con `482913`, **115 conversaciones listadas con token**, y el código reutilizado responde 401
- [x] Comprobado también en modo `--red`, accesible por la IP de la máquina
- [ ] La recepción del bundle cifrado llega en la T17 (`send`)

### T17 · Envío (`send`) con cifrado
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T16 · **Rama:** `feat/t17-envio` · **Commit:** `feat: envío cifrado entre equipos con recepción e importación`
**Archivos:** `src/net/cifrado.js`, `src/net/cliente.js`, `src/net/servidor.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/cifrado.test.js`, `test/red.test.js`

- [x] **Cifrado con AES-256-GCM** y clave derivada del código con `scrypt` + `salt` aleatorio por envío: el código **no viaja** en ninguna petición
- [x] Cifrado y descifrado **en streaming**, sin cargar 300 MB en memoria; un byte cambiado invalida el paquete (queda cubierto por el tag)
- [x] `POST /recibir` en el servidor: guarda en temporal, descifra y llama al mismo `importarBundle` del ZIP (ruta, adjuntos y registro)
- [x] Cliente `send`: empareja una vez y manda **varias conversaciones** con ese token; `--sesion` se puede repetir
- [x] `serve` acepta `--workspace` (destino), y avisa de que sin él solo se puede listar
- [x] Errores con código: 401 sin token, 400 paquete no descifrable, 400 sin destino, 409 si ya estaba instalada
- [x] 16 tests nuevos (151 en total) y **transferencia real**: 4,1 MB / 2.530 eventos / 14 adjuntos en 543 ms, y **693 MB / 22.179 eventos / 559 adjuntos en 7 s** con el registro del destino válido y la ruta reescrita
- [x] **Fallo corregido (el límite):** el tope por defecto era 512 MB y rechazaba justo la conversación del bar (693 MB). Ahora es **2 GB**, configurable con `--max <MB>`, y si el cliente declara el tamaño en la cabecera se rechaza **antes de mover un byte** (413 con el detalle)
- [x] **Fallo corregido (el servidor se caía):** al pasarse del límite cerraba el fichero temporal y seguía recibiendo datos → `ERR_STREAM_DESTROYED` sin capturar y **el proceso moría**: cualquiera podía tumbar el receptor con un envío grande. Ahora la escritura está protegida, se atiende el error del stream y se drena la conexión. Test de regresión: envío de 20 KB con tope de 4 KB → 413 y el servidor sigue respondiendo
- [x] **Memoria comprobada:** durante la transferencia de 693 MB los procesos node se quedaron en ~56-70 MB de RSS (el streaming funciona)
- [ ] La interfaz web (T18) hará esto mismo desde el navegador

### T18 · Interfaz web mínima
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T17 · **Rama:** `feat/t18-ui-web` · **Commit:** `feat: interfaz web local para enviar conversaciones`
**Archivos:** `src/net/ui.js`, `src/net/servidor.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/ui.test.js`

- [x] `dsh-bridge ui` sirve la interfaz en `127.0.0.1` (por defecto 8790; `--abrir` lanza el navegador): lista de conversaciones con casillas, formulario IP/puerto/código, botón de envío y barra de progreso
- [x] **Token por sesión** en un `<meta>` de la página; toda la API lo exige en `x-dsh-token` (probado: 401 sin él). La interfaz **rechaza `--red`**: puede leer tus conversaciones y no debe exponerse
- [x] **CSP estricta** (`default-src 'none'; script-src 'self'…`), cero código o estilos inline, pintado con `textContent` (comprobado con tests que además compilan el JS)
- [x] El envío corre en segundo plano con un **trabajo** (`/api/trabajos/<id>`) y la página va preguntando: sin bloquear el navegador durante los 693 MB
- [x] `serve` sirve además una **página de estado** en `/`: dirección, código (o «ya usado»), caducidad, destino y emparejamiento, con sus estilos en `/estado.css`
- [x] **La página dice de qué almacén lee** y **separa las que ve la app de las que solo están en disco** (`7 visibles · 115 en disco`, etiqueta «no registrada», filtro para ver todas): nació de una confusión real del usuario al ver 115 donde su panel enseña 7
- [x] 9 tests nuevos (159 en total) y **prueba real**: página con CSP, 401 sin token, **115 conversaciones listadas**, separación visibles/huérfanas, y un envío lanzado por la API igual que el botón → «Organizar proyecto tarjeta» (2.530 eventos, 14 adjuntos) recibido en el equipo de pruebas

### T19 · Descubrimiento en la red (`discover`)
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T18 · **Rama:** `feat/t19-descubrir` · **Commit:** `feat: descubrimiento en la red y cierre de la v0.2 (0.2.0)` (junto con T20)
**Archivos:** `src/net/descubrir.js`, `src/net/ui.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/descubrir.test.js`, `test/ui.test.js`

- [x] El receptor se anuncia por **UDP en el puerto 8788**, solo cuando escucha abierto a la red (`--red`); si está en localhost no se anuncia (nadie podría llegar)
- [x] La respuesta lleva **nombre del equipo, puerto y si ya está emparejado**, y **nunca** el código ni nada del contenido (hay un test que lo fija)
- [x] `dsh-bridge discover` pregunta (3 latidos) y enseña una tabla: equipo, IP, puerto y estado, marcando «(este equipo)»
- [x] `dsh-bridge send --buscar …` encuentra el equipo y envía sin escribir la IP; si hay 0 o más de 1, explica qué hacer
- [x] En la interfaz web: botón **«Buscar en la red»** que rellena un desplegable con los equipos encontrados y, al elegir uno, pone IP y puerto
- [x] 8 tests nuevos (167 en total) y **prueba real con difusión**: `discover` encontró `portatil-de-prueba` en `192.168.1.141`, y `send --buscar` mandó la conversación (2.530 eventos, 14 adjuntos) sin escribir la IP
- [x] **Corregido al probarlo en un solo PC:** `send --buscar` descartaba «este equipo» y se quedaba sin candidatos; ahora, si es el único, lo usa avisando. Probado también dentro de WSL/Ubuntu (donde `serve` se anuncia como `DESKTOP-S22K5U6`)

### T20 · Tests de red, documentación y cierre de v0.2
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T19 · **Rama:** `feat/t19-descubrir` (mismo commit que T19) · **Commit:** `feat: descubrimiento en la red y cierre de la v0.2 (0.2.0)`
**Archivos:** `README.md`, `CHANGELOG.md`, `package.json`, `bin/dsh-bridge.js`, `src/core/pack.js`, `TAREAS.md`, `HISTORIAL.md`

- [x] Tests de red ya cubiertos en T16–T19: **167 pruebas, 0 fallos** (servidor, cifrado, cliente, interfaz y descubrimiento)
- [x] README: sección **«Por red, sin USB»** con el flujo de los dos equipos, la tabla de qué se protege, el modo `ui` y el aviso del firewall
- [x] `CHANGELOG.md` **0.2.0** con añadido, cambiado y corregido (incluidos los dos fallos que encontró la prueba grande)
- [x] Versión **0.2.0** en `package.json`, en el binario y en la procedencia que anota cada bundle
- [x] El **menú** ya no anuncia la red como futura: opción 3 abre la interfaz web y la 4 arranca `serve` pidiendo la carpeta de destino
- [x] `npm pack --dry-run` → **22 ficheros, 60,8 kB** (entran los cinco módulos nuevos)

### T21 · Selector nativo de ficheros y carpetas
**Estado:** ✅ Completada (2026-11-07) · **Depende de:** T18 · **Rama:** `feat/t21-selector` · **Commit:** `feat: diálogos del sistema para elegir ficheros y carpetas`
**Archivos:** `src/cli/dialogos.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/dialogos.test.js`
**Petición del usuario (2026-11-07): «¿al exportar o importar se abrirá el explorador de archivos para elegirlo tú?»**

- [x] **Exportar sin `-o`** pregunta con el explorador en qué carpeta guardar (si hay ventanas); con `-o` sigue siendo directo
- [x] **Importar sin ruta** abre el diálogo de fichero; sin `--workspace` pregunta la carpeta del proyecto en una ventana
- [x] En el **menú**, dejar la respuesta vacía abre el diálogo (exportar: carpeta; importar: fichero)
- [x] Sin dependencias: PowerShell + `System.Windows.Forms` en Windows, `osascript` en macOS, `zenity` en Linux; **degradación limpia** a teclado si no hay entorno gráfico, si no es una terminal interactiva o si se pasa `--sin-dialogos`
- [x] Nombres propuestos seguros (`nombreSugerido`): sin acentos ni caracteres prohibidos, con la fecha
- [x] 7 tests nuevos (174 en total) de la parte que se puede probar sin abrir ventanas: comando de cada sistema, comillas de PowerShell, `--sin-dialogos` y nombres
- [x] **Comprobado por el usuario:** el diálogo se abre de verdad, elige carpeta y el ZIP se guarda donde toca

---

## Notas

- La rama de trabajo actual es `main`; el usuario crea la rama de cada tarea (REGLA 4).
- **v0.1 cerrada el 2026-11-07** con la T15: conversación exportada en el sobremesa e importada en el portátil, comprobada por el usuario.
- **2026-11-06** — A petición del usuario se añadió la **REGLA 6** a `AGENTS.md` (revisión obligatoria cuando avisa de que ya está subido a GitHub). Viaja en el mismo commit de T1, que todavía no está subido.
