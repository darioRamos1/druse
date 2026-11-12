# Bitácora de Reportes BI

## Tareas del hito 1

- [x] Leer filas tipadas desde SQL Server y PostgreSQL y cruzarlas por una clave compuesta.
- [x] Guardar el último resultado válido en SQLite y comprobar que un intento fallido lo conserve.
- [x] Medir tiempo y memoria con datos ficticios cerca del límite de filas.
- [x] Acotar el tamaño en bytes y reducir las asignaciones al reabrir resultados anchos.
- [x] Ejecutar el escenario con los dos motores reales.

## Tareas del hito 2

- [x] Guardar y reabrir definiciones de conjuntos (una o dos fuentes por perfil, modo SQL o visual, unión) con versión.
- [x] Unión 1:N con aviso de métricas repetidas y ejemplos de claves duplicadas.
- [x] Vista previa con diagnósticos por fuente, cambios de esquema y muestra marcada.
- [x] API local y contrato OpenAPI.
- [x] Constructor en Angular: Fuentes, Combinar y vista previa, con el compositor para el modo visual.
- [ ] Captura del constructor para la landing.

## Tareas del hito 3

- [x] «Actualizar ahora»: lee, cruza y guarda el resultado; un intento fallido conserva el anterior.
- [x] Historial acotado de intentos (20 por conjunto) con diagnóstico por fuente.
- [x] Resultado legible sin conexión y aviso de definición anterior.
- [x] Reportes guardados: tabla, barras, línea e indicador con meta.
- [ ] Captura del tablero para la landing (hito 4, con los tableros).

## Tareas del hito 4

- [x] 4.1 Tableros: cuadrícula de paneles con reportes de distintos conjuntos, ordenar y redimensionar con botones y teclado.
- [x] 4.1 Filtros compartidos de fecha y categoría, vinculados por conjunto, aplicados sobre los datos guardados.
- [x] 4.2 Personalización: colores, formato de números, umbrales, estilo de panel, varias páginas y filtrar al pulsar.
- [x] 4.3 Plantillas: guardar, aplicar a otro conjunto con asignación de campos, exportar e importar.
- [ ] 4.4 Exportación a Excel, PDF y CSV con los filtros activos.

Los hitos siguientes cubren el constructor SQL y visual, los reportes guardados, los tableros y plantillas, y la actualización programada. La evidencia para la landing se prepara conforme se valida cada hito.

## 2026-11-11 · Inicio del hito 1

- **Plan de referencia:** [plan-reportes-bi-druse.md](../planes/plan-reportes-bi-druse.md).
- **Estado:** prototipo interno de lectura y cruce. Hito 1 en curso.

### Qué se hizo

- `ReportQueryService` abre y cierra una sesión dedicada por fuente con un límite inicial de 20.000 filas y 60 segundos por consulta. Los lectores de SQL Server y PostgreSQL exponen los valores tipados a BI. La cuadrícula y los exportadores siguen usando los valores formateados.
- `ReportJoin` combina dos fuentes mediante una unión interna o izquierda 1:1 por una o varias columnas. Cuenta las filas sin coincidencia y rechaza datos truncados, claves duplicadas y tipos incompatibles.
- El escenario de prueba reúne ventas de SQL Server y metas de PostgreSQL por mes y municipio con datos ficticios. Enero debe sumar 220 en ventas y alcanzar 60 % entre los municipios con meta.

### Comprobaciones

- La aplicación y los proveedores compilados para el host de Comunidad pasan la compilación. Los cinco casos de `ReportJoinTests` pasaron en un proyecto aislado que ejecutó las mismas comprobaciones. Cubren fechas, importes, ceros iniciales, nulos, duplicados, truncado y los totales del ejemplo.
- `CrossEngineReportTests` compiló con el host de Comunidad. La comprobación con los dos servidores sigue pendiente porque Docker Desktop no expuso el motor de contenedores en esta sesión.
- El proyecto unitario completo encontró un fallo del host de tareas de MSBuild al cargar IKVM para Informix (MSB4216).
- VSTest agotó el tiempo de conexión con `testhost` en esta sesión. Los cinco casos locales se comprobaron invocando sus métodos y aserciones desde el proyecto aislado.
- Los cambios quedaron en el árbol de trabajo. Git devolvió permiso denegado al crear `.git/index.lock`.

## 2026-11-11 · Guardado local y medición

- `SqliteReportSnapshotStore` conserva un resultado por conjunto y lo reemplaza de forma atómica cuando llega una captura válida más reciente. Se comprobó el ciclo de escritura y reapertura de fechas, decimales, códigos con ceros iniciales y filas sin coincidencia.
- Pasaron ocho casos en el ejecutor aislado. La prueba de integración que incluye el guardado compiló con el host de Comunidad.
- Docker Desktop está iniciado. La sesión devolvió permiso denegado al acceder a las API de Docker y al abrir sockets de loopback hacia los puertos 55440 y 14433. La prueba con servidores reales sigue pendiente.

### Medición local

Dos fuentes ya materializadas en memoria, con 20.000 filas cada una y un cruce 1:1 por código. El caso ancho añadió 10 columnas de texto de 48 caracteres por fuente. Se midieron tiempos y bytes asignados por .NET durante cada operación en una ejecución de desarrollo en Windows. Las asignaciones son acumuladas durante cada operación. La lectura de los motores y el consumo máximo de memoria del proceso quedan por medir.

| Columnas del resultado | Cruce | Guardado | Reapertura | Datos serializados |
|---|---:|---:|---:|---:|
| 4 | 23,5 ms · 7,33 MiB | 36,6 ms · 3,18 MiB | 87,8 ms · 20,46 MiB | 0,57 MiB |
| 24 | 33,7 ms · 10,38 MiB | 409,6 ms · 84,64 MiB | 804,9 ms · 204,89 MiB | 20,03 MiB |

## 2026-11-11 · Límites y reapertura de resultados

- Cada lectura tipada conserva hasta 32 MiB estimados de filas. Los drivers pueden materializar una celda antes de entregarla. Si la lectura llega al límite, marca el resultado como truncado y el cruce conserva la captura anterior.
- El guardado limita el contenido serializado a 32 MiB antes de escribirlo en SQLite. La reapertura usa un solo documento JSON y reconstruye los valores según el tipo de cada columna, con el formato de captura existente.
- Pasaron las diez comprobaciones locales, incluidas las dos nuevas para el truncado de una fuente ancha y el rechazo de una captura demasiado grande sin sustituir la anterior.
- Al repetir la medición local con 24 columnas, la reapertura tomó 289,4 ms y asignó 112,54 MiB acumulados, frente a 804,9 ms y 204,89 MiB en la medición inicial. El guardado con el límite activo tomó 646,8 ms y asignó 78,28 MiB, frente a 409,6 ms y 84,64 MiB. Son muestras individuales y excluyen el tiempo de lectura desde los motores.
- La prueba con SQL Server y PostgreSQL reales se aplaza por indicación del usuario.

## 2026-11-11 · Cierre del hito 1

- El plan quedó guardado en `docs/planes/plan-reportes-bi-druse.md` y enlazado desde el índice de documentación.
- Los diez casos de `ReportJoinTests` y `ReportSnapshotStoreTests` pasaron con `dotnet test` normal, sin el ejecutor aislado.
- Con `test-db.ps1` se levantaron PostgreSQL 18 y SQL Server 2022 desechables. `CrossEngineReportTests` se ejecutó (no se omitió) y pasó en 4 s: tres filas, 220 en ventas, el municipio 11001 sin meta, `05001` como texto, `mes` como `DateOnly` y 60 % de cumplimiento.
- Con esto se cumple el criterio del hito 1: totales esperados, ceros iniciales, duplicado detectado y fuente truncada rechazada.

## 2026-11-11 · Hito 2: definiciones y vista previa en el backend

### Qué se hizo

- `ReportDataset` describe un conjunto: una o dos fuentes con alias, perfil guardado, base, modo SQL o visual, SQL a ejecutar, copia del estado del compositor y columnas esperadas, más la unión. `ReportDatasetValidator` exige unión con dos fuentes, alias distintos y estado del compositor en las fuentes visuales.
- `SqliteReportDatasetStore` guarda las definiciones en `reports.db`, junto a los resultados. La versión la pone el almacén y solo sube si cambian las fuentes o la unión, no al renombrar. Borrar un conjunto borra también su resultado guardado. `ReportsDatabase` crea las dos tablas en un solo sitio.
- `ReportJoin` admite la cardinalidad `ManyToOne`: la izquierda puede repetir la clave y la derecha es el lado «uno». Las columnas numéricas de la derecha que se repiten salen en `RepeatedColumns` para pedir una agregación antes de sumarlas. Las claves duplicadas lanzan `ReportJoinDuplicateKeysException` con hasta tres ejemplos, con las fechas en ISO.
- `ReportDatasetPreviewService` resuelve las credenciales con el llavero, como al abrir una conexión guardada. Lee cada fuente por separado y devuelve diagnósticos con clave (`connection-missing`, `password-missing`, `ssh-secret-missing`, `engine-unsupported`, `invalid-query`, `database-error`), cambios de esquema frente a la última lectura y hasta 100 filas de muestra. Un fallo de una fuente no oculta el diagnóstico de la otra. Si una fuente se trunca, el cruce se calcula igual pero queda marcado como muestra.
- La API expone `GET/PUT/DELETE /api/reports/datasets/{id}`, `GET /api/reports/datasets` y `POST /api/reports/datasets/preview`. El contrato está en `docs/api/openapi.json`.

### Comprobaciones

- 17 casos unitarios de reportes y la batería unitaria completa (733 superadas, 0 con error).
- Con `DRUSE_REQUIRE_ENGINES=1`, ocho pruebas de integración contra SQL Server 2022 y PostgreSQL 18, sin omitidas. Una fuente visual y otra SQL preparan el mismo cruce que dos SQL (3 filas, 2 con meta, 220 en ventas). Una meta duplicada detiene la unión y muestra `2026-01-01 · 05001`. La prueba encontró que la fecha salía como `01/01/2026` y se corrigió.

## 2026-11-11 · Hito 2: constructor en Druse (versión 1.12.0)

### Qué se hizo

- **Reportes** en la barra superior y «Abrir Reportes BI» en la paleta abren el constructor. A la izquierda están los pasos (Fuentes, Combinar y Visualización, esta última «Próximamente») y los conjuntos guardados. En el centro va la vista previa, con pestañas por fuente y para el resultado combinado. A la derecha, un inspector plegable que pasa a panel superpuesto por debajo de 1.100 px.
- Cada fuente elige una conexión **guardada** y una base. Las bases se listan con `GET /api/reports/connections/{id}/databases`, que usa la contraseña del llavero. El modo SQL es una consulta escrita a mano. El modo visual copia una composición guardada de esa base: su SQL y su estado. Para eso, `GET /api/workspace/compositions` acepta ahora la consulta sin tabla. «Copiar a SQL editable» conserva la composición, y volver al modo visual pide confirmación si el SQL se editó a mano.
- Combinar propone como claves las columnas que se llaman igual y tienen el mismo tipo. Permite elegir el tipo de unión y la cardinalidad (1:1 o 1:N). La vista previa resume filas, coincidencias y filas sin pareja. También marca las cifras que se repetirían, enseña las claves duplicadas y usa el alias de cada fuente en las columnas.
- Al guardar, las columnas de la última vista previa vigente pasan a ser las columnas esperadas. Hay avisos de vista previa desactualizada, de muestra truncada y de cambio de esquema. Antes de descartar cambios o borrar, se pide confirmación en línea.
- La e2e encontró un círculo sin salida: con dos fuentes, la vista previa exigía la unión, pero las columnas de la unión salen de la vista previa. Ahora la vista previa lee las fuentes por separado mientras no hay unión, y guardar la sigue exigiendo.

### Comprobaciones

- Frontend: 13 casos en `features/reports`, tsc, `check-i18n` y las pruebas de shell, paleta, gateway, novedades e i18n (240 casos).
- Backend: 12 de integración con los motores exigidos y 17 unitarias de reportes.
- e2e `reportes.spec.ts` con Druse levantado y PostgreSQL de pruebas: dos fuentes, claves propuestas, cruce de 3 filas con 2 coincidencias, guardado como versión 1 y borrado. En Linux sin llavero comprueba el diagnóstico de contraseña.
- Barrido: capturas `21-reportes-*` (vacío, una fuente, combinar y descartar). Sin hallazgos nuevos y con la consola limpia.

## 2026-11-11 · Hito 3: reportes guardados (versión 1.13.0)

### Qué se hizo

- `ReportRefreshService` lee las fuentes con las mismas reglas que la vista previa, las cruza y publica el resultado en `reports.db`. Una fuente caída o truncada, unas claves duplicadas, un resultado de más de 32 MiB o uno más viejo que el guardado dejan el resultado anterior intacto. `ReportRunGate` impide dos actualizaciones a la vez del mismo conjunto (409).
- Cada intento queda en `report_runs` con su estado, su mensaje, las claves repetidas y el diagnóstico de cada fuente. Se conservan los 20 más recientes por conjunto. La ventana de captura va de la primera lectura a la última.
- `GET /snapshot` solo lee `reports.db`: se abre con las bases apagadas y avisa si el resultado es de una versión anterior de la definición. Los reportes viven en `saved_reports`, con sus ajustes en JSON. Borrar un conjunto borra su resultado, sus intentos y sus reportes.
- En Druse, el paso **Visualización** se habilita al guardar el conjunto. Arriba aparecen «Datos del…», la ventana de lectura y **Actualizar ahora**. Debajo, el último intento fallido con sus motivos y los avisos de definición sin guardar o anterior. Los reportes van en pestañas y se configuran en el inspector: tipo, agrupar por, cálculo (suma, contar filas, promedio, mínimo, máximo), cifra, meta y orden.
- Los gráficos son SVG propio con los tokens del tema. Las barras y la línea llevan los valores escritos y una tabla equivalente a un clic. El indicador con meta calcula el cumplimiento solo con las filas que la tienen: 60 % en el escenario. Cuenta aparte las filas sin meta y no inventa un porcentaje si la meta es cero. También avisa si se suma una cifra repetida del lado «uno». La librería de gráficos se elige en el hito 4, cuando haya que exportar.
- Los controles comunes del constructor y de Visualización pasaron a `features/reports/_report-controls.scss`.

### Comprobaciones

- Integración con los motores exigidos, 17 casos. El escenario de aceptación:
  - actualizar y leer el resultado tras borrar las dos conexiones;
  - fallar sin ellas y conservar el resultado;
  - reconectar, cambiar la meta en PostgreSQL y ver el cambio;
  - borrar la tabla y conservar 150;
  - comprobar los cuatro intentos en orden.
- Unitarias: 18 de reportes, incluida la poda del historial. La batería completa (733) pasó antes de añadir esa prueba.
- Frontend: 98 casos en reportes, novedades, i18n y gateway, además de tsc y `check-i18n`. El cálculo de los gráficos tiene pruebas propias: 60 %, meta cero, orden cronológico y columnas que faltan.

### Revisión visual con Playwright

- El barrido fotografía ahora Reportes también en tema claro (`21f`–`21h`: indicador, barras y combinar) y a 1.024 y 900 px (`21i`–`21k`), con el conjunto reabierto desde `reports.db`. En claro, el contraste y los estados se leen bien.
- A 1.024 y 900 px salieron dos fallos y quedaron corregidos:
  - El inspector superpuesto se abría solo y tapaba «Actualizar ahora». Ahora, por debajo de 1.100 px, empieza cerrado y se abre con su botón.
  - A 900 px la barra compacta ocultaba el botón **Reportes**, y solo quedaba la paleta para llegar. Ahora se queda como icono, con su nombre accesible.
- El barrido y la e2e usan un nombre propio para su conjunto y el barrido borra los suyos al final, también los que dejara una ejecución cortada. La consola sale limpia; `medir` solo marca la ventana de detrás, como ya hacía en esos anchos.

## 2026-11-11 · Hito 4.1: tableros y filtros compartidos (versión 1.14.0)

El hito 4 se divide en cuatro entregas (tableros, personalización, plantillas y exportación) para probar y revisar cada una con Playwright antes de seguir.

### Qué se hizo

- Backend: tabla `report_dashboards` en `reports.db` y `GET/PUT/DELETE /api/reports/dashboards`. El modelo es JSON propiedad de la interfaz: páginas, paneles y filtros. También se añadió `GET /api/reports/reports` para elegir reportes de cualquier conjunto.
- `report-dashboard-model.ts`: cuadrícula de 12 columnas (paneles de 3 a 12 de ancho y de 2 a 8 filas de alto), mover, redimensionar y retitular, y lectura defensiva del JSON guardado. Los filtros de fecha y categoría se vinculan a una columna **por conjunto**. Se aplican sobre las filas guardadas, sin volver a consultar. Un conjunto sin columna vinculada no se filtra y su panel lo dice. Se propone la columna que se llama como las ya vinculadas.
- En Druse, Reportes tiene una lista de **Tableros**:
  - En modo vista: filtros arriba, «Actualizar todo» (actualiza cada conjunto usado y dice cuáles fallaron) y los paneles con «Datos del…» de su conjunto.
  - En **Editar diseño**: el inspector añade reportes, retitula el panel seleccionado y crea y vincula filtros. Cada panel lleva botones para mover y cambiar el tamaño. Alt + flechas mueve y Mayús + flechas redimensiona.
  - Por debajo de 900 px los paneles se apilan a lo ancho.
- Los gráficos se siguen dibujando con SVG propio; `ReportChart` tiene un modo `fit` para llenar el panel. La librería se decidirá en la entrega de exportación.

### Comprobaciones y lo que encontró Playwright

- Pruebas: 7 del modelo del tablero (incluido el segundo mes del plan) y 7 del componente, 595 del frontend afectado, 18 de integración y la e2e de Reportes ampliada con un tablero, el filtro de mes y su borrado.
- La revisión con el barrido (oscuro, edición, claro y 900 px) encontró tres fallos, ya corregidos:
  - **Borrar un tablero recién creado no llegaba al servidor.** El componente seguía viendo la entrada sin guardar y volvía a aparecer al reabrir. Ahora recuerda que está guardado, y la e2e comprueba que no vuelve.
  - **En estrecho, «Editar diseño» no enseñaba el inspector**, que empieza cerrado ahí. Editar un tablero lo abre.
  - **En edición, los botones del panel tapaban el título.** Pasan a su propia línea si no caben.
- El barrido borra al empezar los restos de ejecuciones cortadas, para que no salgan en las capturas.

## 2026-11-11 · Hito 4.2: personalización (versión 1.15.0)

### Qué se hizo

- **Paleta validada, no elegida a ojo.** Ocho tonos categóricos en orden fijo, validados con el script de la guía de visualización contra las superficies reales de los paneles (#e6eaf3 claro, #272c3a oscuro). Pasan banda de luminosidad, croma, separación con daltonismo (peor par 9,1 en claro y 8,4 en oscuro) y visión normal. Algunos tonos quedan por debajo de 3:1 de contraste, así que siempre hay alivio: categoría en el eje, valores escritos o tabla. Viven en `_report-palette.scss`, por tema.
- **Apariencia del reporte** (en sus ajustes): color o heredado, un color por categoría, valores escritos, decimales, prefijo y sufijo, cifras compactas, y umbrales del indicador («En meta», «Cerca», «Por debajo»). Los umbrales se miden en porcentaje de cumplimiento si hay meta y sobre la cifra si no. El estado lleva icono y texto con la paleta de estados.
  - El color sigue a la categoría: se reparte sobre el resultado sin filtrar, y filtrar no repinta.
  - Con más de 8 categorías no se inventan ni se repiten tonos.
- **Gráficos**: barras con el extremo de datos redondeado y la base recta, líneas de 2 px, puntos con anillo, tooltip propio (ratón y foco) con texto en tinta del tema, y valores y ticks con el formato del reporte.
- **Tablero**:
  - Color base del tablero, y por panel descripción, encabezado oculto (sigue nombrado para lectores de pantalla) y color propio.
  - El color se hereda panel → reporte → tablero → tema, y el inspector dice de dónde viene y permite volver a lo heredado.
  - Varias páginas: añadir, renombrar, quitar (los paneles pasan a la primera) y mover paneles entre páginas. Los filtros son de todo el tablero.
  - «Ver como tabla» en cada panel de barras o línea.
- **Filtrar al pulsar una barra**: si hay un filtro de categoría vinculado a la categoría del reporte, pulsar una barra (o Intro y Espacio con el foco) la elige y todo el tablero se filtra. Pulsarla otra vez lo quita, y las demás barras se apagan sin cambiar de color.

### Comprobaciones y lo que encontró Playwright

- Pruebas: 54 de Reportes en el frontend (colores estables con filtro, más de 8 categorías, estados del indicador, formato, páginas, herencia de color, pulsar barras), 554 de core y layout, `check-i18n` y la e2e de Reportes.
- El barrido añade capturas de umbrales (`21l`), apariencia (`21m`), barra pulsada (`22e`), estilo y herencia (`22f`) y segunda página (`22g`). Encontró un fallo real, ya corregido: **la descripción escrita justo después de cambiar de panel iba al panel anterior**. El inspector editaba el panel de su bloque de plantilla, que solo se pone al día al repintar. Ahora edita el panel seleccionado en ese momento. La prueba que lo reproduce (escribir sin repintar tras el clic) falla sin el arreglo y pasa con él.
- También se corrigió una carrera de la propia prueba: el nombre propuesto «Reporte 2» llegaba después de que Playwright empezara a escribir.

## 2026-11-11 · Hito 4.3: plantillas (versión 1.16.0)

### Qué se hizo

- **Formato.** Una plantilla es diseño sin datos (`report-template-model.ts`, formato `druse.report-template`, versión 1):
  - Lleva los reportes con su apariencia, y en paneles y tableros también páginas, paneles, filtros y estilo.
  - Las columnas pasan a ser **campos lógicos** con nombre base, tipo (número, fecha, texto, sí/no) y si son obligatorios. Son obligatorios la categoría y la cifra; la meta, las columnas de tabla y los filtros son opcionales.
  - Un tablero que mezcla conjuntos tiene un **hueco por conjunto**, y cada hueco se rellena con un conjunto propio al aplicarla.
  - No lleva SQL, conexiones, bases ni filas.
- **Backend.** Tabla `report_templates` en `reports.db` y `GET/PUT/DELETE /api/reports/templates`. `ReportTemplateRules` exige nombre, ámbito (`Report`, `Panel` o `Dashboard`), JSON de objeto y como mucho 512 KiB. También rechaza, a cualquier profundidad, propiedades como `sql`, `connectionId`, `password`, `database` o `rows`, aunque la plantilla llegue de un archivo editado a mano.
- **Guardar como plantilla:**
  - el tablero entero, desde su barra;
  - el panel elegido, desde el inspector en edición;
  - un reporte, desde el inspector de Visualización.
  
  Se captura lo que se ve, con los cambios sin guardar.
- **Usar una plantilla** abre una galería superpuesta:
  - Lista los diseños guardados y un diseño inicial, «Seguimiento de una cifra»: indicador con meta, barras, línea y detalle, con filtros de fecha y categoría.
  - Al aplicarla, se elige el conjunto de cada hueco y se revisa la columna de cada campo. Se propone primero por nombre y tipo, y después la primera columna libre del tipo: `monto_total` para «venta» y `region` para «municipio».
  - Un campo obligatorio sin columna, o un conjunto sin datos guardados, impide crear la copia y lo dice.
  - La copia es independiente: reportes nuevos con ids nuevos, numerados si el nombre ya existe en ese conjunto.
  - Desde Tableros crea un tablero nuevo. En un tablero en edición añade paneles. En Visualización añade reportes al conjunto abierto.
- **Exportar e importar.** Exportar guarda `<nombre>.druse-plantilla.json` (diálogo del sistema en el escritorio y descarga en el navegador). Importar valida formato, versión, tamaño, ámbito, tipos de panel y que cada referencia exista, y enseña una vista previa antes de guardarla con id nuevo.

### Comprobaciones y lo que encontró Playwright

- **Pruebas:**
  - Backend: 10 unitarias de reglas y almacén, 6 de integración de la API y el contrato OpenAPI regenerado. La batería unitaria completa pasa (744).
  - Frontend: 11 del modelo (incluido el criterio del plan: un tablero de ventas con sus colores, dos páginas y filtros, aplicado a otra fuente con otros nombres de columna), 6 de la galería y 2 del tablero. Además, 143 de Reportes, novedades, gateway e i18n.
- **e2e nueva en `reportes.spec.ts`.** Guarda un tablero como plantilla y la exporta. Comprueba que el archivo no lleva SQL ni conexiones. Después la borra, la importa y la aplica a un conjunto de pedidos con otros nombres. La copia se dibuja con sus datos y su filtro de categoría funciona.
- **Barrido.** Capturas `23`–`23h`: guardar, galería, vincular, tablero desde plantilla y guardar un reporte, en oscuro, claro y a 900 px. La consola sale limpia.
- **Fallos encontrados y corregidos:**
  - **Escape cerraba todo Reportes.** Al borrar una plantilla o cambiar de paso desaparecía el botón con el foco, y el siguiente Escape lo recibía el constructor. Ahora la galería escucha el teclado en fase de captura mientras está abierta, devuelve el foco a la hoja y tiene su propio atrapado de Tab. Hay una prueba que lo reproduce.
  - **Nombres accesibles ambiguos.** «Guardar reporte como plantilla» y «Nuevo tablero desde plantilla» empezaban como «Guardar reporte» y «Nuevo tablero». Pasaron a «Guardar como plantilla» y «Tablero desde plantilla».
  - **Pestañas repetidas.** Aplicar una plantilla al mismo conjunto dejaba dos reportes con el mismo nombre. Ahora se numeran: «Cumplimiento (2)».

### Dónde retomar

1. Hito 4.4, exportación a Excel, PDF y CSV con los filtros activos (y decidir si basta el SVG propio o hace falta una librería).
2. Preparar la sección `#reportes-bi` de la landing con `22-tablero`, `22e-tablero-pulsado` y `23b-plantilla-vincular` (estado En desarrollo).
3. Opcional: filtro «Plantilla de Druse» en el diálogo de guardar del escritorio (`exports.rs`); hoy guarda el `.json` sin filtro de tipo.
