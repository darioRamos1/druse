# Plan — Mejoras visuales

> Sale de mirar la aplicación entera con Playwright: dieciocho capturas de las
> pantallas y los diálogos, en dos temas y a tres anchos, más lo que se puede
> medir sin ojos —desbordes, textos recortados, botones sin nombre—. Aquí está lo
> que se vio, por orden de lo que más molesta.

---

## 1. Cómo se repite el barrido

`e2e/tests/barrido.spec.ts`, que **no corre con la suite**: no afirma nada y tarda
casi un minuto. Se pide a mano:

```bash
cd e2e
DRUSE_BARRIDO=1 DRUSE_BARRIDO_DIR=../capturas npx playwright test tests/barrido.spec.ts
```

Recorre resultados, mensajes, historial, el error de una consulta, el menú del
árbol, la paleta, seis diálogos, el asistente de migrar, los dos temas y los
anchos 1440, 1024 y 900. Imprime al final los hallazgos medibles y los errores de
consola.

Lo que **no** hace, y por eso hay que mirar las capturas: juzgar contraste,
jerarquía o si algo «se lee raro».

---

## 2. Lo que ya se arregló

De la primera pasada (sesión 023o) salieron cuatro, ya cerradas: la franja que el
editor pega arriba dejaba pasar el texto de debajo; la barra del editor perdía
controles al estrechar; la barra superior empujaba fuera el tema y las
preferencias; y ningún diálogo se cerraba con Escape.

---

## 3. Hallazgos

### 3.1 Alta — La barra de resultados se pisa con sus pestañas

**Dónde:** panel de resultados, a 900 px de ancho.

Las pestañas «Resultados · Mensajes · Historial» y los controles de la derecha
—Filtros, Densidad, Exportar— comparten fila sin encoger ni envolver: «Historial»
queda cortado a media palabra debajo del botón de Filtros. Es el mismo mal que
tenían las dos barras de arriba, en la única fila que quedó sin revisar.

**Qué hacer:** envolver igual que la barra del editor, o esconder el texto de los
controles y dejar sus iconos por debajo de cierto ancho.

### 3.2 Alta — «~ filas» sin número

**Dónde:** asistente de respaldo, lista de tablas.

Las tablas cuyo catálogo no da estimación muestran «~ filas», con el hueco donde
iría el número. Se lee como un error de la aplicación, no como «no lo sé».

**Qué hacer:** cuando no hay estimación, no escribir nada —o «sin estimar»—, que
es lo que ya hace el progreso de los respaldos con las barras indeterminadas.

### 3.3 Media — Las pestañas del diseñador no filtran nada

**Dónde:** diseñador de tablas.

Hay pestañas —Columnas, Índices, Claves foráneas, Restricciones— y debajo se
apilan **todas** las secciones a la vez, cada una con su mensaje de vacío y su
botón a ancho completo. Las pestañas parecen decorativas y la pantalla se alarga
sin necesidad.

**Qué hacer:** que cada pestaña enseñe lo suyo. Y con ello, un solo botón
«Añadir…» por pestaña en lugar de cuatro apilados.

### 3.4 Media — El error de una consulta se cuenta dos veces

**Dónde:** al fallar una consulta.

El mismo texto aparece en una banda de aviso sobre el panel y otra vez en el
centro del panel, esta con el código del motor y el botón de copiar. La banda
roba alto y no añade nada.

**Qué hacer:** dejar el error donde tiene contexto —el panel— y reservar la banda
para lo que no cabe ahí: sesión perdida, transacción abierta, permiso denegado.

### 3.5 Media — Las celdas cortadas no lo dicen

**Dónde:** cuadrícula de resultados.

Un texto que no cabe se corta a mitad de palabra sin puntos suspensivos, así que
no se distingue de un valor que acaba ahí.

**Qué hacer:** `text-overflow: ellipsis` en la celda. Y, ya puestos, repartir el
ancho inicial de las columnas mirando una muestra de los valores: hoy una columna
de enteros se lleva el mismo ancho que un texto largo.

### 3.6 Baja — La paleta habla en inglés

**Dónde:** paleta de comandos.

Las etiquetas de tipo son `COMMAND` y `CONNECTION` en una interfaz que está en
español de arriba abajo.

**Qué hacer:** traducirlas —«comando», «conexión», «tabla»—.

### 3.7 Baja — La rejilla de motores queda 3 + 1

**Dónde:** diálogo de conexión.

Cuatro motores en una rejilla de tres columnas: tres arriba y uno solo abajo, con
el hueco a la derecha.

**Qué hacer:** dos por dos, o cuatro en una fila si el diálogo da el ancho.

### 3.8 Baja — Las listas con desplazamiento cortan la fila por la mitad

**Dónde:** paleta, historial, lista de tablas del respaldo.

La última fila visible queda partida por la mitad. No engaña a nadie, pero se ve
descuidado en tres sitios distintos.

**Qué hacer:** un degradado corto al pie de la lista, o desplazamiento por filas
enteras.

### 3.9 Baja — A 900 px la barra del editor ocupa tres filas

Envolver evita perder controles —que era el fallo—, pero a ese ancho la barra se
come una cuarta parte del editor.

**Qué hacer:** por debajo de cierto ancho, dejar los botones en icono con su
tooltip, como ya hace la barra superior con sus medias consultas.

---

## 4. Lo que se miró y está bien

- **El tema claro se aplica de verdad**: se comprobó midiendo los tokens
  —`--dr-surface-panel` resuelve a un gris casi blanco y el panel se pinta con
  él— antes de tocar nada. La primera impresión sobre una captura decía lo
  contrario.
- **La consola del navegador está limpia** en todo el recorrido.
- **Ningún botón se quedó sin nombre accesible**, ni siquiera los de solo icono.
- El historial, la paleta, el estado vacío del panel de resultados y el error con
  su código y su «Copiar error» se leen bien y dicen lo que hay que decir.
