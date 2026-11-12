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

---

## 2026-11-07 · T10 — Importar un bundle y registrar la conversación

**Estado:** ✅ Completada
**Rama:** `feat/t10-importar`
**Commit:** `feat: importa un bundle y registra la conversación en el workspace`
**Archivos:** `src/core/import.js`, `test/import.test.js`, `src/core/paths.js`, `src/core/registry.js`, `src/core/pack.js`, `test/paths.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Módulo de importación: valida el bundle (manifiesto, formato, sha256 del log y coherencia de la cabecera), reescribe el `cwd` al workspace de este equipo, coloca el log en su carpeta, instala los adjuntos con dedupe y hash verificado, y registra el workspace reutilizando el que ya exista. Con guardas: nada se escribe con la app abierta, hay modo «en seco» y `forzar` deja copia. 10 tests.

### 2. ¿Por qué?

Es la mitad que faltaba: sin esto el ZIP es un fichero muerto. Además concentra los tres fallos que nos costaron tiempo en la migración manual: la ruta que hay que reescribir, el registro que hace que la app liste la conversación y la necesidad de cerrar la app para no perder ese registro.

### 3. ¿Dónde verlo en el código?

- `src/core/import.js:29-36` — `ImportError`.
- `src/core/import.js:74-155` — `analizarBundle`: manifiesto, checksum, cabecera, adaptación de tipos y extracción de adjuntos.
- `src/core/import.js:157-269` — `importarBundle`: carpeta destino, guardas, copia previa, log, adjuntos y registro.
- `src/core/paths.js:206-216` — `nombreBase`, el arreglo de portabilidad.
- `src/core/registry.js:181` y `src/core/pack.js:155` — usan `nombreBase` en vez de `path.basename`.
- `test/import.test.js:64-260` — los 10 tests.
- `test/paths.test.js:113-124` — rutas cruzadas Windows/Linux.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 105` / `fail 0`**.
2. Lo mismo desde WSL, que es donde salió el fallo de portabilidad:

   ```powershell
   wsl.exe -e bash -lc "cd /mnt/d/Users/MSI-PC/Desktop/dsh/dsh-bridge && node --test 2>&1 | tail -6"
   ```
   Debe dar también `pass 105` / `fail 0`.
3. Prueba de punta a punta (la ejecuté yo): exportar «Organizar proyecto tarjeta para Netlify» → 4.182 KB, 14 adjuntos; importar en un almacén vacío → 2.530 eventos, 14 adjuntos copiados, ruta reescrita, registro con 1 workspace y 0 problemas; segunda importación rechazada por «ya está instalada».
4. Abre `TAREAS.md:117`: T10 en ✅ y T11 en ⏳.

---

## 2026-11-07 · T11 — CLI con menú para exportar e importar

**Estado:** ✅ Completada
**Rama:** `feat/t11-cli`
**Commit:** `feat: CLI con menú para exportar e importar conversaciones`
**Archivos:** `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/cli.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

La herramienta ya se puede usar sin saber nada por dentro: `dsh-bridge` sin argumentos abre un menú (Exportar · Importar · Enviar/Recibir de la v0.2 · Diagnóstico · Salir), y los mismos pasos existen como comandos (`list`, `export`, `import`, `doctor`) con alias en castellano. Incluye el diagnóstico real de la instalación y, al importar con la app abierta, ofrece cerrarla, importar y volver a abrirla. 12 tests de la parte que se puede probar sin terminal.

### 2. ¿Por qué?

Todo lo anterior estaba probado pero no se podía usar: hacía falta escribir llamadas a módulos. El menú es lo que convierte la librería en herramienta, y el diagnóstico es lo que evita el «no me sale la conversación»: comprueba de una vez las cuatro cosas que fallaron durante la migración manual (app abierta, carpetas, registro y adjuntos).

### 3. ¿Dónde verlo en el código?

- `bin/dsh-bridge.js:55-75` — carpeta de destino por defecto y lectura de tipos.
- `bin/dsh-bridge.js:77-156` — `list`, `export` e `import` por consola.
- `bin/dsh-bridge.js:158-228` — `doctor`: DSH, app, asar, sesiones, carpetas, registro y adjuntos.
- `bin/dsh-bridge.js:230-255` — `cerrarApp` y `abrirApp` (solo Windows).
- `bin/dsh-bridge.js:257-418` — menú de exportación e importación.
- `bin/dsh-bridge.js:419-460` — despacho de comandos y códigos de salida.
- `src/cli/opciones.js:67-112` — `parsearArgumentos` y `tiposManuales`.
- `src/cli/formato.js:16-152` — tamaños, fechas, recorte, `parsearSeleccion`, tabla y ayuda.
- `test/cli.test.js:24-152` — los 12 tests.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 117` / `fail 0`**.
2. `node bin/dsh-bridge.js --help` → ayuda con comandos y ejemplos.
3. `node bin/dsh-bridge.js doctor` → debe terminar en **`✔ todo en orden`** (en este equipo: 115 sesiones, 0 carpetas mal, 4 workspaces sin problemas).
4. `node bin/dsh-bridge.js list` → tabla con tus conversaciones reales y sus imágenes; `--rapido` para la versión de 87 ms.
5. El menú: `node bin/dsh-bridge.js`, opción `1`, mirar la tabla, `0` para salir.
   **No uses la opción 2 con la app abierta**: te ofrecerá cerrarla y se cerraría también la conversación en curso.

---

## 2026-11-07 · T12 — Integración: ciclo completo sobre almacenes falsos

**Estado:** ✅ Completada
**Rama:** `test/t12-integracion`
**Commit:** `test: ciclo completo exportar e importar sobre almacenes falsos`
**Archivos:** `test/ayudas/entorno.js`, `test/integracion.test.js`, `src/core/import.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Añadí un almacén de mentira reutilizable (tres conversaciones: texto, con fotos y con un evento de tipo desconocido) y ocho tests de integración que hacen el ciclo entero: exportar las tres, importarlas en otro almacén y comprobar que queda todo coherente. Cuatro de esos tests lanzan la **CLI como proceso aparte** y miran su salida y su código de salida.

### 2. ¿Por qué?

Hasta ahora cada módulo se probaba por su lado y la coherencia se comprobaba a mano con conversaciones reales: bueno para validar una vez, malo para el futuro. Estos tests convierten esa comprobación manual en algo que se repite en cada cambio, y sin datos privados dentro del repo (REGLA 3). Además, el test del registro incoherente destapó un orden peligroso: se escribía el log antes de validar el registro del destino.

### 3. ¿Dónde verlo en el código?

- `test/ayudas/entorno.js:1-140` — generadores de eventos, `crearSesion`, `crearCasaFalsa` (almacén completo con títulos y registro).
- `test/integracion.test.js:48-103` — ciclo completo y sus cinco comprobaciones.
- `test/integracion.test.js:105-137` — registro incoherente en el destino.
- `test/integracion.test.js:139-178` — bundle truncado y bundle sin fotos.
- `test/integracion.test.js:180-232` — la CLI de verdad: `list --json`, `doctor`, `export`, `import --seco` y errores de uso.
- `src/core/import.js:155-182` — `comprobarRegistroDestino`, la validación previa.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 125` / `fail 0`**.
2. Solo los de integración: `node --test test/integracion.test.js` → 8 pruebas (tarda ~1 s porque arranca la CLI cuatro veces).
3. En WSL: `wsl.exe -e bash -lc "cd /mnt/d/Users/MSI-PC/Desktop/dsh/dsh-bridge && node --test 2>&1 | tail -6"` → también 125 y 0 fallos.
4. Abre `TAREAS.md:144`: T12 en ✅ y T13 en ⏳.

---

## 2026-11-07 · T13 — README bilingüe, formato v4 y changelog

**Estado:** ✅ Completada
**Rama:** `docs/t13-readme`
**Commit:** `docs: README bilingüe, formato v4 y changelog`
**Archivos:** `README.md`, `docs/FORMATO.md`, `CHANGELOG.md`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Reescribí el README (dos líneas de GitHub) como presentación real del proyecto en español e inglés, con el problema, requisitos, instalación, menú, comandos, contenido del ZIP, avisos y límites. Añadí `docs/FORMATO.md`, el mapa del formato que descubrimos, y `CHANGELOG.md` con la 0.1.0.

### 2. ¿Por qué?

El valor de este proyecto no es solo el código: es haber entendido por qué una conversación copiada no aparece (registro, ruta y tipos de evento). Eso no estaba escrito en ningún sitio y se perdería. Además, quien llegue al repo sin contexto —o yo dentro de tres meses— necesita saber en un minuto qué es, cómo se usa y qué **no** hace.

### 3. ¿Dónde verlo en el código?

- `README.md:1-120` — qué es, el problema en tres piezas y requisitos.
- `README.md:121-215` — uso, menú, comandos, avisos de seguridad y contenido del ZIP.
- `README.md:216-330` — doctor, instalación manual, límites, desarrollo y bloque en inglés.
- `docs/FORMATO.md:1-60` — dónde vive todo y los frames del log (con la cabecera y su `\n`).
- `docs/FORMATO.md:61-140` — sobre de eventos, `ignorable` y cómo se lee la lista de tipos del `app.asar` (con la trampa del ruido).
- `docs/FORMATO.md:141-230` — registro `workspace` v2, tres invariantes y codificación de carpetas.
- `docs/FORMATO.md:231-300` — adjuntos, caché de proyecciones y tabla de riesgos.
- `CHANGELOG.md:1-80` — 0.1.0 con lo añadido, los seis fallos corregidos y lo pendiente.

### 4. ¿Cómo comprobar que funciona?

1. Abre el README en GitHub (pestaña *Code*): debe verse la presentación, el menú y el bloque en inglés.
2. Los cinco enlaces internos apuntan a ficheros que existen (`AGENTS.md`, `TAREAS.md`, `HISTORIAL.md`, `docs/FORMATO.md`, `LICENSE`); comprobado con un script de este mismo paso.
3. Busca «`job/registered`» en `docs/FORMATO.md`: ahí está explicado por qué el harness rechazaba el log y la trampa de leer «alrededor» del símbolo en el asar.
4. `npm test` → **125 pruebas, 0 fallos** (la documentación no toca código).
5. Abre `TAREAS.md:159`: T13 en ✅ y T14 en ⏳.

---

## 2026-11-07 · T14 — CI en Ubuntu y Windows, y metadatos del paquete

**Estado:** ✅ Completada
**Rama:** `chore/t14-ci`
**Commits:** `chore: CI en Ubuntu y Windows y metadatos del paquete` · `fix: --version y --help funcionan sin DeepSeek Harness instalado`
**Archivos:** `.github/workflows/ci.yml`, `package.json`, `README.md`, `bin/dsh-bridge.js`, `test/integracion.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Añadí el workflow de GitHub Actions: matriz de **Ubuntu y Windows por Node 22.15, 24 y 26** ejecutando `npm test`, más un trabajo que comprueba que el paquete se puede publicar (`npm pack --dry-run` y `--version`). Revisé los metadatos de `package.json`, puse la insignia en el README y **corregí el fallo que el propio CI encontró**: `--version` y `--help` exigían tener `~/.dsh` y fallaban en cualquier equipo sin DeepSeek Harness.

### 2. ¿Por qué?

Los tests solo se estaban ejecutando a mano y en un sistema. Ese es justo el punto ciego por el que se coló el fallo de `path.basename`: funcionaba en Windows y no en Linux. Con la matriz, ese fallo no llega a `main`, y el trabajo de empaquetado evita publicar un paquete sin el `bin` o con ficheros de más.

Y funcionó a la primera: **el CI encontró un fallo real en la primera ejecución** (run #1, PR #17). Los seis trabajos de pruebas pasaron, pero el paso `node bin/dsh-bridge.js --version` del trabajo de empaquetado falló porque `principal()` resolvía `~/.dsh` antes de mirar qué comando se pedía: en un runner vacío no existe y moría el comando más básico. Se arregló atendiendo `help` y `version` antes de tocar el disco, con un test que lo fija.

### 3. ¿Dónde verlo en el código?

- `.github/workflows/ci.yml:1-24` — disparadores, permisos y matriz.
- `.github/workflows/ci.yml:25-45` — pasos de `pruebas`.
- `.github/workflows/ci.yml:47-63` — trabajo `empaquetado` (el que destapó el fallo).
- `bin/dsh-bridge.js:419-437` — `help` y `version` se atienden antes de `resolveHome`.
- `test/integracion.test.js:230-250` — test con un `--dsh-home` inexistente.
- `package.json:1-40` — `engines`, `bin`, `scripts`, `files`, `homepage`, `bugs`.
- `README.md:3` — insignia de CI.

### 4. ¿Cómo comprobar que funciona?

1. **En GitHub:** pestaña *Actions* → `CI`. El run del PR #18 (`2d93d09`) y el de `main` (`3cb9b6e0`) salen **verdes con los 7 trabajos**: seis de pruebas y el de empaquetado. La insignia del README tiene que verse en verde.
2. En local: `npm pack --dry-run` → **17 ficheros, 38,9 kB**, sin tests; `npm test` → **126 pruebas, 0 fallos**.
3. El fallo que encontró el CI, ya corregido: `node bin/dsh-bridge.js --version --dsh-home "C:\no\existe"` → `dsh-bridge 0.1.0` y código 0; en cambio `list` con esa misma carpeta falla con mensaje claro.
4. Abre `TAREAS.md:168`: T14 en ✅ y T15 en ⏳.

---

## 2026-11-07 · T15 — Prueba real entre los dos equipos

**Estado:** ✅ Completada
**Rama:** `test/t15-prueba-real`
**Commit:** `test: prueba real de importación entre los dos equipos`
**Archivos:** `TAREAS.md`, `HISTORIAL.md` (el ZIP generado no entra al repositorio)

### 1. ¿Qué he realizado?

Exporté esta misma conversación con la herramienta (`dsh-bridge export … -o Escritorio`): ZIP de 3,6 MB con **3.474 eventos y 5 imágenes**. Escribí `LEEME-PORTATIL.txt` con los pasos para el otro equipo y el usuario hizo la otra mitad: clonar, `doctor`, cerrar DeepSeek Harness e importar en el portátil. La conversación apareció y se abre.

### 2. ¿Por qué?

Todo lo anterior estaba probado con casas falsas y en el mismo equipo. La prueba que faltaba era la de verdad: dos máquinas distintas, dos copias de DeepSeek Harness y una persona siguiendo instrucciones sin mí delante. Es la única forma de saber si el paso a paso del README sirve o solo funciona en mi cabeza.

### 3. ¿Dónde verlo en el código?

- `bin/dsh-bridge.js:94-113` — `comandoExport`, el que generó el ZIP.
- `bin/dsh-bridge.js:115-156` — `comandoImport`, el que se usó en el portátil.
- `src/core/pack.js:89-212` — construcción del bundle y escritura del ZIP.
- `src/core/import.js:157-269` — validación, reescritura de ruta, adjuntos y registro.
- `README.md:130-160` — los pasos que se siguieron (sección «Uso» y avisos).

### 4. ¿Cómo comprobar que funciona?

1. En el sobremesa: Escritorio → `dsh-sesion-pleta-a-deepseek-standard-mode-20261107.zip` (3,6 MB) y `LEEME-PORTATIL.txt`.
2. Repetir la exportación: `node bin/dsh-bridge.js export session-ee2a578c-9407-4827-a6af-36a5e1df771c -o "%USERPROFILE%\Desktop"` → debe dar un ZIP de tamaño parecido.
3. En el portátil, con DeepSeek Harness cerrado: `node bin/dsh-bridge.js import <zip> --workspace <carpeta>` → «✔ importada» con 3.474 eventos y 5 adjuntos.
4. Abrir la app allí: la conversación aparece en el workspace elegido y se abre con sus imágenes (comprobado por el usuario).
5. Abre `TAREAS.md:181`: T15 en ✅. **La v0.1 está completa.**

---

## 2026-11-07 · T16 — Servidor de recepción con código de un solo uso

**Estado:** ✅ Completada
**Rama:** `feat/t16-servidor`
**Commit:** `feat: servidor de recepción con código de un solo uso`
**Archivos:** `src/net/servidor.js`, `test/servidor.test.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

El equipo que recibe ya se puede quedar escuchando: `dsh-bridge serve` arranca un servidor HTTP sin dependencias que enseña dirección, código de 6 dígitos y caducidad. Al emparejarse entrega un token y desde ahí se pueden listar las conversaciones. El código es de un solo uso, caduca a los 10 minutos, admite 5 intentos y bloquea; se compara en tiempo constante y nunca se devuelve.

### 2. ¿Por qué?

Es la otra mitad del «pongo la IP y se transfiere»: alguien tiene que esperar al otro lado. Y ese alguien está expuesto a su red local, así que el diseño es desconfiado por defecto: escucha solo en `127.0.0.1` salvo que se pida `--red`, y sin el código no se puede ni mirar qué conversaciones hay. El límite de intentos y la caducidad están porque un código de 6 dígitos son un millón de combinaciones: con 5 intentos y 10 minutos, adivinarlo no es viable.

### 3. ¿Dónde verlo en el código?

- `src/net/servidor.js:35-47` — `ipLocal`, la IP que se le da al otro equipo.
- `src/net/servidor.js:49-52` — `crearCodigo` (6 dígitos, con ceros delante).
- `src/net/servidor.js:115-150` — `crearServidor`: estado del código, intentos, token y caducidades.
- `src/net/servidor.js:153-215` — rutas `/estado`, `/emparejar` y `/sesiones` con sus comprobaciones.
- `src/net/servidor.js:220-300` — `iniciar`/`cerrar` y datos que se enseñan.
- `bin/dsh-bridge.js:231-286` — `comandoServe`: banner, avisos y `Ctrl+C`.
- `test/servidor.test.js:48-210` — los 8 tests (puerto 0 y reloj controlado).
- `src/cli/opciones.js` y `src/cli/formato.js` — `--red`, `--puerto`, `--codigo` y la ayuda.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 134` / `fail 0`**.
2. Una consola: `node bin/dsh-bridge.js serve --codigo 123456`. Otra (o el navegador): `http://127.0.0.1:8787/estado` → JSON con `emparejado: false` e `intentosRestantes: 5`.
3. Emparejarse y listar:

   ```powershell
   $r = Invoke-RestMethod "http://127.0.0.1:8787/emparejar" -Method Post -ContentType "application/json" -Body '{"codigo":"123456"}'
   Invoke-RestMethod "http://127.0.0.1:8787/sesiones" -Headers @{ Authorization = "Bearer $($r.token)" } | Select-Object -ExpandProperty sesiones | Measure-Object
   ```
   Comprobado por el usuario: **Count: 115**. Repetir el primer comando da 401 (código ya usado).
4. Modo red: `serve --red` y consultar por la IP de la máquina; comprobado en este equipo.
5. Abre `TAREAS.md:195`: T16 en ✅ y T17 en ⏳.

---

## 2026-11-07 · T17 — Envío cifrado entre equipos

**Estado:** ✅ Completada
**Rama:** `feat/t17-envio`
**Commit:** `feat: envío cifrado entre equipos con recepción e importación`
**Archivos:** `src/net/cifrado.js`, `src/net/cliente.js`, `src/net/servidor.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/cifrado.test.js`, `test/red.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

El círculo completo de la red: `send` se empareja con el servidor, exporta cada conversación, la **cifra con AES-256-GCM** (clave derivada del código con `scrypt` y un `salt` aleatorio por envío, sin que el código viaje nunca) y la sube a `/recibir`, que la descifra **en streaming** y la instala con el mismo `importarBundle` que usa el ZIP. Se pueden mandar varias conversaciones con un solo emparejamiento.

### 2. ¿Por qué?

Era la idea con la que empezó todo: poner la IP y que la conversación pase sin USB. Y el cifrado no es adorno: el código de 6 dígitos ya existe para emparejar, así que se reutiliza como secreto compartido para el contenido. Al ir en streaming, una conversación de 693 MB no necesita 693 MB de memoria.

La prueba con la conversación grande encontró **dos fallos que los tests no veían**: el tope de 512 MB rechazaba justo el caso real, y al superarlo el servidor **se caía** (escribía en un fichero ya cerrado, con error no capturado), o sea que cualquiera podía tumbar el receptor con un envío grande.

### 3. ¿Dónde verlo en el código?

- `src/net/cifrado.js:38-87` — `derivarClave`, `cifrar` y `descifrar` (AES-256-GCM, formato `DSH1|salt|nonce|cifrado|tag`).
- `src/net/cifrado.js:90-200` — cifrado y descifrado de ficheros en trozos.
- `src/net/cliente.js:66-108` — `emparejar`.
- `src/net/cliente.js:123-200` — `enviarSesiones`: exportar, cifrar, subir y recoger el resultado.
- `src/net/servidor.js:123-170` — `recibirArchivo`: escritura a disco protegida (aquí estaba el cierre del proceso).
- `src/net/servidor.js:275-340` — `/recibir`: comprobación de tamaño por `Content-Length`, descifrado e importación.
- `src/net/servidor.js:179` — tope por defecto de 2 GB.
- `bin/dsh-bridge.js:232-320` — `serve` con `--workspace` y `--max`; `bin/dsh-bridge.js:286-340` — `send`.
- `test/cifrado.test.js` — 9 tests; `test/red.test.js` — 8, incluido el de regresión del 413.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 151` / `fail 0`**.
2. Cifrado, sin red: los tests «con otro código no se descifra» y «un solo byte cambiado invalida el paquete».
3. Transferencia real (dos consolas; usa `--dsh-home` temporal para no tocar tu almacén):

   ```
   dsh-bridge serve --dsh-home <temp> --workspace <temp>\web --codigo 123456
   dsh-bridge send --ip 127.0.0.1 --codigo 123456 --sesion <id>
   ```
4. Resultado comprobado en este equipo: la conversación del bar —**693 MB, 22.179 eventos, 559 adjuntos**— llegó en **7 s** con los procesos en ~60 MB de memoria, y el destino quedó con 1 workspace válido, 559 adjuntos y el `cwd` reescrito. La pequeña: 4,1 MB en 543 ms.
5. Regresión del fallo grave: `test/red.test.js` «un bundle demasiado grande se rechaza y el servidor sigue vivo».
6. Abre `TAREAS.md:208`: T17 en ✅ y T18 en ⏳.

---

## 2026-11-07 · T18 — Interfaz web local

**Estado:** ✅ Completada
**Rama:** `feat/t18-ui-web`
**Commit:** `feat: interfaz web local para enviar conversaciones`
**Archivos:** `src/net/ui.js`, `src/net/servidor.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/ui.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

La transferencia ya se hace con el ratón: `dsh-bridge ui --abrir` sirve una página en `127.0.0.1` con la lista de conversaciones (casillas), el formulario con la IP, el puerto y el código, un botón de envío y la barra de progreso. El envío va en segundo plano, así que la página no se queda colgada aunque sean 693 MB. El servidor de recepción sirve además una página de estado con su código. Y la interfaz **dice de qué almacén lee** y **separa las conversaciones que ve la app de las que solo están en disco**.

### 2. ¿Por qué?

Hasta ahora todo era consola: para mover una conversación había que copiar una IP y un id. Y una página no puede ser un atajo inseguro: puede leer tus conversaciones y mandarlas, así que va con token por sesión, CSP estricta, sin código inline y solo en localhost.

Lo del almacén y el «no registrada» salió de una confusión real del usuario: la página decía 115 conversaciones y su panel enseñaba 7. Las 115 son las que hay en disco; las 7, las que la app tiene apuntadas en `workspace.json`. Las demás están huérfanas (rutas de cuando usaba WSL) y no se habían borrado. Ahora se ve a la primera.

### 3. ¿Dónde verlo en el código?

- `src/net/ui.js:120-175` — el HTML de la página (sin código ni estilos inline).
- `src/net/ui.js:177-330` — el guion del navegador: pinta con `textContent`, filtro visibles/todas y sondeo del trabajo.
- `src/net/ui.js:340-420` — `crearUiServidor`: rutas, token obligatorio y `POST /api/enviar` en segundo plano.
- `src/net/ui.js:100-118` — `calcularVisibles`: qué conversaciones enseña la app según el registro.
- `src/net/ui.js:520-560` — `paginaEstado`, la página del receptor.
- `src/net/servidor.js:180-190` — rutas `/` y `/estado.css` del receptor.
- `bin/dsh-bridge.js:339-390` — `comandoUi` (`--abrir` incluido).
- `test/ui.test.js` — 9 tests, incluido el del envío real y el de visibles frente a huérfanas.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 159` / `fail 0`**.
2. `node bin/dsh-bridge.js ui --abrir` → la página debe decir **«7 visibles · 115 en disco»** (en este equipo) y el almacén `C:\Users\MSI-PC\.dsh`.
3. Cambia el desplegable a «Todas»: aparecen las 115 con la etiqueta «no registrada» en las huérfanas.
4. En el navegador, `http://127.0.0.1:8790/api/sesiones` sin token → 401.
5. Con dos consolas (receptor con `--dsh-home` temporal), marcar una conversación y pulsar «Enviar seleccionadas» → barra de progreso y resultado con eventos y adjuntos.
6. Abre `TAREAS.md:224`: T18 en ✅ y T19 en ⏳.

---

## 2026-11-07 · T19 — Descubrimiento en la red

**Estado:** ✅ Completada
**Rama:** `feat/t19-descubrir`
**Commit:** `feat: descubrimiento en la red y cierre de la v0.2 (0.2.0)` (junto con T20)
**Archivos:** `src/net/descubrir.js`, `src/net/ui.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/descubrir.test.js`, `test/ui.test.js`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

El equipo que recibe se anuncia por **UDP en el 8788** (solo cuando escucha abierto a la red), y el que envía lo encuentra con `dsh-bridge discover` o directamente con `send --buscar`, sin escribir la IP. La interfaz web tiene un botón **«Buscar en la red»** que rellena la IP y el puerto al elegir un equipo.

### 2. ¿Por qué?

Copiar la IP es el paso que más se falla: se cambia con el DHCP, se confunde con la del router, se copia mal. Preguntar en la red es lo que hace cualquier impresora o televisor. Y el anuncio va con lo mínimo: nombre, puerto y si ya está emparejado; **nunca** el código ni nada del contenido.

### 3. ¿Dónde verlo en el código?

- `src/net/descubrir.js:29-90` — `crearRespondedor`: contesta a la pregunta con nombre y puerto.
- `src/net/descubrir.js:100-160` — `descubrir`: tres latidos, recoge respuestas y deduplica por IP.
- `bin/dsh-bridge.js:402-430` — `comandoDiscover`.
- `bin/dsh-bridge.js:320-345` — `send --buscar` (y el arreglo para un solo PC).
- `src/net/ui.js` — botón «Buscar en la red» y `POST /api/descubrir`.
- `test/descubrir.test.js` — 8 tests, incluido el que fija que el código no viaja.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 167` / `fail 0`**.
2. Dos consolas: en una `serve --red --workspace <carpeta>`; en la otra `discover` → aparece el equipo con su IP y puerto.
3. `send --buscar --codigo <código> --sesion <id>` → envía sin escribir la IP.
4. Comprobado en este equipo: `discover` encontró `DESKTOP-S22K5U6` en `192.168.1.141`, el envío llegó (2.530 eventos, 14 adjuntos) y el código se leyó de la página de estado del receptor. También probado dentro de WSL/Ubuntu.
5. Abre `TAREAS.md:236`: T19 en ✅ y T20 en ⏳.

---

## 2026-11-07 · T20 — Cierre de la v0.2

**Estado:** ✅ Completada
**Rama:** `test/t20-cierre-v02` (o la de T19, en el mismo PR)
**Commit:** `feat: descubrimiento en la red y cierre de la v0.2 (0.2.0)` (el mismo que T19)
**Archivos:** `README.md`, `CHANGELOG.md`, `package.json`, `bin/dsh-bridge.js`, `src/core/pack.js`, `TAREAS.md`, `HISTORIAL.md`

### 1. ¿Qué he realizado?

Documenté la parte de red en el README («Por red, sin USB»): el flujo de los dos equipos con sus salidas reales, la tabla de qué se protege, el modo `ui` y el aviso del firewall. Añadí la entrada **0.2.0** del `CHANGELOG` (añadido, cambiado y corregido), subí la versión a **0.2.0** en el paquete, en el binario y en la procedencia que anota cada bundle, y arreglé el **menú**, que seguía anunciando la red como futura.

### 2. ¿Por qué?

Una versión que se puede usar pero que se documenta como si no existiera es una versión que nadie encuentra. Y el menú era lo primero que veía el usuario: ofrecía «(v0.2)» y no hacía nada. Ahora la opción 3 abre la interfaz web y la 4 arranca la recepción pidiendo la carpeta de destino.

### 3. ¿Dónde verlo en el código?

- `README.md:91-160` — «Por red, sin USB»: `serve`, `send --buscar`, `ui` y las garantías.
- `CHANGELOG.md:8-40` — la entrada 0.2.0.
- `package.json:3` — `"version": "0.2.0"`.
- `bin/dsh-bridge.js:44` — `VERSION`; `src/core/pack.js:37` — `VERSION_TOOL`.
- `bin/dsh-bridge.js:618-640` — el menú con las opciones 3 y 4 conectadas.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 167` / `fail 0`**.
2. `node bin/dsh-bridge.js --version` → `dsh-bridge 0.2.0`.
3. `node bin/dsh-bridge.js --help` → aparecen `serve`, `ui`, `discover` y `send --buscar`.
4. `npm pack --dry-run` → **22 ficheros, 60,8 kB**.
5. `node bin/dsh-bridge.js` (sin argumentos, en una terminal de verdad) → el menú ya no dice «(v0.2)»; la opción 3 abre la interfaz y la 4 pide carpeta y arranca la recepción.
6. Abre `TAREAS.md:248`: T20 en 👀 (pasará a ✅ con tu «sí»).

---

## 2026-11-07 · T21 — Selector nativo de ficheros y carpetas

**Estado:** ✅ Completada
**Rama:** `feat/t21-selector`
**Commit:** `feat: diálogos del sistema para elegir ficheros y carpetas`
**Archivos:** `src/cli/dialogos.js`, `bin/dsh-bridge.js`, `src/cli/opciones.js`, `src/cli/formato.js`, `test/dialogos.test.js`, `TAREAS.md`, `HISTORIAL.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Exportar sin `-o` pregunta con el explorador en qué carpeta guardar; importar sin ruta abre el diálogo de fichero, y sin `--workspace` pregunta la carpeta del proyecto. En el menú, dejar la respuesta vacía abre el diálogo. Se puede desactivar con `--sin-dialogos` y, sin entorno gráfico o sin terminal interactiva, se vuelve al teclado.

### 2. ¿Por qué?

Era la petición literal del usuario: «¿al exportar o importar se abrirá el explorador de archivos para que lo elijas tú?». Teclear rutas es donde más se falla, y en Windows el explorador ya está ahí. Se hace sin dependencias (PowerShell, `osascript` o `zenity`) para no romper la promesa de `npm install` vacío.

### 3. ¿Dónde verlo en el código?

- `src/cli/dialogos.js:32-49` — `hayDialogos`: ¿hay ventanas en este sistema?
- `src/cli/dialogos.js:52-140` — `comandoDialogo`: el comando nativo de cada sistema, con el escapado de comillas.
- `src/cli/dialogos.js:149-180` — `elegirArchivo`, `elegirCarpeta`, `guardarComo` y `nombreSugerido`.
- `bin/dsh-bridge.js:99-160` — `export` e `import` con diálogos y vuelta al teclado.
- `bin/dsh-bridge.js:502-560` — los mismos diálogos desde el menú.
- `test/dialogos.test.js` — 7 tests sin abrir ventanas.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 174` / `fail 0`**.
2. `node bin/dsh-bridge.js export <id>` en una consola de verdad → se abre la ventana «¿En qué carpeta guardo el ZIP?». Comprobado por el usuario: elige carpeta y el ZIP se guarda ahí.
3. `node bin/dsh-bridge.js import` → diálogo de fichero; cancelar no rompe nada.
4. `node bin/dsh-bridge.js export <id> --sin-dialogos -o <carpeta>` → sin ventanas, directo.
5. `npm pack --dry-run` → **23 ficheros, 63,1 kB**.

**Con esto el encargo queda terminado: 21 de 21 tareas.**

---

## 2026-11-07 · T22 — Lanzadores de doble clic

**Estado:** ✅ Completada
**Rama:** `feat/t22-lanzadores`
**Commit:** `feat: lanzadores, destino automático y actualización al recibir`
**Archivos:** `recibir.cmd`, `enviar.cmd`, `dsh-bridge.cmd`, `bin/lanzador.js`, `bin/dsh-bridge.js`, `src/net/servidor.js`, `src/core/import.js`, `test/lanzadores.test.js`, `README.md`, `TAREAS.md`, `AGENTS.md`

### 1. ¿Qué he realizado?

Tres lanzadores para abrir con doble clic: **`recibir.cmd`** (pregunta la carpeta, la crea y se queda escuchando), **`enviar.cmd`** (arranca la interfaz y abre el navegador) y **`dsh-bridge.cmd`** (el menú). Además, el receptor ya **avisa por consola** cuando llega una conversación, y `serve` resuelve solo los choques de puerto.

### 2. ¿Por qué?

El usuario lo pidió así: «sin tener que lanzar comando». Y abrir dos veces el receptor reventaba con un `EADDRINUSE` que no dice nada útil; ahora detecta que ya hay uno nuestro, avisa y se cierra. El aviso al recibir salió de una confusión real: el envío funcionaba pero la ventana del receptor no decía nada y parecía que no había llegado.

Tres fallos por el camino, todos con test o comprobación después:

1. **Los `.cmd` se escribieron con saltos LF.** cmd.exe solo entiende CRLF: se comía dos caracteres de cada línea («No se esperaba node en este momento»). Ahora son CRLF y ASCII puro.
2. **Un `)` pegado a la orden siguiente** tras un `if`. Rehecho con `goto`.
3. **Carpeta inválida** (`<carpeta nueva>`): se rendía; ahora explica que esos caracteres no valen y sigue con `Documents\recibidas`.

### 3. ¿Dónde verlo en el código?

- `recibir.cmd:1-19` · `enviar.cmd:1-19` · `dsh-bridge.cmd:1-15` — CRLF, ASCII y llamada al lanzador.
- `bin/lanzador.js:22-35` — `prepararCarpeta`: crea la carpeta o cae en la de por defecto.
- `bin/lanzador.js:43-70` — los modos `recibir`, `enviar` y `menu`.
- `bin/dsh-bridge.js:249-263` — `hayReceptorPropio`: ¿ya hay un `serve` contestando?
- `bin/dsh-bridge.js:290-330` — arranque con puerto libre y aviso de cuál se usó.
- `src/net/servidor.js` — `alRecibir`, el aviso al receptor.
- `src/core/import.js:270` — `titulo` en el resultado de la importación.
- `test/lanzadores.test.js` — 4 tests (CRLF, ASCII, modos y nombres).

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 180` / `fail 0`**.
2. Doble clic en `recibir.cmd` → pregunta carpeta → Enter → sale dirección y código. Con otra ventana de `recibir.cmd` abierta: «ya hay un dsh-bridge recibiendo…» y no abre un duplicado.
3. `enviar.cmd` → abre el navegador con la interfaz.
4. `dsh-bridge.cmd --version` → `dsh-bridge 0.2.0`.
5. Enviar una conversación: el receptor imprime «✔ recibida «…» · 2.530 eventos · 14 adjuntos».
6. Abre `TAREAS.md:271`: T22 en ✅.

---

## 2026-11-07 · T23 — Destino automático y actualización al recibir

**Estado:** ✅ Completada
**Rama:** `feat/t22-lanzadores` (misma rama que T22)
**Commit:** `feat: lanzadores, destino automático y actualización al recibir`
**Archivos:** `bin/dsh-bridge.js`, `src/net/servidor.js`, `test/red.test.js`, `README.md`, `TAREAS.md`, `HISTORIAL.md`

### 1. ¿Qué he realizado?

Recibir por red ya no pregunta nada ni amontona todo en una carpeta: cada conversación se coloca **donde corresponde**, siguiendo tres pasos en este orden: si esa misma conversación ya está en el equipo, se **actualiza en su sitio**; si no, se usa la **carpeta del proyecto del emisor** (la misma ruta, si existe aquí); y si esa carpeta no existe, se **crea** con su nombre dentro de `Documents\recibidas`.

### 2. ¿Por qué?

El usuario lo pidió tal cual: «que se guarde en la carpeta que tiene el emisor… y si ya existe el chat, que borre el que tiene y ponga este, que estará actualizado». No se puede actualizar un histórico en el sitio —solo crece— así que lo correcto es reemplazarlo, y con copia del anterior por si el que llega viene incompleto. Preguntar una carpeta por cada envío, además, convertía una tarea de dos clics en un formulario.

### 3. ¿Dónde verlo en el código?

- `bin/dsh-bridge.js:301-370` — `resolverDestino`: los tres pasos, con mensajes de qué decidió.
- `bin/dsh-bridge.js:353-375` — `alRecibir`: distingue «recibida» de «actualizada» y enseña la copia.
- `bin/dsh-bridge.js:377` — `forzar: true`: lo que llega manda (con `.bak`).
- `src/net/servidor.js:302-345` — el servidor pide el destino **después de descifrar**, cuando ya puede leer el proyecto del emisor.
- `test/red.test.js` — carpeta elegida, cancelar y carpeta espejo.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 184` / `fail 0`**.
2. Dos envíos seguidos de la misma conversación (receptor con `--dsh-home` temporal):
   - primero: `destino: D:\...\JARDIN\bar` y «✔ recibida»;
   - segundo: `destino: … (ya la tenías: se actualiza)` y «✔ actualizada», con `…zstd.bak-20261107140857` al lado y **0 adjuntos copiados** (14 ya estaban).
3. En el receptor: `node bin/dsh-bridge.js list` → la conversación aparece **una sola vez**.
4. Abre `TAREAS.md:272`: T23 en 👀 (pasa a ✅ con tu «sí»).

---

## 2026-11-07 · T24 — Pruebas de red tolerantes a las rutas cortas de Windows

**Estado:** ✅ Completada
**Rama:** `fix/ci-rutas-cortas`
**Commit:** `test: compara rutas canonicalizadas para que el CI de Windows pase`
**Archivos:** `test/red.test.js`, `TAREAS.md`, `HISTORIAL.md`

### 1. ¿Qué he realizado?

El CI de `main` estaba **en rojo**: de 184 pruebas pasaban 181 y fallaban 3, solo en los tres trabajos de Windows. Las tres comparaban la ruta del workspace con `assert.equal`, y en el runner `%TEMP%` se llama `C:\Users\RUNNER~1\…` (nombre corto 8.3) mientras el programa devuelve la ruta larga real `C:\Users\runneradmin\…`. Ahora se comparan las dos canonicalizadas con `samePath`. Confirmado en GitHub: **PR #27 (run #21) y `main` (run #22) con los 7 trabajos en verde**.

### 2. ¿Por qué?

El programa estaba bien; el fallo era de las pruebas, que comparaban texto en vez de rutas. Confiar en que `os.tmpdir()` y la ruta real son idénticas funciona en un equipo normal y falla en un entorno con nombres cortos, que es exactamente lo que un CI tiene que detectar. Es la tercera vez que el CI encuentra algo que yo no veía en local, y por eso está ahí.

### 3. ¿Dónde verlo en el código?

- `test/red.test.js:13` — se importa `samePath` además de `canonicalize`.
- `test/red.test.js:249-253` — el aviso al recibir compara `canonicalize(red.workspace)`.
- `test/red.test.js:300-303` — carpeta elegida en el diálogo.
- `test/red.test.js:380-383` — carpeta espejo del emisor.

### 4. ¿Cómo comprobar que funciona?

1. En local: `npm test` → **184 / 0 fallos** (ya pasaba antes; el fallo solo aparece con nombres cortos).
2. En GitHub: al subir la rama, los **7 trabajos** deben salir en verde, incluidos los tres de Windows.
3. Si quieres ver la causa con tus ojos: en el log antiguo, `runneradmin` (lo que devuelve el programa) frente a `RUNNER~1` (lo que esperaba la prueba).
4. Abre `TAREAS.md`: T24 en 👀 hasta que el CI confirme.

---

## 2026-11-07 · T25 — El proyecto se llama como su carpeta

**Estado:** ✅ Completada
**Rama:** `fix/nombre-proyecto`
**Commit:** `fix: el workspace importado se registra con el nombre de su carpeta`
**Archivos:** `src/core/import.js`, `bin/dsh-bridge.js`, `test/import.test.js`, `TAREAS.md`, `HISTORIAL.md`

### 1. ¿Qué he realizado?

Al importar (por red o por ZIP), el proyecto se registraba con el **título de la conversación**, así que una carpeta `juego` con el chat «Probar app para pasar sesiones» aparecía en la barra lateral como «Probar app…». Ahora el proyecto toma el nombre de **su carpeta** (`meta.workspace.titulo`) y el título del chat se queda solo para los mensajes. Además: el ZIP sin `--workspace` ya no falla si la carpeta de origen no existe (la crea en `Documents\recibidas`), y la opción 4 del menú deja de pedir rutas a mano.

### 2. ¿Por qué?

El usuario lo dijo claro: «creo la carpeta y mete el chat, pero le pone el nombre del propio chat». Un proyecto tiene que llamarse como su carpeta: si no, cada conversación importada bautiza el proyecto y la barra lateral se llena de nombres de chat. Y en el menú, pedir una ruta a mano era justo lo que ya habíamos quitado en exportar e importar.

### 3. ¿Dónde verlo en el código?

- `src/core/import.js:231-241` — `tituloWorkspace` (carpeta) separado de `tituloConversacion`.
- `src/core/import.js:271` — `registrarSesion` con el título del workspace.
- `bin/dsh-bridge.js:143-162` — ZIP: crea `Documents\recibidas\<proyecto>` si la carpeta original no existe.
- `bin/dsh-bridge.js:520-526` — menú, opción 4, sin preguntar carpeta.
- `test/import.test.js:89-101` — el proyecto se registra como «juego».

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 185` / `fail 0`**.
2. Por red: manda una conversación que viva en `juego`. En el receptor, el proyecto debe llamarse **juego** (no como el chat) y la carpeta también `juego`.
3. Por ZIP con la carpeta de origen borrada: `! esa carpeta no existe en este equipo: se crea ...\Documents\recibidas\juego`.
4. Menú → opción 4: ya no pregunta ruta; sale el banner de recepción.
5. Abre `TAREAS.md`: T25 en 👀 hasta tu «sí».

---

## 2026-11-07 · T26 — Endurecimiento: ZIP bomba, DNS rebinding y fuerza bruta

**Estado:** ✅ Completada
**Rama:** `fix/nombre-proyecto` (misma que T25)
**Commit:** `fix: el workspace importado se registra con el nombre de su carpeta` (con la T25) y `fix: topes de ZIP, Host local y código de 8 dígitos`
**Archivos:** `src/core/zip.js`, `src/net/ui.js`, `src/net/servidor.js`, `src/net/cliente.js`, `src/net/cifrado.js`, `bin/dsh-bridge.js`, `src/cli/formato.js`, `test/zip.test.js`, `test/ui.test.js`, `test/servidor.test.js`, `test/red.test.js`, `test/cifrado.test.js`, `test/descubrir.test.js`, `CHANGELOG.md`, `README.md`, `docs/TAREAS.md`, `docs/HISTORIAL.md`

### 1. ¿Qué he realizado?

Revisión de seguridad completa y tres cierres: **tope de descompresión** al leer ZIP (por entrada y total, comprobado antes de inflar y con `maxOutputLength`), **validación de la cabecera `Host`** en la interfaz web (403 si no es `127.0.0.1`, `localhost` o `[::1]`) y **código de 8 dígitos** con `scrypt` más caro (N=2^15). Medido: la fuerza bruta offline pasa de **6,8 horas** a **57 días por núcleo**.

### 2. ¿Por qué?

El usuario preguntó si el proyecto es seguro. Lo que estaba bien, estaba bien (sin `eval`, sin `shell: true`, Zip Slip bloqueado, CRC y sha256 verificados, token y código de un solo uso), pero había tres huecos reales: un ZIP bomba podía tumbar el proceso, un dominio con DNS rebinding podía leer la API local, y un código de 6 dígitos con scrypt barato cae en horas si alguien captura el paquete en la red.

### 3. ¿Dónde verlo en el código?

- `src/core/zip.js:200-230` — topes antes de inflar y `maxOutputLength`.
- `src/net/ui.js:497-510` — `hostPermitido` y el 403.
- `src/net/cifrado.js:38-48` — scrypt N=2^15 con `maxmem`.
- `src/net/servidor.js:54-56` — `crearCodigo` de 8 dígitos.
- `test/zip.test.js`, `test/ui.test.js` — las tres pruebas nuevas.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 188` / `fail 0`**.
2. `serve` → el código que sale tiene **8 dígitos**; `send --codigo 123456` responde «el código son 8 dígitos».
3. Envío real con código de 8 dígitos: 2.530 eventos y 14 adjuntos, correcto.
4. `curl -H "Host: evil.com" http://127.0.0.1:8790/` → 403.

---

## 2026-11-12 · T27 — Importar un ZIP ya importado: reemplaza solo

**Estado:** 👀 Esperando tu OK
**Rama:** `fix/reimportar-zip`
**Commit:** `fix: importar reemplaza solo y avisa del firewall`
**Archivos:** `bin/dsh-bridge.js`, `src/core/import.js`, `test/integracion.test.js`, `docs/TAREAS.md`, `docs/HISTORIAL.md`

### 1. ¿Qué he realizado?

Importar un ZIP hace ya siempre lo mismo, sin banderas: si esa conversación **no está**, se instala; si **ya está**, se reemplaza por la del ZIP (que es la buena) y la anterior queda como `.bak-…`. Si la carpeta del proyecto no existe en este equipo, se crea en `Documents\recibidas\<nombre>`; si existe, se usa tal cual.

### 2. ¿Por qué?

El usuario tropezó con «usa --forzar» y no había dónde ponerlo. Lo que quiere —y lo que tiene sentido— es que importar sea un solo gesto: la copia que traes manda. Antes el reemplazo había que pedirlo, y el mensaje ni siquiera decía cómo; ahora es automático y reversible, porque el histórico anterior se conserva al lado.

### 3. ¿Dónde verlo en el código?

- `bin/dsh-bridge.js` (`comandoImport`) — `forzar: true` y mensaje «importada/actualizada».
- `bin/dsh-bridge.js` (`menuImportar`) — el mismo comportamiento desde el menú, sin preguntas.
- `src/core/import.js:208` — copia `.bak` y `reemplaza` en el resultado.
- `test/integracion.test.js` — reimportar dice «actualizada», deja `.bak` y no duplica.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 195` / `fail 0`**.
2. Importar un ZIP dos veces: la segunda dice **«✔ actualizada»**, avisa de la copia y sigue habiendo **una sola** conversación.
3. Si la carpeta del origen no existe: `! esa carpeta no existe en este equipo: se crea …\Documents\recibidas\<proyecto>`.
4. Ya no hace falta `--forzar` (se sigue aceptando, sin efecto).

---

## 2026-11-12 · T28 — Avisar cuando el firewall impide recibir

**Estado:** 👀 Esperando tu OK
**Rama:** `fix/reimportar-zip` (misma que T27)
**Commit:** `fix: reimportar un ZIP ya importado y avisar del firewall`
**Archivos:** `src/core/firewall.js`, `bin/dsh-bridge.js`, `test/firewall.test.js`, `docs/TAREAS.md`, `docs/HISTORIAL.md`

### 1. ¿Qué he realizado?

El usuario contó que del PC al portátil envía bien, pero del portátil al PC no, y que «buscar en la red» no encontraba nada. La causa estaba en el equipo que recibe: Windows tenía permiso de entrada para Node **solo en el perfil público** y para **otro** `node.exe` (el de `…\herd\bin\nvm\…`), no para `C:\Program Files\nodejs\node.exe`. Ahora `doctor` y el banner de `serve --red` lo detectan y enseñan el comando exacto (con el ejecutable real) para arreglarlo como administrador.

### 2. ¿Por qué?

El síntoma es de los que hacen perder una tarde: la salida funciona, la entrada no, y nada lo explica. La comprobación es de solo lectura y el arreglo va acotado a ese programa, esos puertos y el perfil privado, para no abrir la máquina de par en par.

### 3. ¿Dónde verlo en el código?

- `src/core/firewall.js:17-30` — `cubreAlgunPerfil` (puro).
- `src/core/firewall.js:40-90` — `estadoFirewall`: perfiles activos y reglas que permiten este ejecutable.
- `src/core/firewall.js:32-38` — `comandoSugerido`: las dos órdenes acotadas.
- `bin/dsh-bridge.js` (`comandoDoctor`) — línea `firewall : …` y aviso con las órdenes.
- `bin/dsh-bridge.js` (`comandoServe`) — mismo aviso en el banner con `--red`.
- `test/firewall.test.js` — 6 pruebas sin tocar el sistema.

### 4. ¿Cómo comprobar que funciona?

1. `npm test` → **`pass 195` / `fail 0`**.
2. `node bin/dsh-bridge.js doctor` → si el firewall no deja entrar, sale `firewall : ✖ NO permite recibir en red Private` y las dos órdenes.
3. `serve --red` → el mismo aviso en el banner, antes de quedarse esperando.
4. Tras ejecutar las órdenes como administrador y reiniciar `serve`, `doctor` debe decir `firewall : permite recibir`.

_(Fin del historial.)_
