# Bitácora de seguimiento — Druse

> Documento vivo. Se actualiza **al final de cada sesión de trabajo**.
> El plan maestro (alcance, arquitectura, fases) vive en `PLAN_TRABAJO_DRUSE.md`.
> Esta bitácora responde solo a tres preguntas: **qué se hizo**, **en qué estado quedó** y **qué toca retomar**.

---

## 1. Estado actual

| Campo | Valor |
| --- | --- |
| Última sesión | **009** — 2026-08-12 |
| Fase activa | **Fase 7 — Empaquetado de escritorio** |
| Fases 0–5 | ✅ Cerradas. |
| Fase 6 | ✅ **Cerrada.** 9/9 tareas. |
| ¿Compila el backend? | Sí — 0 advertencias, 0 errores |
| ¿Compila el frontend? | Sí — 422 kB iniciales, 0 advertencias |
| ¿Pasan las pruebas? | Sí — **192 en backend** (102 unitarias + 48 contractuales + 42 integración) y **70 en frontend** |
| ¿Se puede exportar? | Sí — 9 630 filas a CSV en 0,23 s, y XLSX que Windows reconoce |
| Bloqueantes | **Rust no está instalado** y hace falta para Tauri |
| Git | Rama `feature/results-export`, pendiente de fusionar en `main`. Sin remoto configurado. |

### Qué toca retomar en la próxima sesión

1. **Instalar Rust** (`rustup`). Es el prerrequisito de la Fase 7, como Docker lo fue de la 2 y SQL Server de la 4.
2. **Fusionar `feature/results-export` en `main`** y abrir `feature/desktop-packaging`.
3. La **Fase 7** es la que convierte esto en una aplicación de verdad:
   - Tauri sobre el frontend existente;
   - la API como proceso auxiliar, con **puerto dinámico** en lugar del 5177 fijo;
   - **el token ya no lo leerá el proxy sino Tauri**, que es lo que se preparó en la Fase 3;
   - cerrar la API al cerrar la ventana;
   - instalador para Windows y ZIP portable;
   - probar en un equipo limpio, sin .NET ni Node.
4. Los tres círculos de la barra superior (minimizar, maximizar, cerrar) siguen siendo decorativos: con Tauri pasan a funcionar.
5. Aplazado otra vez: recordar las pestañas abiertas entre sesiones. Encaja con el estado de ventana de esta fase.

**Sigue pendiente el visto bueno visual.** La extensión de Chrome no ha estado conectada en ninguna sesión.

---

## 2. Cómo retomar (prompt de arranque de sesión)

```text
Lee BITACORA.md y PLAN_TRABAJO_DRUSE.md, y revisa el mockup de referencia
docs/mockups/druse-main.html.

Antes de escribir código:
1. Confirma la fase activa y las tareas pendientes según la bitácora.
2. Verifica el estado real del repositorio (no confíes solo en la bitácora).
3. Propón únicamente los cambios de la siguiente tarea pendiente.

Al terminar: ejecuta compilación y pruebas, resume archivos modificados y
actualiza el checklist del plan y esta bitácora.
```

---

## 3. Identidad del proyecto

| Campo | Valor |
| --- | --- |
| Nombre | **Druse** (sin sufijo «Studio») |
| Origen | Una *drusa* es la costra de cristales que tapiza el interior de una geoda: la estructura que aparece al abrir la piedra. Metáfora de explorar el esquema de una base de datos. |
| Raíz de namespaces | `Druse.*` |
| Solución | `backend/Druse.slnx` |
| Ejecutable | `druse.exe` |
| Raíz del repositorio | `P:\Proyectos\Trabajo\DB STUDIO\druse` |
| Nombre anterior | ~~Quarzo Studio~~ — descartado en la sesión 001 |

**Verificación de colisiones (sesión 001).** Candidatos comprobados antes de fijar el nombre:

| Candidato | Resultado |
| --- | --- |
| **Druse** | ✅ Elegido. Sin colisiones encontradas en software. |
| Geode | ❌ Apache Geode: base de datos distribuida en memoria, proyecto top-level de la ASF (antes GemFire). Colisión directa en el mismo dominio. |
| Facet | ❌ Paquete NuGet `Facet` activo (source generator de DTOs), versión 5.x. |
| Kyanite | ⚠️ Saturado: un lenguaje, una librería de inferencia en Rust, Kyanite Labs. |
| Shard | ✅ Libre como nombre de app, pero «sharding» satura el término en bases de datos. |
| Lazuli | ✅ Casi libre; solo un paquete Python nicho en PyPI. |

Pendiente cuando haya presencia pública: reservar dominio, organización de GitHub y el identificador `druse` en NuGet/npm.

---

## 4. Entorno verificado

| Herramienta | Versión | Estado |
| --- | --- | --- |
| .NET SDK | 10.0.302 | OK |
| Node.js | v24.16.0 | OK |
| npm | 11.12.1 | OK |
| Git | 2.50.0.windows.2 | OK |
| Angular | 22.1.0 (CLI 22.1.3) | OK |
| TypeScript | 6.0.2 | OK |
| Vitest | 4.1.10 | OK — es el runner por defecto de Angular 22 |
| Rust / cargo | — | **Falta.** Necesario solo para Tauri (Fase 7). |

Pendiente de verificar cuando toque: Docker (pruebas de integración con contenedores), instancias PostgreSQL y SQL Server de prueba (Fases 2 y 4).

---

## 5. Registro de sesiones

### Sesión 009 — 2026-08-12 · Fase 6 completa

**Objetivo:** sacar los datos de la herramienta. Es lo último que faltaba del uso diario.

**Hecho:**

*Lectura progresiva*
- `IQueryResultReader`: nuevo contrato que recorre un resultado **fila a fila, sin materializarlo**. Implementado en los dos proveedores.
- Existe porque `ExecuteAsync` limita las filas —van a una cuadrícula— y exportar una tabla grande por ese camino agotaría la memoria del proceso.
- El búfer de fila se reutiliza en cada iteración, para no reservar un array por registro durante una exportación larga.

*Exportadores*
- **CSV según RFC 4180**, escrito a mano: son cuatro reglas y una dependencia para esto habría que justificarla. Entrecomilla cuando hay separador, comillas o saltos de línea, y duplica las comillas internas.
- Codificación elegible. Por defecto **UTF-8 con BOM**: sin él, Excel en Windows abre el archivo con la página de códigos del sistema y los acentos salen rotos.
- Separador y texto de nulo configurables. Un nulo escrito como vacío es indistinguible de una cadena vacía, así que se puede cambiar.
- **XLSX con ClosedXML**, con su propio tope de 200 000 filas: este formato sí necesita el libro entero en memoria, y se dice en el código por qué.
- Los valores van como texto a propósito: dejar que Excel los interprete convertiría «007» en 7.

*API*
- `/api/exports/csv` y `/api/exports/xlsx`, escribiendo directamente sobre la respuesta.
- **Exportar no es una vía para saltarse las protecciones**: pasa por las mismas reglas que una ejecución, incluidas solo lectura y confirmación de instrucciones destructivas.
- El nombre de archivo se sanea antes de ir a la cabecera.

*Interfaz*
- Menú **Exportar** con CSV y Excel, que descarga el archivo.
- **Filtros por columna**, locales sobre lo que se ve; para acotar de verdad está el `WHERE`.
- **Copiar**: celda con doble clic o Ctrl+C, fila entera con doble clic en su número, encabezados desde la esquina. Todo separado por tabuladores para pegarlo en una hoja.
- **Varios conjuntos de resultados**: un lote con tres `SELECT` muestra tres pestañas. El backend ya los devolvía; la interfaz ignoraba todos menos el primero.
- El historial se extrajo a su propio componente.

**Verificado con la aplicación en marcha:**
- **9 630 filas exportadas a CSV en 0,23 s**, cuando la cuadrícula solo muestra 500.
- XLSX que Windows identifica como «Microsoft Excel 2007+».
- Los casos que rompen un CSV mal hecho, todos correctos: `"Madrid, España"`, `"Dijo ""hola"""`, salto de línea dentro del campo, nulo vacío, acentos y BOM `ef bb bf`.
- `DELETE` sin filtro por la vía de exportación → 409.

**Incidencias resueltas:**
1. **Las cabeceras con el recuento de filas se añadían después de escribir el cuerpo**, cuando ya se habían enviado. Se pasó a **trailers HTTP**, que es el mecanismo para metadatos que solo se conocen al terminar. La validación se movió antes de tocar la respuesta, para poder devolver 409 con un cuerpo legible.
2. **ClosedXML necesita un destino con posicionamiento** y el cuerpo de una respuesta HTTP no lo tiene. Se compone en memoria y se copia; no es una limitación nueva, porque este formato ya obligaba a tener el libro entero en memoria.
3. El panel de resultados volvió a superar el presupuesto de estilos. Se extrajo el historial, que es una vista con entidad propia.

**Decisiones tomadas:** D-08 y D-16 (ver §6).

---

### Sesión 008 — 2026-08-11 · Fase 5 completa

**Objetivo:** que el trabajo diario se pueda hacer con el teclado, y apagar los botones de adorno.

**Hecho:**

*Formateador*
- `sql-formatter` con el dialecto de cada motor: PostgreSQL, T-SQL o MySQL. Formatear con el genérico no es inofensivo —parte el `::` de PostgreSQL y los corchetes de SQL Server por sitios que cambian el significado del SQL.
- Formatea la selección si la hay, o el documento entero.
- **Si el SQL no se puede analizar, se devuelve intacto.** Reformatear a la fuerza algo a medio escribir sería la forma más rápida de que alguien pierda trabajo.
- Va por `executeEdits`, así que **se deshace con Ctrl+Z** como cualquier otra edición.

*Autocompletado*
- Palabras reservadas y funciones por motor. La lista es corta a propósito: sugerir cientos convierte el desplegable en ruido.
- Tablas, vistas, esquemas y columnas **de lo que el explorador ya cargó**. Consultar el catálogo en cada pulsación sería mucho peor que sugerir de menos.
- Tras un punto se sugieren **solo columnas**, y se resuelven los alias: escribir `u.` funciona si antes hay `FROM users u`. Sin eso, la función más útil del autocompletado no existiría.
- Las tablas se ordenan por delante de las palabras reservadas, que es lo que más se escribe.

*Atajos*
- `Ctrl+Enter` ejecutar · `Ctrl+Shift+Enter` ejecutar selección · `Esc` cancelar · `Ctrl+S` guardar · `Ctrl+T` nueva consulta · `Ctrl+Shift+F` formatear · `Ctrl+F` buscar.
- Se registran en Monaco y no en el documento: un `Ctrl+S` global se comería el del navegador aunque el foco estuviera en otro sitio.

*Lo que dejó de ser decorativo*
- **Formatear**, que era un botón muerto.
- **Timeout**, ahora un desplegable con valores habituales que **se guarda en preferencias**.
- **Filtro de conexiones**, que además filtra objetos del árbol y conserva los ancestros de cada coincidencia: una tabla suelta sin su esquema no diría de dónde sale.
- **Historial filtrable**, resuelto en el servidor, que es quien tiene todas las entradas.
- **Copiar el nombre calificado** y **abrir el `SELECT`** desde el árbol, con acciones que solo aparecen al pasar por encima para no tapar los nombres.

**Verificado:**
- 61 pruebas de frontend (16 nuevas de formateo y autocompletado) y 167 de backend.
- La preferencia de timeout persiste: se escribió 120 y se leyó 120.
- El historial filtra por texto contra el servidor.

**Incidencia resuelta:** `sql-formatter` añadía **300 kB al paquete inicial**, que se descargarían siempre, incluso para quien no formatee nunca. Pasó a carga diferida, igual que Monaco: el paquete inicial volvió de 705 kB a 411 kB y el formateador se trae la primera vez que se usa.

**No hecho:**
- Guardar en disco: `Ctrl+S` solo quita el indicador de cambios pendientes. Los archivos llegan con el empaquetado de escritorio (Fase 7).
- Recordar las pestañas abiertas entre sesiones. Se aplaza otra vez; encaja mejor junto al estado de ventana de la Fase 7.

---

### Sesión 007 — 2026-08-11 · Fase 4 completa

**Objetivo:** el segundo motor. Es la fase que dice si las abstracciones sirven o solo lo parecían.

**Hecho:**
- `SqlServerDatabaseProvider`, `SqlServerQueryExecutor`, `SqlServerMetadataReader` y `SqlServerErrorNormalizer` con Microsoft.Data.SqlClient 7.
- Metadatos sobre las vistas `sys.*`, con recuento desde `sys.dm_db_partition_stats` —el equivalente de `reltuples`— para no hacer `COUNT(*)` por tabla.
- Los tipos se recomponen con su longitud (`nvarchar(200)`, `datetimeoffset(7)`), porque `sys.columns` los guarda despiezados y mostrar solo «nvarchar» perdería información que PostgreSQL sí da.
- Registrado en la composición: **tres líneas**, sin tocar Domain, Application ni un solo componente Angular.
- SQL Server habilitado en el diálogo de conexión.
- `test-db.ps1` y `.sh` levantan ahora los dos motores, por separado o juntos.

**Las pruebas contractuales pasaron a ser de verdad compartidas**
- `DatabaseProviderContractTests<TFixture>` define **24 comprobaciones idénticas**; cada motor solo aporta conexión y dialecto a través de `IProviderFixture`.
- **48 pruebas en verde: las mismas 24 contra PostgreSQL 18.4 y contra SQL Server 2022.** Ninguna comprobación tuvo que cambiarse para que pasara en un motor concreto.
- Lo que sí varía queda declarado y a la vista en el fixture: `pg_sleep` frente a `WAITFOR DELAY`, SQLSTATE `42601` frente al error `102`, `generate_series` frente a una CTE recursiva, `RAISE NOTICE` frente a `PRINT`, `public` frente a `dbo`.

**Dos fallos encontrados, y cómo:**

1. **`InvariantGlobalization=true`, puesto en la Fase 0 para reducir el tamaño del ejecutable, impide que SqlClient abra ninguna conexión**: falla con «Globalization Invariant Mode is not supported». Una decisión de tres fases atrás que solo se manifiesta al integrar el segundo motor. Desactivado, con el motivo escrito en `Directory.Build.props`. Tampoco encajaba con una aplicación que muestra datos de bases ajenas con sus intercalaciones.

2. **Las 24 pruebas de SQL Server pasaban sin comprobar nada.** El patrón de omisión silenciosa —terminar sin hacer nada cuando falta el servidor— convertía un motor caído en una suite verde. Se añadió `ElMotorEstabaDisponible`, que con `DRUSE_REQUIRE_ENGINES=1` convierte ese silencio en un fallo, y `UnavailableReason`, que muestra **por qué** no conectó en lugar de obligar a depurar a ciegas. Fue justo ese test el que destapó el problema anterior. La integración continua ya exige los dos motores.

**Verificado con la aplicación en marcha, contra SQL Server real:**
- `/api/engines` devuelve los dos motores.
- Conexión guardada y sesión abierta **sin reenviar la contraseña**.
- Esquemas sin `sys` ni `INFORMATION_SCHEMA`; tablas con su recuento.
- Columnas con tipos T-SQL correctos: `nvarchar(200)`, `datetimeoffset(7)`, `bit`, clave primaria e identidad.
- Consulta T-SQL con acentos y nulos.
- **El `bit` de SQL Server llega como `true`, igual que el `boolean` de PostgreSQL**: la normalización de tipos funciona.
- `DELETE` sin filtro → 409 con el mismo aviso que en PostgreSQL.

**Decisión registrada:** la autenticación integrada de Windows queda **fuera del MVP**. Ata la aplicación a un sistema operativo y el plan exige explícitamente que no sea la única forma de conectarse (ADR 0003). Sigue en el backlog de prioridad alta.

**Sobre el nombre «R3Safety»:** venía del mockup y lo había copiado a los datos de prueba. Sustituido por nombres neutros. En el código no quedaba ninguna referencia: los datos simulados que lo tenían se borraron en la Fase 2.

---

### Sesión 006 — 2026-08-11 · Ejecución completa y tres fallos corregidos

**Objetivo:** arrancar la aplicación entera y ver cómo se comporta de verdad.

**Qué se hizo:** se pobló la base de pruebas con los mismos datos del mockup (1 284 usuarios, 37 tenants, 412 empresas, 9 630 documentos; el nombre «R3Safety» del mockup se sustituyó por datos neutros), se arrancó con `dev.ps1` y se recorrió el flujo completo por el proxy.

**Tres fallos que solo aparecieron al ejecutar:**

1. **`dev.ps1` no funcionaba en esta máquina.** `Start-Process` une los argumentos con espacios sin entrecomillarlos, y la ruta contiene un espacio («DB STUDIO»), así que dotnet recibía `P:\Proyectos\Trabajo\DB`. El criterio de salida de la Fase 0 decía «existe un único comando documentado»… y ese comando nunca se había ejecutado entero. Corregido entrecomillando la ruta.

2. **El proxy no inyectaba el token.** Se había escrito con la sintaxis `on: { proxyReq }` de http-proxy-middleware v3, pero el servidor de Angular usa Vite, que espera `configure`. La opción se ignoraba **en silencio** y todas las peticiones llegaban sin token: el frontend habría respondido 401 en todo. Corregido con `configure`.

3. **El botón «Cancelar» no podía funcionar.** El `executionId` lo generaba el servidor y solo llegaba **con la respuesta**, es decir, cuando la consulta ya había terminado. Mientras corría, el cliente no tenía identificador que cancelar. Las pruebas no lo detectaron porque las contractuales cancelaban pasando un token directamente al ejecutor, y la de integración solo comprobaba que cancelar un id inexistente da 404. **Ahora el identificador lo elige el cliente y se envía con la petición.** Añadidas dos pruebas: cancelar una consulta *en curso* y comprobar que el id devuelto es el que se mandó.

**Verificado con la aplicación en marcha:**
- `dev.ps1` levanta API y frontend con un solo comando.
- El proxy inyecta el token: `/api/connections` responde 200 por el 4200 y 401 por el 5177 directo.
- Conexión guardada, sesión abierta **sin reenviar la contraseña**, con nombre en UTF-8 («PostgreSQL — Local») intacto.
- Explorador con carga perezosa: base → esquema → carpetas → tablas, con los recuentos reales (9 630, 412, 37, 1 284).
- La consulta del mockup ejecutada de verdad: 17 ms.
- `DELETE FROM users` sin filtro → **409** con el riesgo explicado.
- Error de sintaxis → SQLSTATE 42601 y posición 14.
- 9 630 filas recortadas a 500 con `truncated: true`.
- Nulos como `null`, distintos de la cadena vacía, y acentos correctos («Lucía Gómez»).
- **Cancelación en vivo: `pg_sleep(30)` cortado a los 2,8 segundos.**

**Pruebas:** 140 en backend (85 + 21 + 34) y 45 en frontend.

**Limpieza:** se borraron de la máquina los datos de prueba y la credencial del Administrador de credenciales.

**Nota sobre el proceso:** los tres fallos estaban en las costuras —un script, una opción de configuración, un contrato entre cliente y servidor—, justo donde las pruebas de cada lado no miran. Conviene ejecutar la aplicación entera al cerrar cada fase, no solo al final.

---

### Sesión 005 — 2026-08-11 · Fase 3 completa

**Objetivo:** que los datos sobrevivan al reinicio y que la API deje de ser abierta.

**Hecho:**

*Plataforma*
- `IAppPaths`: directorios según la convención de cada sistema (`%APPDATA%`, `Application Support`, XDG). Todo con `Path.Combine`; una prueba comprueba que no aparece el separador de la otra plataforma.
- `ISecretStore` con tres implementaciones: **Administrador de credenciales de Windows** por P/Invoke a `advapi32`, **Llavero de macOS** por `security` y **Secret Service** por `secret-tool`.
- `NullSecretStore` cuando no hay ninguno: la aplicación pide la contraseña cada vez **y lo dice en la interfaz**. Cifrar un archivo con una clave que está en el mismo disco sería seguridad aparente, que es peor que ninguna.

*Persistencia*
- SQLite con perfiles, historial y preferencias. Esquema explícito, WAL y `user_version` para poder migrar más adelante.
- `SavedConnectionService` reparte: el perfil a SQLite, la contraseña al almacén del sistema. **Nunca coinciden en el mismo sitio.**
- El historial guarda cada ejecución, incluidas las fallidas con su error. Un fallo al escribirlo no tumba la consulta.

*Seguridad*
- **Token de la API local**: 32 bytes aleatorios por arranque, en `api-token` con permisos 0600 en Unix, exigido en `X-Druse-Token` en todas las rutas menos `/api/health`. Comparación en tiempo constante.
- CORS restringido al origen de la aplicación y solo a la cabecera del token.
- El proxy de desarrollo de Angular pasó de `.json` a `.js` para poder **leer el token del disco e inyectarlo**: el navegador no puede hacerlo.
- ADR 0004 documenta el alcance real de la protección, incluido lo que **no** cubre.

*Interfaz*
- Perfiles guardados en la barra lateral, restaurados al arrancar y desconectados: abrir todas las sesiones al inicio despertaría servidores que el usuario no pensaba tocar.
- Un clic sobre un perfil guardado lo conecta usando la contraseña del almacén.
- **Color por entorno**: franja verde, ámbar o roja en desarrollo, pruebas y producción.
- Historial navegable con filtro; al pulsar una consulta se abre en una pestaña nueva.
- El diálogo ofrece guardar la conexión y recordar la contraseña, e informa de dónde queda.

**Verificado ejecutando:**
- 138 pruebas de backend y 45 de frontend, todas pasan.
- **Sin token la API responde 401; con él, 200.**
- **Al reiniciar la API, el token cambia y el anterior deja de valer.**
- **El perfil guardado sobrevive al reinicio y abre sesión sin reenviar la contraseña**, que sale del Administrador de credenciales.
- Se ejecutó una consulta real con esa sesión y quedó anotada en el historial.
- **Ningún archivo local contiene la contraseña**: se leyeron `druse.db`, `-wal`, `-shm` y `api-token` byte a byte buscándola. La credencial sí estaba en el Administrador de credenciales.
- Los datos de prueba y la credencial se borraron de la máquina al terminar.

**Incidencias resueltas:**
1. Una prueba destapó que **el término de búsqueda del historial no escapaba los comodines de LIKE**: buscar `%` devolvía todo y `_` casaba con cualquier carácter. No era inyección —iba como parámetro— pero sí una búsqueda que mentía. Ahora se escapa con `ESCAPE '\'`.
2. Otra prueba destapó que **`forget` borraba el perfil en el servidor pero lo dejaba en la lista local**, porque `disconnect` ahora conserva los perfiles guardados. Corregido.
3. La referencia nueva `Persistence.Sqlite → Platform.Abstractions` hizo fallar la prueba de arquitectura, que es justo su trabajo. Se amplió la regla con el motivo documentado.

**Comportamiento conocido:**
- Si el proceso muere de forma abrupta (kill, fallo), **el archivo del token queda en disco**. No es una brecha: ese valor ya no lo acepta nadie y el siguiente arranque lo sobrescribe. Verificado.
- En macOS, `security` recibe la contraseña como argumento y es visible un instante en la lista de procesos. Anotado en el ADR 0004 como mejora pendiente.

**No hecho:**
- No se recuerdan las pestañas abiertas: va con el resto del estado del editor en la Fase 5.
- Sin verificación visual: la extensión de Chrome sigue sin conectarse.

---

### Sesión 004 — 2026-08-11 · Fase 2 completa

**Objetivo:** el flujo vertical contra PostgreSQL, de la interfaz al motor.

**Hecho:**

*Dominio y contratos*
- `ConnectionProfile`, `DatabaseObject`, `DatabaseColumn`, `QueryRequest`, `QueryResult` y compañía en `Druse.Domain`.
- `IDatabaseProvider`, `IDatabaseSession`, `IDatabaseMetadataReader` e `IQueryExecutor` en `Druse.Database.Abstractions`.
- **`ConnectionProfile` no tiene campo de contraseña.** Las credenciales viajan aparte en `DatabaseCredentials`, se usan al abrir y se descartan. Hay una prueba que falla si alguien añade una propiedad que se llame «password», «secret» o «credential».
- `SqlSafetyAnalyzer`: detecta DROP, TRUNCATE, DELETE/UPDATE sin WHERE, cambios de esquema y de permisos. Descarta cadenas, identificadores citados y comentarios antes de analizar, para no avisar sin motivo.

*Proveedor PostgreSQL*
- `PostgreSqlDatabaseProvider` con Npgsql 10.
- `PostgreSqlQueryExecutor` sobre `DbCommand`/`DbDataReader`. **No reescribe el SQL**: el límite de filas se aplica al leer, no añadiendo `LIMIT`, porque modificar la consulta cambiaría su significado y su plan.
- `PostgreSqlMetadataReader` sobre los catálogos `pg_*`, con carga perezosa por nivel y recuento estimado desde `reltuples`.
- `PostgreSqlErrorNormalizer`: traduce excepciones a `QueryError` **saneado**, porque los mensajes del driver pueden traer la cadena de conexión.
- Los valores se formatean en cultura invariante: un `numeric` con la coma decimal de la máquina no se podría copiar de vuelta a una consulta.

*Aplicación e infraestructura*
- `ConnectionService`, `MetadataService` y `QueryService`.
- `QueryService.Validate` concentra las reglas comunes: solo lectura, confirmación de instrucciones destructivas y límites. **Confirmar un riesgo no permite saltarse el modo de solo lectura**, que tiene prioridad.
- `ProviderRegistry`, `SessionRegistry` y `QueryExecutionTracker` (cancelación con tokens enlazados).

*API local*
- Endpoints de motores, prueba de conexión, sesiones, metadatos, ejecución y cancelación.
- Middleware que traduce las excepciones conocidas: **ninguna traza llega al cliente**.
- Las sesiones se cierran al apagar el proceso.

*Frontend*
- `ApplicationGateway` ampliado con todo el contrato; `HttpApplicationGateway` traduce los DTO y clasifica los tipos de columna por nombre, no por motor.
- **`WorkspaceStore`**: conexiones, árbol perezoso, pestañas, ejecución y cancelación con Signals.
- Diálogo de nueva conexión según el mockup, con «Probar conexión».
- El árbol carga hijos al expandir y no vuelve a pedirlos; hay que actualizar el nodo explícitamente.
- Doble clic en una tabla abre una pestaña con su `SELECT`.
- Aviso de instrucción destructiva con «Ejecutar de todos modos».
- **Los datos simulados se borraron**, como estaba previsto.

*Pruebas*
- 21 contractuales contra PostgreSQL real: conexión válida e inválida, tipos, nulos, varios conjuntos de resultados, errores con su SQLSTATE, timeout, cancelación y metadatos.
- 15 de integración por HTTP, incluido el flujo completo y la comprobación de que **ninguna respuesta devuelve la contraseña**.
- 20 unitarias nuevas del analizador de SQL y las reglas de ejecución.

**Verificado ejecutando:**
- `dotnet build` y `ng build` — 0 advertencias.
- 90 pruebas de backend y 37 de frontend, todas pasan.
- Flujo completo por HTTP contra PostgreSQL 18.4: salud → motores → sesión → bases → esquemas → `SELECT` con nulo → cierre.
- `DELETE FROM pg_class` sin filtro devuelve **409** con el riesgo explicado, en lugar de ejecutarse.
- Proxy de Angular alcanzando la API y ésta la base.

**Incidencias resueltas:**
1. El puerto 55440 se eligió porque **55432 ya lo ocupaba `prima-postgres`**, un contenedor ajeno al proyecto. No se tocó ningún contenedor existente.
2. Una prueba destapó que `ALTER TABLE … DROP COLUMN` solo se marcaba como cambio de esquema, cuando **destruye datos**. Se amplió el patrón para tratarlo como DROP.
3. El diálogo de conexión superaba el presupuesto de estilos por 281 bytes. Aquí sí se subió el límite a 6 kB: partir un modal en dos componentes por eso habría sido peor que el problema.

**No hecho / decidido no hacer:**
- **Sin verificación visual**: la extensión de Chrome sigue sin estar conectada.
- El timeout está fijo en 30 s; exponerlo en la interfaz es de la Fase 5.
- No hay historial ni persistencia: la contraseña se pide en cada conexión. Es justo el objetivo de la Fase 3.
- No hay token entre Angular y la API. También Fase 3.
- Sin exportación a CSV/XLSX (Fase 6) ni plan de ejecución.

---

### Sesión 003 — 2026-08-11 · Fase 1 completa

**Objetivo:** reproducir el mockup como shell de Angular.

**Hecho:**

*Dependencias*
- Fuentes **Inter** y **JetBrains Mono** empaquetadas con `@fontsource` y cargadas desde `angular.json`. **D-07 resuelto**: verificado que el CSS servido tiene **cero** referencias a Google Fonts y que los WOFF2 salen del propio servidor.
- **Monaco Editor 0.56.0** copiado como recurso estático a `assets/monaco/vs`.

*Componentes* (todos `OnPush`, todos con los tokens, ningún color literal suelto salvo los pocos matices que aún no eran token)
- `layout/app-shell` — compone la ventana y sostiene el estado con Signals.
- `layout/top-bar` — marca, acciones, búsqueda global, controles de ventana.
- `layout/status-bar` — estado de sesión, motor, base, usuario, posición del cursor.
- `features/connections/connections-sidebar` — conexiones y árbol del explorador con sangría por nivel.
- `features/query-editor/editor-tabs` — pestañas con indicador de cambios sin guardar.
- `features/query-editor/editor-toolbar` — ejecutar, ejecutar selección, cancelar, formatear, contexto y timeout.
- `features/query-editor/sql-editor` — Monaco encapsulado; **ningún otro componente importa su API**.
- `features/query-results/results-panel` y `results-grid` — separados a propósito (ver «Incidencias»).
- `shared/ui/icon` — los 20 trazos del mockup en un solo sitio, con unión cerrada de nombres.
- `shared/ui/engine-badge` — el color por motor vive aquí y solo aquí, para no ramificar por motor en las plantillas (plan §13).
- `shared/ui/resize-handle` — arrastre con Pointer Events **y ajuste por teclado**, con `role="separator"` y valores ARIA.

*Editor*
- Tema `druse-dark` para Monaco derivado del mockup: violeta para reservadas, verde para literales, azul para identificadores.
- Creado fuera de la zona de Angular para no disparar detección de cambios en cada pulsación.
- `Ctrl/Cmd + Enter` ejecuta.
- Autocompletado por palabras del documento **desactivado**: sin esquema real solo estorba. Se activa en la Fase 5 con metadatos.

**Verificado:**
- `ng build` — 320 kB iniciales, 0 advertencias.
- `ng test` — 17 pruebas, todas pasan.
- `dotnet test` — 7 pruebas, siguen pasando.
- Servidor de desarrollo sirviendo `loader.js` de Monaco (39 kB) y los WOFF2 de ambas fuentes.

**Incidencias resueltas:**
1. **Monaco arrastraba una `dompurify` vulnerable** (3.4.8; avisos de XSS y de contaminación de configuración). `npm audit fix` proponía degradar Monaco a 0.53. En su lugar se añadió un `override` a `dompurify ^3.4.13`, que resuelve a la versión parcheada manteniendo Monaco 0.56.
2. **El panel de resultados superaba el presupuesto de estilos de Angular** (5,45 kB sobre 4 kB). En vez de subir el límite se extrajo `results-grid`, que además aísla justo la pieza que habrá que sustituir al resolver D-08.

**No hecho:**
- **Sin captura visual comparada con el mockup:** la extensión de Chrome no estaba conectada. La estructura está verificada por DOM y pruebas, pero falta el vistazo a ojo.
- El diálogo «Nueva conexión» del mockup **no se implementó**: pertenece a `connections`, no a la Fase 1.
- Quedan 3 vulnerabilidades moderadas en `@angular/cli` (su servidor MCP interno, vía `@hono/node-server`). Son de desarrollo, no llegan al bundle, y la única «solución» sería degradar Angular a la 21. Se espera actualización.

**Archivos:** 30 nuevos en `frontend/src/app`, más `angular.json` y `package.json`.

---

### Sesión 002 — 2026-08-11 · Fase 0 completa

**Objetivo:** montar el esqueleto del proyecto y cerrar la Fase 0.

**Hecho:**

*Estructura y repositorio*
- Creada la raíz `druse/` con el árbol del plan §4; movidos el plan, la bitácora y los mockups.
- Mockups renombrados: `druse-main.html` (referencia) y `druse-main-v0.html` (versión previa).
- `git init` en la rama `main`. `.gitignore` de .NET ampliado con Node, Angular, Tauri, artefactos de empaquetado y, sobre todo, bases SQLite, `.env` y `appsettings.Local.json` — nada de datos de usuario ni secretos en el repositorio.
- `.editorconfig` con convenciones de C#, TypeScript y SCSS, más reglas de nomenclatura y de diagnóstico alineadas con el plan.

*Backend*
- Solución con los 13 proyectos (10 en `src`, 3 en `tests`), todos en `Druse.slnx`.
- Grafo de referencias del plan §10 aplicado y verificado.
- `Directory.Build.props` con `net10.0`, `Nullable`, `TreatWarningsAsErrors` y `AnalysisLevel=latest-recommended`.
- `GET /api/health` implementado. Kestrel con `ListenLocalhost`: **verificado con `Get-NetTCPConnection` que solo escucha en `127.0.0.1` y `::1`**, nunca en `0.0.0.0`.
- 4 pruebas de arquitectura que leen los `.csproj` y hacen fallar la compilación si se rompe la dirección de dependencias, si el núcleo toca un driver o si un proveedor referencia a otro.
- 3 pruebas de integración de `/api/health`, incluida una que comprueba que la respuesta no filtra credenciales.

*Frontend*
- Angular 22.1.0 generado, zoneless y con Signals; encaja con la decisión del plan de no usar NgRx.
- Estructura de carpetas `core / shared / layout / features/*`.
- **Design tokens** en `src/styles/_tokens.scss` con toda la paleta, tipografías y medidas del mockup (§7).
- `ApplicationGateway` abstracto + `HttpApplicationGateway`, registrados en un único punto de `app.config.ts`. Ningún componente conoce host, puerto ni `HttpClient`.
- Proxy de desarrollo `/api` → `127.0.0.1:5177`.
- Pantalla provisional que verifica la conexión con la API, con 4 pruebas.

*Documentación e integración continua*
- `README.md` con requisitos, comando único y estructura.
- Tres ADR: arquitectura hexagonal, transporte local en loopback y estrategia multiplataforma.
- `build/scripts/dev.ps1` y `dev.sh`: **un solo comando** arranca API y frontend, espera a que la API responda y la detiene al salir.
- `.github/workflows/ci.yml` con matriz Windows/Linux/macOS para backend y frontend, más un job que publica la API autocontenida por Runtime Identifier.

**Verificado de verdad, no asumido:**
- `dotnet build` — 0 advertencias, 0 errores.
- `dotnet test` — 7 pruebas, todas pasan.
- `npm run build` — 220 kB iniciales.
- `npm test` — 4 pruebas, todas pasan.
- `GET /api/health` con la API real levantada → `200 OK`.
- Binding de red comprobado con `Get-NetTCPConnection`.
- `dotnet publish -r win-x64 --self-contained` → ejecutable de 107 MB generado correctamente.

**Incidencias resueltas:**
1. **Vulnerabilidad en la plantilla.** La plantilla `webapi` de .NET 10 arrastra `Microsoft.OpenApi` 2.0.0, con CVE-2026-49451 (GHSA-v5pm-xwqc-g5wc, CVSS 7.5, desbordamiento de pila con referencias circulares de esquema). `TreatWarningsAsErrors` lo convirtió en error de compilación. Elevado a 2.7.5 con una referencia directa comentada en el `.csproj`. **Revisar en futuras actualizaciones del SDK si ya viene elevada.**
2. **`.slnx` en vez de `.sln`.** .NET 10 genera el formato nuevo. Se mantiene; el plan quedó actualizado.
3. **CA1707 contra los nombres de prueba.** Los analizadores prohibían los guiones bajos de `Metodo_Escenario`. Desactivada solo para `tests/` mediante un `Directory.Build.props` propio.

*Cierre*
- `.gitattributes` que normaliza a LF. Sin él, `core.autocrlf` de Windows convertía todo a CRLF y `dev.sh` habría dejado de funcionar en Linux: `#!/usr/bin/env bash\r` no es un intérprete válido. Los `.ps1` y `.cmd` quedan forzados a CRLF.
- Commit inicial `4ba1319`: 71 archivos, 4861 inserciones. Sin remoto configurado.

**No hecho:**
- `Druse.ProviderContractTests` está vacío a propósito: se llena en las Fases 2 y 4.
- Sin trimming ni ReadyToRun en la publicación (107 MB). Optimizar en la Fase 7.

**Archivos creados/modificados:** 70 archivos versionables. Los principales:
- `README.md`, `.editorconfig`, `.gitignore`, `.github/workflows/ci.yml`
- `backend/Directory.Build.props`, `backend/tests/Directory.Build.props`
- `backend/src/Druse.Host.LocalApi/Program.cs`
- `backend/tests/Druse.UnitTests/ArchitectureRulesTests.cs`
- `backend/tests/Druse.IntegrationTests/HealthEndpointTests.cs`
- `frontend/src/styles/_tokens.scss`, `frontend/src/styles.scss`
- `frontend/src/app/core/application-gateway/*`, `app.ts`, `app.html`, `app.scss`, `app.config.ts`, `app.spec.ts`
- `frontend/proxy.conf.json`, `frontend/angular.json`
- `build/scripts/dev.ps1`, `build/scripts/dev.sh`
- `docs/decisions/0001…0003`

---

### Sesión 001 — 2026-08-11 · Arranque

**Hecho:**
- Analizado el plan completo y los dos mockups; confirmado el de referencia.
- Extraídas paleta, tipografías y medidas del mockup (§7).
- Verificado el toolchain instalado.
- **Cambio de nombre:** «Quarzo Studio» → **Druse**, con verificación previa de colisiones. Se descartó Geode por Apache Geode.
- Renombradas las 40 referencias del plan y el archivo a `PLAN_TRABAJO_DRUSE.md`.
- Creada esta bitácora.

**Notas:** el cambio de nombre se hizo antes de generar código, así que no hubo que tocar namespaces ni `.csproj`.

---

## 6. Decisiones

### Tomadas

| ID | Decisión | Resuelto |
| --- | --- | --- |
| D-01 | **Raíz del repositorio: `druse/`** dentro de `P:\Proyectos\Trabajo\DB STUDIO`. La carpeta contenedora conserva su nombre; el repositorio lleva el del producto. | 2026-08-11 |
| D-02 | **Mockup de referencia: `docs/mockups/druse-main.html`** (antes `Quarzo Studio.dc .html`). Incluye el diálogo «Nueva conexión»; el otro queda como `druse-main-v0.html`. El diseño se mantiene tal cual. | 2026-08-11 |
| D-03 | **El mockup HTML es la fuente de verdad**, no un PNG. Los tokens ya se extrajeron a SCSS; la comparación visual se hará por captura. | 2026-08-11 |
| D-04 | **Angular 22.1.0**, zoneless, con Signals y Vitest. Sin NgRx hasta que haya necesidad comprobada. | 2026-08-11 |
| D-05 | **Nombre del producto: Druse**, sin sufijo. Ver §3. | 2026-08-11 |
| D-07 | **Fuentes empaquetadas con `@fontsource`**, no enlazadas desde Google Fonts. La aplicación funciona sin conexión. Inter y JetBrains Mono son de licencia abierta (SIL OFL). | 2026-08-11 |
| D-09 | **Formato de solución `.slnx`**, el nuevo de .NET 10. Requiere VS 2022 17.13+ o Rider recientes. | 2026-08-11 |
| D-12 | **Monaco se carga con su cargador AMD desde `assets`**, no como ESM a través del bundler. Sus *web workers* se resuelven solos y queda fuera del bundle inicial. Encapsulado por completo en `SqlEditor`. | 2026-08-11 |
| D-13 | **`dompurify` fijado con `override` a ^3.4.13** en lugar de degradar Monaco. Revisar cuando Monaco actualice su dependencia. | 2026-08-11 |
| D-17 | **Sin almacén seguro no se guarda la contraseña.** Se pide en cada conexión y se dice en la interfaz. Cifrar un archivo con una clave del mismo disco sería seguridad aparente. Ver ADR 0004. | 2026-08-11 |
| D-18 | **Token obligatorio en la API local**, salvo `/api/health`. El proxy de desarrollo lo lee del disco y lo inyecta, porque el navegador no puede. | 2026-08-11 |
| D-08 | **Cuadrícula propia, sin biblioteca externa.** Con el límite de 500 filas la rejilla CSS va sobrada, y exportar —que es donde aparecen los volúmenes grandes— no pasa por ella. Revisar solo si algún día se sube ese tope. | 2026-08-12 |
| D-16 | **Sin paginación.** Exportar cubre el caso de «quiero todo», y para acotar está el `WHERE` de la consulta. Paginar obligaría a reescribir el SQL del usuario con `OFFSET` o a mantener un cursor abierto, y ninguna de las dos cosas compensa. | 2026-08-12 |
| D-19 | **`proxy.conf.json` → `proxy.conf.js`**: el proxy necesita lógica para leer el token en cada petición. No se cachea, para que reiniciar la API no obligue a reiniciar el servidor de desarrollo. | 2026-08-11 |
| D-10 | **La integración continua no genera instaladores todavía.** Compila, prueba y verifica la publicación autocontenida. El empaquetado llega en la Fase 7 (ADR 0003). | 2026-08-11 |

### Abiertas

| ID | Decisión | Opciones | Estado |
| --- | --- | --- | --- |
| D-15 | Selector de base de datos | PostgreSQL no permite cambiar de base sin reconectar, así que el explorador solo muestra los esquemas de la base de la sesión. Falta decidir si abrir una sesión nueva por base o pedirle al usuario que cree otra conexión. | Abierta — Fase 4, al comparar con SQL Server |
| D-11 | Optimización del ejecutable | La publicación autocontenida pesa 107 MB. Evaluar trimming y ReadyToRun. | Abierta — Fase 7 |
| D-14 | Estado del shell | Hoy vive en Signals dentro de `AppShell`. Al llegar los datos reales hay que decidir si se reparte en servicios por funcionalidad. Sigue en pie no incorporar NgRx sin necesidad comprobada. | Abierta — Fase 2 |

_D-06 (wordmark) quedó resuelta al construir el shell: la barra superior dice «Druse». El HTML del mockup no se retocó._

---

## 7. Referencia extraída del mockup

Fuente: `docs/mockups/druse-main.html`. **Ya implementado** en `frontend/src/styles/_tokens.scss`; esta tabla queda como referencia legible.

### Paleta

| Rol | Token | Hex |
| --- | --- | --- |
| Fondo exterior / ventana | `--dr-surface-outer` | `#07080B` |
| Fondo principal (editor, main) | `--dr-surface-base` | `#0B0D11` |
| Superficie de paneles | `--dr-surface-panel` | `#0E1219` |
| Top bar | `--dr-surface-topbar` | `#101420` |
| Barra de estado | `--dr-surface-statusbar` | `#0C1018` |
| Encabezado de cuadrícula | `--dr-surface-grid-header` | `#121824` |
| Superficie elevada / botón | `--dr-surface-raised` | `#1B2233` |
| Borde principal | `--dr-border` | `#1E2534` |
| Borde secundario | `--dr-border-subtle` | `#232A38` |
| Acento primario | `--dr-accent` | `#6C8BFF` |
| Acento claro (hover/iconos) | `--dr-accent-bright` | `#9FB0FF` |
| Acento secundario (violeta) | `--dr-accent-alt` | `#9A7CFF` |
| Éxito / conectado | `--dr-success` | `#3DDC97` |
| Texto principal | `--dr-text` | `#E4E8F1` |
| Texto secundario | `--dr-text-secondary` | `#C9D3E6` |
| Texto atenuado | `--dr-text-muted` | `#B9C2D4` |
| Texto terciario | `--dr-text-tertiary` | `#8B96AB` |
| Texto tenue | `--dr-text-faint` | `#66728A` |

### Tipografías

- UI: **Inter** (400, 500, 600, 700), tamaño base 13px.
- Código / SQL: **JetBrains Mono** (400, 500, 700).
- Ver D-07: hay que empaquetarlas, no enlazarlas.

### Medidas del layout (lienzo 1440×900)

| Zona | Token | Medida |
| --- | --- | --- |
| Top bar | `--dr-topbar-height` | 46px |
| Sidebar de conexiones | `--dr-sidebar-width` | 274px (redimensionable) |
| Encabezado de sidebar | `--dr-sidebar-header-height` | 38px |
| Barra de pestañas | `--dr-tabs-height` | 36px |
| Toolbar del editor | `--dr-editor-toolbar-height` | 42px |
| Canaleta de números de línea | `--dr-editor-gutter-width` | 44px |
| Panel de resultados | `--dr-results-height` | 322px (redimensionable) |
| Encabezado de resultados | `--dr-results-header-height` | 36px |
| Encabezado de la cuadrícula | `--dr-grid-header-height` | 31px |
| Barra de estado | `--dr-statusbar-height` | 26px |
| Radio de la ventana | `--dr-radius-window` | 10px |

---

## 8. Seguimiento por fases

| Fase | Descripción | Estado |
| --- | --- | --- |
| 0 | Preparación y decisiones | ✅ **Cerrada** — 9/9 |
| 1 | Shell visual basado en el mockup | ✅ **Cerrada** — 8/8 |
| 2 | Flujo vertical PostgreSQL | ✅ **Cerrada** — 11/11 |
| 3 | Persistencia local y seguridad | ✅ **Cerrada** — 10/10 |
| 4 | SQL Server | ✅ **Cerrada** — 9/9 |
| 5 | Productividad del editor | ✅ **Cerrada** — 10/10 |
| 6 | Resultados y exportaciones | ✅ **Cerrada** — 9/9 |
| 7 | Empaquetado de escritorio | 🔄 **Activa** — 0/12 |
| 8 | MySQL y estabilización | ⬜ No iniciada |

### Fase 0 — criterio de salida ✅

> «La solución compila, Angular inicia, la API responde en `/api/health` y existe un único comando documentado para ejecutar ambos proyectos en desarrollo.»

Los cuatro puntos están verificados con ejecución real, no por inspección.

### Fase 1 — criterio de salida ✅

> «La pantalla reproduce el mockup con proporciones, colores y comportamiento de paneles consistente, todavía sin conexión real.»

Proporciones y colores salen de los tokens extraídos del propio mockup, y los dos paneles se redimensionan con ratón y con teclado. **Pendiente el visto bueno a ojo**: la comparación por captura no se pudo hacer.

### Fase 2 — criterio de salida ✅

> «Un usuario puede conectarse a PostgreSQL, navegar hasta una tabla, ejecutar un `SELECT`, ver el resultado y cancelar una consulta larga.»

Los cinco pasos están verificados contra PostgreSQL 18.4 real, no simulado.

### Fase 3 — criterio de salida ✅

> «Cerrar y abrir la aplicación conserva conexiones, historial y preferencias sin almacenar contraseñas legibles.»

Verificado reiniciando la API de verdad: el perfil sobrevivió, abrió sesión sin reenviar la contraseña, y **una búsqueda byte a byte en todos los archivos locales no encontró la contraseña por ninguna parte**.

### Fase 4 — detalle

- [ ] Crear `SqlServerDatabaseProvider`.
- [ ] Implementar autenticación SQL Server.
- [ ] Evaluar autenticación integrada de Windows como tarea separada.
- [ ] Obtener bases, esquemas, tablas, vistas, procedimientos y columnas.
- [ ] Ejecutar consultas T-SQL.
- [ ] Normalizar mensajes y errores.
- [ ] Probar múltiples conjuntos de resultados.
- [ ] Verificar timeout y cancelación.
- [ ] Ejecutar las pruebas contractuales compartidas por proveedores.

**Criterio de salida:** las mismas funciones visibles del MVP trabajan con PostgreSQL y SQL Server sin condicionales del motor dentro de los componentes Angular.

**Prerrequisito:** un SQL Server de prueba. Ampliar `build/scripts/test-db.ps1` con `mcr.microsoft.com/mssql/server`.

**Lo que de verdad se pone a prueba:** las 21 pruebas contractuales deben pasar contra SQL Server **sin cambiar lo que comprueban**. Si alguna hay que retocar, es señal de que se coló una fuga de dialecto en las abstracciones.

---

## 9. Riesgos y notas técnicas abiertas

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| **Sin SQL Server de prueba** | **Bloquea la Fase 4, que es la activa** | Contenedor `mcr.microsoft.com/mssql/server`; ampliar `test-db.ps1` |
| Solo hay un proveedor implementado | Las abstracciones no están validadas de verdad | La Fase 4 es justo esa prueba: las contractuales deben pasar tal cual |
| macOS pasa la contraseña por argumento a `security` | Visible un instante en la lista de procesos | Enlazar Security.framework. Anotado en ADR 0004 |
| Contenedor `druse-pg-test` en el 55440 | El 55432 lo ocupa `prima-postgres`, ajeno al proyecto | Puerto configurable con `DRUSE_TEST_PG_PORT` |
| Rust no instalado | Bloquea la Fase 7 | Instalar antes de empezarla; no urge |
| Ejecutable de 107 MB | Instalador pesado | D-11: trimming y ReadyToRun en la Fase 7 |
| Dependencias con vulnerabilidades en plantillas | Ya pasó dos veces: `Microsoft.OpenApi` y `dompurify` | En backend lo caza `TreatWarningsAsErrors`; en frontend, `npm audit` en cada instalación |
| 3 vulnerabilidades moderadas en `@angular/cli` | Solo desarrollo; no llegan al bundle | Esperar actualización de Angular. Degradar a la 21 sería peor |
| Fidelidad visual no comprobada a ojo | El shell podría desviarse del mockup en detalles | Revisar con `npm start` junto a `docs/mockups/druse-main.html` |
| Los datos simulados podrían filtrarse a producción | `mock-workspace.ts` es solo de la Fase 1 | Debe borrarse en la Fase 2. Ningún componente lo importa: solo `AppShell` |
| Identificador `druse` no reservado | Podría ocuparlo otro | Reservar dominio, org de GitHub y NuGet/npm cuando haya algo publicable |

---

## 10. Convención para actualizar esta bitácora

Al cerrar cada sesión:

1. Agregar una entrada nueva en §5, arriba de las anteriores (**Hecho**, **Verificado**, **No hecho**, **Archivos**).
2. Actualizar la tabla de §1 y el «Qué toca retomar».
3. Mover a **Decisiones tomadas** lo que se haya resuelto en §6.
4. Actualizar los checkboxes de §8 y del plan maestro.
5. Registrar cualquier riesgo nuevo en §9.
