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

_(Sin más entradas todavía: la T3 se registrará aquí en cuanto respondas «sí» a su «¿Todo OK?».)_
