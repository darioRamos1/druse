# Plan — Mejoras visuales

> **Cerrado en la sesión 024, revalidado en la 026 y ampliado en la 027**: los
> diez hallazgos de §3 y los cuatro puntos del editor están hechos. La segunda
> pasada encontró dos reglas CSS incompletas; la tercera sustituyó un control
> nativo imposible de personalizar. Todo queda cubierto por pruebas de componente
> y de navegador. Se deja escrito entero —con lo que se vio y por qué se arregló
> así— para poder repetir el barrido y comparar.
>
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

En la sesión 026 se corrigió también el propio barrido: abre la paleta con
`Ctrl+K` desde Monaco —ya no por el botón— y no cuenta como texto recortado las
etiquetas de un píxel que la barra conserva solo para accesibilidad.

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

### 3.1 Alta — La barra de resultados se pisa con sus pestañas ✅

**Dónde:** panel de resultados, a 900 px de ancho.

Las pestañas «Resultados · Mensajes · Historial» y los controles de la derecha
—Filtros, Densidad, Exportar— comparten fila sin encoger ni envolver: «Historial»
queda cortado a media palabra debajo del botón de Filtros. Es el mismo mal que
tenían las dos barras de arriba, en la única fila que quedó sin revisar.

**Hecho.** Envuelve igual que la barra del editor: las pestañas no encogen y los
controles bajan a la fila siguiente cuando no caben. El desplazamiento interno se
queda para el caso extremo de muchos conjuntos de resultados.

### 3.2 Alta — «~ filas» sin número ✅

**Dónde:** asistente de respaldo, lista de tablas.

Las tablas cuyo catálogo no da estimación muestran «~ filas», con el hueco donde
iría el número. Se lee como un error de la aplicación, no como «no lo sé».

**Hecho.** El catálogo devuelve **nulo**, no ausente, y la comprobación solo
miraba `undefined`. Ahora no se escribe nada cuando no hay número.

### 3.3 Media — Las pestañas del diseñador no filtran nada ✅

**Dónde:** diseñador de tablas.

Hay pestañas —Columnas, Índices, Claves foráneas, Restricciones— y debajo se
apilan **todas** las secciones a la vez, cada una con su mensaje de vacío y su
botón a ancho completo. Las pestañas parecen decorativas y la pantalla se alarga
sin necesidad.

**Hecho.** No era que faltara la lógica: las secciones ya se ocultaban con
`[hidden]`, y **un `display` propio le ganaba** —el atributo solo vale
`display: none` en la hoja del navegador—. La primera corrección cubrió las tres
secciones `.rows`, pero dejó fuera `.columns`, que también declara
`display: flex`; la segunda pasada lo encontró y corrigió. Una prueba compara el
`display` calculado al cambiar de Columnas a Índices. Con eso, cada pestaña
enseña solo lo suyo y el diálogo pasó de 660 a 360 píxeles de alto.

### 3.4 Media — El error de una consulta se cuenta dos veces ✅

**Dónde:** al fallar una consulta.

El mismo texto aparece en una banda de aviso sobre el panel y otra vez en el
centro del panel, esta con el código del motor y el botón de copiar. La banda
roba alto y no añade nada.

**Hecho.** El error se queda donde tiene contexto: el panel, con el código del
motor y el botón de copiar, más la insignia en «Mensajes» y la palabra subrayada
en el editor. La banda se reserva para lo que no cabe ahí.

### 3.5 Media — Las celdas cortadas no lo dicen ✅

**Dónde:** cuadrícula de resultados.

Un texto que no cabe se corta a mitad de palabra sin puntos suspensivos, así que
no se distingue de un valor que acaba ahí.

**Hecho, y con él lo otro que faltaba.** El valor va en su propio elemento con
puntos suspensivos —sueltos en un contenedor flexible no se aplican— y lleva
`min-width: 0`: sin esto un hijo flex conserva el ancho de su contenido y el
padre lo recorta antes de que aparezca la elipsis. El ancho inicial ya **sale de
los valores**: se miran las primeras 60 filas y se cuenta el más largo, en vez de
repartir por tipo. Medir el texto pintado exigiría pintarlo antes, así que se
cuenta en caracteres por el avance medio del glifo —estimado tanto para Unicode
como para la cabecera en Inter—, con un suelo de 84 px y un tope de 320.
Comprobado en la aplicación: `id` pasó de 110 px a 84 y `descripcion` de 220 a
320.

### 3.6 Baja — La paleta habla en inglés ✅

**Dónde:** paleta de comandos.

Las etiquetas de tipo son `COMMAND` y `CONNECTION` en una interfaz que está en
español de arriba abajo.

**Hecho.** Traducidos todos los tipos visibles: comando, conexión, fragmento,
base, esquema, carpeta, tabla, vista, función, procedimiento y columna. Una
prueba impide que vuelvan a asomarse `command` o `connection`.

### 3.7 Baja — La rejilla de motores queda 3 + 1 ✅

**Dónde:** diálogo de conexión.

Cuatro motores en una rejilla de tres columnas: tres arriba y uno solo abajo, con
el hueco a la derecha.

**Hecho.** Dos por dos.

### 3.8 Baja — Las listas con desplazamiento cortan la fila por la mitad ✅

**Dónde:** paleta, historial, lista de tablas del respaldo.

**Hecho con un degradado corto al pie**, y no con desplazamiento por filas
enteras: las filas no miden lo mismo en los tres sitios —una entrada del
historial ocupa dos líneas y una de la paleta, una—, así que cuadrar la altura
habría exigido fijarla en cada uno.

La clase es global, `dr-scroll-fade` en `styles.scss`, y el degradado **solo
pinta mientras queda algo por debajo**: la máscara se anima con el propio
desplazamiento (`animation-timeline: scroll(self block)`), así que al llegar al
final se retira y la última fila se ve entera. Donde el navegador no soporte
líneas de tiempo de desplazamiento no se aplica nada y la lista queda como
estaba.

Playwright abre una lista que desborda, lee la máscara calculada, baja hasta el
final y afirma que cambia. Así se prueba el comportamiento del navegador y no
solo que exista la clase.

### 3.9 Baja — A 900 px la barra del editor ocupa tres filas ✅

Envolver evita perder controles —que era el fallo—, pero a ese ancho la barra se
comía una cuarta parte del editor.

**Hecho: por debajo de 780 px de barra, los botones se quedan en icono.** Lo que
decide no es el ancho de la ventana sino **el de la propia barra**
(`container: editor-toolbar / inline-size`), porque el editor vive a la derecha
de un sidebar que se arrastra: a igual ventana la barra puede tener 900 px o 500.

Las etiquetas se retiran de la vista pero **siguen en el árbol de
accesibilidad** —son el nombre del botón— y el `title` dice lo mismo a la vista.
Se fueron también los atajos escritos al lado, el nombre de la conexión en el
chip de contexto —queda la base, que es contra lo que se ejecuta—, y
«Iniciar transacción» estrenó icono propio para poder quedarse mudo.

Medido en la aplicación levantada a 900 px de ventana: la barra pasó de **73 px
a 42**, una sola fila, y a 1440 px sigue con todas sus etiquetas. Con una
transacción abierta —indicador, Commit y Rollback— vuelve a envolver a ese
ancho, y se deja así a propósito: son las dos palabras que no puede sustituir
ningún icono.

La regresión de Playwright mide que a 900 px la etiqueta queda recogida, la barra
no supera 44 px, Historial y Filtros no se solapan y el menú de filas recibe el
clic por encima de Monaco; al volver a 1440, la etiqueta recupera su ancho.

**Corrección de la sesión 028.** La primera prueba solo preguntaba si el menú era
visible. Playwright considera visible una caja aunque otro elemento la tape:
Monaco estaba en el nivel 6 y la barra en el 3, así que el menú existía pero el
editor interceptaba el clic. La barra quedó en el nivel 10 y la regresión ahora
pulsa una opción de conexión y afirma que el menú se cierra; eso prueba que está
realmente por encima.

### 3.10 Media — El selector de tipos no parecía parte de Druse ✅

**Dónde:** diseñador de tablas, al crear o modificar una columna.

El campo usaba un `datalist`. El input sí tenía los tokens de Druse, pero el menú
de sugerencias lo dibuja el navegador o el sistema operativo fuera del DOM: no
se pueden aplicar el fondo, borde, sombra, tipografía, hover ni selección de la
aplicación, y cambiaba de aspecto según el equipo.

**Hecho.** Se sustituyó por un combobox editable propio. Filtra los tipos que
declara cada motor, permite recorrerlos con flechas y aceptar con Enter, cierra
con Escape y expone `combobox`, `listbox` y `option` a accesibilidad. La lista es
solo una ayuda: siguen admitiéndose dominios, tipos parametrizados y cualquier
tipo escrito a mano, aunque no figure en el catálogo.

Playwright abre el diseñador real y comprueba que el menú tiene superficie,
borde y sombra calculados, filtra por `var` y conserva un tipo personalizado.

---

## 4. El editor

Lo que se ve al usarlo a diario, más allá de lo visual.

### 4.1 Ctrl+K no llegaba desde dentro del editor ✅

**Hecho.** Monaco se queda con esa combinación —la usa como principio de sus
propios acordes—, así que el atajo que anuncia la barra de arriba solo funcionaba
con el foco fuera del editor, que es donde menos tiempo se pasa. Ahora el editor
lo registra y avisa al shell.

Merece revisarse la misma pregunta con el resto de atajos globales que no estén ya
registrados en el editor.

### 4.2 Buscar y reemplazar no se anuncia ✅

**Hecho.** Monaco lo traía desde siempre con `Ctrl+F` y `Ctrl+H`, pero nada en la
interfaz lo decía. Ahora el editor expone `openFind`, y la paleta ofrece las dos
entradas con su atajo al lado; al elegirlas se cierra **sin devolver el foco al
editor**, porque lo quiere el buscador. Comprobado de punta a punta: sale el
widget con su segunda fila desplegada.

### 4.3 El autocompletado sí distingue alias — la sospecha era falsa ✅

**No había nada que arreglar.** Este hallazgo estaba mal escrito: el
autocompletado **sí** resuelve el alias contra el `FROM`/`JOIN` de la instrucción
en curso. Con `ciudad c` y escribiendo `c.` salen sus tres columnas.

La lista vacía que lo hizo parecer roto no venía del editor, sino de los datos:
la tabla `public.clientes` de la base de pruebas se había quedado **sin columnas**
por una prueba anterior, así que el catálogo no tenía nada que sugerir. Queda una
prueba de punta a punta que afirma el caso, para que no vuelva a dudarse.

**Corrección de la sesión 029.** Resolver alias funcionaba, pero cambiar la
conexión desde la barra dejaba otro problema: el índice filtraba por conexión y
no por la base activa, y las cargas diferidas omitían ambos datos. Además, el
switch podía terminar mientras el precalentado seguía en curso. El editor recibe
ahora solo `conexión + base` de la pestaña, las columnas y relaciones conservan
ese contexto y el switch espera la misma promesa de catálogo que inició al abrir
la conexión.

**Corrección definitiva de la sesión 030.** Al retomar un SQL, la tabla del alias
puede pertenecer a un esquema fuera de los 20 que se precargan. `e.` resolvía el
alias a `archivo.expedientes`, no encontraba esa relación en el índice y devolvía
vacío antes de pedir nada. Ahora usa el esquema que ya está escrito en el SQL:
carga sus tablas, relee el índice y después trae las columnas. Es el mismo camino
que antes solo se conseguía abriendo el esquema a mano.

### 4.4 Fragmentos guardados ✅

**Hecho, de punta a punta.** Se guardan en la base local —tabla `sql_snippets`,
esquema en la versión 5— y viven detrás de `/api/workspace/snippets`, de uno en
uno: son independientes entre sí, y guardar uno no puede tocar los demás.

Todo pasa por la paleta, sin diálogo nuevo:

- **Guardar** con «Guardar como fragmento». El nombre se pide **en el propio
  campo de búsqueda**, porque el usuario ya está escribiendo ahí; si lo deja
  vacío, lo pone la primera línea del SQL. Se guarda **lo mismo que ejecutaría
  «Ejecutar actual»**: la selección, o la instrucción donde esté el cursor.
- **Insertar**, eligiéndolo en la lista: entra donde esté el cursor y **por la
  pila de deshacer**, así que un fragmento largo pegado por error se quita con
  Ctrl+Z.
- **Borrar** con Shift+Supr, a la segunda: no hay deshacer, y una lista que se
  recorre con las flechas no puede borrar a la primera. El atajo solo se anuncia
  en el pie cuando hay un fragmento marcado.

Además salen en el **autocompletado del editor**, por delante de las plantillas
de fábrica: estos los guardó el usuario y se escriben buscando el nombre que él
mismo les puso.

No se atan a ninguna conexión: el mismo `SELECT` sirve en pruebas y en
producción, y atarlo a un perfil obligaría a decidir qué hacer con él cuando ese
perfil se borra.

La segunda pasada endureció las pruebas donde una carrera podía dar un verde
falso: el E2E espera las respuestas `PUT` y `DELETE`, guarda solo la instrucción
del cursor entre dos distintas, comprueba que Ctrl+Z deshace la inserción y que
el borrado sobrevive a recargar. Las pruebas de componente cubren el nombre
vacío, la propuesta desde la primera línea y que el fragmento sale antes que las
plantillas de fábrica en el autocompletado.

### 4.5 Fuera de alcance, dicho a propósito

El **plan de ejecución** está declarado fuera del MVP en la bitácora, y así sigue.

---

## 5. Lo que se miró y está bien

- **El tema claro se aplica de verdad**: se comprobó midiendo los tokens
  —`--dr-surface-panel` resuelve a un gris casi blanco y el panel se pinta con
  él— antes de tocar nada. La primera impresión sobre una captura decía lo
  contrario.
- **La consola del navegador está limpia** en todo el recorrido.
- **Ningún botón se quedó sin nombre accesible**, ni siquiera los de solo icono.
- El historial, la paleta, el estado vacío del panel de resultados y el error con
  su código y su «Copiar error» se leen bien y dicen lo que hay que decir.

---

## 6. Verificación final — sesión 026

- Frontend completo: **536 pruebas**, 40 archivos, todas en verde.
- Backend de almacenamiento y fragmentos: **15 pruebas de integración**, todas
  en verde.
- Playwright de los puntos reabiertos: **3 pruebas** en verde —fragmentos, barra
  estrecha y degradado al final del scroll—.
- Build de producción: correcto. Siguen los avisos conocidos del presupuesto del
  bundle (560,32 kB frente a 500 kB) y de `nearley` como dependencia no ESM.
- `git diff --check`: limpio; solo avisa de la normalización futura de CRLF a LF
  en una prueba ya modificada.

No se ejecutó en esta pasada la suite completa de punta a punta ni la de cuatro
motores: solo estaba levantado PostgreSQL. Eso no deja un punto visual sin
implementar, pero sí impide usar esta sesión como validación general de motores.

---

## 7. Ampliación — sesión 027

- Frontend completo: **538 pruebas**, todas en verde.
- Playwright del selector de tipos: **1 prueba** en verde contra PostgreSQL.
- Build de producción correcto. Siguen los avisos conocidos del presupuesto del
  bundle (564,62 kB frente a 500 kB) y de `nearley` como dependencia no ESM.
- `git diff --check`: sin errores; permanece el aviso informativo de CRLF a LF en
  `backup-dialog.spec.ts`.

---

## 8. Corrección — sesión 028

- Frontend completo: **538 pruebas**, todas en verde.
- Playwright reproduce primero la intercepción de Monaco y después completa el
  clic sobre una opción del menú de conexiones: **1 E2E en verde**.
- Build de producción correcto, con los dos avisos conocidos sin cambios.

---

## 9. Corrección — sesión 029

- El spec del store exige que `useConnection` termine con relaciones de la
  conexión destino y que el índice de Monaco contenga solo la base activa.
- Frontend completo: **538 pruebas**, todas en verde.
- Build de producción correcto, con los dos avisos conocidos sin cambios.

---

## 10. Corrección — sesión 030

- Una prueba reproduce un SQL restaurado con `FROM archivo.expedientes e`, sin
  relaciones precargadas, y exige que `e.` cargue esquema y columnas.
- Frontend completo: **539 pruebas**, todas en verde.
- Build de producción correcto, con los dos avisos conocidos sin cambios.
