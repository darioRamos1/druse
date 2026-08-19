# Plan — Migración de datos entre tablas

> Documento de trabajo de una función concreta. El plan maestro vive en
> `PLAN_TRABAJO_DRUSE.md` y la bitácora en `BITACORA.md`. Aquí está el detalle
> que no cabe en el backlog: qué se construye, en qué orden y qué se decidió
> descartar.

---

## 1. Qué se quiere

Pasar **las filas de una tabla a otra tabla**, eligiendo cuáles y qué columnas
viajan, aunque las dos tablas estén en esquemas distintos, en bases distintas o
al otro lado de conexiones distintas.

El caso que la justifica es el de todos los días: se tienen desarrollo y
producción abiertos a la vez y hace falta llevar unos datos de uno a otro. Hoy
eso obliga a exportar a CSV, abrir el archivo, volver a importarlo y confiar en
que las columnas caigan donde deben.

Es la pieza que faltaba entre las dos que ya existían: **importar** lleva un
archivo a una tabla y **respaldar** lleva una tabla a un archivo. Aquí los dos
extremos son tablas vivas.

---

## 2. Decisiones de partida

Tomadas antes de escribir código, porque cada una cambia el diseño entero.

| Decisión | Elegido | Por qué |
| --- | --- | --- |
| Cómo se escribe | **Por lotes, cada uno confirmado**, con «todo o nada» opcional | Una transacción que abarque millones de filas revienta el registro del servidor y bloquea la tabla mientras dura. Troceando, lo copiado se queda y se sabe hasta dónde llegó |
| Qué hacer con lo que ya está | **Los cuatro modos**: añadir, vaciar-y-cargar, actualizar-o-insertar y omitir-existentes | Los dos primeros cubren el caso corriente; los otros dos son los que convierten esto en algo que se puede repetir sin duplicar |
| Motores | **El mismo a los dos lados primero**, entre motores distintos en la fase 3 | Traducir tipos entre dialectos es una función por sí sola, con pérdidas que hay que declarar |
| Identidad y autoincremento | **Se conservan los valores del origen** | Si el id 42 llega con otro número, todo lo que apuntaba a esa fila deja de apuntar a nada |
| Tabla destino ausente | **Se ofrece crearla** desde la estructura del origen (fase 3) | El guionizado ya sabe hacerlo; el paso manual sobra |
| Un valor que no cabe | **Para el traslado entero**, diciendo fila y columna | Al revés que importar: aquí no hay archivo que corregir, y seguir metiendo filas deja en el destino una tabla que nadie sabe describir |
| Nombre | `Transfers` en el código, «Migrar datos» en la interfaz | En un gestor de bases, «migración» suena a migración de esquema tipo EF |

---

## 3. Lo que el usuario elige

1. **La tabla de destino.** Se navega el catálogo preguntando por los hijos de
   cada nodo, sin suponer una jerarquía: cada motor organiza el suyo a su manera.
   El destino solo ofrece **conexiones ya abiertas**; abrirlas es otro flujo y ya
   existe en la barra lateral.
2. **Qué columna va a cuál.** Se emparejan por nombre sin distinguir mayúsculas,
   y lo que no case se queda **sin destino**, nunca colocado por posición.
   Adivinar ahí es exactamente como se copian teléfonos a la columna del código
   postal.
3. **Qué filas.** Una condición sin `WHERE` delante, validada contra la tabla
   antes de armar nada con `TableDataFilter.Validate`: es la única entrada de
   texto libre de la función.
4. **Cómo se escribe.** Modo, tamaño de lote, «todo o nada» y si se conservan los
   identificadores del origen.

Y entre elegir y escribir, **la vista previa**: a qué columna va cada columna,
qué columnas obligatorias del destino no llena nadie, qué se pierde en las que el
motor genera, el `SELECT` que se leerá y el `INSERT` que se escribirá. Es la
razón de ser de todo lo demás: un traslado mal emparejado no falla, funciona.

---

## 4. Lo que sostiene la función

Casi todo estaba escrito antes de empezar:

| Lo que hace falta | Lo que ya había |
| --- | --- |
| Dos conexiones vivas a la vez | Cada conexión abierta es una sesión con su `Guid` |
| Leer el origen sin agotar memoria | `SelectData` + `OpenReaderAsync`, que ya usa el respaldo en CSV |
| Filtrar filas y columnas | `TableDataFilter` |
| Convertir al tipo del destino | `RowBatchPlanner.Prepare`, compartido con importar y restaurar |
| Escribir | `IRowEditor.InsertAsync` |
| Progreso que sobrevive a cerrar la ventana | El patrón de `IBackupTracker` |
| Copiar los identificadores que genera el motor | `BeginDataLoad` / `EndDataLoad` |

Lo genuinamente nuevo es el bucle que lee de una sesión y escribe en otra.

### 4.1 Tres cosas que no se pueden dejar para después

**El lado que lee necesita su propia conexión** siempre que comparta una con el
que escribe. Copiar entre dos esquemas de la misma conexión es de lo más
corriente, y ningún motor de estos admite un lector abierto y un `INSERT` a la
vez por el mismo cable: sin la sesión auxiliar, el caso más común se queda
colgado.

**Los turnos de las dos sesiones se piden en orden de identificador.** Dos
traslados cruzados entre las mismas conexiones —uno de dev a prod y otro de prod
a dev— se esperarían el uno al otro para siempre si cada uno tomase primero el
suyo.

**Vaciar es un `DELETE`, no un `TRUNCATE`**, aunque sea mucho más lento. MySQL
confirma la transacción en curso al truncar —con lo que «todo o nada» dejaría de
ser cierto justo en el modo que borra— y truncar falla en cuanto otra tabla
apunte a esta, que es lo normal en la tabla que uno quiere reemplazar.

---

## 5. Las fases

### Fase 1 — Una tabla a otra ✅ (sesión 023)

Origen, destino, columnas, filtro; modos **añadir** y **vaciar-y-cargar**; lotes
con «todo o nada»; progreso cancelable; vista previa. Mismo motor a los dos
lados.

Piezas: `Druse.Domain/DataTransfer.cs`,
`Druse.Application/Transfers/TransferService.cs`, `ITransferTracker` y su
implementación, `TransferEndpoints` con `preview` / `run` / `status` / `cancel`,
`transfer.store.ts` y el asistente en `features/transfer/`.

De las abstracciones salieron dos añadidos: `IWriteScope` —una transacción que
abarca varios lotes, prestada a la sesión con `Borrow` para que los lotes se unan
a ella— y `ScriptClearTable`, el `DELETE` que vacía la tabla destino.

### Fase 2 — Actualizar lo que ya está

`Upsert` y `SkipExisting`. Los dos valores **ya existen** en `TransferMode` y
viajan en el contrato; hoy `TransferService.PrepareAsync` los rechaza con un
mensaje que lo dice. La fase es sustituir ese rechazo por el camino de escritura.

`IRowEditor` gana un método de escritura con modo, junto a `InsertAsync`, que
recibe el lote, el modo y las columnas que identifican la fila. `RowEditorBase`
lo implementa una vez —transacción, parámetros y recuento son iguales— y deja un
gancho abstracto para la cláusula de conflicto, que sí es dialecto:

| Motor | Actualizar si está | Omitir si está |
| --- | --- | --- |
| PostgreSQL | `ON CONFLICT (...) DO UPDATE SET` | `ON CONFLICT DO NOTHING` |
| MySQL | `ON DUPLICATE KEY UPDATE` | `INSERT IGNORE` |
| SQL Server | `MERGE ... WHEN MATCHED` | `MERGE ... WHEN NOT MATCHED` |
| Informix | `MERGE` | `MERGE` |

`InsertAsync` se queda como está: es el camino que ya usan importar y restaurar.

Las columnas que identifican la fila salen de `DatabaseColumn.IsPrimaryKey`, y el
asistente debe dejar cambiarlas —emparejar por una clave de negocio es justo lo
que se quiere al sincronizar dos entornos—. **Sin clave no hay upsert posible**, y
eso se dice antes de empezar, no cuando el motor se queje.

`RowsSkipped` ya está en `TransferProgress` sin llenar: es el número que hace útil
el modo, «entraron 900, ya estaban 4.100».

La prueba que importa es **contractual, no de integración**: los cuatro motores
tienen que comportarse igual ante el mismo lote repetido. Cuatro dialectos para
una promesa que tiene que ser una.

### Fase 3 — Entre motores distintos

`TypeTranslator` en `Application/Transfers`, con una tabla de equivalencias por
par de motores. Vive ahí y trabaja sobre `DatabaseEngine` como dato porque
`ArchitectureRulesTests.LosProveedoresNoSeConocenEntreSi` prohíbe que un proveedor
conozca a otro.

Cada traducción lleva su nivel —exacta, aproximada con lo que se pierde, o sin
equivalente— y la vista previa las enseña. **Los avisos son el producto**: una
migración que traduce en silencio es la que estropea datos.

Con esto llega crear la tabla destino: un `TableDefinition` construido desde las
columnas del origen y `ITableDesigner.CreateAsync`. Solo columnas, tipos,
nulabilidad y clave primaria; índices y foráneas no, por lo mismo que el respaldo
los deja para el final.

### Fase 4 — Varias tablas y migraciones guardadas

Varias tablas en una pasada, ordenadas por sus claves foráneas con lo que ya lee
`IDatabaseMetadataReader`; los ciclos se avisan y se migran sin ordenar.

Y perfiles, espejo de `SqliteBackupProfileStore`, con su misma regla: el perfil
guarda **nombres calificados, no identificadores de sesión**, porque se reabre
meses después contra otra conexión.

---

## 6. Cómo se comprueba

1. `dotnet test backend/Druse.slnx` y `cd frontend; npm test -- --watch=false`.
2. Con los motores de verdad: `./build/scripts/test-db.ps1` y después
   `$env:DRUSE_REQUIRE_ENGINES = '1'; dotnet test backend/Druse.slnx`.
3. **En la aplicación levantada**, que es donde se ve si la función sirve. La
   suite de `e2e/` lo hace sola y con sus propios datos: abre el menú de la tabla,
   elige el destino, mira la vista previa, copia y **cuenta las filas del destino
   con un `COUNT(*)`**. Lo que se comprueba al final no es un mensaje en pantalla.
