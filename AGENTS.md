# AGENTS.md — dsh-bridge

Documento de trabajo del proyecto. Se lee **al principio de cada tarea** (REGLA 1).

---

## 1. De qué va el proyecto

**dsh-bridge** exporta e importa conversaciones de **DeepSeek Harness (DSH)** entre equipos.

DSH no trae exportar/importar sesiones: guarda cada conversación en `~/.dsh` y no hay botón para llevarla a otro PC. Esta herramienta cubre ese hueco con un ZIP portable y, más adelante, con transferencia directa por red local.

No es solo copiar un fichero. La migración de una conversación real (13.086 eventos, 287 imágenes, 297 MB) descubrió que hacen falta cuatro cosas, y las cuatro están en el alcance:

1. **Registrar el workspace** en `storages/workspace.json`. Sin registro, la sesión está en disco pero la app no la lista nunca.
2. **Reescribir la ruta** (`cwd`) de la cabecera del log, y usar la ruta canónica (`realpath`), no el texto que escribió el otro equipo.
3. **Adaptar los eventos**: si el harness destino es más viejo, rechaza el log entero por un tipo de evento que no conoce; hay que marcar esos eventos como `ignorable`.
4. **Copiar solo los adjuntos citados**, con deduplicación por `sha256`.

Fuera de alcance: sincronización en vivo, cuentas en la nube, subir conversaciones a ningún servidor.

---

## 2. Stack tecnológico

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | **Node.js ≥ 22.15** | `node:zlib` ya trae Zstandard nativo; nada de dependencias |
| Módulos | **ESM** (`"type": "module"`) | Un solo formato, sin transpilar |
| Dependencias | **Cero** en runtime | El formato es simple; una dependencia más es un riesgo más |
| ZIP | **Propio**, sin comprimir (`store`) | El log va en zstd y las fotos ya vienen comprimidas: recomprimir es perder tiempo |
| Tests | **`node:test`** | Viene con Node, sin instalar nada |
| CI | **GitHub Actions** | Windows + Ubuntu, Node 22/24/26 |
| CLI | Parseo de argumentos propio | ~80 líneas, sin `commander` |
| v0.2 (red) | `node:http` + UI estática servida por el propio tool + `AES-256-GCM` | Cero instalación en el equipo destino: solo navegador |

Datos que lee y escribe (siempre bajo `~/.dsh`, o `--dsh-home`):

```
sessions/<workspace-codificado>/<session-id>/session.v<N>.jsonl.zstd
attachments/v1/objects/<2 hex>/<sha256>
storages/workspace.json
storages/session_projcache/sessions/<session-id>.json   (solo lectura)
```

---

## 3. Estructura del proyecto

```
dsh-bridge/
├─ recibir.cmd                doble clic: recepción (CRLF y sin acentos)          [T22 ✔]
├─ enviar.cmd                 doble clic: interfaz web                            [T22 ✔]
├─ dsh-bridge.cmd             doble clic: menú y comandos                          [T22 ✔]
├─ bin/dsh-bridge.js          CLI y menú: orquesta, la lógica está en src/core    [T11 ✔]
├─ bin/lanzador.js            lo que hay detrás de los .cmd (habla con el usuario) [T22 ✔]
├─ src/cli/
│  ├─ opciones.js             argumentos, alias en castellano y errores de uso    [T11 ✔]
│  ├─ dialogos.js             ventanas del sistema para elegir ficheros/carpetas  [T21 ✔]
│  └─ formato.js              tablas, tamaños, fechas y selecciones (1,3 · 2-4)    [T11 ✔]
├─ src/net/
│  ├─ servidor.js             recepción en red: código de un solo uso y token     [T16 ✔]
│  ├─ cifrado.js              AES-256-GCM con clave derivada del código           [T17 ✔]
│  ├─ cliente.js              enviar: emparejar, cifrar y subir el bundle         [T17 ✔]
│  ├─ descubrir.js            anuncio UDP y búsqueda de equipos en la red         [T19 ✔]
│  └─ ui.js                   interfaz web local (token, CSP) y página de estado  [T18 ✔]
├─ src/core/
│  ├─ zstd.js                 frames Zstandard, cabecera, comprimir/descomprimir  [T2 ✔]
│  ├─ zip.js                  ZIP propio: escribir (store) y leer (store/deflate)  [T3 ✔]
│  ├─ paths.js                ~/.dsh, realpath, nombre de carpeta de workspace     [T4 ✔]
│  ├─ sessions.js             inventario: cabeceras, títulos, adjuntos citados     [T5 ✔]
│  ├─ attachments.js          referencias sha256 y copia con dedupe               [T6 ✔]
│  ├─ registry.js             workspace.json: altas, invariantes, copia previa    [T7 ✔]
│  ├─ compat.js               tipos de evento que entiende el harness destino     [T8 ✔]
│  ├─ pack.js                 construir el bundle (ZIP + meta.json)               [T9 ✔]
│  └─ import.js               instalar el bundle en el equipo destino             [T10 ✔]
├─ test/                      node:test con DSH_HOME falsos, sin datos reales
│  ├─ ayudas/entorno.js       monta un almacén de mentira completo (3 conversaciones)  [T12 ✔]
│  └─ integracion.test.js     ciclo export→import y la CLI lanzada de verdad           [T12 ✔]
├─ docs/FORMATO.md            el formato v4 por dentro: log, registro, rutas     [T13 ✔]
├─ AGENTS.md
├─ docs/ · docs/TAREAS.md (tablero) · HISTORIAL.md (por qué de cada tarea) · FORMATO.md
├─ README.md (ES + EN) · CHANGELOG.md · LICENSE (MIT)                            [T13 ✔]
└─ .github/workflows/ci.yml   Ubuntu+Windows × Node 22.15/24/26 y empaquetado   [T14 ✔]
```

`[borrador]` = el fichero existe pero **no está revisado ni probado**; su tarea sigue pendiente y consiste en revisarlo, completarlo y cubrirlo con tests.

---

## 4. Reglas

### REGLA 1 — El ciclo de trabajo (no se salta nunca)

Cada tarea, una vuelta completa:

1. **Leer** este `AGENTS.md` y `docs/TAREAS.md`. Elegir la siguiente tarea pendiente **por orden**. Si conviene cambiar el orden, **justificarlo** al usuario antes de empezar.
2. Marcar la tarea como **🔧 En curso** en `docs/TAREAS.md`.
3. **Implementar solo esa tarea.** Prohibido colar cambios de otras tareas en el mismo trabajo.
4. Informar al usuario con:
   - qué se ha hecho,
   - qué archivos se han tocado,
   - cómo comprobarlo paso a paso, en lenguaje claro,
   - y la pregunta literal: **«¿Todo OK?»**
5. **Parar y esperar.** No se avanza a la siguiente tarea bajo ningún concepto.
6. Cuando el usuario responde **«sí»**:
   - comprobar que todo está bien subido e informar de lo que falte (ver **REGLA 5**),
   - marcar **✅ Completada** en `docs/TAREAS.md`,
   - añadir la entrada correspondiente en `docs/HISTORIAL.md`,
   - indicar qué subir a GitHub (rama propuesta, mensaje de commit y archivos) y cuándo hacerlo.
7. Si el usuario dice que algo falla: volver al paso 3, corregir y repetir el paso 4. La tarea **no** se marca ✅.

**Estados posibles en `docs/TAREAS.md`:** ⏳ Pendiente · 🔧 En curso · 👀 Esperando tu OK · ✅ Completada · ⛔ Bloqueada.

> Al terminar de implementar (paso 4) la tarea queda en **👀 Esperando tu OK**, no en ✅.

### REGLA 2 — Documentación

**`docs/TAREAS.md`**
- Lista viva de tareas, agrupadas por fases, con **dependencias explícitas**.
- **Solo una** tarea en 🔧 En curso a la vez.
- Una tarea pasa a ✅ **únicamente** con el «sí» del usuario.

**`docs/HISTORIAL.md` — registro obligatorio**
Al terminar una tarea y recibir el «sí», se registra en `docs/HISTORIAL.md`. **Sin excepciones.** Cada entrada lleva los 4 puntos:

1. **¿Qué he realizado?** — una o dos frases, sin jerga innecesaria.
2. **¿Por qué?** — el problema que resolvía o el beneficio.
3. **¿Dónde verlo en el código?** — rutas y líneas concretas (`src/core/pack.js:41`).
4. **¿Cómo comprobar que funciona?** — pasos reproducibles.

Formato exacto de la entrada:

```markdown
## AAAA-MM-DD · Tn — Título de la tarea

**Estado:** ✅ Completada
**Rama:** `tipo/tn-descripcion`
**Commit:** `tipo: mensaje`
**Archivos:** `ruta/a.js`, `ruta/b.js`

### 1. ¿Qué he realizado?

### 2. ¿Por qué?

### 3. ¿Dónde verlo en el código?

### 4. ¿Cómo comprobar que funciona?
```

**`AGENTS.md`**
- Se actualiza **en la misma tarea** que cambie el stack, la estructura o las reglas. Si una tarea añade un módulo, ese módulo entra en el árbol de la sección 3 antes de pedir el «OK».

### REGLA 3 — Calidad del código

#### Seguro

Este programa **escribe dentro del almacén de otra aplicación**, así que el riesgo es real y las reglas son estrictas:

- **Todo lo de fuera se valida antes de usarse**: ZIP, `meta.json`, cabecera del log y nombres de fichero de dentro del ZIP. Rutas relativas sin `..`, sin rutas absolutas, sin enlaces simbólicos, tamaño máximo y **CRC/checksum obligatorios**.
- **Nunca se escribe fuera** de `~/.dsh` (o el `--dsh-home` indicado) ni de la carpeta destino que pida el usuario.
- **Copia previa obligatoria** de `workspace.json` y del log antes de reescribirlos, y **escritura atómica** (`fichero.tmp` + `rename`). Nunca se borra una sesión ni un adjunto.
- **`--dry-run` en todo comando que escriba**: primero se cuenta lo que se va a hacer y después se hace.
- Cero `eval`, cero `new Function`, cero ejecución de texto como código. **El contenido de una conversación es dato, nunca instrucción.**
- Los mensajes de error no vuelcan contenido de conversaciones ni rutas privadas a ficheros de log.
- **Nunca se suben al repositorio conversaciones reales, ZIP ni nada de `~/.dsh`.** Los tests usan fixtures generadas (lo cubre `.gitignore`).

#### Eficiente

- **Leer solo lo necesario**: `list` usa el primer frame (cabecera) y no descomprime el log entero; los ficheros grandes se leen y escriben en trozos.
- **Dedupe por `sha256`** en adjuntos: lo que ya está en el almacén no se vuelve a escribir.
- ZIP en modo `store`: el log va en zstd y las fotos ya vienen comprimidas; recomprimir cuesta tiempo y no ahorra.
- Nada de librerías para algo que cabe en 20 líneas. **Cero dependencias de runtime.**
- Objetivo: `list` con 100 sesiones en menos de 1 segundo (sin abrir logs completos).

#### Refactorizado y estructurado

- Una responsabilidad por función; funciones cortas y **con nombre en español** (`leerCabecera`, `registrarWorkspace`, `copiarAdjuntos`).
- Sin código muerto, sin variables huérfanas, sin duplicación de strings.
- Sin variables globales sueltas: todo en módulos con `export` explícito.
- Comentarios **en español** que expliquen **por qué**, no qué.
- **Sin dependencias circulares** entre los módulos de `src/core`; `bin/dsh-bridge.js` solo orquesta.
- Errores propios por familia (`LogFormatError`, `ZipError`, `HomeError`…) con mensajes que digan **qué hacer**, no solo qué pasó.
- Cada módulo entra con sus tests en `test/`. Lo que no se pueda probar automáticamente se documenta con los pasos manuales (sección 6).

#### Interfaz web (solo cuando llegue la T18)

Estas normas se activan con la UI de la v0.2, porque es lo único con navegador:

- **CSP estricta** posible: cero `onclick`/`onload` inline, cero `<style>` inline, cero `eval`, cero `document.write`, cero `innerHTML` con datos. Todo texto dinámico con **`textContent`**.
- Enlaces externos con `rel="noopener noreferrer"` y `target="_blank"`.
- `localStorage` siempre dentro de `try/catch` (o sin usar, que es lo previsto).
- **Sin recursos de terceros desde CDN**: fuentes y scripts autoalojados. Cabeceras de seguridad en `_headers`.
- Imágenes con `width`/`height`; solo los pesos de fuente que se usan; `requestAnimationFrame` y `ResizeObserver` donde haga falta.
- **Presupuesto de arranque: < 120 KB propios** (sin fuentes, vídeo ni fotos) y primera pintura útil rápida en 4G.

### REGLA 4 — Git y GitHub

- La gestión de Git y GitHub **la hace el usuario**. El agente **NO ejecuta comandos de git** (`git init`, `add`, `commit`, `push`, `branch`, `merge`, `gh`), ni toca `.git/config`, ni crea repos, ni abre PRs.
- Cuando una tarea queda completada, el agente indica:
  1. **Cuándo** subirla: siempre después del «sí» a «¿Todo OK?» y antes de empezar la siguiente.
  2. **Qué archivos** entran en el commit.
  3. **Nombre de rama** propuesto.
  4. **Mensaje de commit** (Conventional Commits: `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `test:`).
  5. **Descripción breve para el Pull Request.**
- Ramas: `tipo/tn-descripcion-corta` → PR a `main`. **Una rama y un PR por tarea.**
- Nunca proponer `git push --force` ni commits directos a `main`.

### REGLA 5 — Comprobación obligatoria al recibir «sí»

Cada vez que el usuario responda **«sí»** a «¿Todo OK?», el agente comprueba que todo está bien subido y avisa de lo que falte. Revisa, en este orden:

1. **Rama actual (HEAD)** y si es la que corresponde a la tarea.
2. **Archivos rastreados** frente a los que hay en disco: si un archivo existe pero no está rastreado, falta `git add`.
3. **Cambios sin comitear**: fichero rastreado con fecha de modificación posterior a `.git/index`.
4. **Commits sin subir**: si la rama local apunta a un commit que `origin/` no tiene, falta `git push`.
5. **PR y merge**: si la rama de la tarea está en `origin` y si `main` ya la ha incorporado; y si `main` local apunta al mismo commit que `origin/main`.
6. **Registro incluido**: que `docs/TAREAS.md` (✅) y `docs/HISTORIAL.md` (entrada con los 4 puntos) formen parte de **lo subido**, no solo del disco.

Se informa con esta tabla:

| Comprobación | Estado |
|---|---|
| Rama de la tarea subida | ✅ / ⚠️ |
| Archivos de la tarea rastreados | ✅ / ⚠️ |
| PR mergeado en main | ✅ / ⚠️ |
| main local al día | ✅ / ⚠️ |
| Tablero e historial incluidos | ✅ / ⚠️ |

Si algo está ⚠️, el agente dice **exactamente qué comando falta** y no da la tarea por subida.

**Cómo lo comprueba sin ejecutar git:** leyendo en **solo lectura** los metadatos de `.git/` — `HEAD`, `refs/`, `packed-refs`, `logs/HEAD` e `index`. Nunca escribe nada ahí. Si el usuario prefiere, puede pegar el resultado de `git status` y el agente lo usa como fuente.

### REGLA 6 — Revisión cuando el usuario dice «ya está subido a GitHub»

Cuando el usuario avise de que **ya lo ha subido**, el agente revisa si realmente está todo subido antes de dar nada por bueno, y responde siempre con tres cosas: **qué falta**, **por qué ha pasado** y **qué comandos ejecutar** para arreglarlo. Ninguna tarea se da por subida sin esta revisión.

Comprobaciones, en este orden:

1. **Rama correcta**: `HEAD` apunta a la rama de la tarea (`tipo/tn-...`), no a `main`.
2. **Rama en `origin`**: existe `refs/remotes/origin/<rama>` (o aparece en `packed-refs`) y apunta **al mismo commit** que la rama local.
3. **Commit con los archivos de la tarea**: el árbol del commit contiene todos los archivos del trabajo y no queda ninguno de la tarea sin rastrear en disco.
4. **Tablero e historial dentro del commit**: `docs/TAREAS.md` con la tarea en ✅ y `docs/HISTORIAL.md` con su entrada, **en el commit**, no solo en el disco.
5. **`.gitignore` no esconde nada necesario**: si un archivo del proyecto aparece ignorado (por ejemplo `src/` o un fixture `.zip` de test), avisar; `git add -f` solo si es intencionado.
6. **PR y merge**: si el PR existe y si `main` en `origin` ya incluye la rama; y `main` local al día con `origin/main`.
7. **Nada sensible subido**: ni conversaciones de `~/.dsh`, ni `*.zip` de sesiones, ni credenciales, ni `.env`, ni rutas privadas. Si aparece algo así es **⛔ bloqueante**: se dice lo primero y cómo quitarlo (`git rm --cached`); si ya está en el historial, avisar de que hay que reescribirlo o rotar lo expuesto.
8. **Commits de más**: que el commit de la tarea no arrastre cambios de otras tareas (REGLA 1, paso 3).

Se responde con esta tabla y, debajo, el detalle:

| Comprobación | Estado | Por qué |
|---|---|---|
| Rama correcta | ✅ / ⚠️ | |
| Rama subida a origin | ✅ / ⚠️ | |
| Commit con los archivos de la tarea | ✅ / ⚠️ | |
| Tablero e historial dentro del commit | ✅ / ⚠️ | |
| Nada ignorado por error | ✅ / ⚠️ | |
| PR mergeado en main | ✅ / ⚠️ | |
| main local al día | ✅ / ⚠️ | |
| Sin datos sensibles ni ficheros ajenos | ✅ / ⚠️ / ⛔ | |

Reglas de la respuesta:

- Un ⚠️ **no se tapa con un «está casi»**: se dice qué falta, por qué (falta `git add`, falta `git push`, rama equivocada, PR sin mergear, fichero ignorado…) y **el comando exacto**, en orden y listo para copiar.
- Si algo no se puede comprobar leyendo `.git` (objeto empaquetado, rama sin `fetch`, autoría del PR), se pide **un comando concreto** al usuario (`git status`, `git log --oneline -3`, `git ls-remote origin`) y se espera su salida. No se supone.
- Mientras haya un ⚠️, la tarea **no** se da por subida y no se empieza la siguiente.

**Cómo se comprueba sin ejecutar git:** solo lectura de `.git/` — `HEAD`, `refs/heads/`, `refs/remotes/`, `packed-refs`, `logs/HEAD`, `index` y, si el objeto está suelto, `objects/<xx>/<resto>` (descomprimir con zlib para leer commit y árbol). Nunca se escribe ahí ni se ejecutan comandos de git (REGLA 4).

---

## 5. Convenciones

- **Ramas:** `tipo/tn-descripcion-corta` (ej. `feat/t9-export-bundle`), PR siempre a `main`.
- **Commits:** Conventional Commits, en español y en imperativo (`feat: añade exportación a ZIP`).
- **Idioma:** documentación, mensajes de la CLI y comentarios en español; nombres de ficheros y de variables en inglés cuando son términos técnicos del formato (`cwd`, `sha256`, `sessionIds`).
- **Tareas:** un identificador `Tn` por tarea, el mismo en `docs/TAREAS.md`, en la rama y en `docs/HISTORIAL.md`.
- **Nombres de la CLI:** verbos en inglés (`list`, `export`, `import`, `doctor`), salida por pantalla en español.

---

## 6. Cómo se prueba este proyecto

Tres niveles, de menos a más real:

1. **Unitarios** (`npm test`): ZIP, frames zstd, nombres de carpeta, registro e invariantes, compat. Sin tocar `~/.dsh` real.
2. **Integración**: se crea un `DSH_HOME` falso en una carpeta temporal (`--dsh-home`), se exporta e importa, y se comprueba que el resultado es coherente. Nunca se usan conversaciones reales.
3. **Real (manual, dos equipos)**: exportar una conversación en un PC e importarla en el otro, y ver que la app la lista y la abre. Requiere la app cerrada para escribir el registro.

Reglas de oro en pruebas reales:

- **Cerrar DSH antes** de importar (si está abierto, el registro puede perderse al cerrar la app).
- No usar la misma conversación en dos equipos a la vez: los historiales divergen.
- Guardar el ZIP hasta comprobar que abre.

---

## 7. Referencia del formato

Resumen de lo aprendido del formato de sesión (v4), que se documentará entero en `docs/FORMATO.md` (T13):

- El log es una secuencia de **frames Zstandard independientes**; el **primero** contiene solo la línea de cabecera.
- Los eventos son una línea JSON cada uno, con sobre `{type, seq, time, data, surfaceOp?, sourceEventSeqs?, ignorable?}`.
- Un tipo de evento desconocido **sin** `ignorable: true` hace que el harness rechace el log completo.
- El registro de workspaces (`storages/workspace.json`, dominio `workspace` versión 2) exige: ruta única por workspace, sesión contada una sola vez, y que el orden (`workspaceIds`) cubra todas las entradas de la tabla.
- Los adjuntos se citan como `sha256:<64 hex>` y viven en `attachments/v1/objects/<2 primeros hex>/<hash>`.
