# Changelog

Todos los cambios que merecen mención. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado
[semántico](https://semver.org/lang/es/).

## [0.1.0] — 2026-11-07

Primera versión: exportar e importar conversaciones de DeepSeek Harness por consola y
menú. Sin dependencias: solo Node.js ≥ 22.15.

### Añadido

- **Exportar** una conversación a un ZIP portable con manifiesto (`meta.json`), el log,
  los adjuntos que la conversación cita y un `LEEME.txt`. Nombre previsible
  `dsh-sesion-<titulo>-<AAAAMMDD>.zip` y escritura atómica.
- **Importar** ese ZIP en otro equipo: valida el checksum del log, reescribe la ruta al
  workspace local, coloca el log en su carpeta, copia los adjuntos con dedupe y
  **registra el workspace** para que la app liste la conversación.
- **Menú interactivo** (`dsh-bridge` sin argumentos): exportar, importar, diagnóstico,
  y las entradas de red reservadas para la v0.2.
- **Comandos** `list`, `export`, `import`, `doctor`, con alias en castellano
  (`listar`, `exportar`, `importar`, `diagnostico`) y códigos de salida estables.
- **`doctor`**: comprueba la carpeta de datos, si la app está abierta, los tipos de
  evento del `app.asar`, el número de sesiones, que cada log esté en la carpeta que le
  toca, la validez del registro y los adjuntos citados que faltan.
- **Compatibilidad entre versiones**: lee del `app.asar` del destino la lista de tipos
  de evento que entiende y marca `ignorable: true` en los que no conoce, dejando
  constancia en el manifiesto.
- **Seguridad**: no escribe con DeepSeek Harness abierto (se perdería el registro),
  valida el registro antes de tocar nada, verifica el hash de cada adjunto antes de
  escribirlo, rechaza rutas peligrosas dentro de los ZIP y guarda copias
  `.bak-<fecha>` antes de reemplazar nada.
- **125 pruebas** con `node:test`, incluidas de integración con un `DSH_HOME` de mentira
  y la CLI lanzada como proceso aparte. Verdes en Windows (Node 26) y WSL (Node 24).
- Documentación: `README.md` (español e inglés) y `docs/FORMATO.md` con el formato v4
  del log, el registro `workspace` v2, la codificación de carpetas de sesión y los
  adjuntos.

### Corregido durante el desarrollo

- La recompresión del log perdía el salto de línea entre la cabecera y el primer
  evento: el log reescrito quedaba ilegible para la app.
- El lector de ZIP rechazaba los ZIP de Windows, que escriben los nombres con `\`.
- Bucle infinito al buscar el último título de una sesión si el JSON traía espacios.
- `path.basename` no es portable: una ruta de Windows leída en Linux daba el título del
  workspace como la ruta completa.
- Al importar se reconstruía el log desde el cuerpo sin adaptar, perdiendo las marcas
  `ignorable`.
- Al cortar la salida con un pipe (`| head`), la CLI terminaba con código 1 por `EPIPE`.

### Pendiente

- Transferencia directa por red local con código de un solo uso y cifrado (v0.2).
- Publicación en npm.

[0.1.0]: https://github.com/antoniorb1913/dsh-bridge/releases/tag/v0.1.0
