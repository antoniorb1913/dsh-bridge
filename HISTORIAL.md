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

Dejé el proyecto en la carpeta del clon de GitHub y escribí los tres documentos de trabajo: `AGENTS.md` (de qué va, stack, estructura y reglas), `TAREAS.md` (20 tareas en 4 fases, con dependencias y rama propuesta) y `HISTORIAL.md` (formato de registro). Añadí también el esqueleto: `package.json`, licencia MIT, `.gitignore` y los cuatro borradores del núcleo (`zstd`, `zip`, `paths`, `sessions`).

### 2. ¿Por qué?

Sin tablero y registro, un proyecto largo se convierte en una sucesión de cambios sin orden: no se sabe qué está hecho, qué falta ni por qué se hizo cada cosa. Y las reglas que venían del otro proyecto estaban pensadas para una web: aquí el riesgo real es **escribir dentro del almacén de otra aplicación**, así que se reescribieron para este CLI (validar lo que llega, copia previa, escritura atómica, `--dry-run`, nunca subir conversaciones reales) y se renumeraron 1–5.

### 3. ¿Dónde verlo en el código?

- `AGENTS.md:1-22` — qué es y qué resuelve.
- `AGENTS.md:24-46` — stack (Node ≥ 22.15, cero dependencias, zstd nativo).
- `AGENTS.md:48-72` — estructura, con los borradores marcados.
- `AGENTS.md:74-217` — las cinco reglas; `AGENTS.md:169-178` el apartado de interfaz web (se activa en T18).
- `AGENTS.md:229-243` — cómo se prueba (unitario, integración, real); `AGENTS.md:245-253` — resumen del formato v4.
- `TAREAS.md:1-10` — leyenda de estados y dependencias; `TAREAS.md:11-23` — T1; `TAREAS.md:26-89` — fase 1.
- `HISTORIAL.md:1-32` — formato obligatorio de entrada.
- `package.json:1-40`, `LICENSE:1-21`, `.gitignore:1-9`.
- `src/core/zstd.js`, `src/core/zip.js`, `src/core/paths.js`, `src/core/sessions.js` — borradores sin tests (su tarea es T2–T5).

### 4. ¿Cómo comprobar que funciona?

1. Abre `D:\Users\MSI-PC\Desktop\dsh\dsh-bridge`: deben estar `AGENTS.md`, `TAREAS.md`, `HISTORIAL.md`, `package.json`, `LICENSE`, `README.md` y `src\core` con cuatro ficheros `.js`.
2. En una consola, en esa carpeta: `node -e "import('./src/core/zip.js').then(()=>console.log('ok'))"` → debe imprimir `ok` (los cuatro módulos cargan sin errores).
3. `Select-String -Path AGENTS.md -Pattern '^### REGLA'` → debe devolver **cinco** líneas (76, 100, 137, 180 y 192).
4. Abre `TAREAS.md`: T1 en ✅ Completada y de T2 a T20 en ⏳, cada una con su «Depende de».
5. Abre `AGENTS.md` y busca `REGLA 6`: no debe aparecer.
6. Esta entrada de `HISTORIAL.md` debe tener los cuatro apartados.

_(Sin más entradas todavía: la T2 se registrará aquí en cuanto respondas «sí» a su «¿Todo OK?».)_
