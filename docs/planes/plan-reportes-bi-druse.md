# Plan de implementación · Reportes BI en Druse

11 de noviembre de 2026 · Propuesta para la primera versión.
Seguimiento: [bitácora de Reportes BI](../seguimiento/bitacora-reportes-bi.md).

## 1. Alcance y experiencia

La primera versión permite crear un conjunto de datos con una o dos conexiones, cruzar datos de motores diferentes, guardarlo como reporte con tabla o gráfico, usar reportes en un tablero con filtros compartidos y programar actualizaciones. Cada usuario puede personalizar gráficos, paneles y tableros, guardar sus diseños como plantillas y exportar un panel o un tablero completo. Los datos de la última actualización exitosa se pueden consultar sin conexión a los orígenes. Los hitos de abajo son entregas de desarrollo de una misma versión.

1. Desde **Reportes → Nuevo conjunto de datos**, elegir una conexión guardada y su base. Se puede añadir una segunda fuente aunque use el mismo motor o la misma conexión con otra base.
2. Configurar cada fuente en modo **SQL** o **Visual**. El modo visual reutiliza el compositor para elegir tablas, columnas, filtros y cruces dentro de la fuente. Validar agrupaciones y agregados del compositor durante el primer hito, y extenderlo donde haga falta para preparar reportes. El SQL generado se puede ver y copiar a una fuente SQL editable. Conservar la configuración visual al hacer el cambio y pedir confirmación antes de regenerar SQL que se haya editado manualmente.
3. En **Combinar**, seleccionar columnas de ambos lados, tipo de unión y cardinalidad esperada. La vista previa muestra la estructura, los registros que coinciden y los diagnósticos por fuente.
4. En **Visualización**, elegir un tipo de gráfico o una tabla. Configurar campos, métricas y apariencia en el inspector con vista previa. Guardar el reporte y usar **Actualizar ahora** o **Programar** desde su conjunto de datos.
5. En **Tableros**, añadir reportes, ordenar y redimensionar tarjetas y vincular filtros compartidos. Se puede empezar desde un tablero vacío o desde una plantilla y guardar el diseño para reutilizarlo. Un conjunto de datos alimenta varios reportes con una sola actualización.

### Estilo visual moderno

- Integrar Reportes y Tableros en el espacio de trabajo de Druse. Usar los tokens de `frontend/src/styles/_tokens.scss` y el sistema de temas existente, con modo claro, oscuro y color de acento.
- Constructor con navegación lateral **Fuentes**, **Combinar** y **Visualización**. La vista principal prioriza la previsualización y deja la configuración en un inspector lateral plegable. En espacios estrechos, el inspector pasa a panel superpuesto.
- Tablero con una cuadrícula flexible, tarjetas de bordes suaves, tipografía clara, ejes discretos y una barra superior para fecha, filtros y actualización. Ofrecer una alternativa de teclado para ordenar tarjetas.
- Mostrar último dato disponible, próxima actualización y último intento donde ayuden a entender el estado. Usar esqueletos solo en la primera carga. Mientras se actualiza, mantener el dato guardado visible y mostrar el avance.
- Usar contraste legible, leyendas y estados con texto, foco visible, respeto por movimiento reducido y una tabla accesible como alternativa al gráfico. Revisar capturas en claro y oscuro con el barrido E2E del repositorio.

## 2. Arquitectura y puntos de integración

| Pieza actual | Uso previsto |
|---|---|
| `QueryService`, registro de proveedores y perfiles de conexión | Resolver cada fuente por perfil persistente, abrir una sesión de lectura dedicada por ejecución y reutilizar conexión, túnel, cancelación y errores por motor. Cerrar las sesiones al terminar. |
| Compositor SQL y `SavedComposition` | Reutilizar metadatos y generación de SQL por dialecto. Guardar en el conjunto de datos una copia versionada de la definición para que editar una composición externa no cambie un reporte por sorpresa. |
| `QueryResult` y `ResultSet` | Sus filas actuales contienen cadenas formateadas. Añadir lectura tipada desde los proveedores para BI, conservando el contrato actual del editor. |
| `JobRunner`, `IBackgroundJobs` y persistencia SQLite | Reutilizar el ejecutor de trabajos. Añadir programación persistente porque la cola de trabajos actual vive en memoria. |
| Angular y API local .NET | Angular edita y presenta. .NET ejecuta, combina y guarda los datos, con la misma ruta para una actualización manual o programada. |

**Motores objetivo:** SQL Server, PostgreSQL, MySQL, Oracle, Informix y SQLite, según los proveedores habilitados en cada edición de Druse. La prueba inicial cubre SQL Server + PostgreSQL. Antes de declarar un motor compatible, comprobar lectura tipada, nulos, cancelación, detección de truncado y reconexión por perfil. Si una definición se abre en una edición sin su proveedor, mostrar qué fuente requiere otro motor o edición. El resultado guardado sigue disponible.

**Estrategia de cruce:** ejecutar el SQL de cada origen en su motor, con agregaciones y filtros fijos cerca de los datos. En .NET, normalizar los tipos, unir conjuntos acotados mediante un índice por clave y calcular las métricas. SQLite guarda definiciones, ejecuciones y resultados en un archivo local dedicado a BI. El primer hito mide el uso de memoria y tiempos para decidir si hace falta llevar el procesamiento a un motor local distinto.

### Modelo propuesto

| Entidad | Campos principales |
|---|---|
| Conjunto de datos | ID, nombre, versión de definición, fuentes, unión, esquema esperado y métricas derivadas. |
| Fuente | Alias, ID del perfil de conexión, base, modo SQL o visual, definición y columnas esperadas. |
| Reporte | ID, conjunto de datos, tipo de visual, columnas o ejes y configuración de presentación. |
| Tablero | ID, páginas y paneles con posición, tamaño y estilo, tema y filtros con enlaces a columnas compatibles. |
| Plantilla | ID, ámbito (gráfico, panel o tablero), versión de formato, configuración copiable, vista previa opcional y campos esperados para vincular datos. |
| Programación | Conjunto de datos, frecuencia, zona horaria, próxima ejecución UTC y estado activo o pausado. |
| Ejecución | ID, versión de definición, origen manual o programado, estado, fechas, duración y diagnóstico por fuente. |
| Resultado guardado | Ejecución, versión de definición, esquema tipado, filas combinadas y fecha de captura. |

Guardar referencias a perfiles y resolver credenciales con el mecanismo existente. Una eliminación de perfil, un cambio de esquema o un túnel caído se informa en la fuente afectada y permite volver a vincularla. Usar cuentas de lectura con permisos restringidos, sesiones dedicadas y la validación de SQL de Druse. El analizador ayuda a detectar operaciones evidentes y los permisos de la base son los que impiden escrituras.

## 3. Reglas para que los números cuadren

- **Claves.** Admitir una o varias columnas, uniones internas e izquierdas y cardinalidades 1:1 y 1:N. En una unión izquierda, una clave nula queda sin coincidencia. Ante una relación N:N inesperada, detener la actualización y mostrar ejemplos de claves duplicadas. En modo 1:N, detectar métricas del lado «uno» que se repetirían y pedir una agregación al nivel correcto antes de totalizarlas.
- **Tipos.** Conservar enteros, decimales, fechas, texto, booleanos y nulos como valores tipados. Mantener códigos como texto para preservar ceros iniciales. Mostrar incompatibilidades y requerir conversiones explícitas si los tipos de las claves difieren. Guardar instantes en UTC y conservar las fechas sin hora como fechas. Mantener precisión decimal para importes y métricas, incluidas las lecturas desde el resultado guardado.
- **Presupuesto.** Empezar el prototipo con 20.000 filas por fuente, 50.000 en el cruce, 60 segundos por consulta y una sola ejecución simultánea por conjunto de datos. Son valores de partida para medir en Windows. Incorporar límite de bytes por ejecución y cuota local antes del lanzamiento. Una vista previa truncada se etiqueta como muestra. Una ejecución truncada jamás reemplaza un resultado guardado.
- **Filtros.** Fecha y categoría en la primera versión. Cada filtro se vincula a una columna de cada tarjeta compatible. Aplicar filtros y recalcular métricas sobre los datos guardados. Los filtros que cambien la consulta de origen requieren una actualización y quedan visibles como parte de la configuración. Por ejemplo, conservar el mes y el código de municipio permite aplicar ambos filtros sin volver a consultar.
- **Consistencia.** Registrar cuándo se leyó cada fuente. Mostrar el rango de captura de la ejecución, porque dos motores independientes pueden reflejar momentos diferentes. Guardar resultado y actualizar el puntero a la versión activa en una transacción local. Ante error, cancelación o cambio de definición durante una actualización, conservar el último dato válido y señalar si corresponde a una definición anterior.

## 4. Actualizaciones manuales y programadas

- **Actualizar ahora** y las frecuencias diaria o semanal ejecutan el mismo trabajo. El usuario elige hora y zona. La programación se persiste en SQLite y un servicio de la API local despacha los trabajos a la cola existente.
- La primera versión propuesta ejecuta horarios mientras Druse está abierto. Si el equipo está apagado, suspendido o Druse se cerró, ejecutar una sola actualización pendiente al abrir o reanudar y calcular el siguiente horario. Ejecutar con Druse cerrado requeriría un proceso persistente o una tarea del sistema y se estima por separado.
- Evitar ejecuciones simultáneas del mismo conjunto con una adquisición atómica y deduplicar por horario. En el arranque, cerrar ejecuciones interrumpidas y recuperar la programación. Para fallos transitorios, permitir un reintento con demora y mostrar el diagnóstico si falla. Una programación pausada sigue permitiendo actualizaciones manuales.
- Conservar el último resultado exitoso por conjunto y un historial acotado de intentos. Aplicar retención y cuota de almacenamiento, con controles para ver el espacio usado y borrar los datos guardados. Mostrar «Datos del…» junto al fallo reciente, de modo que siempre se entienda qué versión se está viendo.

## 5. Hitos y criterios de aceptación

| Hito | Trabajo | Cómo se valida |
|---|---|---|
| 1. Prueba técnica | SQL Server + PostgreSQL, lectura tipada, sesiones dedicadas, unión en .NET y mediciones de memoria. | Un escenario reproducible da los totales esperados, conserva ceros iniciales y detecta un duplicado y una fuente truncada. |
| 2. Conjuntos de datos | Edición SQL y visual, configuración de la unión, vista previa y diagnósticos. | Se guarda y reabre un conjunto con una fuente visual y otra SQL. Los dos modos pueden preparar el mismo resultado. |
| 3. Reportes guardados | Tabla, barras, línea e indicador, actualización manual y resultado local. | Reabrir con ambas bases desconectadas. Al reconectar y actualizar, cambian los datos. Si una fuente falla, se conserva el resultado anterior. |
| 4. Diseño y plantillas | Cuadrícula, inspector visual, personalización, filtros compartidos, plantillas y exportación a Excel y PDF. | Cambiar el diseño, guardar una plantilla, aplicarla a otro conjunto compatible y exportar con los filtros activos. Verificar teclado y temas claro y oscuro. |
| 5. Programación | Diario/semanal, recuperación tras reinicio, historial y retención. | Simular reloj, suspensión, arranque tardío, concurrencia manual y fallo de origen. Cada horario se ejecuta a lo sumo una vez, salvo su reintento controlado. |
| 6. Compatibilidad y cierre | Matriz por motor y edición, errores en español e inglés, rendimiento, pruebas de UI y novedades. | Ejecutar pruebas de backend y frontend, comprobación de i18n, barrido visual y E2E multifuente. Declarar motores compatibles según la matriz verificada. Aplicar el flujo de versión del repositorio al implementar la función visible. |

### Caso de validación sin datos reales

Preparar SQL Server con ventas por mes y municipio, y PostgreSQL con metas del mismo periodo. Para enero, usar el municipio 05001 con ventas de 80 y meta de 100, 08001 con ventas de 100 y meta de 200, y 11001 con ventas de 40 y sin meta. La unión izquierda debe dar tres filas y 220 en ventas. El indicador de cumplimiento de municipios con meta debe dar 60 % usando (80 + 100) / (100 + 200), con el municipio sin meta marcado como tal. Agregar un segundo mes para comprobar los filtros y duplicar una meta para verificar que la actualización se detiene. Incluir pruebas de meta cero, cambios de esquema y desconexión.

### Primer bloque de implementación

Crear las dos bases de prueba y un prototipo en el backend que lea un conjunto tipado por conexión, combine ambas fuentes y guarde el resultado válido. Usar esa prueba para fijar el contrato de lectura tipada y los límites iniciales. En paralelo con el diseño del constructor, definir su apariencia con los temas existentes antes de implementar toda la navegación.

## 6. Mostrar el avance de Reportes BI en la landing

### Qué verá quien visite la página

Añadir **Reportes BI** al menú y una sección `#reportes-bi` entre Herramientas y Descargar. Usar las fuentes, colores y tarjetas de la landing. La vista previa mostrará una captura del constructor o del tablero con datos ficticios, acompañada de un resumen breve de lo que ya se puede ver o probar. La sección inicial puede publicarse con el siguiente texto y el estado **En desarrollo**:

> **Reportes BI en Druse**
> Estamos desarrollando reportes que combinan datos de distintas bases. Consulta el avance del constructor SQL y visual, los tableros con filtros y las actualizaciones programadas.

Incluir un enlace **Ver avance** hacia `./reportes-bi.html` cuando haya suficiente material para una bitácora pública. La portada mantiene el último avance y la página de detalle conserva el historial. Conservar foco visible y contraste en los estados, texto alternativo para capturas y una presentación adaptable a móviles. Marcar cada imagen como **Mockup** o **Captura de Druse**, según corresponda.

### Qué publicar por hito

| Hito del plan | Evidencia pública | Estado sugerido |
|---|---|---|
| Cruce SQL Server + PostgreSQL | Mostrar los resultados del escenario ficticio de ventas y metas. | En desarrollo |
| Constructor SQL y visual | Publicar una captura de las dos fuentes, la unión y la vista previa. | En desarrollo |
| Reportes guardados y tableros | Mostrar un tablero con dos gráficos, su filtro de mes y el último dato disponible. Si se prepara una demo web, ofrecer un filtro funcional sobre los mismos datos ficticios. | En desarrollo |
| Diseño y plantillas | Mostrar cómo cambiar un gráfico, guardar el diseño y aplicarlo a otro conjunto ficticio. | En desarrollo |
| Actualización programada | Mostrar la configuración diaria o semanal y la recuperación tras reabrir Druse. | En desarrollo |
| Paquetes publicados | Enlazar la versión, sus notas y la guía. Indicar ediciones y motores verificados para BI. | Disponible |

Usar **En pruebas** si se publica una versión de prueba que incluya BI e indicar dónde se consigue. Reservar **Disponible** para una versión publicada y comprobada que incluya la función. Si la demo está lista antes, usar **Ver demo** y aclarar que es una muestra web con datos ficticios. La demo, si se hace, usa recursos estáticos locales y funciona sin credenciales ni conexiones a las bases.

### Cómo mantenerlo actualizado

1. Al cerrar un hito, añadir una entrada con fecha, resultado que se puede mostrar y evidencia pública. Si la mejora está publicada, enlazar también sus notas. Evitar porcentajes de avance y fechas de entrega sin confirmar.
2. Mantener el resumen y el historial como HTML estático dentro de `landing/`. Usar imágenes optimizadas en `landing/assets/` y rutas relativas compatibles con el sitio bajo `/druse/`. Un cambio de estado en la landing requiere comprobar la evidencia del hito correspondiente.
3. Previsualizar la landing localmente y probar navegación por teclado, vista móvil, enlaces y carga de imágenes. Al publicar, comprobar el despliegue de Pages y abrir la sección desde el sitio público.
4. Para marcar BI como **Disponible**, seguir el flujo de publicación de Druse. Verificar las seis descargas de la misma versión y que la guía la enlaza. El generador actual obtiene las descargas desde Releases.

**Criterio de aceptación:** desde la portada se puede ver qué parte de BI está en desarrollo, abrir el último avance y reconocer si se está viendo un mockup, una demo o una función disponible para descargar.

## 7. Personalización y plantillas

### Qué puede personalizar cada usuario

| Nivel | Controles previstos |
|---|---|
| Gráfico | Tipo de visualización, campos y agregaciones, series, orden, etiquetas, título, ejes y escalas, leyenda, información al pasar el cursor, formato de números y fechas, colores por serie o categoría y reglas de color por valor. |
| Panel | Tamaño y posición, título y descripción, fondo, borde, espaciado y visibilidad del encabezado. Puede contener un gráfico, tabla, indicador, bloque de texto, imagen o control de filtros. Las tablas permiten elegir, ordenar y formatear columnas. |
| Tablero | Una o varias páginas, cuadrícula ajustable, distribución de paneles, alineación, tipografía, fondo, paleta y filtros compartidos. Cada gráfico puede emitir o recibir filtros según los campos vinculados. |

Tipos de visualización propuestos para la primera versión: barras, línea, área, dispersión, dona, tabla e indicador. Incluir opciones pertinentes para cada tipo, como apilado en barras y referencia de meta en indicadores. Elegir la librería tras probar renderizado, tema, accesibilidad y exportación de estos tipos con los datos de prueba.

### Editor de diseño

- Ofrecer **Ver** y **Editar diseño**. En edición, seleccionar un panel abre un inspector con **Datos**, **Apariencia** e **Interacciones**, y los cambios aparecen en la vista previa. Permitir duplicar, deshacer y restaurar valores del tema.
- Colocar y redimensionar paneles en una cuadrícula con ajuste y controles de teclado. Guardar el diseño de cada página y definir cómo se reorganiza cuando el espacio se reduce.
- Heredar los valores del tema de Druse, luego los del tablero y por último los ajustes del panel y del gráfico. La interfaz debe mostrar qué valor se hereda y permitir restablecerlo.
- Al pulsar una categoría, aplicar un filtro a los paneles vinculados. Mostrar el filtro activo y permitir quitarlo con teclado o ratón. Conservar etiquetas, iconos o valores para que el color no sea la única señal.

### Crear, reutilizar y compartir plantillas

1. **Guardar como plantilla** desde un gráfico, un panel o un tablero completo. Pedir nombre y permitir una descripción y vista previa. Conservar estilos, distribución, reglas de formato, interacciones y los campos que necesita cada visual.
2. **Crear desde plantilla** desde una galería con diseños iniciales y plantillas personales. Elegir el conjunto de datos, revisar la asignación propuesta por nombre y tipo de campo y resolver los campos requeridos que falten antes de generar el tablero. Ejemplo: vincular `monto_total` al campo Ventas y `fecha_pedido` al campo Fecha.
3. Crear una copia independiente. Cada usuario puede modificarla y guardarla como otra plantilla. Las ediciones a una plantilla se aplican al crear nuevas copias.
4. Permitir exportar e importar una definición versionada de plantilla. El archivo lleva el diseño y las referencias lógicas a campos. Cada usuario elige sus propias conexiones y conjuntos de datos al aplicarla. Mantener SQL, credenciales y filas de origen fuera del archivo compartido. Validar versión, tamaño, tipos de panel y referencias antes de mostrar la vista previa de importación.

**Criterio de aceptación:** un usuario puede diseñar un tablero de ventas con sus colores, dos páginas y filtros compartidos, compartir la plantilla y aplicarla a otra fuente con nombres de columnas diferentes. El segundo usuario puede cambiar la apariencia de su copia y exportarla con sus propios datos.

## 8. Exportación de tableros y paneles

- Incorporar **Exportar tablero** en la barra superior y **Exportar panel** en el menú de cada panel. En tableros de varias páginas, ofrecer la página actual o todas. Exportar desde la misma versión guardada y con los filtros visibles al iniciar la operación. Registrar los filtros y la fecha de captura para que el resultado se pueda reproducir.
- **Excel:** una hoja de resumen con indicadores y hojas con datos tipados por visualización. Reconstruir gráficos editables para los tipos compatibles. Para una visualización sin equivalente, incluir su imagen y la tabla de datos. Reutilizar las piezas del exportador existente que escriben celdas, con el resultado guardado de BI como origen. Avisar si el volumen supera el límite antes de generar el archivo.
- **PDF:** una vista preparada para impresión que conserve distribución, títulos y gráficos, y que permita revisar saltos de página en tableros largos. Aplicar los estilos personalizados del tablero y comprobar textos y contrastes en la vista previa.
- **CSV:** ofrecer los datos filtrados de un panel o del conjunto de datos. Considerar HTML interactivo después de validar Excel y PDF, usando únicamente los datos que el usuario decida incluir.

**Criterio de aceptación:** con un filtro de mes activo y las bases desconectadas, exportar un panel y el tablero. Las cifras deben coincidir con la vista. En Excel se pueden revisar los datos de cada visual, y en PDF se reconocen el diseño, los filtros y la fecha de captura.
