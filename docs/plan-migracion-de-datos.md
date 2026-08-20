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
| «Todo o nada» con varias tablas | **Por tabla**, y la pasada se para en la primera que falle | Abarcar el conjunto entero devolvería la transacción larga que la primera decisión evitó, multiplicada por el número de tablas. Lo que entró completo se queda, y el resumen dice en cuál se paró |
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

### Fase 2 — Actualizar lo que ya está ✅ (sesión 023b)

`Upsert` y `SkipExisting`, con `IRowEditor.WriteAsync`: el lote, qué hacer con lo
que ya está y las columnas que identifican la fila. `RowEditorBase` lo implementa
una vez —transacción, parámetros y recuento son iguales— y `InsertAsync` pasa a
ser ese mismo camino con «fallar si ya está», que es lo que era.

Cada motor pone su dialecto:

| Motor | Actualizar si está | Omitir si está |
| --- | --- | --- |
| PostgreSQL | `ON CONFLICT (...) DO UPDATE SET` | `ON CONFLICT (...) DO NOTHING` |
| MySQL | `ON DUPLICATE KEY UPDATE` | `INSERT IGNORE` |
| SQL Server | `MERGE ... WHEN MATCHED` | `MERGE ... WHEN NOT MATCHED` |
| Informix | `MERGE` con `sysmaster:sysdual` | igual, sin la rama de actualizar |

Cuatro cosas que salieron al construirlo y conviene no volver a descubrir:

1. **El recuento se normaliza en la base, no en cada proveedor.** MySQL devuelve
   dos filas afectadas cuando actualiza una. Lo que se cuenta es *si la fila se
   escribió*, que significa lo mismo en los cuatro.
2. **En MySQL, omitir tiene que ser `INSERT IGNORE`.** La forma elegante —`ON
   DUPLICATE KEY UPDATE col = col`— no sirve porque MySqlConnector cuenta filas
   *encontradas* y no *afectadas*, así que una fila que ya estaba devolvería uno y
   se contaría como escrita. El precio es que `IGNORE` también degrada a aviso
   algún error de datos; se asume porque los valores llegan ya convertidos contra
   los tipos del destino.
3. **MySQL no deja decir con qué clave se choca**: reacciona ante cualquier
   restricción de unicidad de la tabla, no solo ante las columnas elegidas. No hay
   sintaxis para arreglarlo, así que queda dicho aquí.
4. **SQL Server e Informix necesitan un `MERGE` entero**, no una cláusula al
   final; Informix además exige un `CAST` por valor, porque un `?` suelto dentro
   del `SELECT` de origen no tiene de dónde deducir su tipo.

Las columnas que identifican la fila salen de `DatabaseColumn.IsPrimaryKey`, y se
pueden cambiar —sincronizar dos entornos suele hacerse por una clave de negocio—.
**Tienen que estar respaldadas por la clave primaria, una restricción de unicidad
o un índice único**, y se comprueba contra el catálogo antes de escribir: con una
clave que se repite, «actualiza la que ya está» toca todas las que coinciden, no
falla y no avisa. También se exige que la clave **se copie**: si no viaja, todas
las filas se parecerían en ella.

La prueba que importa es **contractual**: los cuatro motores ante el mismo lote
repetido —insertar falla, actualizar cambia sin duplicar, omitir cuenta lo que
dejó estar, y repetir dos veces deja lo mismo que una—.

### Fase 3 — Entre motores distintos ✅ (sesión 023c)

Trasladar de un motor a otro ya no se rechaza, y con ello llega crear la tabla de
destino desde la estructura del origen.

`TypeTranslator` vive en `Application/Transfers` y trabaja sobre `DatabaseEngine`
como dato, porque `ArchitectureRulesTests.LosProveedoresNoSeConocenEntreSi`
prohíbe que un proveedor conozca a otro —y aquí hay que mirarlos de dos en dos—.

**No hay tabla de equivalencias por par de motores.** Con cuatro serían doce
direcciones y crecería al cuadrado. En su lugar, dos preguntas: qué familia es el
tipo —`ColumnValueParser.Classify`, que el dominio ya sabía responder— y cómo
llama este motor al tipo que guarda eso, que es `ITableDesigner.TypeFor` y es lo
único nuevo que aporta cada dialecto. Las medidas que sí viajan —longitud,
precisión, escala, si tenía límite— salen del propio texto del tipo, con
`TypeFacets.Parse`.

Sobre eso, los avisos, que son el producto:

| Lo que deja de ser cierto en el destino | Nivel |
| --- | --- |
| Un JSON en un motor sin JSON: viaja entero, pero deja de validarse y de consultarse por sus campos | Aproximada |
| Un identificador único sin tipo propio: se guarda escrito, con sus 36 caracteres | Aproximada |
| Una marca de tiempo con zona donde no se guarda el huso: el instante se conserva, de dónde venía no | Aproximada |
| Un booleano donde no lo hay: los valores llegan como 1 y 0 | Aproximada |
| Un texto sin límite que llega con tope: lo que hay cabe, lo que se escriba después quizá no | Aproximada |
| Una columna que guarda varios valores, fuera de PostgreSQL | **Sin equivalente** |

Lo que no tiene equivalente **no se traduce a la fuerza**: se dice, e impide crear
la tabla hasta que se excluya la columna o se le escriba un tipo. Y el tipo
escrito a mano gana siempre, sin discutirlo con un aviso: quien lo escribe sabe
algo que el traductor no —que ese texto sin límite son en realidad cuatro
letras—.

Crear la tabla es un `TableDefinition` armado desde las columnas del origen y
`ITableDesigner.CreateAsync`: columnas, tipos, nulabilidad y clave primaria.
Índices y foráneas no, por lo mismo que el respaldo los deja para el final. **La
identidad tampoco**, porque la tabla nueva existe para recibir los valores del
origen y una columna que los genera sola pelearía con ellos; ni los valores por
omisión, que son expresiones del dialecto de origen —`now()`, `GETDATE()`,
`CURRENT`— y crearían una tabla que no compila.

Tres cosas que salieron al construirlo:

1. **La traducción va por su propia ruta** —`POST /api/transfers/translation`— y
   no dentro de la vista previa. Lo enseñó una prueba: se pregunta *antes de que
   la tabla exista*, que es justo cuando sirve para decidir si crearla. La vista
   previa, en cambio, compara dos tablas que ya están.
2. **Dentro del mismo motor no se traduce nada.** Proponer un equivalente sería
   cambiar una columna sin motivo: un `smallint` no tiene por qué convertirse en
   `bigint` porque los dos guarden enteros. La traducción devuelve vacío y el
   asistente lo dice, en lugar de enseñar una tabla de tipos vacía.
3. **`TypeFor` devuelve siempre algo.** Un motor sin tipo para una familia
   contesta con el más cercano que tenga; negarse ahí dejaría a la vista previa
   sin nada que enseñar, y decir qué se pierde es trabajo de quien llama, no del
   dialecto.

Piezas: `Druse.Domain/TypeFacets.cs`, `Application/Transfers/TypeTranslator.cs`,
`ITableDesigner.TypeFor` con sus cuatro implementaciones,
`TransferService.TranslateAsync` y `CreateTargetAsync`, las rutas
`/api/transfers/translation` y `/api/transfers/target`, y en la interfaz el paso
`types` del asistente, que enseña el tipo de cada columna, deja cambiarlo y pone
debajo lo que se pierde.

**Comprobado también desde la pantalla** (sesión 023j): una prueba de punta a
punta abre las dos conexiones —PostgreSQL y SQL Server—, migra una tabla con los
tipos que peor viajan, lee en la pantalla de tipos que el `uuid` se creará como
`uniqueidentifier` y que el JSON «deja de comprobar que lo sea», crea la tabla,
copia y cuenta las filas **en SQL Server**.

**Lo que queda sin comprobar**, que no bloquea la fase: `CrossEngineTransferTests`
cruza PostgreSQL → SQL Server contra motores de verdad, y las otras once
direcciones solo están cubiertas por unitarias; y el paso de tipos no tiene
pruebas de componente en el frontend.

### Fase 4 — Varias tablas y migraciones guardadas ✅ (sesiones 023d, 023f e 023i)

Dos cosas que caben en una fase porque se usan juntas: llevar un conjunto de
tablas de una vez, y poder repetirlo mañana sin volver a armarlo. Las dos están
terminadas, de motor a pantalla.

#### La decisión que había que tomar antes de escribir código

**«Todo o nada» sigue siendo por tabla, y la pasada se para en la primera que
falle.** Una transacción que abarcara el conjunto entero sería lo coherente
cuando hay foráneas de por medio —o entran todas las tablas o ninguna—, pero es
exactamente lo que la fase 1 evitó a propósito: el registro del servidor
creciendo hasta el final y las tablas bloqueadas mientras dura, ahora
multiplicado por el número de tablas. Lo que entró completo se queda, y el
resumen dice cuántas tablas pasaron y en cuál se paró, que es de donde sale por
dónde se retoma.

#### Varias tablas en una pasada ✅

`DataTransferSetRequest` es la lista de traslados más un interruptor para ordenar.
Cada tabla lleva **su modo, su filtro y su emparejamiento**, porque migrar seis
tablas no significa tratarlas igual: de una se lleva el año en curso y de otra
todo, y una se reemplaza mientras las demás se añaden.

Los dos extremos son **una conexión de origen y una de destino para el conjunto
entero**. Los turnos se piden por sesión, y una pasada que tocara cuatro
conexiones tendría que sostener cuatro turnos a la vez, que es la forma más corta
de llegar a un bloqueo mutuo.

`TransferOrder` ordena mirando el grafo **del destino**, que es el único lado que
puede rechazar una escritura: si allí `pedidos` apunta a `clientes`, copiar los
pedidos primero falla por más ordenadas que estén en el origen. Es determinista
—entre dos tablas que nadie obliga a separar gana la que se pidió antes—, ignora
lo que apunta fuera del conjunto y no trata como ciclo a la tabla que se apunta a
sí misma, que es la jerarquía de toda la vida. **Los ciclos se avisan y se copian
sin ordenar.**

Tres cosas que salieron al construirlo:

1. **Vaciar va antes de todo y en el orden contrario.** «Vaciar y cargar» sobre
   dos tablas relacionadas falla siempre si se vacía la padre mientras la hija
   guarda filas que la apuntan, así que el vaciado de la pasada se hace entero
   —de las hijas hacia las padres— y después empieza la copia. El precio queda
   declarado: en una pasada de varias tablas el vaciado ya no cae dentro de la
   transacción de su tabla, de modo que «todo o nada» cubre lo que se carga y no
   lo que se borró antes. Con una sola tabla nada de esto pasa y el vaciado sigue
   donde estaba.
2. **Una tabla es una pasada de una.** El camino de las tres primeras fases no se
   mantiene aparte: `RunAsync` construye un conjunto de un elemento y sigue por
   donde siguen todos. Dos caminos para lo mismo acaban siempre con uno de los dos
   sin probar.
3. **El orden se pregunta antes de confirmar nada**, en `/api/transfers/set/order`.
   Quien va a mover doce tablas quiere verlo en la vista previa, no enterarse por
   el aviso de un traslado que ya empezó.

El progreso tiene ya los dos niveles del respaldo: `TablesDone` y `TablesTotal`
para la pasada, `TableRowsCopied` contra `RowsEstimated` para la tabla en curso, y
`RowsCopied` como total. Con una sola tabla los dos números coinciden, que es como
tiene que ser: lo contrario obligaría a la pantalla a saber en cuál de los dos
casos está.

#### La pantalla ✅

`TransferSetDialog`, aparte del asistente de una tabla y no dentro de él: aquí el
destino **no es una tabla sino el sitio donde viven las tablas**, y meter los dos
flujos en la misma pantalla obligaría a preguntar en cada paso cuál de los dos se
está haciendo.

Sale del menú del esquema o de la carpeta de tablas —«Migrar tablas a…»—, que es
donde se mira cuando se piensa «me llevo esto». Cuatro pasos: marcar las tablas,
elegir el sitio de destino, ver el plan y copiar.

Tres decisiones de esta pantalla:

1. **Se empareja por nombre**, igual que las columnas. Cada tabla del origen busca
   la que se llama igual al otro lado.
2. **Las que no están en el destino se dicen y se quedan fuera.** No se crean:
   crear una tabla es una decisión con tipos y clave primaria, y se toma de una en
   una en el otro asistente. Una pasada que crea a medias parece completa y no lo
   es.
3. **«Vaciar y cargar» no se ofrece en una pasada.** Vaciar exige escribir el
   nombre de la tabla, y con seis marcadas serían seis confirmaciones que no caben
   en una casilla; se hace tabla a tabla, que es donde esa confirmación significa
   algo.

El orden se pide antes de confirmar y se enseña como lista numerada, con el aviso
de los ciclos debajo. Y el progreso ya usa los dos niveles: la tabla en curso
contra su estimación, y «tabla 2 de 6» encima.

#### Cada tabla a lo suyo ✅

Migrar seis tablas no significa tratarlas igual: de una se lleva el año en curso y
de otra todo, y una se actualiza mientras las demás se añaden. El modo de la
pantalla es **el de partida**, y debajo, plegado, cada tabla puede llevar el suyo y
su condición.

Elegir en una tabla el mismo modo de la pasada **no la separa del resto**: si
contara como algo distinto, cambiar después el modo general la dejaría atrás sin
que nadie lo hubiera pedido.

Y con qué se reconoce la fila que ya está también es de cada tabla, porque cada
una tiene la suya. Vacío significa la clave primaria del destino; se escribe otra
cuando hay que sincronizar por una **clave de negocio** —el código del artículo, el
NIT— y no por el identificador que generó cada base por su cuenta. El campo solo
aparece en los modos que tienen que reconocer la fila: en «añadir» sería una
pregunta sin respuesta posible. Lo que se escriba lo comprueba el proceso local
contra el catálogo, como en el asistente de una tabla: sin unicidad detrás,
actualizar tocaría todas las filas que coincidan.

#### Migraciones guardadas ✅

Espejo de `SqliteBackupProfileStore`: tabla `transfer_profiles` en `DruseDatabase`,
con las tablas y las opciones en JSON por lo mismo que allí —solo se usan
enteras— y lo que se lista y se ordena en columnas propias.

La regla que no se puede saltar es la suya: el perfil guarda **nombres —conexión,
base, esquema y tablas—, no identificadores de sesión**, porque se reabre meses
después y para entonces aquella sesión hace mucho que se cerró. Al abrirlo se
resuelve contra dos conexiones vivas, que no tienen por qué ser las de aquel día:
repetir en otro entorno la misma migración es justo para lo que se guarda.

Y se abre **diciendo las dos cosas**: lo que hoy se puede migrar y lo que no.
Negarse por una tabla que alguien borró obligaría a rehacer el perfil entero;
abrirlo callando las ausencias haría creer que la pasada se llevó algo que no se
llevó. Las que faltan en el destino no se crean desde aquí, por lo mismo que en la
pantalla: crear una tabla es una decisión con tipos y clave primaria.

Lo que cada tabla hace distinto **se guarda con el perfil**. Olvidarlo sería
peligroso: uno que perdiera el filtro se llevaría la tabla entera la próxima vez,
sin que nadie lo pidiera.

Buscar en el catálogo por nombre —que es como guardan los perfiles— lo hacen ya
dos servicios, así que vive en `CatalogLookup`.

#### Lo que queda fuera de la fase

**Vaciar y cargar en pasada**, que se deja a propósito: vaciar exige escribir el
nombre de la tabla, y con seis marcadas serían seis confirmaciones.

---

## 6. Cómo se comprueba

1. `dotnet test backend/Druse.slnx` y `cd frontend; npm test -- --watch=false`.
2. Con los motores de verdad: `./build/scripts/test-db.ps1` y después
   `$env:DRUSE_REQUIRE_ENGINES = '1'; dotnet test backend/Druse.slnx`.
3. **En la aplicación levantada**, que es donde se ve si la función sirve. La
   suite de `e2e/` lo hace sola y con sus propios datos: abre el menú de la tabla,
   elige el destino, mira la vista previa, copia y **cuenta las filas del destino
   con un `COUNT(*)`**. Lo que se comprueba al final no es un mensaje en pantalla.
