# HISTORIAL.md — dsh-bridge

Registro cronológico de tareas terminadas. **Se escribe al recibir el «sí» a «¿Todo OK?» (REGLA 1, paso 6), sin excepciones.**

Cada entrada responde a cuatro preguntas: qué se hizo, por qué, dónde está en el código y cómo se comprueba.

---

## Formato obligatorio de cada entrada

```markdown
## AAAA-MM-DD · Tn — Título de la tarea

**Estado:** ✅ Completada
**Rama:** `tipo/tn-descripcion`
**Commit:** `tipo: mensaje`
**Archivos:** `ruta/a.js`, `ruta/b.css`

### 1. ¿Qué he realizado?

### 2. ¿Por qué?

### 3. ¿Dónde verlo en el código?

### 4. ¿Cómo comprobar que funciona?
```

---

## Entradas

## 2026-11-06 · T1 — Base del proyecto: ubicación, documentos de trabajo y esqueleto

**Estado:** ✅ Completada
**Rama:** `docs/t1-base-proyecto`
**Commit:** `docs: añade documentación de trabajo y esqueleto base`
**Archivos:** `AGENTS.md`, `TAREAS.md`, `HISTORIAL.md`, `package.json`, `LICENSE`, `.gitignore`, `src/core/zstd.js`, `src/core/zip.js`, `src/core/paths.js`, `src/core/sessions.js`

### 1. ¿Qué he realizado?

Dejé el proyecto en la carpeta del clon de GitHub y escribí los tres documentos de trabajo: `AGENTS.md` (de qué va, stack, estructura y reglas), `TAREAS.md` (20 tareas en 4 fases, con dependencias y rama propuesta) y `HISTORIAL.md` (formato de registro). Añadí también el esqueleto: `package.json`, licencia MIT, `.gitignore` y los cuatro borradores del núcleo (`zstd`, `zip`, `paths`, `sessions`). Después, a petición tuya, añadí la **REGLA 6** (revisión cuando avisas de que ya está subido a GitHub), que viaja en este mismo commit.

### 2. ¿Por qué?

Sin tablero y registro, un proyecto largo se convierte en una sucesión de cambios sin orden: no se sabe qué está hecho, qué falta ni por qué se hizo cada cosa. Y las reglas que venían del otro proyecto estaban pensadas para una web: aquí el riesgo real es **escribir dentro del almacén de otra aplicación**, así que se reescribieron para este CLI (validar lo que llega, copia previa, escritura atómica, `--dry-run`, nunca subir conversaciones reales) y se renumeraron 1–5. La REGLA 6 cerró el hueco de «digo que está subido»: sin ella, la revisión solo ocurría al dar el OK, no al comprobar la subida.

### 3. ¿Dónde verlo en el código?

- `AGENTS.md:1-22` — qué es y qué resuelve.
- `AGENTS.md:24-46` — stack (Node ≥ 22.15, cero dependencias, zstd nativo).
- `AGENTS.md:48-72` — estructura, con los borradores marcados.
- `AGENTS.md:74-253` — las seis reglas; `AGENTS.md:169-178` el apartado de interfaz web (se activa en T18).
- `AGENTS.md:217-253` — REGLA 6: revisión de la subida a GitHub, con su tabla y sus comandos de arreglo.
- `AGENTS.md:265-279` — cómo se prueba (unitario, integración, real); `AGENTS.md:281-289` — resumen del formato v4.
- `TAREAS.md:1-10` — leyenda de estados y dependencias; `TAREAS.md:11-23` — T1; `TAREAS.md:26-89` — fase 1.
- `HISTORIAL.md:9-28` — formato obligatorio de entrada.
- `package.json:1-40`, `LICENSE:1-21`, `.gitignore:1-9`.
- `src/core/zstd.js`, `src/core/zip.js`, `src/core/paths.js`, `src/core/sessions.js` — borradores sin tests (su tarea es T2–T5).

### 4. ¿Cómo comprobar que funciona?

1. Abre `D:\Users\MSI-PC\Desktop\dsh\dsh-bridge`: deben estar `AGENTS.md`, `TAREAS.md`, `HISTORIAL.md`, `package.json`, `LICENSE`, `README.md` y `src\core` con cuatro ficheros `.js`.
2. En una consola, en esa carpeta: `node -e "import('./src/core/zip.js').then(()=>console.log('ok'))"` → debe imprimir `ok` (los cuatro módulos cargan sin errores).
3. `Select-String -Path AGENTS.md -Pattern '^### REGLA'` → debe devolver **seis** líneas (76, 100, 137, 180, 192 y 217).
4. Abre `TAREAS.md`: T1 en ✅ Completada y de T2 a T20 en ⏳, cada una con su «Depende de».
5. Abre `AGENTS.md` en la REGLA 6 y comprueba que explica las ocho comprobaciones y la tabla con la columna «Por qué».
6. Esta entrada de `HISTORIAL.md` debe tener los cuatro apartados.

---

## 2026-11-06 · T2 — Log de sesión: frames Zstandard y cabecera

**Estado:** ✅ Completada
**Rama:** `feat/t2-log-zstd`
**Commit:** `feat: lee y escribe el log de sesión con cabecera y frames zstd`
**Archivos:** `src/core/zstd.js`, `test/zstd.test.js`, `src/core/sessions.js`, `package.json`, `AGENTS.md`, `TAREAS.md`

### 1. ¿Qué he realizado?

Revisé el módulo que lee y escribe el log de una sesión y le puse 10 tests. En la revisión salió un fallo importante: al recomprimir se **perdía el salto de línea entre la cabecera y el primer evento**, así que el log reescrito quedaba ilegible para la app. Además, la cabecera se lee ahora en trozos crecientes, se valida que sea JSON de sesión y se ha quitado código muerto.

### 2. ¿Por qué?

La importación **siempre** reescribe el log (hay que cambiar el `cwd`), así que ese fallo habría roto todas las migraciones de forma silenciosa: el fichero se escribiría correctamente pero la app no podría abrir la conversación, y el síntoma aparecería lejos de la causa. Los tests dejan fijado el contrato real del formato: la cabecera del primer frame **incluye** su `\n`, igual que en los logs que escribe la app.

### 3. ¿Dónde verlo en el código?

- `src/core/zstd.js:104-123` — `splitHeader`: devuelve la cabecera **con** su salto de línea y valida el JSON.
- `src/core/zstd.js:125-138` — `encodeLogString`: comprime exactamente ese contenido en el primer frame.
- `src/core/zstd.js:141-157` — `readLogHeader`: lee en trozos de 64 KB y va doblando hasta encontrar el final del primer frame.
- `src/core/zstd.js:36-84` — `readFrames`: recorrido de frames y detección de cola rota.
- `test/zstd.test.js:58-170` — los diez tests; el de la cabecera con su `\n` está en `:58` y el de ida y vuelta exacta en `:72`.
- `src/core/sessions.js:13` — arreglo mínimo: el `import` de `readLogHeader` que faltaba.
- `package.json:31` — script `test` corregido a `node --test`.
- `AGENTS.md:54` — `zstd.js` deja de estar marcado como borrador.

### 4. ¿Cómo comprobar que funciona?

1. En `D:\Users\MSI-PC\Desktop\dsh\dsh-bridge`, ejecuta `npm test`: debe terminar con **`pass 10`** y **`fail 0`**.
2. Mira el test «la cabecera va en el primer frame y los eventos en el segundo» (`test/zstd.test.js:58`): comprueba que el primer frame contiene la cabecera **con su salto de línea**.
3. Mira el test «ida y vuelta exacta, con acentos y emoji» (`test/zstd.test.js:72`): compara el texto recuperado con el original carácter a carácter; si el `\n` se perdiera, se pondría en rojo.
4. Prueba real (opcional): con el log de tu conversación de la web (54.215.552 caracteres), `decodificar → recomprimir → decodificar` devuelve **texto idéntico** y la cabecera se lee igual antes y después.
5. Abre `TAREAS.md:28`: T2 en ✅ Completada y T3 en ⏳.

---

## 2026-11-06 · T3 — ZIP propio: escribir sin comprimir, leer store y deflate

**Estado:** ✅ Completada
**Rama:** `feat/t3-zip`
**Commit:** `feat: lee y escribe ZIP con validación de rutas y compatibilidad Windows`
**Archivos:** `src/core/zip.js`, `test/zip.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Revisé el módulo ZIP y le puse 14 tests. Al probarlo contra las herramientas de Windows apareció un fallo real: `Compress-Archive` (y el «Enviar a > carpeta comprimida») escribe los nombres con barra invertida (`carpeta\fichero.txt`), y el lector los rechazaba. Ahora se normalizan a `/` y las entradas de directorio se ignoran. Además se validan las rutas en los dos sentidos y se añadieron límites explícitos.

### 2. ¿Por qué?

Un ZIP de este proyecto puede acabar **repacketeado a mano en Windows** (abrir, meter una foto, volver a comprimir), y entonces el bundle habría dejado de leerse por un detalle de separadores. Y como los nombres de dentro de un ZIP acaban siendo rutas en disco, aceptar `..` o `C:` sería una vía para escribir fuera de `~/.dsh`: eso es lo que la REGLA 3 prohíbe.

### 3. ¿Dónde verlo en el código?

- `src/core/zip.js:36-42` — `ZipError`, el error propio del módulo.
- `src/core/zip.js:44-58` — `crc32` con tabla (valor de referencia comprobado: `0xCBF43926`).
- `src/core/zip.js:61-69` — `validarNombreEntrada`: rechaza `..`, rutas absolutas, `C:` y barras invertidas al escribir; al leer las admite y normaliza.
- `src/core/zip.js:83-140` — `createZip`: `store`, UTF-8, límites de 4 GB y 65.535 entradas.
- `src/core/zip.js:158-219` — `readZip`: EOCD, directorio central, `store`/`deflate`, normalización de `\`, descarte de directorios, comprobación de tamaños y CRC.
- `test/zip.test.js:62-176` — los 14 tests (el de Windows en `:139`, el de directorio con `\` en `:96`).

### 4. ¿Cómo comprobar que funciona?

1. En `D:\Users\MSI-PC\Desktop\dsh\dsh-bridge`: `npm test` → debe dar **`pass 24` / `fail 0`** (14 del ZIP + 10 del log).
2. Que Windows abra lo nuestro: en **PowerShell**, una línea cada vez:

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "import('./src/core/zip.js').then(z=>{const fs=require('fs');fs.writeFileSync('prueba.zip',z.createZip([{name:'hola.txt',data:Buffer.from('contenido')}]))})"
   Expand-Archive .\prueba.zip -DestinationPath .\prueba -Force
   Get-Content .\prueba\hola.txt
   ```
   Debe imprimir `contenido`. Luego borra `prueba.zip` y la carpeta `prueba`.
3. Dirección contraria (ya verificada): `Compress-Archive -Path .\src\* -DestinationPath .\windows.zip -Force` y leerlo con `readZip` devuelve las entradas con barras normales y sin error.
4. Abre `TAREAS.md:37`: T3 en ✅ y T4 en ⏳.

---

## 2026-11-06 · T4 — Rutas de `~/.dsh` y nombre de carpeta del workspace

**Estado:** ✅ Completada
**Rama:** `feat/t4-rutas-workspace`
**Commit:** `feat: resuelve rutas de DSH y codifica el nombre de carpeta del workspace`
**Archivos:** `src/core/paths.js`, `test/paths.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Revisé el módulo de rutas, lo dejé estricto donde tocaba y le puse 14 tests. Lo importante: he comprobado el codificador del nombre de carpeta contra **las 115 sesiones reales** de este equipo (12 carpetas de workspace) y **no hay ni un desajuste**: partiendo del `cwd` de cada log, la función reproduce exactamente la carpeta que usa la app.

### 2. ¿Por qué?

Ese nombre de carpeta es donde la importación escribe la conversación. Si el algoritmo derivado de los ejemplos reales estuviera mal en un caso (espacios, rutas de WSL, mayúsculas), la sesión acabaría en una carpeta que DSH no mira y volveríamos al problema del principio: «está en disco, pero no aparece». Verificarlo contra 115 casos reales convierte una suposición en un hecho comprobado.

Y `--dsh-home` ahora se obedece: antes, una ruta mal escrita caía en silencio a `~/.dsh`, justo el fallo silencioso que hay que evitar en una herramienta que escribe en el almacén de otra aplicación.

### 3. ¿Dónde verlo en el código?

- `src/core/paths.js:34-55` — `resolveHome`: ruta indicada = se respeta o error; si no, `DSH_HOME` y `~/.dsh`.
- `src/core/paths.js:79-87` — `canonicalize` con `realpath` y `HomeError` si no existe.
- `src/core/paths.js:89-92` — `samePath`: mayúsculas, separadores y barra final.
- `src/core/paths.js:107-120` — `encodeSessionDirName`: `~0020` para espacios, separadores a `-`, colapso y recorte.
- `src/core/paths.js:122-153` — `verifySessionDirNames`: el chequeo contra las sesiones guardadas.
- `src/core/paths.js:187-205` — `findAppAsar` estricto con ruta manual.
- `test/paths.test.js:42-179` — los 14 tests (casos reales en `:112`, sesión mal colocada en `:129`).

### 4. ¿Cómo comprobar que funciona?

1. `npm test` en la carpeta del proyecto → **`pass 38` / `fail 0`**.
2. El chequeo con datos reales:

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "import('./src/core/paths.js').then(p=>{const r=p.verifySessionDirNames(p.resolveHome());console.log('sesiones:',r.checked.length,'| desajustes:',r.mismatches.length)})"
   ```
   Debe dar `desajustes: 0` (el número de sesiones sube con el uso).
3. Que una carpeta inventada ya no se ignora:

   ```powershell
   node -e "import('./src/core/paths.js').then(p=>{try{p.resolveHome('C:/no/existe')}catch(e){console.log(e.message)}})"
   ```
   Debe responder *«la carpeta indicada no existe: C:\no\existe»*.
4. Abre `TAREAS.md:47`: T4 en ✅ y T5 en ⏳.

---

## 2026-11-07 · T5 — Inventario de sesiones: cabeceras, títulos y adjuntos

**Estado:** ✅ Completada
**Rama:** `feat/t5-inventario`
**Commit:** `feat: inventario de sesiones con títulos y adjuntos`
**Archivos:** `src/core/sessions.js`, `test/sessions.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Revisé el inventario de conversaciones y le puse 12 tests. Ahora lista sin descomprimir (solo la cabecera de cada log) y resuelve el título por tres vías: caché de proyecciones de la app, evento `session/title` del propio log (vale el último) y, como último recurso, el primer mensaje del usuario. También corrige un bucle infinito que congelaba el listado, quita código muerto y ordena de forma estable.

### 2. ¿Por qué?

El menú «Exportar» empieza justo aquí: si listar tarda o se cuelga, la herramienta no sirve. Y sin título no se puede elegir una conversación entre 115. El bucle infinito lo destapó la propia suite al quedarse colgada: era un `regex` sin bandera `g` que nunca avanzaba, así que el programa se habría quedado frito en la primera sesión con título viejo.

### 3. ¿Dónde verlo en el código?

- `src/core/sessions.js:28-58` — `findSessionLogs`: recorre `sessions/` y elige la versión más alta del log.
- `src/core/sessions.js:65-86` — `readProjectionMeta`: título, `blank` y modelo desde `session_projcache`.
- `src/core/sessions.js:88-108` — `lineaDelEvento` y `recortarLinea`: búsqueda con `regex` global (aquí estaba el bucle infinito).
- `src/core/sessions.js:110-149` — `titleFromLog` (el último título gana) y `firstUserPrompt` (con recorte).
- `src/core/sessions.js:154-206` — `listSessions`: modo rápido y modo `full`, un solo `stat` y orden estable.
- `src/core/sessions.js:208-241` — `findSession` y `attachmentHashes` (con validación de entrada).
- `test/sessions.test.js:87-245` — los 12 tests.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` en la carpeta del proyecto → **`pass 50` / `fail 0`**.
2. Listado rápido (medido en este equipo: 115 sesiones en 35-41 ms):

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "import('./src/core/sessions.js').then(async s=>{const p=await import('./src/core/paths.js');const t=Date.now();const l=s.listSessions(p.resolveHome());console.log(l.length,'sesiones en',Date.now()-t,'ms');for(const x of l.slice(0,5))console.log(' -',x.label)})"
   ```
3. Modo completo (títulos de reserva y adjuntos): debe dar **`títulos: 111 | con adjuntos: 53`**.

   ```powershell
   node -e "import('./src/core/sessions.js').then(async s=>{const p=await import('./src/core/paths.js');const l=s.listSessions(p.resolveHome(),{full:true});console.log('títulos:',l.filter(x=>x.title).length,'| con adjuntos:',l.filter(x=>x.attachments>0).length)})"
   ```
4. Abre `TAREAS.md:57`: T5 en ✅ y T6 en ⏳.

---

## 2026-11-07 · T6 — Adjuntos: referencias y copia con deduplicación

**Estado:** ✅ Completada
**Rama:** `feat/t6-adjuntos`
**Commit:** `feat: adjuntos con verificación de hash y dedupe`
**Archivos:** `src/core/attachments.js`, `test/attachments.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Módulo nuevo para los adjuntos de una conversación: recoger del almacén solo los `sha256` que la conversación cita (exportar), instalarlos en el equipo destino con dedupe y escritura atómica (importar), y avisar de los que faltan sin abortar. El contenido se verifica contra su hash antes de escribirlo y el hash se valida siempre, así que no sirve como ruta. 9 tests nuevos.

### 2. ¿Por qué?

Una conversación son 13.000 eventos y 287 imágenes, pero el almacén tiene adjuntos de otras conversaciones: copiar «todo» multiplicaría el tamaño. Y al revés: recibir un ZIP de fuera y escribir sus ficheros donde diga su nombre es la vía clásica para escribir fuera de sitio; por eso el nombre debe ser un `sha256` válido y el contenido debe cuadrar con él. Faltar una foto no debe impedir recuperar la conversación: se avisa y se sigue.

### 3. ¿Dónde verlo en el código?

- `src/core/attachments.js:24-32` — `AttachmentError`.
- `src/core/attachments.js:34-47` — `esHashValido` y `rutaAdjunto` (validación que corta rutas).
- `src/core/attachments.js:49-67` — `huella` y `leerAdjunto`.
- `src/core/attachments.js:69-113` — `recogerAdjuntos`: solo lo citado, con `faltan` aparte.
- `src/core/attachments.js:115-153` — `instalarAdjuntos`: dedupe, hash verificado y escritura atómica.
- `src/core/attachments.js:155-175` — `adjuntosQueFaltan` y `tamanoAdjuntos` (informan sin escribir).
- `test/attachments.test.js:37-186` — los 9 tests.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 59` / `fail 0`**.
2. Contra tus adjuntos reales (una línea, esta sí descomprime el log):

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "Promise.all([import('./src/core/sessions.js'),import('./src/core/paths.js'),import('./src/core/attachments.js'),import('./src/core/zstd.js'),import('node:fs')]).then(([s,p,a,z,fs])=>{const h=p.resolveHome();const l=s.listSessions(h,{full:true}).filter(x=>(x.attachments||0)>0).slice(0,5);let t=0,f=0,mb=0;for(const x of l){const hs=s.attachmentHashes(z.decodeLogBuffer(fs.readFileSync(x.logPath)));t+=hs.size;f+=a.adjuntosQueFaltan(h,hs).length;mb+=a.tamanoAdjuntos(h,hs).bytes/1048576}console.log('TOTAL:',t,'refs |',f,'ausentes |',mb.toFixed(1),'MB')})"
   ```
   Resultado esperado en este equipo: `TOTAL: 587 refs | 0 ausentes | 687.7 MB`.
3. El test «un adjunto que no cuadra con su hash no entra» (`test/attachments.test.js:88`) demuestra el rechazo del bundle manipulado.
4. Abre `TAREAS.md:68`: T6 en ✅ y T7 en ⏳.

---

## 2026-11-07 · T7 — Registro de workspaces con invariantes y copia previa

**Estado:** ✅ Completada
**Rama:** `feat/t7-registro`
**Commit:** `feat: registro de workspaces con invariantes y copia previa`
**Archivos:** `src/core/registry.js`, `test/registry.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Módulo nuevo del registro de workspaces (`storages/workspace.json`, dominio `workspace` versión 2): lee el fichero respetando lo que no conoce (`defaultWorkspaceId`, marcas), valida las tres invariantes, da de alta el workspace y asigna la sesión de forma idempotente, desarchiva la sesión al instalarla, y guarda con copia previa y escritura atómica. 15 tests.

### 2. ¿Por qué?

Este fichero es exactamente lo que hizo falta el primer día para que la conversación apareciera, y la app **lo valida al arrancar y aborta** si está incoherente. Por eso aquí se comprueba antes de escribir y se guarda copia: es el único fichero del almacén cuyo estropicio deja DeepSeek Harness sin abrir. Además se niega a escribir con la app abierta, que es cómo perdimos el primer registro: lo tenía en memoria y lo sobrescribió al cerrarse.

### 3. ¿Dónde verlo en el código?

- `src/core/registry.js:30-38` — `RegistryError`.
- `src/core/registry.js:40-57` — `registroVacio` con la forma exacta de la app.
- `src/core/registry.js:59-90` — `leerRegistro`: conserva campos desconocidos y rellena los que falten.
- `src/core/registry.js:92-136` — `validarRegistro`: las tres invariantes (orden, ruta única, sesión contada una vez).
- `src/core/registry.js:156-229` — `asegurarWorkspace`: alta idempotente, desarchivado y limpieza de `pendingMutation`.
- `src/core/registry.js:231-273` — `guardarRegistro`: copia `.bak-<fecha>`, escritura atómica y negativa con la app abierta.
- `src/core/registry.js:275-289` — `registrarSesion`: las tres cosas de un tirón, con modo seco.
- `test/registry.test.js:37-247` — los 15 tests.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 74` / `fail 0`**.
2. Lectura real del registro, en seco (no escribe):

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "Promise.all([import('./src/core/registry.js'),import('./src/core/paths.js')]).then(([r,p])=>{const h=p.resolveHome();const {registro}=r.leerRegistro(h);console.log('problemas:',r.validarRegistro(registro).length,'| workspaces:',registro.global.workspaceIds.length,'| sesiones:',Object.values(registro.tables.workspaces).reduce((a,f)=>a+f.sessionIds.length,0));const seco=r.registrarSesion(h,{path:'D:\\Users\\MSI-PC\\Desktop\\web',sessionId:'session-7f56faee-07dc-4147-a205-9add8b35ff3d'},{seco:true});console.log('cambios:',JSON.stringify(seco.cambios))})"
   ```
   Resultado en este equipo: `problemas: 0 | workspaces: 4 | sesiones: 8` y `cambios: []`.
3. Mira el test «guardarRegistro se niega con DeepSeek Harness abierto» (`test/registry.test.js:201`): cubre el fallo que nos mordió.
4. Abre `TAREAS.md:79`: T7 en ✅ y T8 en ⏳.

---

## 2026-11-07 · T8 — Compatibilidad de tipos de evento con el harness destino

**Estado:** ✅ Completada
**Rama:** `feat/t8-compat`
**Commit:** `feat: compatibilidad de tipos de evento con el harness destino`
**Archivos:** `src/core/compat.js`, `test/compat.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Módulo que mira qué tipos de evento entiende el DeepSeek Harness **destino** (leyéndolos de su `app.asar`), compara con los que usa el log y marca `ignorable: true` solo en los que no conoce. Después comprueba que no queda ninguno pendiente antes de escribir. 10 tests.

### 2. ¿Por qué?

Un solo tipo de evento desconocido hace que la app **rechace el log entero** («unknown to this harness and not marked ignorable»): es lo que nos pasó con la conversación del bar. El formato prevé la salida —el sobre admite `ignorable`—, pero hay que saber exactamente qué sobra. Y la primera versión de la detección leía «alrededor» del símbolo en el asar y se colaba una mención de la documentación (`job/registered`): el modo automático habría decidido no parchear y la importación habría fallado igual. Por eso ahora se parsea el literal exacto de la tabla.

### 3. ¿Dónde verlo en el código?

- `src/core/compat.js:22-30` — `CompatError`.
- `src/core/compat.js:34-110` — `TIPOS_CONOCIDOS_020_RC2`, la tabla de respaldo (foto de la 0.2.0-rc.2).
- `src/core/compat.js:112-150` — `tiposDesdeAsar`: busca `KNOWN_SESSION_EVENT_TYPES = new Set([...])` y lee solo ese literal.
- `src/core/compat.js:152-172` — `tiposConocidos`: precedencia manual → asar → respaldo, informando del origen.
- `src/core/compat.js:174-204` — `analizarTipos`: tipos usados y desconocidos.
- `src/core/compat.js:206-242` — `marcarIgnorables`: parcheo línea a línea con re-parseo de control.
- `src/core/compat.js:244-250` — `tiposPendientes`: comprobación final.
- `test/compat.test.js:35-170` — los 10 tests; el del ruido está en `:90`.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 84` / `fail 0`**.
2. Los tipos reales de tu instalación:

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "Promise.all([import('./src/core/compat.js'),import('./src/core/paths.js')]).then(([c,p])=>{const t=c.tiposDesdeAsar(p.findAppAsar());console.log('tipos:',t.size,'| job/registered:',t.has('job/registered'))})"
   ```
   Debe dar `tipos: 62 | job/registered: true`.
3. Que el ruido no entra: `test/compat.test.js:90` mete `job/registered` en un texto de documentación falso dentro del asar y comprueba que la lista leída no lo incluye.
4. Abre `TAREAS.md:90`: T8 en ✅ y T9 en ⏳.

---

## 2026-11-07 · T9 — Exportar una conversación a un bundle ZIP

**Estado:** ✅ Completada
**Rama:** `feat/t9-exportar`
**Commit:** `feat: exporta una conversación a un bundle ZIP con manifiesto`
**Archivos:** `src/core/pack.js`, `test/pack.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Módulo de exportación: empaqueta una conversación en un ZIP con `meta.json` (manifiesto con checksum del log, eventos, tipos usados, adjuntos y avisos), `LEEME.txt`, el log y **solo los adjuntos citados**, con nombre `dsh-sesion-<titulo>-<fecha>.zip` y escritura atómica. Si se le pasa la lista de tipos del destino, adapta el log antes de empaquetarlo. 10 tests.

### 2. ¿Por qué?

Es la mitad del programa: sin bundle no hay nada que importar, y el ZIP debe poder auditarse a mano (abrir y ver qué lleva) sin saber leer un log comprimido. Copiar solo los adjuntos citados no es un detalle: una conversación de este equipo cita 559 archivos, pero el almacén tiene miles; empaquetarlo todo multiplicaría el tamaño. El `meta.json` guarda el sha256 del log para que la importación verifique la integridad y para que cualquiera pueda comprobarla con `sha256sum`.

### 3. ¿Dónde verlo en el código?

- `src/core/pack.js:28-33` — `PackError`.
- `src/core/pack.js:35-37` — `FORMATO` (`dsh-bridge/1`).
- `src/core/pack.js:39-58` — `slugDe` y `nombreSugerido` (acentos fuera, fecha incluida).
- `src/core/pack.js:60-87` — `textoLeeme`.
- `src/core/pack.js:89-188` — `construirBundle`: compatibilidad, adjuntos citados, manifiesto y ZIP en memoria.
- `src/core/pack.js:190-212` — `exportarSesion`: escritura atómica y nombre final.
- `test/pack.test.js:48-211` — los 10 tests.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 94` / `fail 0`**.
2. Exportar de verdad (carpeta temporal; bórrala al terminar):

   ```powershell
   cd "D:\Users\MSI-PC\Desktop\dsh\dsh-bridge"
   node -e "Promise.all([import('./src/core/pack.js'),import('./src/core/paths.js'),import('./src/core/sessions.js'),import('./src/core/compat.js'),import('node:fs'),import('node:os'),import('node:path')]).then(([pk,p,s,c,fs,os,path])=>{const h=p.resolveHome();const k=c.tiposDesdeAsar(p.findAppAsar());const l=s.listSessions(h,{full:true}).filter(x=>(x.attachments||0)>0);const x=l.find(y=>y.label.includes('tarjeta'));const d=fs.mkdtempSync(path.join(os.tmpdir(),'prueba-'));const r=pk.exportarSesion(h,x.id,d,{tiposConocidos:k,origenCompat:'asar'});console.log(path.basename(r.ruta),'|',(r.bytes/1024).toFixed(0),'KB | adjuntos:',r.meta.adjuntos.length);console.log('carpeta:',d)})"
   ```
   Resultado comprobado: `dsh-sesion-organizar-proyecto-tarjeta-para-netlify-20261107.zip | 4182 KB | adjuntos: 14`.
3. Abre el ZIP con doble clic: dentro están `meta.json`, `LEEME.txt`, `session/…` y `attachments/objects/…`. El `LEEME.txt` explica qué es y cómo importarlo.
4. Abre `TAREAS.md:105`: T9 en ✅ y T10 en ⏳.

_(Sin más entradas todavía: la T10 se registrará aquí en cuanto respondas «sí» a su «¿Todo OK?».)_
