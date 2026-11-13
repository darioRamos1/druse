# Plan de implementación · Lienzo visual de consultas y reportes

12 de noviembre de 2026 · Propuesta.

## 1. Qué se busca

Montar consultas y reportes **jugando con las tablas** en vez de escribir SQL:
arrastrar tablas a un lienzo, marcar columnas, unir columnas con una línea para
cruzarlas y soltar campos en estantes para agrupar, medir y filtrar, viendo el
resultado al momento.

El SQL manual **no desaparece**. Es una de tres vistas de la misma consulta:

| Vista | Para qué |
|---|---|
| **Lienzo** | Tablas como cajas, cruces como líneas, columnas que se marcan. |
| **Estantes** | Agrupar por, valores (SUM, COUNT…), filtros y orden, con vista previa en tabla o gráfico. |
| **SQL** | El editor de siempre, con el SQL que genera el lienzo o escrito a mano. |

Reglas de convivencia con el SQL:

- Lo que se cambia en el lienzo o en los estantes reescribe el SQL al instante.
- Un retoque a mano nunca se pisa en silencio. Mientras el SQL no se pueda
  llevar al lienzo, este queda en solo lectura con el aviso de siempre
  («SQL editado a mano») y dos salidas: **Seguir en SQL** o **Restablecer**
  (con confirmación, porque descarta el retoque).
- Las piezas que el lienzo no sabe dibujar se pueden meter como **SQL a mano
  dentro del lienzo**: una columna calculada o una condición escrita en SQL. Así
  no hay que abandonar el lienzo por una sola expresión.
- En Reportes BI se mantienen los tres modos de cada fuente: SQL, Visual y
  composición guardada.

## 2. Lo que ya existe y se reutiliza

| Pieza | Dónde | Uso |
|---|---|---|
| Estado del compositor (`CompositionState`: columnas, cruces, filtros, agrupación, cálculos, HAVING, orden, límite, `sqlOverride`) | `features/query-builder/query-builder/query-builder.ts` | Pasa a ser **el modelo único** que editan lienzo, estantes y formulario. |
| Generación de SQL por motor (`buildSelect`, `SelectSpec`, `QueryJoin`…) | `features/query-editor/sql-language/sql-writer.ts` | Sin cambios de fondo: el lienzo produce el mismo `SelectSpec`. |
| Búsqueda de rutas de cruce por claves foráneas | `features/query-builder/query-builder/join-path.ts` | Proponer el cruce al soltar una tabla relacionada. |
| Colocación de cajas y relaciones (`layoutDiagram`, `BOX`, `tableKey`) | `features/diagram/diagram-layout.ts` | Colocar las tablas del lienzo y dibujar las líneas. |
| Lienzo SVG con desplazamiento, arrastre de cajas y selección | `features/diagram/diagram-canvas/diagram-canvas.ts` | Base de interacción del lienzo de consulta. |
| Composiciones guardadas (almacén SQLite por conexión y tabla) | `SqliteCompositionStore`, `composed-queries.ts` | Se guardan igual, añadiendo las posiciones de las cajas. |
| Fuentes visuales de Reportes (`VisualSourceModel`, copia de la composición) | `features/reports/report-draft.ts` | El modo Visual deja de ser solo «elegir una composición» y abre el lienzo dentro de la fuente. |
| Gráficas e inspector de Reportes | `features/reports/report-chart`, `report-builder` | Vista previa de los estantes y paso Visualización con arrastre. |

`query-builder.ts` tiene unas 2.200 líneas y mezcla estado, reglas y
presentación. Antes de añadir otra vista hay que **sacar el modelo a un módulo
puro** (sin Angular) para que lienzo y formulario no dupliquen reglas.

## 3. Diseño

### 3.1 Modelo único

- Nuevo módulo `features/query-builder/query-model.ts` con el estado de un
  SELECT, sus operaciones (añadir tabla, cruzar, marcar columna, mover a un
  estante…) como funciones puras y la conversión a `SelectSpec`.
- El formulario actual y el lienzo llaman a esas operaciones. El SQL siempre se
  obtiene de `buildSelect(engine, toSpec(model))`.
- Se añade `layout` opcional: posición de cada caja en el lienzo. Las
  composiciones antiguas no la tienen y se colocan solas con `layoutDiagram`.
- Se añade una versión de formato al estado guardado. Las composiciones
  anteriores se leen sin migración: los campos que faltan toman su valor por
  defecto, como ya pasa con `distinct`.
- Piezas en SQL a mano dentro del modelo: `ExpressionColumn` (alias +
  expresión) y `RawCondition` (fragmento WHERE o HAVING). Se escriben
  entre paréntesis y se validan con el analizador del editor antes de
  ejecutar.

### 3.2 Lienzo

- Arrastrar una tabla desde el explorador o desde un buscador del propio lienzo
  la añade como caja. Si hay clave foránea con alguna tabla ya presente, se
  propone el cruce con una línea punteada que se acepta con un clic.
- Cada caja lista sus columnas con casilla, tipo e icono de clave. Buscador de
  columnas en tablas anchas y modo plegado, como en el diagrama.
- Arrastrar una columna sobre otra de otra caja crea el cruce. Pulsar la línea
  abre un menú pequeño: tipo (INNER, LEFT, RIGHT, FULL, CROSS), columnas y
  quitar cruce.
- La misma tabla dos veces recibe alias propio (`t1`, `t2`), visible en la caja.
- La tabla principal se marca y se puede cambiar. Un cruce que quede suelto al
  quitar una tabla se señala en rojo y no se genera SQL hasta resolverlo.
- Teclado: Tab recorre cajas, columnas y líneas. Espacio marca, Enter abre el
  menú de la línea y un menú «Cruzar con…» sustituye al arrastre.

### 3.3 Estantes

- Cuatro estantes: **Agrupar por**, **Valores**, **Filtros** y **Orden**. Se
  llenan arrastrando columnas desde las cajas o con el menú de cada columna.
- Una fecha soltada en «Agrupar por» ofrece día, mes, trimestre o año. Un
  número en «Valores» se suma por defecto y se cambia con un clic.
- Cada filtro es una pastilla que se edita en un desplegable con el mismo editor
  de valores (`ValueInput`) del formulario actual, incluido IN con lista o
  subconsulta.
- La vista previa usa el ajuste «Actualizar sola» del compositor y alterna
  entre tabla, barras, línea e indicador con las gráficas de Reportes.

### 3.4 De SQL al lienzo (fase posterior)

- Analizador propio del **subconjunto que el lienzo sabe dibujar**: SELECT con
  columnas, alias, JOIN con igualdades, WHERE con AND/OR y operadores del
  compositor, GROUP BY, agregados básicos, HAVING, ORDER BY y límite por motor.
  Se apoya en el troceado que ya hacen `sql-statements.ts` y `sql-context.ts`.
- Lo que no entiende (CTE, ventanas, UNION, subconsultas en FROM, funciones
  propias) no se pierde. Si es una expresión de columna o una condición, entra
  como pieza en SQL a mano. Si afecta a la forma de la consulta, el lienzo queda
  en solo lectura con el SQL como fuente de verdad.
- Prueba de ida y vuelta: para cada caso, `parse(buildSelect(m))` debe devolver
  un modelo equivalente a `m` en los seis motores.

### 3.5 Reportes BI

- En una fuente, **Visual** abre el lienzo dentro del constructor de Reportes.
  La fuente guarda su propia copia del modelo, como hoy guarda la copia de la
  composición.
- **Composición guardada** sigue disponible como punto de partida: copia la
  composición en el lienzo de la fuente.
- **Editar como SQL** sigue igual y conserva el modelo para poder volver.
- En el paso **Visualización**, las columnas del conjunto de datos se arrastran
  a los campos del inspector (eje, series, valores). Los selectores actuales se
  mantienen como alternativa de teclado.

### 3.6 Estilo

Tokens de `frontend/src/styles/_tokens.scss`, temas claro y oscuro y color de
acento. Cajas con borde fino, líneas con el color de acento, cruces sugeridos
punteados y estados con texto además de color. Movimiento reducido respetado en
las animaciones de arrastre. Revisión con el barrido de capturas E2E.

## 4. Fases y criterios de aceptación

Las fases 1 a 4 son entregas visibles y siguen el flujo de `AGENTS.md`:
versión *minor*, novedades en español e inglés, comprobaciones y commit. La
fase 0 no cambia nada a la vista: lleva su commit, sin versión ni novedades.

**Estado:** fase 0 hecha el 12 de noviembre de 2026. El modelo vive en
`frontend/src/app/features/query-builder/query-model.ts` con sus pruebas al
lado; las del compositor y las E2E que lo abren pasan sin cambios.

Fase 1 hecha el mismo día, en la versión 1.21.0, con el lienzo en
`frontend/src/app/features/query-builder/query-canvas/`. Cambios respecto a lo
previsto:

- La colocación es propia y no usa `layoutDiagram`: el diagrama identifica cada
  caja por su tabla, y aquí la misma tabla puede salir dos veces con alias
  distintos. Las cajas van por niveles, cada cruce a la derecha de su origen.
- El arrastre usa eventos de puntero y no el arrastre nativo del navegador,
  que Tauri intercepta en Windows para soltar archivos.
- Las tablas se añaden desde el propio lienzo (añadir tabla, llegar hasta,
  claves foráneas detectadas). Arrastrarlas desde el explorador queda pendiente.
- Las sugerencias por clave foránea son botones sobre el lienzo, no líneas
  punteadas: la tabla sugerida todavía no tiene caja a la que llegar.
- Las pestañas son Formulario y Lienzo; el SQL sigue a la vista en el panel de
  la derecha, como antes, en las dos.

Fase 2 hecha el mismo día, en la versión 1.22.0, con los estantes en
`frontend/src/app/features/query-builder/query-shelves/` y la vista previa en
gráfico en `preview-chart.ts`. Cambios respecto a lo previsto:

- Las columnas se llevan a los estantes cogiéndolas por el nombre; el círculo
  sigue siendo para cruzar. Al acercarse al borde, el panel se desplaza solo:
  los estantes quedan debajo del lienzo.
- Los filtros de los estantes son de la tabla principal, como los del
  formulario. Filtrar por una columna de otra tabla se hace con una condición
  en «SQL a mano», y el estante lo dice al soltarla.
- Las condiciones HAVING siguen en el formulario; los estantes avisan cuando
  la consulta las tiene.
- Las condiciones a mano son de WHERE. Las columnas calculadas pueden ser
  «sobre el grupo» (`SUM(a) / SUM(b)`); las demás se agrupan también.
- El formato guardado pasa a la versión 3.

Fase 3 hecha el mismo día, en la versión 1.23.0. Cambios respecto a lo
previsto:

- El lienzo de una fuente es el propio compositor, abierto encima del
  constructor de Reportes en modo «fuente»: solo SELECT, empieza en el lienzo
  y su botón es «Usar en la fuente». Así la fuente tiene cruces, estantes, SQL
  a mano y vista previa sin repetir nada.
- Componer necesita el catálogo y la sesión del explorador; las
  actualizaciones del reporte siguen con sus sesiones propias. Si la conexión
  no está abierta, «Leer las tablas de esta base» la abre, y «Volver a leer las
  tablas» recoge las que se crearon después de conectar.
- La fuente guarda su tabla principal por partes para reabrirse. Las fuentes
  anteriores la deducen de su nombre.
- En Visualización, las columnas del conjunto son pastillas que se arrastran a
  Categoría, Valor o Meta. La cifra y la meta solo aceptan números, y se dice
  al soltar otra cosa.

Fase 4 hecha el mismo día, en la versión 1.24.0, con el analizador en
`frontend/src/app/features/query-builder/sql-to-model.ts`. Con ella el plan
queda completo. Cambios respecto a lo previsto:

- Llevar el SQL al lienzo es un botón («Llevar al lienzo» o «al formulario»)
  que aparece cuando el SQL está retocado a mano, no algo que pase al escribir:
  convertir mientras se escribe reescribiría el texto bajo el cursor.
- El analizador no se apoya en `sql-statements.ts`: tiene su propio troceado,
  que entiende las comillas de los seis dialectos. Reconoce los periodos de
  fecha comparando con lo que escribe cada dialecto.
- Lo que queda a mano se reescribe con los alias del compositor (`t0`, `t1`…,
  o ninguno sin cruces): si no, un `c.nombre` dejaría de existir.
- Un número escrito entre comillas (`'05001'`) queda como condición a mano:
  pasarlo a filtro lo escribiría sin comillas y cambiaría la comparación.
- No se convierte, y se dice por qué: WITH, UNION/INTERSECT/EXCEPT, subconsultas
  en FROM o JOIN, otra tabla principal, cruces sin una igualdad entre dos
  columnas, OFFSET, órdenes que el modelo no representa, HAVING que no compara
  un cálculo del SELECT con un número y GROUP BY que no casa con el SELECT.

| Fase | Trabajo | Cómo se valida |
|---|---|---|
| 0. Modelo único | Sacar `query-model.ts` del compositor sin cambiar su comportamiento. Añadir `layout` y versión de formato. | Las pruebas actuales del compositor pasan sin tocarlas. Composiciones antiguas se abren igual. Pruebas del modelo: mismo SQL que antes en los seis motores. |
| 1. Lienzo de cruces | Vista Lienzo en el compositor: añadir tablas, marcar columnas, cruzar arrastrando, sugerencias por clave foránea, alias para tablas repetidas, teclado. Pestañas Lienzo / Formulario / SQL sobre el mismo modelo. | Montar en el lienzo ventas × municipios con LEFT JOIN y obtener el mismo SQL que con el formulario. Cambiar algo en el formulario se ve en el lienzo y al revés. E2E con ratón y con solo teclado. |
| 2. Estantes y vista previa | Agrupar, valores, filtros y orden por arrastre. Periodos de fecha. Vista previa en tabla y gráfico. Columnas calculadas y condiciones en SQL a mano. | El caso de validación de Reportes (ventas por municipio de enero) da 3 filas y 220 montado solo con el lienzo. Una expresión a mano se ejecuta y se conserva al guardar y reabrir. |
| 3. Lienzo en Reportes BI | Modo Visual de la fuente con el lienzo. Composición guardada como punto de partida. Arrastre al inspector de Visualización. | Un conjunto con una fuente en lienzo y otra en SQL se guarda, se reabre y se actualiza. Editar la composición original no cambia el reporte. |
| 4. De SQL al lienzo | Analizador del subconjunto, piezas a mano para lo que no entiende y solo lectura cuando cambia la forma. | Ida y vuelta en los seis motores. Un SQL con CTE queda en solo lectura sin perder nada. Un retoque de un filtro a mano aparece en su estante. |

## 5. Riesgos y decisiones abiertas

- **Tamaño del compositor.** La fase 0 es la que más riesgo tiene de romper
  algo. Se hace sola, sin funciones nuevas, y con las pruebas existentes como
  red.
- **Arrastre accesible.** Todo lo que se hace arrastrando tiene un camino de
  teclado y menú. Si un gesto no lo tiene, no se publica.
- **Esquemas grandes.** El lienzo solo carga las tablas añadidas. El buscador
  usa el índice del explorador y el límite de rutas de `join-path.ts`.
- **Analizador SQL.** Se prefiere uno propio y acotado a una librería genérica:
  solo hace falta el subconjunto que el lienzo dibuja, y los seis dialectos ya
  tienen sus reglas en `sql-dialects.ts`. Se revisa al empezar la fase 4.
- **INSERT, UPDATE y DELETE** siguen en el formulario. El lienzo es solo para
  SELECT.
