# Plan — Motores nuevos: Oracle y SQLite

> Documento de trabajo de una función concreta. El plan maestro vive en
> `PLAN_TRABAJO_DRUSE.md` y la bitácora en `BITACORA.md`. Aquí está el detalle
> que no cabe en el backlog: qué se construye, en qué orden y qué se decidió
> descartar.

---

## 1. Qué se quiere

Añadir **Oracle** y **SQLite** de forma que funcionen en *todas* las
funcionalidades, no solo en conectar y consultar.

Esa última frase es el plan entero. Un motor que conecta, lista tablas y ejecuta
un `SELECT` se saca en dos días y parece terminado; lo que se descubre después
es que el diseñador de tablas escribe DDL que su servidor rechaza, que el
respaldo produce un archivo que no se puede restaurar, que el traslado de datos
promete una traducción exacta que pierde los booleanos y que el generador de
consultas visuales escribe `LIMIT` donde no existe. Ninguna de esas cosas falla
al conectar: fallan más tarde, cuando alguien ya confiaba en ellas.

Así que el trabajo se divide en dos mitades muy distintas:

- **Escribir el proveedor** —unas 2.000 líneas por motor, siguiendo la plantilla
  que ya definen los cuatro existentes—. Es lo mecánico.
- **Cerrar las fugas de dialecto que hoy siguen fuera del proveedor.** Es lo que
  de verdad decide si el motor nuevo funciona en todas partes, y es donde este
  plan pone el peso.

---

## 2. Lo que ya está resuelto

La arquitectura está preparada para esto y conviene decirlo antes de enumerar lo
que falta. Un motor entra registrando sus piezas en el contenedor
(`DependencyInjection.cs`), y ni `Domain` ni `Application` ni el host se enteran:

| Contrato | Qué le toca al motor |
| --- | --- |
| `IDatabaseProvider` | Abrir, probar, puerto y base por omisión, bases del sistema, sesión auxiliar en otra base |
| `IDatabaseMetadataReader` | Catálogo: bases, hijos, columnas, definición, estructura, firma de rutinas, y el **lote** de `GetTableDetailsAsync` |
| `IQueryExecutor` | Ejecutar, cancelar, leer por streaming, normalizar errores |
| `IRowEditor` | `INSERT`/`UPDATE`/`DELETE` desde la cuadrícula, con su ámbito de escritura |
| `ITableDesigner` | DDL del diseñador, tipos ofrecidos, `TypeFor`, capacidades de índice, si el DDL es transaccional |
| `IDatabaseScripter` | DDL y datos que reproducen lo existente, y la instantánea del respaldo |

`ProviderRegistry` los localiza por `DatabaseEngine` y **no hay un solo `switch`
por motor en los casos de uso**. `/api/engines` sale del registro, así que un
motor registrado se anuncia solo. `ContractMapper.ParseEngine` ya acepta el
nombre del enumerado como caso general, de modo que un motor nuevo no necesita
alias salvo que se quiera uno bonito.

Y hay un activo que no es evidente: **`Druse.Jdbc` es un puente ADO.NET sobre
JDBC genérico**, construido con IKVM para Informix SQLI. No hace falta Java
instalado. Si algún motor futuro no tuviera cliente .NET decente, ese puente ya
existe y solo habría que cambiar la `MavenReference`.

### Las piezas de un proveedor, medidas

Lo que hay hoy en cada carpeta `Druse.Provider.*`, para saber a qué se firma uno:

| Archivo | PostgreSQL | SQL Server | MySQL | Informix | Oracle |
| --- | --- | --- | --- | --- | --- |
| `*ConnectionStringFactory` | 77 | 114 | 109 | 112 (+114 SQLI) | 119 |
| `*DatabaseProvider` | 205 | 177 | 217 | 249 | 358 |
| `*ErrorNormalizer` | 109 | 78 | 79 | 155 | 65 |
| `*MetadataReader` | **1.008** | **1.068** | **912** | **1.234** | **1.031** |
| `*QueryExecutor` | 236 | 252 | 284 | 290 | 274 |
| `*ResultReader` | 121 | 119 | 119 | 119 | 126 |
| `*RowEditor` | 72 | 100 | 101 | 151 | 156 |
| `*TableDesigner` | 165 | 231 | 271 | 264 | 277 |
| `*ValueFormatter` | 28 | 28 | 35 | 54 | 71 |
| **Total** | ~2.020 | ~2.170 | ~2.130 | ~2.740 | ~2.860 |

SQLite son **~2.240**, el más corto de los seis: no tiene fábrica de cadena que negociar, su normalizador cabe en sesenta líneas y su catálogo es una tabla y unos `PRAGMA`. Lo que le abulta es el diseñador, por la reconstrucción.

El lector de metadatos es la mitad del trabajo en los cinco. No es casualidad:
es lo único que no se puede escribir sin conocer el catálogo del motor de verdad.

Oracle suma además cuatro archivos que los otros no tienen, y cada uno resuelve
algo que solo pasa allí: `OracleIdentifier` (cuándo citar un nombre y cuándo
dejar que el motor lo pliegue), `OracleStatement` (el punto y coma que no viaja),
`OracleTypeNames` (el tipo, que el catálogo guarda repartido en cinco columnas) y
`OracleServerOutput` (los mensajes, que el servidor no manda: los guarda).

---

## 3. Las fugas de dialecto que había — cerradas en la fase 0

> Este inventario es el diagnóstico que justificó la fase 0, y se conserva tal
> cual porque explica **por qué** las cosas están donde están ahora. Las tres
> fugas silenciosas del §3.1 están arregladas; ver §6.

Esto es el inventario real de puntos que un motor nuevo obliga a tocar fuera de
su propia carpeta. Está ordenado por lo peligroso que es olvidarse de cada uno.

### 3.1. Fugas que fallan **en silencio** — las urgentes

| Dónde | Qué pasa con un motor nuevo |
| --- | --- |
| `Application/Transfers/TypeTranslator.cs:194` (`Keeps`) | El `_ => true` final significa «este motor conserva la familia». Un motor nuevo hereda **la respuesta más optimista posible**: el asistente de traslado diría «traducción exacta» de un booleano a Oracle, que no tiene booleanos. El aviso *es* el producto de esa pantalla, y aquí se pierde sin ruido |
| `frontend/.../sql-writer.ts` (`quote`, `leadingLimit`, `allGeneratedInsert`, `dateGroupExpression`) | Los cuatro tienen `default:` con la semántica de PostgreSQL. Un motor nuevo genera SQL de PostgreSQL con su nombre encima. **Ya está roto hoy**: `informixsqli` no aparece en ninguno de los cuatro, así que una conexión SQLI recibe `LIMIT` al final —que Informix rechaza— y un `DEFAULT VALUES` que no admite |
| `frontend/.../connection-dialog.ts:76` (`ENGINES`) | La lista de motores del diálogo está escrita a mano y **`getEngines()` no lo llama nadie en producción**. El endpoint existe, el gateway lo expone y ningún componente lo consume. Consecuencia de hoy: la compilación ligera sin Informix sigue ofreciendo Informix en el diálogo, y falla al conectar |

### 3.2. Fugas que fallan **al compilar** — las inofensivas

Estas están bien: el compilador de TypeScript las señala porque son
`Record<DatabaseEngine, …>` exhaustivos. Se enumeran para que nadie se sorprenda.

- `shared/ui/engine-badge/engine-badge.ts` — `ENGINE_LABELS` (dos letras),
  `ENGINE_NAMES` (nombre completo) y el bloque `:host([data-engine=…])`.
- `styles/_tokens.scss` — las tres variables `--dr-engine-<motor>{,-tint,-line}`,
  **en los dos temas**: los tonos que funcionan sobre negro no funcionan sobre
  blanco.
- `query-editor/sql-language/sql-formatting.ts` — el dialecto de
  `sql-formatter`. Formatear con el dialecto equivocado no es inofensivo: parte
  el SQL por sitios que cambian su significado.
- `query-editor/sql-language/sql-keywords.ts` y `sql-snippets.ts` — palabras
  clave del autocompletado y plantillas.

### 3.3. Puntos del backend que hay que revisar sin excepción

- `Domain/DatabaseEngine.cs` — número nuevo. **Nunca se reordena ni se
  reutiliza**: se guarda en el SQLite del usuario junto a cada perfil, y cambiarlo
  convertiría las conexiones guardadas de un motor en las de otro.
- `Application/Connections/ConnectionProfileValidator.cs` — hoy exige `Host` y
  `Username` siempre. **Esto bloquea SQLite por completo** (ver §8).
- `Host.LocalApi/Contracts/ContractMapper.cs` — `EngineId` y `EngineName` solo si
  se quiere un identificador distinto del nombre del enumerado.
- `Host.LocalApi/DependencyInjection.cs` — las seis líneas de registro.
- `Infrastructure/Providers/ProviderRegistry.cs` (`Comparte`) — solo si el motor
  nuevo comparte catálogo y dialecto con otro y únicamente cambia el transporte.
- `backend/Druse.slnx` y el `.csproj` del host — referencia al proyecto nuevo.

---

## 4. Decisiones de partida

Tomadas antes de escribir código, porque cada una cambia el diseño.

| Decisión | Elegido | Por qué |
| --- | --- | --- |
| Cómo se declara lo que un motor sabe hacer | **Una `EngineCapabilities` que publica el proveedor**, no un `switch` en la capa de arriba | Ya existe el precedente y funciona: `ITableDesigner.IndexCapabilities` dibuja el formulario de índices sin que ningún componente sepa contra qué está conectado. Lo mismo para «tiene booleanos», «limita con `LIMIT`, `TOP`, `FIRST` o `FETCH`», «tiene esquemas», «tiene procedimientos» |
| Dónde vive la traducción de tipos | **En `ITableDesigner`**, ampliando `TypeFor` con la familia conservada | Evita la tabla de todos contra todos, que con seis motores serían treinta direcciones. Cada motor responde por sí mismo y `TypeTranslator` solo compara respuestas |
| Cliente de Oracle | **`Oracle.ManagedDataAccess.Core`**, no el puente JDBC | Es 100 % gestionado: no necesita Instant Client ni nada instalado en la máquina del usuario, que es la promesa de Druse. Unos 10 MB, frente a los 111 MB del driver de Informix |
| «Bases» en Oracle | **El árbol arranca en esquemas**, y `GetDatabasesAsync` devuelve el servicio o los PDB visibles | En Oracle un esquema *es* un usuario, y no hay varias bases por conexión como en PostgreSQL. Fingir un nivel «base» que no existe llenaría el árbol de nodos con un solo hijo |
| Cliente de SQLite | **`Microsoft.Data.Sqlite`** | Es el de referencia, gestionado, con el binario nativo incluido por plataforma y sin dependencias del sistema |
| Cómo se conecta a SQLite | **Un perfil con ruta de archivo**, con `Host`, `Port` y `Username` vacíos y declarados como no aplicables por el proveedor | Un archivo no tiene servidor ni usuario. Reutilizar `Host` como si fuera la ruta ahorraría una migración y produciría mensajes de error que hablan de «el servidor» cuando lo que falta es un archivo |
| DuckDB | **Fuera de este plan**, se decide después de SQLite | Comparte la forma —un archivo, sin servidor— pero no el dialecto, y su binario nativo pesa por plataforma. Lo que SQLite deja hecho es justo la parte que le costaría: el perfil sin servidor |
| Orden | **Oracle primero, SQLite después** | Oracle cabe en el modelo actual y solo obliga a cerrar las fugas del §3. SQLite además rompe el supuesto de que un perfil tiene servidor, y conviene atacarlo con las fugas ya cerradas |
| Números del enumerado | `Oracle = 6`, `Sqlite = 7`, `DuckDb = 8` reservado | Se asignan aquí y ya no se mueven |

---

## 5. Qué significa «funciona en todas las funcionalidades»

Esta es la lista de aceptación. Un motor no está terminado hasta que las
dieciocho filas están comprobadas **contra un servidor real**, no solo en verde
en las pruebas.

| Funcionalidad | Qué le pide al motor | Riesgo en Oracle | Riesgo en SQLite |
| --- | --- | --- | --- |
| Conectar y probar | `TestConnectionAsync`, versión del servidor | Servicio vs. SID en la cadena | Que el archivo no exista: ¿crear o fallar? |
| Explorador | `GetDatabasesAsync`, `GetChildrenAsync`, carga perezosa | Esquemas del sistema (`SYS`, `SYSTEM`) al final | No hay nivel «base»; `ATTACH` para las adjuntas |
| Consulta y cancelación | `ExecuteAsync`, `OpenReaderAsync`, cancelar de verdad | `OracleCommand.Cancel` | `sqlite3_interrupt`; **a confirmar** cuánto de eso expone el proveedor |
| Errores señalados en el editor | Código, línea y posición (`SyntaxErrorPlace`) | ORA-00942, ORA-00933; **a confirmar** si `OracleError` da la posición | Mensaje sin posición: será `Nothing` |
| Historial | Nada propio del motor | — | — |
| Exportar CSV/XLSX | Nada propio del motor | — | — |
| Importar CSV/XLSX | `IRowEditor.InsertAsync` por lotes | — | Un solo escritor: los lotes no van en paralelo |
| Edición de filas | Clave primaria detectada, `RowBatchPlanner` | `ROWID` como alternativa cuando no hay clave | `rowid` implícito, salvo `WITHOUT ROWID` |
| Diseñador de tablas | `DescribeCreate`, `DescribeAlter`, `CommonDataTypes` | **DDL no transaccional**: hay que declararlo | `ALTER TABLE` limitadísimo: renombrar, añadir y poco más. Todo lo demás obliga a **reconstruir la tabla** |
| Índices y restricciones | `IndexCapabilities`, `GetTableStructureAsync` | Índices funcionales, `BITMAP` | `PRAGMA index_list` / `foreign_key_list`; claves foráneas **apagadas por omisión** |
| Transacciones manuales | `SessionTransaction` | El DDL confirma por su cuenta y rompe la transacción abierta | Transaccional de verdad, DDL incluido |
| Respaldo | `IDatabaseScripter`, `BeginSnapshotAsync` | Instantánea coherente: `FLASHBACK`/`SCN`, o declarar que no la hay | El archivo entero es la instantánea |
| Restauración | `ApplyAsync` sobre lotes de instrucciones | Separador `/` para bloques PL/SQL | — |
| Traslado de datos | `TypeFor` y las familias conservadas | **Sin booleano nativo** antes de 23ai; sin UUID | **Tipado dinámico**: la afinidad no es un tipo. Es el caso raro |
| Diagramas MER | `GetTableDetailsAsync` en **una** lectura | Un `ALL_TAB_COLUMNS` + `ALL_CONSTRAINTS` por lote | Un `PRAGMA` por tabla; hay que medir si pasa la prueba de viajes |
| Procedimientos | `GetRoutineSignatureAsync`, `GetDefinitionAsync` | Paquetes: un nivel más que el árbol no tiene | **No existen**: hay que declarar el hueco, no fingirlo |
| Asistente de IA | El dialecto en el contexto del prompt | — | — |
| Túnel SSH y solo lectura | `SshTunnel`, `ReadOnlyEnforcedByEngine` | Sin modo de sesión de solo lectura equivalente | `Mode=ReadOnly` **sí es una frontera real**: sería el tercer motor que puede prometerlo |

---

## 6. Fase 0 — Cerrar las fugas antes de añadir nada — **hecha**

Sin esto, cada motor nuevo multiplica la deuda en lugar de heredar la solución.
Es trabajo que se paga solo con el segundo motor.

- [x] **MOT-001:** crear `EngineCapabilities` y publicarla desde
  `IDatabaseProvider`: si el perfil necesita servidor, usuario o servidor lógico,
  si admite la identidad del sistema, el túnel y el cifrado, si sus sesiones de
  solo lectura son una frontera real, y **qué familias de datos guarda con un
  tipo propio**. `NativeFamilies` es `required`, así que un motor nuevo no
  compila hasta declararlo.
- [x] **MOT-002:** exponerla en `/api/engines` y **consumirla en el diálogo de
  conexión**, sustituyendo la constante `ENGINES`. Cierra de paso el fallo de hoy:
  la compilación ligera deja de ofrecer Informix.
- [x] **MOT-003:** mover `TypeTranslator.Keeps` a las capacidades del motor y
  borrar el `_ => true`. En el traductor ya no se nombra ningún motor.
- [x] **MOT-004:** `sql-dialects.ts`, tabla exhaustiva con `quote`, límite de
  filas, `INSERT` sin columnas y truncado de fechas. Sin `default:` con semántica
  de PostgreSQL: lo que no esté declarado, no compila.
- [x] **MOT-005:** con la tabla anterior, **arreglado `informixsqli`**, que
  recibía `LIMIT` al final y `DEFAULT VALUES`, dos cosas que su servidor rechaza.
- [x] **MOT-006:** `ConnectionProfileValidator` pregunta a las capacidades en vez
  de exigir `Host` y `Username` a todos, y las dos reglas que nombraban un motor
  —la identidad de Windows y el `INFORMIXSERVER`— las contesta ahora el proveedor.
- [x] **MOT-007:** [`como-anadir-un-motor.md`](como-anadir-un-motor.md), enlazado
  desde el README.

### Dónde acabó cada cosa, y por qué

Dos decisiones se tomaron al implementarlo y conviene dejarlas escritas:

- **La sintaxis del SQL no viaja por la API.** `EngineCapabilities` dice lo que el
  motor *es*; cómo se le escribe vive donde se escribe: el diseñador de cada
  proveedor en el servidor, y `sql-dialects.ts` en el navegador. Mandar
  `TOP {n} ` por HTTP sería enviar plantillas de texto para que las rellene otro.
- **Lo que no tiene consumidor, no se declara todavía.** «Tiene esquemas»,
  «tiene procedimientos» y «tiene varias bases» aún no cambian ninguna pantalla,
  así que entran con Oracle y SQLite, que es cuando el árbol tendrá que
  preguntarlo. Una bandera que nadie lee no protege de nada y hay que mantenerla.

Fuera de plan, la interfaz ganó tres registros exhaustivos más —`ENGINE_VERSIONS`,
`ENGINE_FAMILIES` y `ENGINE_TRANSPORTS`— que sustituyen a los literales
`'informixsqli'` que había sueltos por el diálogo. Con ellos, la agrupación de
Informix en una sola tarjeta con dos protocolos deja de estar escrita a mano: es
lo que declara la familia.

---

## 7. Fase 1 — Oracle — **hecha**

### 7.1. El proveedor

- [x] **MOT-010:** `DatabaseEngine.Oracle = 6`, proyecto `Druse.Provider.Oracle`,
  referencia en `Druse.slnx` y en el host.
- [x] **MOT-011:** `OracleConnectionStringFactory` — servicio o SID, `TNS_ADMIN`
  si aparece, tiempo de espera, TLS. Con pruebas unitarias como las de Informix
  (`InformixConnectionStringTests`), que comprueban la cadena sin conectar.
- [x] **MOT-012:** `OracleDatabaseProvider` — abrir, probar, puerto 1521,
  `SystemDatabases` con `SYS`, `SYSTEM`, `SYSAUX`, `XDB`, `OUTLN`.
- [x] **MOT-013:** `OracleErrorNormalizer` — de `ORA-…` a `QueryError`, sin
  filtrar credenciales.
- [x] **MOT-014:** `OracleMetadataReader` sobre `ALL_TABLES`, `ALL_VIEWS`,
  `ALL_TAB_COLUMNS`, `ALL_CONSTRAINTS`, `ALL_CONS_COLUMNS`, `ALL_INDEXES`,
  `ALL_PROCEDURES`, `ALL_ARGUMENTS`; definiciones con `DBMS_METADATA.GET_DDL`.
- [x] **MOT-015:** `GetTableDetailsAsync` **en una lectura**. La prueba
  contractual cuenta viajes y rechaza la implementación por omisión: un proveedor
  que se quede en ella falla, en vez de pasar desapercibido y hacer lento el
  diagrama.
- [x] **MOT-016:** `OracleQueryExecutor` + `OracleResultReader` — cancelación,
  varios conjuntos de resultados vía `SYS_REFCURSOR`, `DBMS_OUTPUT` como los
  mensajes informativos del servidor.
- [x] **MOT-017:** `OracleValueFormatter` y `OracleRowEditor`, con `ROWID` como
  respaldo cuando la tabla no tiene clave primaria.
- [x] **MOT-018:** `OracleTableDesigner` (que es también el `IDatabaseScripter`):
  `NUMBER`, `VARCHAR2`, `CLOB`, `BLOB`, `TIMESTAMP WITH TIME ZONE`, `RAW(16)`.
  **`SupportsTransactionalDdl = false`**, que es de las cosas que más sorprenden
  al que viene de PostgreSQL.
- [x] **MOT-019:** declarar las capacidades: sin booleano nativo antes de 23ai,
  sin identificador único, sí conserva zona horaria, limita con
  `OFFSET … FETCH NEXT`, tiene esquemas y procedimientos.

### 7.2. Lo de fuera

- [x] **MOT-020:** las seis líneas de `DependencyInjection`, tras el `#if` que
  corresponda si el driver acaba pesando lo suficiente.
- [x] **MOT-021:** distintivo `OR`, nombre «Oracle», color propio en los dos temas.
- [x] **MOT-022:** dialecto `plsql` del formateador, palabras clave y plantillas.
- [x] **MOT-023:** entrada en la tabla de dialecto de `sql-writer` (comillas
  dobles, `FETCH FIRST`, `TRUNC(fecha, 'MM')`, `INSERT … VALUES (DEFAULT)`).
- [x] **MOT-024:** `OracleFixture` y las pruebas contractuales completas.
- [x] **MOT-025:** contenedor en `test-db.ps1`/`.sh` (`gvenzl/oracle-free`, que
  es mucho más ligera y rápida de arrancar que las imágenes oficiales).
- [x] **MOT-026:** recorrido contra un Oracle real, con el barrido de capturas y
  una prueba de punta a punta propia (`e2e/tests/oracle.spec.ts`).

### Lo que Oracle obligó a cambiar fuera de su carpeta

Cuatro cosas, y las cuatro eran huecos de verdad y no concesiones al motor:

| Qué | Por qué |
| --- | --- |
| `TableDesignerBase.ToCommand` | El punto y coma se escribe en el guion —que se parte por él— y **no viaja por el cable**: Oracle responde `ORA-00911`. La costura evita repetir el recorte en las diez plantillas que componen instrucciones |
| `BackupIsolation.Serializable` | Oracle no admite `RepeatableRead` como nivel de ADO: su driver lo rechaza con `ORA-50002`, y lo que él llama serializable es justo lo que hacía falta —lecturas consistentes que no bloquean a quien escribe—. De paso, un nivel rechazado ya no tumba el respaldo |
| `ColumnValueParser` | No conocía `NUMBER` ni `RAW`, que son **los** tipos numérico y binario de Oracle. Sin eso, una columna de enteros se clasificaba como texto y el respaldo la escribía entrecomillada |
| `IProviderFixture.Stored` y `HasEmptyStrings` | Dos hechos de Oracle que no se pueden fingir: pliega a mayúsculas lo que no va citado, y `''` **es** `NULL` |

### Dos decisiones que costaron varias vueltas

**Los identificadores no se citan por costumbre.** Los otros cuatro proveedores
citan todo, porque allí es gratis. En Oracle citar además fija la caja, así que
citar todo produciría tablas llamadas `clientes` que ningún informe ni ningún
SQL*Plus sabe consultar —preguntan por `CLIENTES`—. `OracleIdentifier` cita solo
lo que lo necesita y pliega lo demás, que es lo que hacen SQL Developer y
DBeaver. El coste está escrito allí: un objeto cuyo nombre real esté en minúscula
no se puede referir por este camino.

**La sesión se reinicia al abrirla.** El explorador se asoma a otro esquema con
`ALTER SESSION SET CURRENT_SCHEMA`, y eso **se queda pegado a la conexión** cuando
vuelve al pool: la siguiente consulta que la tomara resolvería sus tablas en el
esquema ajeno y fallaría hablando de una tabla que sí está. Costó cuatro pruebas
rojas intermitentes averiguarlo. Ahora cada sesión vuelve a su esquema y fija sus
formatos de fecha nada más abrirse.

### Lo que queda declarado, no resuelto

- **Un lote con varias instrucciones no se puede ejecutar de una vez.** Oracle no
  encadena con punto y coma, y partir el texto es una función de Druse —no del
  proveedor— que hoy no existe. Quien pegue dos consultas y pulse Ejecutar recibe
  `ORA-00911`.
- **No se dice dónde falló un error de sintaxis.** El servidor sabe el
  desplazamiento; ODP.NET no lo expone.
- **Los paquetes no salen en el árbol.** Los procedimientos que viven dentro de
  uno no se listan: colgarlos del esquema daría nombres que no se pueden llamar.
- **Sin booleano**, salvo en 23ai. Se traduce a `NUMBER(1)` y el traslado lo
  avisa.

---

## 8. Fase 2 — SQLite — **hecha**

SQLite no es «un motor más pequeño»: es el que rompe los supuestos. Por eso va
después, y por eso su fase empieza por el modelo y no por el proveedor.

### 8.1. Lo que rompe

- **No hay servidor.** Ni host, ni puerto, ni usuario, ni contraseña, ni TLS, ni
  túnel SSH. El diálogo de conexión tiene que enseñar un selector de archivo y
  esconder el resto, sin condicionales por motor en la plantilla: preguntando a
  las capacidades (MOT-001).
- **No hay lista de bases.** `main`, `temp` y las que se adjunten con `ATTACH`.
- **No hay procedimientos ni funciones.** El árbol no debe enseñar carpetas
  vacías: la ausencia se declara, no se finge.
- **El tipado es dinámico.** La afinidad de una columna no promete nada sobre lo
  que hay dentro. Es el caso más difícil del traductor de tipos, y la respuesta
  honesta es marcar la traducción como aproximada casi siempre.
- **`ALTER TABLE` casi no existe.** Renombrar tabla o columna, añadir columna y
  poco más. Cualquier otro cambio del diseñador obliga a la danza de las siete
  instrucciones: crear la nueva, copiar, borrar la vieja, renombrar, rehacer
  índices y disparadores. Va dentro de una transacción, que aquí sí abarca DDL —
  salvo los pragmas que hacen falta alrededor, que no entran en ella.

### 8.2. Tareas

- [x] **MOT-030:** `DatabaseEngine.Sqlite = 7` y campo de ruta en
  `ConnectionProfile`, con su migración de SQLite y su `user_version`.
- [x] **MOT-031:** el diálogo de conexión dirigido por capacidades: selector de
  archivo, sin credenciales, sin túnel, con «solo lectura» ya real.
- [x] **MOT-032:** decidir y documentar qué pasa si el archivo no existe. Propuesta:
  **no crearlo en silencio**; ofrecerlo como una acción explícita.
- [x] **MOT-033:** proveedor, lector (`sqlite_master`, `PRAGMA table_info`,
  `index_list`, `index_info`, `foreign_key_list`), ejecutor y lector de resultados.
- [x] **MOT-034:** `SqliteTableDesigner` con la reconstrucción de tabla para todo
  lo que `ALTER TABLE` no admite, y el DDL previsualizado tal cual se ejecutará.
- [x] **MOT-035:** `ReadOnlyEnforcedByEngine = true` con `Mode=ReadOnly`. Es una
  frontera de verdad, no un aviso del analizador, y la interfaz puede prometerlo.
- [x] **MOT-036:** un solo escritor: importación y traslado en un único hilo, con
  `busy_timeout` y `WAL` declarados.
- [x] **MOT-037:** distintivo, color, dialecto `sqlite` del formateador, palabras
  clave, plantillas y entrada en la tabla de `sql-writer`.
- [x] **MOT-038:** `SqliteFixture` — la única que no necesita Docker, lo que la
  convierte en la fixture que **siempre** corre en integración continua.
- [x] **MOT-039:** recorrido contra un archivo real, con el barrido de capturas y
  una prueba de punta a punta propia (`e2e/tests/sqlite.spec.ts`) que **no
  necesita ningún contenedor**.
- [x] **MOT-040:** que la reconstrucción no se lleve nada por delante: sus
  disparadores, sus condiciones de comprobación, las vistas que la miraban y las
  filas de las tablas que la referencian. Con la lectura de condiciones que hacía
  falta para lo tercero, que las saca del `CREATE TABLE`.
- [x] **MOT-041:** que la reconstrucción tampoco rompa a las demás: el paso 10 del
  procedimiento —`foreign_key_check` antes de confirmar— y la traducción del error
  que sale al copiar las filas que no cumplen lo que se acaba de pedir.

### Cómo fue

**El contrato pasó entero a la primera: 54 de 54.** No es suerte: es lo que la
fase 0 y Oracle dejaron hecho. Las tres cosas que Oracle obligó a absorber —el
terminador que no viaja, el nivel de aislamiento, la clasificación de tipos— ya
estaban, y las dos banderas de dialecto que SQLite necesitaba se declaran igual
que las suyas.

Lo que sí hizo falta fue una costura nueva, y era la que el plan anunciaba:
`ITableDesigner.DescribeAlterAsync`. Reconstruir una tabla exige **saber cómo
está hoy**, y el cambio solo dice qué se toca; sin la sesión no hay forma de
escribir el `CREATE TABLE` nuevo. Los otros cinco motores no la reescriben.

### Las tres cosas suyas

- **La reconstrucción.** `ALTER TABLE` hace cuatro cosas —renombrar la tabla,
  renombrar una columna, añadirla y quitarla— y nada más. Cambiar un tipo, tocar
  la clave primaria o añadir una restricción se hacen creando otra tabla,
  copiando las filas, borrando la vieja y renombrando. Va entero en una
  transacción, porque aquí **el DDL sí se deshace**.
- **El candado de solo lectura es el más fuerte de los seis.** No es un modo que
  el servidor haga cumplir: el archivo se abre sin permiso de escritura y no hay
  instrucción que pueda saltárselo.
- **El tipo de una columna no obliga a nada.** Una columna `INTEGER` acepta el
  texto `hola`. Por eso sus familias declaradas son cuatro —texto, entero,
  decimal y binario—: son las que sobreviven al viaje de ida y vuelta. No hay
  booleano, ni fecha, ni hora, ni marca de tiempo, ni identificador único.

### Un fallo que solo apareció con la aplicación levantada

Reabrir una conexión guardada **pedía contraseña a un motor que no tiene
usuarios**, así que SQLite conectaba la primera vez y no volvía a conectar nunca
más. El contrato no lo veía —va por debajo de la API— y las pruebas del navegador
tampoco. Lo encontró la prueba de punta a punta a la segunda ejecución. El
endpoint ahora pregunta al motor si tiene identidad antes de pedirla.

### Crear una base, que es lo contrario de abrirla

Se añade como operación propia del proveedor —`CreateDatabaseAsync`— y con su
capacidad, `CanCreateDatabase`. **Hoy solo la declaran los motores que son un
archivo**, y no por falta de ganas: `CREATE DATABASE` en un servidor lleva detrás
media docena de decisiones que cambian según el motor —codificación, cotejo,
espacio de tablas, plantilla— y ofrecerlo como un botón sin ellas crearía bases
que después hay que rehacer. Es una función por derecho propio, no un añadido del
formulario de conexión.

Tres cosas que la implementación decide y conviene saber:

- **No machaca lo que ya está.** Vaciar una base con un botón que pone «crear»
  sería borrarla sin avisar.
- **Lo que crea es una base, no un archivo vacío.** Abrir en modo de creación deja
  el archivo a cero bytes hasta la primera escritura, y un archivo de cero bytes
  no se puede abrir después: se escribe la cabecera a propósito.
- **No conecta después.** Encadenarlo dejaría una sesión viva que nadie pidió.

### Lo que la reconstrucción se llevaba, y ya no

Lo que se escribió aquí al cerrar la fase 2 —«la reconstrucción no conserva
disparadores ni vistas»— **se quedaba corto en las dos direcciones**: perdía más
de lo dicho, y en un caso ni siquiera llegaba a terminar. Al escribir la prueba
que lo demostrara salieron cuatro cosas, tres peores que la documentada:

- **Con una vista mirando la tabla, el cambio fallaba entero.** Desde la versión
  3.25, SQLite valida todas las vistas y disparadores de la base al renombrar una
  tabla; a mitad de la reconstrucción esas vistas apuntan a algo que ya se borró y
  el renombrado aborta. Se pide el modo antiguo del renombrado
  —`legacy_alter_table`— solo durante esos dos pasos.
- **Se llevaba por delante las filas de las tablas hijas.** Con las claves
  foráneas encendidas, el `DROP TABLE` de la tabla vieja ejecuta un borrado
  implícito que dispara las cascadas de quien la referencia: cambiarle el tipo a
  una columna de la tabla de clientes borraba todos sus pedidos, sin aviso y
  dentro de la misma transacción que se confirma sola. Es el paso 1 del
  procedimiento que documenta SQLite, y **hay que darlo fuera de la transacción**,
  porque el pragma que las apaga no hace nada dentro de una. Con una transacción
  manual abierta, la reconstrucción ahora se para en vez de seguir con la cascada
  armada. `defer_foreign_keys`, que sí se puede dentro, no sirve: retrasa la
  comprobación de las restricciones, y una cascada no es una comprobación sino una
  acción.
- **Perdía las condiciones de comprobación**, que era la otra limitación
  declarada y resultó ser la misma: no se leían, y lo que no se lee no se puede
  volver a escribir. Ahora se sacan del `CREATE TABLE` que el motor guarda
  literal, así que sobreviven a la reconstrucción y además se ven y se escriben
  desde el diseñador. Lo que hace el lector **no es interpretar SQL**: busca la
  palabra `CHECK`, cuenta paréntesis y copia la expresión sin entenderla; lo que
  sí sabe es dónde no mirar —cadenas, identificadores citados y comentarios—,
  porque un `CHECK` escrito ahí es texto.
- **Perdía los disparadores**, que era lo único documentado. Se leen antes de
  tirar la tabla, que es mientras todavía existen, y se vuelven a escribir tal
  cual.

El orden de la reconstrucción cambió por un motivo que no se ve: la tabla nueva
recupera **siempre** el nombre de la vieja, y el renombrado que pidiera el usuario
va al final, como una instrucción aparte. Los índices y los disparadores se
reescriben con su texto original, que nombra la tabla de antes; una vez puestos,
el renombrado final lo hace el motor y **arrastra con él las vistas y los
disparadores**, que es lo que no se puede hacer a mano sin ponerse a interpretar
su texto.

Los dos pragmas vuelven a su sitio pase lo que pase, y eso hubo que escribirlo
aparte: no entran en la transacción, así que un fallo a mitad deshace lo escrito y
dejaría los ajustes puestos para todo lo que viniera después por esa conexión.

### Y lo que la reconstrucción rompía en otras tablas

Apagar las claves foráneas para reconstruir abre un segundo agujero, y este no se
ve porque **el daño cae en una tabla que nadie tocó**. Mientras están apagadas el
motor no dice nada, así que la reconstrucción termina bien y lo que se rompió se
descubre la próxima vez que alguien escriba. Dos formas de llegar, ninguna rara:

- **Renombrar o borrar una columna a la que apunta la clave foránea de otra
  tabla.** La otra sigue diciendo `REFERENCES clientes (id)`; si `id` deja de
  existir, esa frase ya no señala a nada y **cualquier escritura en la otra tabla**
  falla desde entonces con «foreign key mismatch».
- **Añadir una clave foránea que los datos de hoy no cumplen**, que es lo que hace
  cualquiera al ordenar una base que creció sin relaciones declaradas: la tabla se
  queda con una relación que su propio contenido incumple.

Es el paso 10 del procedimiento de SQLite —el `PRAGMA foreign_key_check` antes de
confirmar— que el plan daba por no hecho «porque hoy no hace falta». Sí hacía
falta, y no se podía escribir como una instrucción más: el pragma **lanza** en el
primer caso y **devuelve filas** en el segundo, así que puesto entre las demás se
tragaría el segundo sin que nadie leyera su respuesta. Va en una comprobación
aparte, dentro de la transacción y antes de confirmar, que es el único momento en
que todavía puede impedir algo. Se miran la tabla y las que la referencian, no la
base entera: sin argumento el pragma recorre todas las tablas.

Un cambio de tipo, en cambio, **no descoloca a las hijas**, aunque lo pareciera: al
comparar, el motor aplica la afinidad de la columna madre al valor de la hija, así
que un `'900'` de texto que pasa a ser el número `900` sigue casando. Se probó
antes de escribirlo.

### Y el error que había que traducir

Poner una condición de comprobación que **las filas de hoy ya incumplen** falla al
copiarlas, y el motor dice «CHECK constraint failed: ck_cantidad». Es verdad y no
explica nada: quien lo lee acaba de escribir esa condición y va a creer que la
escribió mal, cuando lo que pasa es que la tabla no la cumple. El mismo error
significa otra cosa según el paso en que salga —al insertar una fila habla de esa
fila—, así que la traducción vive donde se sabe el paso y no en el normalizador,
que es común a todo. Lo mismo vale para quitar los nulos de una columna que los
tiene y para declarar única una que está repetida.

### Lo que queda declarado, no resuelto

- **Druse no crea el archivo al abrirlo**, y eso no cambia: una ruta mal escrita
  tiene que decirlo, no dejar una base vacía en el disco. Crear una **sí** se
  puede, como acción aparte: el formulario tiene «Examinar…» y «Crear una nueva»,
  y las dos abren el diálogo del sistema, que es lo que impide que la página
  escriba donde le apetezca. Crear no conecta: quien crea una base quiere ver que
  está antes de abrirla.
- **No hay recuento aproximado de filas** en el explorador: SQLite no guarda
  estadísticas salvo que alguien pida `ANALYZE`.

---

## 9. Pruebas

El listón ya está puesto por `DatabaseProviderContractTests`, y es el bueno: lo
que se comprueba es idéntico para todos los motores, y **si hubiera que cambiar
una comprobación para que pase en uno concreto, sería señal de que se coló una
fuga de dialecto en las abstracciones**.

- [ ] **MOT-040:** `OracleFixture` y `SqliteFixture` implementando
  `IProviderFixture` entero, incluido `TypesByFamily`. Recordar que **una familia
  ausente es una declaración, no un olvido**.
- [ ] **MOT-041:** vigilar el tamaño de `IProviderFixture`. Si crece mucho con
  estos dos motores, la conclusión no es «ya está», es que las abstracciones están
  dejando pasar diferencias que deberían absorber.
- [ ] **MOT-042:** `DRUSE_REQUIRE_ENGINES=1` en integración continua, para que un
  motor caído sea un fallo y no una suite verde que no comprobó nada.
- [ ] **MOT-043:** pruebas unitarias de cadena de conexión y del traductor de
  tipos —las traducciones con pérdida, una por una, con su aviso—.
- [ ] **MOT-044:** ampliar el barrido e2e con un perfil por motor nuevo.

---

## 10. Empaquetado

- El driver gestionado de Oracle ronda los 10 MB: cabe en la compilación normal
  sin la ceremonia del `#if DRUSE_INFORMIX`. **Medir antes de decidir.**
- `Microsoft.Data.Sqlite` ya viaja en el paquete: la persistencia local es SQLite.
  Añadir el motor no debería sumar nada apreciable.
- Si algún día entra DuckDB, su binario nativo va por plataforma y ahí sí hará
  falta la compilación condicional.
- [ ] **MOT-050:** medir el instalador antes y después de cada fase y anotarlo.

---

## 11. Lo que se descarta, y por qué

| Descartado | Motivo |
| --- | --- |
| Una capa SQL común que unifique los catálogos | Ya está decidido en `IDatabaseMetadataReader` y sigue siendo cierto: los catálogos no se parecen, y unificarlos produce SQL frágil que funciona a medias en todas partes |
| Cargar proveedores desde ensamblados externos | La forma del registro ya es la de un sistema de complementos, pero cargar código desconocido en el proceso que tiene las credenciales del usuario es otra conversación. Sigue en «prioridad futura» del plan maestro |
| MongoDB y compañía | No hay tablas, ni SQL, ni DDL, ni claves foráneas. La mitad de los contratos no tendría sentido. Sería un producto distinto dentro del mismo, no un motor más |
| MariaDB como motor aparte | Ya funciona con el proveedor de MySQL y las mismas pruebas contractuales. Separarlo sería duplicar para distinguir lo que no se distingue |
| Reutilizar `Host` como ruta de archivo en SQLite | Ahorra una migración y produce para siempre mensajes que hablan del «servidor» cuando falta un archivo |

---

## 12. Plantilla: un motor nuevo, paso a paso

Resumen ejecutable de todo lo anterior. Sirve para el sexto motor y para el
décimo.

1. Número nuevo en `DatabaseEngine`. **Nunca reordenar ni reutilizar.**
2. Proyecto `Druse.Provider.<Motor>`, referenciado en `Druse.slnx` y en el host.
3. Las nueve clases de la tabla del §2.
4. `GetTableDetailsAsync` **en una lectura**, o el diagrama no existe.
5. Declarar las capacidades del motor. Lo que no se declare, no compila.
6. Seis líneas en `DependencyInjection.cs`.
7. `EngineId`/`EngineName` en `ContractMapper`, solo si se quiere alias.
8. Revisar `ConnectionProfileValidator`: ¿necesita servidor?, ¿usuario?
9. Frontend: distintivo, dos colores por tema, dialecto del formateador,
   palabras clave, plantillas y entrada en la tabla de `sql-writer`.
10. `<Motor>Fixture` y las pruebas contractuales **completas**.
11. Contenedor en `test-db.ps1` y `test-db.sh`.
12. Recorrer a mano la tabla del §5 contra un servidor real, con capturas, y
    anotarlo en `BITACORA.md`. Las pruebas en verde no son la verificación.

---

## 13. Estimación orientativa

Para una sola persona trabajando de forma constante:

| Bloque | Estimación |
| --- | --- |
| Fase 0 — cerrar fugas (MOT-001 … MOT-007) | 3–5 días |
| Oracle — proveedor | 1,5–2 semanas |
| Oracle — fuera del proveedor, pruebas y verificación | 4–6 días |
| SQLite — modelo sin servidor (MOT-030 … MOT-032) | 3–4 días |
| SQLite — proveedor, con la reconstrucción de tablas | 1–1,5 semanas |
| SQLite — resto y verificación | 3–4 días |

En total, alrededor de **6 a 8 semanas** para los dos motores con todas las
funcionalidades cubiertas. De ese tiempo, la fase 0 es la que no se repite: el
tercer motor cuesta la mitad que el segundo.
