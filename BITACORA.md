# Bitácora de seguimiento — Druse

> Documento vivo. Se actualiza **al final de cada sesión de trabajo**.
> El plan maestro (alcance, arquitectura, fases) vive en `PLAN_TRABAJO_DRUSE.md`.
> Esta bitácora responde solo a tres preguntas: **qué se hizo**, **en qué estado quedó** y **qué toca retomar**.

---

## 1. Estado actual

| Campo | Valor |
| --- | --- |
| Última sesión | **011** — 2026-08-12 |
| Fase activa | **Ninguna: las ocho fases están cerradas.** Queda validar el MVP en otro equipo |
| Fases 0–6 | ✅ Cerradas. |
| Fase 7 | 🟡 **10/12.** Hay instalador y funciona; faltan dos comprobaciones que exigen otro equipo. |
| Fase 8 | ✅ **7/7.** Tres motores sobre el mismo contrato y primera beta preparada. |
| ¿Compila el backend? | Sí — 0 advertencias, 0 errores |
| ¿Compila el envoltorio? | Sí |
| ¿Pasan las pruebas? | Sí — **269 en backend** y **120 en frontend** |
| ¿Hay aplicación de escritorio? | **Sí.** Instalador NSIS, MSI y ZIP portable |
| Motores | **PostgreSQL, SQL Server y MySQL/MariaDB**, con las **mismas 24 pruebas contractuales** cada uno |
| Bloqueantes | Ninguno |
| Git | `main`, con la Fase 8 ya fusionada (`dd9244b`). Sin remoto configurado. |

### Qué toca retomar en la próxima sesión

1. Lo único que impide dar el MVP por terminado **necesita otro equipo**:
   - instalar, actualizar y desinstalar de verdad, para validar el ciclo completo;
   - arrancar en una máquina sin .NET ni Node, que es el criterio que demuestra que el paquete se basta solo.
2. Artefactos de Linux y macOS: el script acepta cualquier RID, pero generarlos exige compilar en cada plataforma. Es trabajo de integración continua.
3. **Probar la edición de filas a mano**: editar una celda, ver el SQL y confirmar. Es lo único de lo entregado que no se ha recorrido en el navegador.
4. **De las tres que pidió el usuario** (plan §15), la edición de filas ya está. Quedan **importar CSV/Excel** —que reutiliza sus mismas protecciones— y la **ayuda para componer consultas**, que es la única de las tres que no escribe en los datos.

**El visto bueno visual ya está dado** (sesión 011, con la extensión de Chrome por fin conectada): la pantalla reproduce el mockup. Lo único ausente es la pestaña «Plan de ejecución», que está fuera del MVP.

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
| Rust / cargo | 1.97.1 | OK |
| MSVC Build Tools | 14.44.35207 + SDK 10.0.26100 | OK — el enlazador que Rust necesita en Windows |
| Tauri CLI | 2.11.4 | OK |

Pendiente de verificar cuando toque: Docker (pruebas de integración con contenedores), instancias PostgreSQL y SQL Server de prueba (Fases 2 y 4).

---

## 5. Registro de sesiones

### Sesión 011 — 2026-08-12 · Fase 8, MySQL y primera beta

**Objetivo:** el tercer motor y cerrar el ciclo. Era la fase más previsible: el contrato compartido iba a decir en un minuto si el proveedor estaba bien.

**Hecho:**

*Proveedor MySQL*
- `MySqlDatabaseProvider`, `MySqlQueryExecutor`, `MySqlMetadataReader`, `MySqlResultReader`, `MySqlErrorNormalizer`, `MySqlValueFormatter` y `MySqlConnectionStringFactory` con MySqlConnector 2.6.2.
- Registrado en la composición: **tres líneas**, sin tocar Domain, Application ni un solo componente Angular. Es justo lo que el plan §14 pedía demostrar.
- Metadatos sobre `information_schema`, al revés que los otros dos: MySQL no tiene un catálogo interno que aporte más, y ahí ya están el recuento aproximado (`TABLE_ROWS`) y el tipo completo de cada columna (`COLUMN_TYPE`, que da `varchar(200)` donde `DATA_TYPE` solo daría `varchar`).
- Cuatro opciones del driver elegidas a conciencia, cada una con su motivo en el código: `ConvertZeroDateTime` (las fechas cero de MySQL no caben en .NET y reventarían a mitad de un resultado), `GuidFormat=None` (un `CHAR(36)` que no sea un GUID es legítimo y debe verse tal cual), `TreatTinyAsBoolean` (es lo que hace que un `BOOL` se lea `true` igual que en los otros motores) y `AllowUserVariables` (un cliente SQL tiene que poder ejecutar `SET @x = …`).

*Las 24 pruebas contractuales, otra vez sin tocarlas*
- **72 en verde: las mismas 24 contra PostgreSQL 18.4, SQL Server 2022 y MySQL 8.4.** Ninguna comprobación tuvo que cambiarse.
- Lo que sí varía queda declarado en el fixture: `SLEEP` frente a `pg_sleep` y `WAITFOR`, `SIGNAL SQLSTATE '01000'` frente a `RAISE NOTICE` y `PRINT`, el error 1064 frente a `42601` y 102, y el esquema por omisión, que en MySQL es la propia base.
- **MariaDB 11.4 supera las mismas 24 con el proveedor de MySQL**, así que la compatibilidad que declara el código está comprobada y no supuesta.

*Estabilización*
- Regresión: una prueba nueva comprueba que **todo motor anunciado tiene sus tres piezas registradas**. Sin ella, olvidar el lector de metadatos de un proveedor futuro no falla al arrancar: el motor aparece en la lista y revienta luego, al abrir el árbol.
- Los tres motores y sus puertos, comprobados por HTTP; `test-db.ps1`, `test-db.sh` y la integración continua levantan ahora los tres.
- Dos pruebas de frontend para el dialecto MySQL, incluida la que protege las comillas invertidas: son lo que permite que una columna se llame `order`.

*Primera beta*
- `docs/release-notes/0.1.0-beta.md`: qué trae, con qué números se comprobó y **qué no garantiza todavía**.
- La versión se queda en `0.1.0` sin sufijo (ver D-23).

**Un fallo encontrado, y lo que destapó:**

De las 24, una falló: **el tiempo de espera daba la consulta por completada**. MySqlConnector agota `CommandTimeout` mandando `KILL QUERY` desde otra conexión, pero el servidor no siempre convierte esa interrupción en error: un `SELECT SLEEP(30)` cortado **termina bien y devuelve una fila**. La consulta que el usuario dio por caducada se anunciaba como correcta, con datos incompletos. Ahora el plazo lo controla el proveedor con su propio token y `CommandTimeout` queda a cero: así se distingue quién cortó, si el reloj o el usuario. Es exactamente el tipo de diferencia que el contrato compartido existe para encontrar.

**Verificado con la aplicación en marcha, contra MySQL 8.4 real** (37 tenants, 412 empresas, 1 284 usuarios y 9 630 documentos):
- Los **tres motores** en `/api/engines` con sus puertos.
- Sesión abierta **sin reenviar la contraseña**, y la respuesta no la contiene.
- Árbol completo: base → esquema → carpetas → tablas con recuento, más vistas, funciones y procedimientos.
- Columnas con su tipo entero: `varchar(200)`, `decimal(12,2)`, `tinyint(1)`, `timestamp`, clave primaria y valores por defecto.
- Tipos normalizados: el `BOOL` de MySQL llega como `true`/`false` **igual que el `boolean` de PostgreSQL y el `bit` de SQL Server**; decimales en cultura invariante; binarios como `0x…`; nulos distintos de la cadena vacía; acentos intactos («André Sáez», «Ömer Çelik»).
- `SET @total = …; SELECT @total := …` funciona, y los parámetros con nombre de las consultas de catálogo siguen funcionando.
- Avisos del servidor recogidos («aviso desde MySQL»), error de sintaxis con código 1064, `DELETE` sin filtro → **409**, 9 630 filas recortadas a 500 con `truncated`.
- **Cancelación en vivo: `SLEEP(30)` cortado a los 2,8 s.**
- **9 630 filas exportadas a CSV en 0,06 s**, con BOM y acentos correctos.
- Tiempos (mediana de 10): metadatos **~5 ms**, `SELECT` de 500 filas **~26 ms**, abrir y cerrar sesión **~5 ms**.
- **Memoria plana: 44 MB antes y 42 MB después de tres exportaciones completas seguidas.** La lectura progresiva hace lo que promete.

**Verificación visual, por fin (la extensión de Chrome se conectó a mitad de sesión):**
- Se compararon lado a lado el mockup y Druse a 1440×900, con la aplicación conectada a MySQL y una consulta ejecutada. **La pantalla reproduce el mockup**: proporciones de los paneles, barra superior, pestañas, barra de herramientas, cuadrícula con tipos por columna, panel de resultados y barra de estado.
- Diferencias, todas conocidas: el wordmark dice «Druse» y no «Quarzo Studio» (D-05/D-06) y **falta la pestaña «Plan de ejecución»**, que el mockup enseña pero está fuera del MVP (backlog §15, prioridad media).
- De paso quedó comprobado el flujo de MySQL **desde la interfaz**, no solo por HTTP: diálogo con MySQL ya seleccionable, «Conexión correcta con MySQL 8 en 160 ms», árbol con recuentos, doble clic en una tabla generando `SELECT * FROM druse_test.usuarios LIMIT 100;` —dialecto correcto, no `TOP`— y 100 filas en 13 ms con booleanos en verde y rojo, nulos marcados y acentos intactos.

**Un fallo de interfaz encontrado mirando, que ninguna prueba veía:** la barra del editor escribía **`druse_test.public`**. El esquema estaba puesto a fuego desde la Fase 1, copiado del mockup: `public` es el esquema por omisión de PostgreSQL y de nadie más —en SQL Server es `dbo` y en MySQL no existe—, así que la aplicación mentía en dos motores de tres. Ahora el esquema solo se muestra cuando el árbol ha cargado uno y solo uno y no coincide con el nombre de la base. Dos pruebas nuevas lo fijan: una comprueba que MySQL no dice `public`, y otra que PostgreSQL **sí** sigue diciendo `druse_test.public`, para que arreglar un motor no rompa el otro.

**Incidencia del entorno, no del producto:** los acentos aparecían dobles («AndrÃ©»). No era Druse: el guion de carga entró por el cliente `mysql` sin `--default-character-set=utf8mb4` y los grabó doblemente codificados. Se comprobó con `HEX(nombre)` —`C383C2A9` en vez de `C3A9`— y al recargar bien salieron correctos de punta a punta. Merece quedar escrito para que la próxima lectura no lo confunda con un fallo del proveedor.

**No hecho, y por qué:** lo mismo que quedó de la Fase 7 —instalar de verdad y probar en un equipo limpio— sigue necesitando otra máquina.

---

#### Después de cerrar la Fase 8, usando la beta contra una base real

El usuario abrió su SQL Server de preproducción y lo que salió no estaba en ningún plan. Todo esto vino de usarla, no de leerla:

1. **El explorador no podía listar tablas** en su base. El recuento de filas salía de una DMV que exige `VIEW DATABASE STATE`, un permiso que un usuario de aplicación no tiene: el servidor respondía 262 y el usuario se quedaba sin ver **ninguna** tabla por culpa de un número informativo. Ahora sale de `sys.partitions`, que solo exige poder ver la tabla, y detrás queda un respaldo que lista sin recuento si aun así lo rechazan. Los números de error están comprobados en los dos entornos: 262 en Azure SQL, 297 en SQL Server 2022.

2. **El autocompletado se apagaba tras el punto de un esquema.** Se buscaba una tabla llamada `tpublico`; como no existía, la lista salía vacía justo donde más falta hace: en una base cuyo esquema no es el de por omisión. De paso, las columnas solo se conocían si la tabla se había expandido a mano, cosa que nadie hace con cientos de tablas. Ahora el catálogo **se precalienta al conectar** —hasta 20 esquemas, y el resto al escribir `esquema.`— y las columnas se piden la primera vez que se pregunta por una tabla.

3. **Una conexión no ejecuta dos cosas a la vez**, y el precalentado pedía tablas y vistas en paralelo: SQL Server respondía que no admite MultipleActiveResultSets. El fallo lo destapó el precalentado pero no era suyo —bastaba con expandir dos nodos seguidos—, así que cada sesión tiene ahora su turno en el servidor.

4. **IntelliSense**, a petición del usuario: tooltip con el tipo de cada columna, tipos en el desplegable, plantillas por motor y avisos que subrayan lo que el catálogo desmiente. La regla de los avisos es callar si no se está seguro: un aviso falso sobre SQL correcto enseña a ignorarlos.

5. **Edición de filas en la cuadrícula**, la primera vez que Druse escribe en los datos del usuario. Las reglas viven en el caso de uso, no en la interfaz: clave primaria obligatoria, la clave se lee del catálogo, no se toca la clave primaria, transacción, parámetros, el SQL a la vista antes de confirmar y **una fila por instrucción** —si toca cero o más de una, se deshace todo—.

6. **Los errores del motor llegan a la pantalla.** Un permiso que falta o una contraseña incorrecta salían como 500 con «se produjo un error inesperado» y el motivo se quedaba en el log. Ahora salen como 409 con el mensaje del motor y su código, ya saneado: se comprobó que la contraseña rechazada no aparece dentro.

**Al día:** 269 pruebas de backend y 120 de frontend.

**Sin verificar todavía:** el recorrido completo de la edición de filas en el navegador —editar, ver el SQL, confirmar—. La cadena que decide si una tabla es editable sí se comprobó en la aplicación real; el clic final lo hará el usuario.

**Decisiones tomadas:** D-20 a D-23 (ver §6).

---

### Sesión 010 — 2026-08-12 · Fase 7, aplicación de escritorio

**Objetivo:** que Druse deje de ser una pestaña del navegador.

**Instalación del entorno**
- Rust 1.97.1 con rustup, añadido al PATH del usuario.
- **El instalador oficial de Rust no viene firmado.** Es conocido y ha sido objeto de debate en el propio proyecto; se descargó de `win.rustup.rs` por HTTPS.
- Faltaba el enlazador de C++. Hubo que instalar Build Tools 2022 con el componente de C++ y el SDK de Windows: **4 GB de descarga**.

**Hecho:**

*Puerto dinámico*
- La API acepta `LocalApi:Port=0` y pide un puerto libre al sistema. Un puerto fijo puede estar ocupado por otro programa o por otra instancia.
- `LocalApiEndpoint` sustituye a `LocalApiToken`: publica **puerto, token y PID** en `endpoint.json`, dentro del directorio de datos. Quien pueda leer ese archivo tiene todo lo necesario para hablar con la API; quien no, nada.
- El archivo se escribe al arrancar el servidor, no en el constructor: con puerto dinámico el número real no existe antes.

*Envoltorio Tauri*
- Lanza la API como proceso auxiliar, espera a que publique su punto de conexión y **la mata al cerrar la ventana**.
- Expone un único comando, `api_connection`, que da al frontend el puerto y el token. Es toda su razón de ser: el navegador no puede leer archivos del disco.
- **No contiene lógica de base de datos** (ADR 0001).
- Icono generado a partir del logo del mockup: rombo sobre degradado azul-violeta.

*Frontend*
- `DesktopHost` detecta si corre dentro del envoltorio y le pide los datos de conexión.
- `apiInterceptor` antepone el host y añade el token **solo cuando hace falta**. En desarrollo no toca nada, porque de eso se encarga el proxy.
- **Es el único sitio del frontend que distingue navegador de escritorio.** Ni el gateway ni los componentes lo saben.

*Empaquetado*
- `package.ps1` publica la API autocontenida, compila el frontend y construye el instalador. Con `-Portable`, además un ZIP.
- `msvc-env.ps1` carga el entorno de MSVC antes de compilar.

**Verificado ejecutando la aplicación de verdad:**
- Se generaron **NSIS (44 MB), MSI (58 MB) y ZIP portable (62 MB)**.
- La aplicación abre, **arranca su propia API en un puerto asignado por el sistema** (56201 en la prueba) y responde.
- **La versión portable funciona extraída en un directorio limpio**, con la API en otro puerto (65088).
- Al cerrar la ventana **no queda ningún proceso vivo** y el `endpoint.json` desaparece.
- 192 pruebas de backend y 76 de frontend.

**Incidencias resueltas:**
1. **`ListenLocalhost(0)` no admite puerto dinámico**: abriría dos sockets, IPv4 e IPv6, y cada uno recibiría un puerto distinto. Se pasó a `Listen(IPAddress.Loopback, 0)`.
2. **winget no pasó el `--override`**: instaló el bootstrapper de Build Tools sin el componente de C++, y en el registro no aparecía VCTools por ninguna parte. Se resolvió con el instalador oficial de Microsoft directamente.
3. **Rust elegía el `link.exe` equivocado.** Conviven varias instalaciones de Visual Studio y la detección automática tomaba una que tiene el enlazador pero no las librerías, fallando con «no se puede abrir el archivo msvcrt.lib». Un `.cargo/config.toml` con otro enlazador **no resolvía nada** —el problema eran las rutas de librerías, no el enlazador— así que se hizo bien: cargar el entorno de MSVC.
4. **El glob de recursos `api/*` fallaba** cuando la API no estaba publicada. Se versiona un `.gitkeep`.
5. **`endpoint.json` sobrevivía al cierre**, porque Tauri mata la API sin darle tiempo a limpiar. Ahora lo borra el propio envoltorio.

**No hecho, y por qué:**
- **Instalar y desinstalar de verdad**: modificaría el sistema del usuario. Requiere su decisión.
- **Probar en un equipo limpio**: hace falta otra máquina. Es el criterio que de verdad demuestra que no se necesita .NET ni Node.
- **Artefactos de Linux y macOS**: exigen compilar en cada plataforma. Trabajo de integración continua, no de esta máquina.

---

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
| D-20 | **En MySQL el árbol conserva el nivel de esquema**, con un nodo del mismo nombre que su base. `SCHEMA` es allí un sinónimo de `DATABASE`, así que el nivel es redundante; aun así se mantiene para que el explorador se comporte igual en los tres motores. La alternativa sería un árbol distinto solo para MySQL, y eso obligaría a ramificar por motor en la interfaz (plan §13). | 2026-08-12 |
| D-21 | **El tiempo de espera de MySQL lo controla el proveedor, no `CommandTimeout`.** El driver corta con `KILL QUERY` y hay instrucciones que al ser interrumpidas terminan «bien»: la consulta caducada se anunciaba como completada. Con un token propio se distingue el reloj del usuario. | 2026-08-12 |
| D-22 | **Cuatro opciones fijadas en la cadena de conexión de MySQL**: `ConvertZeroDateTime`, `GuidFormat=None`, `TreatTinyAsBoolean` y `AllowUserVariables`. Las tres primeras existen porque Druse muestra datos de bases ajenas y no puede reventar ante un `0000-00-00` o un `CHAR(36)` que no sea un GUID; la cuarta, porque un cliente SQL tiene que poder ejecutar `SET @x = …`. | 2026-08-12 |
| D-23 | **La primera beta es la `0.1.0`, sin sufijo de prerrelease.** Un `0.x` ya dice que es una beta, y los instaladores MSI de Windows exigen una versión de tres partes numéricas: añadir `-beta.1` sería arriesgar el empaquetado para repetir algo que el número ya comunica. Lo que sí se declara por escrito son sus límites, en `docs/release-notes/0.1.0-beta.md`. | 2026-08-12 |

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
| 7 | Empaquetado de escritorio | 🟡 **10/12** — falta validar en otro equipo |
| 8 | MySQL y estabilización | ✅ **Cerrada** — 7/7 |

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

### Fases 4 a 6 — criterios de salida ✅

Cerradas en las sesiones 007, 008 y 009. El detalle está en cada entrada de §5.

### Fase 7 — criterio de salida 🟡

> «Druse se instala y ejecuta en Windows sin que el usuario tenga que instalar Node.js, Angular CLI o el SDK de .NET.»

Los instaladores se generan y la aplicación arranca desde el ZIP portable en un directorio limpio. **Falta la mitad que exige otro equipo**: instalar y desinstalar de verdad, y arrancar en una máquina sin herramientas de desarrollo.

### Fase 8 — criterio de salida ✅

> «Los tres motores superan el mismo contrato sin excepciones y existe una versión instalable con sus notas y sus límites declarados.»

72 pruebas contractuales en verde —24 idénticas por motor—, MariaDB comprobado con el mismo proveedor, y `docs/release-notes/0.1.0-beta.md` escrito, incluidos los límites que la beta **no** garantiza.

---

## 9. Riesgos y notas técnicas abiertas

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| **El MVP no se ha probado en un equipo limpio** | Es el criterio que demuestra que el paquete se basta solo | Instalar el NSIS en una máquina sin .NET ni Node. **Es lo único que queda del MVP** |
| macOS pasa la contraseña por argumento a `security` | Visible un instante en la lista de procesos | Enlazar Security.framework. Anotado en ADR 0004 |
| Contenedor `druse-pg-test` en el 55440 | El 55432 lo ocupa `prima-postgres`, ajeno al proyecto | Puerto configurable con `DRUSE_TEST_PG_PORT` |
| Ejecutable de 107 MB | Instalador pesado | D-11: trimming y ReadyToRun. Sigue abierta |
| Dependencias con vulnerabilidades en plantillas | Ya pasó dos veces: `Microsoft.OpenApi` y `dompurify` | En backend lo caza `TreatWarningsAsErrors`; en frontend, `npm audit` en cada instalación |
| 3 vulnerabilidades moderadas en `@angular/cli` | Solo desarrollo; no llegan al bundle | Esperar actualización de Angular. Degradar a la 21 sería peor |
| Detalles visuales fuera del shell principal | La comparación de la sesión 011 cubrió la pantalla principal, no todos los estados | Repetir la comparación al tocar diálogos, filtros o vistas menos transitadas |
| Identificador `druse` no reservado | Podría ocuparlo otro | Reservar dominio, org de GitHub y NuGet/npm cuando haya algo publicable |

_Retirados: «sin SQL Server de prueba» y «solo hay un proveedor» (Fase 4), «Rust no instalado» (Fase 7), «los datos simulados podrían filtrarse» (borrados en la Fase 2) y «fidelidad visual no comprobada» (comprobada en la sesión 011)._

---

## 10. Convención para actualizar esta bitácora

Al cerrar cada sesión:

1. Agregar una entrada nueva en §5, arriba de las anteriores (**Hecho**, **Verificado**, **No hecho**, **Archivos**).
2. Actualizar la tabla de §1 y el «Qué toca retomar».
3. Mover a **Decisiones tomadas** lo que se haya resuelto en §6.
4. Actualizar los checkboxes de §8 y del plan maestro.
5. Registrar cualquier riesgo nuevo en §9.
