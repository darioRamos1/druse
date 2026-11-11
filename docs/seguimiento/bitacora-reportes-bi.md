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
- [ ] Constructor en Angular: Fuentes, Combinar y vista previa, con el compositor para el modo visual.
- [ ] Captura del constructor para la landing.

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

### Dónde retomar

1. Constructor en Angular con navegación Fuentes, Combinar y vista previa, y el inspector plegable. Revisar antes qué agrupaciones y agregados admite el compositor (`frontend/src/app/features/query-builder`) para el modo visual.
2. Llevar la unión a un trabajo de actualización manual que guarde el resultado (hito 3) usando `ReportDatasetPreviewService` y `ReportSnapshotService`.
3. Preparar la evidencia del cruce y la captura del constructor para la sección `#reportes-bi` de la landing.
