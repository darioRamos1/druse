# Instrucciones para asistentes de IA

Lo lee cualquier asistente que trabaje en este repositorio (Claude Code, Codex,
Cursor, Copilot…). Las normas de estilo generales están en
[`CONTRIBUTING.md`](CONTRIBUTING.md): todo en español, comentarios que explican
por qué y mensajes de commit con ámbito.

## Al terminar una mejora o una función nueva

Cada cambio que alguien note al usar Druse —una función nueva, una mejora o un
arreglo visible— se cierra siempre con estos cuatro pasos. No hay que esperar a
que el usuario los pida.

### 1. Subir la versión

```powershell
./build/scripts/subir-version.ps1 -Parte minor   # función nueva
./build/scripts/subir-version.ps1 -Parte patch   # mejora o arreglo
```

El script cambia la versión en todos los sitios donde vive: backend, Tauri,
`Cargo.lock` y la documentación. **No la edites a mano** en un solo archivo.
Si avisa de que algún archivo no tenía la versión, revísalo.

Se sube **una vez por tarea**, no una por commit: si una tarea deja tres commits,
la versión se sube en el primero y los demás añaden líneas a la misma entrada.

### 2. Contarlo en las novedades

Druse enseña las novedades en Preferencias → Novedades, y abre esa pestaña sola
la primera vez que se arranca tras actualizar.

- En [`frontend/src/app/core/whats-new/release-notes.ts`](frontend/src/app/core/whats-new/release-notes.ts)
  añade una entrada **arriba del todo** con la versión nueva y la fecha de hoy.
  Si la tarea no subió la versión porque ya la subió un commit anterior de esa
  misma tarea, añade la línea a la entrada que ya está arriba.
- Cada línea es una clave `whatsNew.vX_Y_Z.<nombre>`, escrita entera (la guarda
  de idiomas busca el texto literal).
- El texto va en `frontend/src/i18n/es.json` **y** en `en.json`: una frase para
  quien usa Druse, que cuente qué puede hacer ahora. Nada de nombres de archivo
  ni de clases.

`package.ps1` se niega a empaquetar una versión que no tenga su entrada.

### 3. Comprobar

Desde `frontend/`:

```powershell
npx tsc -p tsconfig.app.json --noEmit
node ../build/scripts/check-i18n.mjs
npx ng test --watch=false --include='src/app/core/whats-new/**/*.spec.ts'
```

Y las pruebas de lo que se haya tocado. Si algo falla, se arregla antes del
commit; no se hace commit en rojo.

### 4. Hacer commit

- En la rama actual. Si es `main`, primero crea una rama `feat/...` o `fix/...`.
- Un mensaje que diga qué cambió en la aplicación, con ámbito:
  `feat(resultados): colores y letra de la cuadrícula a medida`.
- La versión, las novedades y el cambio van en el mismo commit, o en commits
  seguidos de la misma tarea.
- Añade solo los archivos de la tarea. Si ya había cambios ajenos sin commitear,
  déjalos fuera y avisa.
- No hagas `push` ni abras PR si no te lo piden.

## Qué no cuenta como novedad

Refactorizaciones sin efecto visible, pruebas, documentación interna, la
bitácora y actualizaciones de dependencias. Llevan su commit, pero no suben la
versión ni añaden novedades.
