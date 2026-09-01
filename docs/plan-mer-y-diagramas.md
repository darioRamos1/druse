# Plan — Diagramas entidad-relación

> Documento de trabajo de una función concreta. El plan maestro vive en
> `PLAN_TRABAJO_DRUSE.md` y la bitácora en `BITACORA.md`. Aquí está el detalle
> que no cabe en el backlog: qué se construye, en qué orden y qué se decidió
> descartar.

---

## 1. Qué se quiere

**Ver la forma de una base de datos.** Abrir un esquema y entender en diez
segundos qué tablas hay, cuáles cuelgan de cuáles y por dónde se unen — lo que
hoy exige abrir tabla por tabla, leer sus claves foráneas y dibujar el resto en
una hoja aparte.

Y después, **cambiarla desde ahí**: si el diagrama ya enseña que falta una
relación o sobra una columna, obligar a irse al diseñador de tablas para
arreglarlo es partir en dos un mismo gesto.

El caso que lo justifica es el de siempre: llega una base ajena, sin
documentación, con ochenta tablas y nombres que no explican nada. Druse ya sabe
leer su catálogo entero. Lo único que falta es dibujarlo.

Hay un segundo caso, más incómodo y más frecuente de lo que debería: **bases sin
una sola clave foránea declarada**. Las relaciones existen —`factura.cliente_id`
apunta a `cliente.id`— pero solo en la cabeza de quien la hizo. Un diagrama que
solo lea el catálogo dibujaría ochenta tablas sueltas y sería técnicamente
correcto e inútil.

---

## 2. Decisiones de partida

Tomadas antes de escribir código, porque cada una cambia el diseño entero.

| Decisión | Elegido | Por qué |
| --- | --- | --- |
| Alcance | **Leer y editar desde el diagrama** | El diagrama es donde se ve el problema; mandar al usuario a otra pantalla para resolverlo parte el gesto. La edición reutiliza el diseñador de tablas entero, no se escribe otra vez |
| Relaciones | **Las declaradas, más las inferidas por nombre, señaladas aparte** | Sin inferencia, media base real sale como tablas sueltas. Sin distinguirlas, el diagrama miente. Línea sólida lo que el motor garantiza, punteada lo que Druse supone |
| Dónde vive | **Pestaña propia**, como el diseñador de tablas | Es donde cabe un esquema de trescientas tablas y donde se puede tener más de uno abierto |
| Ámbito | **Cualquier objeto de la misma conexión** | El lienzo es libre: se arrastran tablas de cualquier base y esquema de la conexión. Las relaciones interesantes cruzan esquemas más a menudo de lo que se admite |
| Qué entra al abrir | **Siempre se pregunta** | Un esquema de trescientas tablas dibujado de golpe es una tela de araña y una espera. El árbol de selección ya existe para respaldos: se reutiliza |
| Cómo se dibuja | **SVG propio, sin dependencias nuevas** | El frontend solo depende hoy de Monaco y `sql-formatter`. Con SVG propio, exportar a SVG, PNG y PDF sale casi gratis, y nada estorba al empaquetado sin red |
| Cómo sale | **Imagen (SVG y PNG), texto (Mermaid y DBML) y papel (PDF)** | Las tres se construyen sobre el mismo SVG. La segunda es la que se versiona en git; la tercera es la que se lleva a una reunión |
| Notación | **Pata de gallo** (*crow's foot*) | Es la que se lee sin leyenda. Chen y UML son más expresivas y nadie las reconoce de un vistazo |
| Una conexión por diagrama | **Sí** | Mezclar conexiones obligaría a mantener varias sesiones vivas por pestaña y a dibujar relaciones que ningún motor puede comprobar |

Lo estructural queda registrado en
`docs/decisions/0006-diagramas-desde-el-catalogo.md`, que se escribe al cerrar la
Fase A.

---

## 3. Lo que ya existe y no hay que construir

Conviene decirlo antes de planificar nada, porque cambia el tamaño del trabajo:
**la mitad del backend ya está**.

| Pieza | Dónde | Qué aporta |
| --- | --- | --- |
| `IDatabaseMetadataReader.GetTableStructureAsync` | `Druse.Database.Abstractions` | Devuelve `TableStructure` con clave primaria, índices, claves foráneas, unicidad y comprobaciones |
| `DatabaseForeignKey` | `Druse.Domain/TableStructure.cs` | Columnas, esquema y tabla referenciados, columnas referenciadas, `OnDelete` y `OnUpdate`. Es exactamente una arista |
| Los cuatro proveedores | `Druse.Provider.*` | Ya escriben esas consultas contra sus catálogos y pasan las contractuales |
| `MetadataService` | `Druse.Application/Metadata` | El turno por sesión (`EnterAsync`) y el cambio de base (`UseDatabaseAsync`) ya resueltos |
| Diseñador de tablas | `frontend/features/tables/table-designer` | Formulario completo, previsualización de DDL y aplicación en transacción |
| Árbol de selección | `features/backup/backup-dialog` | Casillas de tres estados sobre la jerarquía del explorador |
| `SchemaIndex` / `KnownRelation` | `shared/models/workspace.ts` | El índice de tablas cargadas que ya alimenta el autocompletado |

**Lo que falta es exactamente esto:** una lectura masiva del catálogo (hoy solo
hay tabla a tabla), un lienzo que lo dibuje, la inferencia de relaciones, la
persistencia del diagrama y las exportaciones.

---

## 4. El modelo

### 4.1 Dos cosas que no se mezclan

Un diagrama tiene dos mitades, y confundirlas es el error que hace que los
diagramas envejezcan mal:

- **Lo que el motor tiene**: tablas, columnas, tipos, claves. Se **relee del
  catálogo cada vez que se abre el diagrama**. Nunca se guarda.
- **Lo que el usuario decidió**: qué tablas entran, dónde está cada una, qué
  sugerencias descartó, qué colores puso. Esto sí se guarda.

De ahí sale la regla: **el archivo del diagrama no contiene ni una columna ni un
tipo**. Guardarlos produciría un dibujo que sigue enseñando una columna borrada
hace seis meses, y un diagrama en el que no se puede confiar no se mira.

Al abrir, lo que ya no existe se marca como ausente en vez de desaparecer en
silencio: el usuario tiene que enterarse de que la tabla se fue.

### 4.2 Lo que se guarda

Una tabla nueva en la base local (`Druse.Persistence.Sqlite/DruseDatabase.cs`,
`PRAGMA user_version` de 6 a 7):

```sql
CREATE TABLE IF NOT EXISTS diagrams (
    id            TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    name          TEXT NOT NULL,
    model         TEXT NOT NULL,   -- JSON
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);
```

El JSON lleva los nodos (base, esquema, nombre, posición, plegado, color), las
relaciones dibujadas a mano, las sugerencias descartadas y las opciones de vista.
Se sirve por `/api/workspace/diagrams`, al lado de las pestañas y los fragmentos
que ya viven en `StorageEndpoints`.

---

## 5. Backend

### 5.1 Una lectura, no trescientas

Hoy `GetTableStructureAsync` lee **una** tabla, y en PostgreSQL cuesta tres
consultas. Un diagrama de sesenta tablas serían ciento ochenta viajes sobre una
conexión que no admite dos cosas a la vez. Es inaceptable, y no se arregla
después: se hace desde el primer commit.

Se añade al contrato:

```csharp
/// <summary>Estructura de varias tablas en una sola lectura.</summary>
Task<IReadOnlyDictionary<DatabaseObject, TableStructure>> GetTableStructuresAsync(
    IDatabaseSession session,
    IReadOnlyList<DatabaseObject> tables,
    CancellationToken cancellationToken);
```

Y lo mismo para las columnas. Cada proveedor lo implementa con **su** consulta
filtrada por la lista de tablas —el contrato ya dice que no se fuerza SQL común,
y aquí se nota más que en ninguna parte, porque el catálogo de claves foráneas es
donde más se separan los cuatro motores.

Hay una implementación base que itera tabla a tabla. Existe solo para que un
proveedor nuevo arranque, y las contractuales miden el número de viajes: un
proveedor que se quede en la implementación base **falla la prueba**, no pasa
desapercibido.

### 5.2 Aplicación

`MetadataService` gana `GetSchemaGraphAsync(sessionId, tables, ct)`, que:

1. entra al turno una sola vez para todo el grafo;
2. agrupa las tablas por base, porque `UseDatabaseAsync` cambia de base y hacerlo
   una vez por tabla sería el mismo problema con otro nombre;
3. devuelve columnas y estructura de todas ellas.

La inferencia de relaciones **no vive aquí**: es un servicio aparte
(`Druse.Application/Diagrams/RelationInference.cs`), sin acceso a la sesión, que
recibe el grafo ya leído y devuelve sugerencias. Así se prueba sin servidor y no
se cuela dentro de la lectura del catálogo, que tiene que seguir contando la
verdad y nada más.

### 5.3 API local

En `DatabaseEndpoints`:

| Ruta | Qué hace |
| --- | --- |
| `POST /api/sessions/{sessionId}/metadata/graph` | Lista de tablas → columnas, estructuras y sugerencias |

En `StorageEndpoints`, junto a `/api/workspace/tabs`:

| Ruta | Qué hace |
| --- | --- |
| `GET /api/workspace/diagrams` | Los diagramas guardados |
| `PUT /api/workspace/diagrams/{id}` | Crear o actualizar |
| `DELETE /api/workspace/diagrams/{id}` | Borrar |

---

## 6. Las relaciones que el motor no declara

Es la parte que hace útil el diagrama en una base real, y la que más fácil sería
hacer mal. La regla que lo gobierna todo: **una sugerencia nunca se disfraza de
hecho**.

### 6.1 Cómo se infiere

Sobre el grafo ya leído, sin tocar la base:

1. **Por sufijo**: `cliente_id`, `id_cliente`, `clienteid` cuando existe una tabla
   `cliente` —o `clientes`, con las plurales de español e inglés— cuya clave
   primaria sea de una sola columna.
2. **Por nombre de clave**: una columna que se llama igual que la clave primaria
   de otra tabla, siempre que ese nombre no sea genérico. `id`, `codigo`,
   `estado`, `fecha`, `nombre` y `tipo` no sugieren nada: emparejarían todo con
   todo.
3. **El tipo tiene que encajar.** Entero con entero, texto con texto y longitud
   compatible. Un `varchar(10)` no apunta a un `bigint` por mucho que se llamen
   igual.
4. **Nunca se sugiere lo que ya está declarado**, ni un par de columnas que ya
   une una clave foránea real.

Cada sugerencia lleva una confianza. **Solo se dibujan las altas** —sufijo,
tabla única, tipo idéntico, columna indizada—; las demás se cuentan en la
cabecera («14 relaciones sugeridas, 6 dudosas») y se muestran si se piden.

### 6.2 Cómo se ven

- **Línea sólida**: clave foránea declarada. El motor la garantiza.
- **Línea punteada, en otro color y con leyenda fija**: sugerencia de Druse.
- Un interruptor las apaga todas; el diagrama vuelve a decir solo lo que el
  catálogo dice.
- Una sugerencia se puede **descartar**, y queda descartada en ese diagrama para
  siempre. Es la forma de que la segunda pasada sea más limpia que la primera.
- Y se puede **aceptar**, que no la convierte en nada: **abre la previsualización
  del `ALTER TABLE ... ADD CONSTRAINT`** con las mismas protecciones de siempre.
  Ninguna suposición de Druse escribe en la base sin que alguien lea el SQL.

---

## 7. El lienzo

### 7.1 Qué es un nodo

Una tabla es una caja: cabecera con esquema y nombre, y una fila por columna con
su tipo, sus marcas de clave y si admite nulos. Tres niveles de detalle, porque
lo que se necesita a zoom completo no es lo que se necesita mirando ochenta
tablas:

| Nivel | Qué enseña |
| --- | --- |
| Completo | Todas las columnas |
| Claves | Solo las que forman parte de una clave o restricción |
| Plegado | Solo la cabecera |

El nivel general se elige en la barra, y cada nodo puede romperlo por su cuenta.

Las **vistas** se pueden invitar al lienzo y se dibujan en gris, sin edición: son
contexto, no entidades.

### 7.2 Cardinalidad, que se deduce y no se pregunta

La punta de cada línea sale del catálogo, no de un formulario:

- El lado hijo es **uno** si sus columnas de clave foránea están cubiertas por un
  índice único o por la clave primaria; **muchos** si no.
- Es **opcional** —círculo— si alguna columna de la clave admite nulos;
  **obligatorio** —barra— si ninguna lo admite.
- Una **tabla puente** —toda su clave primaria son claves foráneas a otras dos
  tablas— se reconoce y se marca. Se puede plegar a una sola línea `N:M` entre
  las dos tablas que une, que es como la dibujaría cualquiera a mano.

### 7.3 Dónde va cada tabla

La parte cara. Sin dependencias, se implementa una colocación por capas
determinista: componentes conexas separadas, nivel por profundidad de
dependencia —las tablas sin claves foráneas salientes arriba—, y una pasada
baricéntrica por nivel para reducir cruces. Determinista importa: el mismo
esquema tiene que salir siempre igual, o el diagrama no se puede comparar consigo
mismo.

Colocar es una acción, no un estado: el botón **Reorganizar** la lanza, y en
cuanto alguien mueve una tabla, su posición manda y se guarda.

Si al medirla contra un esquema real de más de cien tablas el resultado se enreda
demasiado, la salida está escrita: `dagre` es una dependencia pequeña, sin
interfaz, que resuelve solo la colocación. El dibujo seguiría siendo nuestro. No
se toma esa decisión antes de tener el problema.

### 7.4 Mecánica

Pan con arrastre y rueda, zoom con `Ctrl`+rueda, encuadre a la selección, ir a
una tabla por nombre, minimapa. Selección múltiple. Marcar una tabla resalta sus
vecinas y apaga el resto — en un diagrama grande es lo único que lo hace legible.

Dos decisiones técnicas que hay que tomar el primer día porque después cuestan
una reescritura:

- **Nada de `<foreignObject>`.** Todo el texto es `<text>` SVG. Es más trabajo
  para medir y recortar nombres largos, y es lo único que sobrevive a la
  serialización a PNG y a PDF.
- **Virtualización desde el principio**: solo se montan los nodos que caen en la
  vista, más un margen. Con trescientas cajas de veinte columnas, montarlas todas
  es una pestaña que no responde.

---

## 8. Editar desde el diagrama

La regla, en una línea: **el diagrama es otra puerta al diseñador de tablas, no
otro camino para escribir en la base.**

| Gesto | Qué abre |
| --- | --- |
| Doble clic en la cabecera | El diseñador de tablas sobre esa tabla |
| Doble clic en una columna | El diseñador, ya en esa columna |
| Arrastrar de una columna a otra | El formulario de clave foránea, con origen y destino puestos |
| Menú contextual sobre una tabla | Añadir columna, índice o restricción; quitar del lienzo; ver datos; guionizar |
| Aceptar una sugerencia | El mismo formulario de clave foránea (§6.2) |

Todo acaba en la **previsualización de DDL que ya existe**, con su transacción,
su confirmación de operaciones destructivas y su rechazo en conexiones de solo
lectura. No se añade ni una vía de escritura nueva: si algo no se puede hacer hoy
desde el diseñador, tampoco se puede desde el diagrama.

Cuando el cambio se aplica, **se relee el catálogo de las tablas afectadas** y el
nodo se redibuja con lo que el motor tiene ahora, no con lo que se pidió. Es la
diferencia entre un diagrama y un dibujo de nuestras intenciones.

Quitar una tabla del lienzo **no la borra**, y la palabra en el menú es *Quitar
del diagrama*. Borrar de verdad está en el mismo sitio de siempre, con la misma
confirmación de siempre.

---

## 9. Cómo sale

Las tres exportaciones se construyen sobre el mismo SVG.

| Formato | Cómo | Detalle que lo rompe si se olvida |
| --- | --- | --- |
| SVG | El propio lienzo, con los estilos en línea y la fuente declarada con su alternativa | Los estilos viven en una hoja aparte: sin volcarlos al nodo, el archivo sale sin colores |
| PNG | El SVG a `Image`, y a `canvas`, a doble escala | La fuente tiene que estar cargada antes de dibujar, o el texto sale desplazado |
| Mermaid `erDiagram` y DBML | Texto generado del modelo | Sanear los nombres que no son identificadores válidos en esos formatos |
| PDF e impresión | Paginación en cuadrícula, con marcas de continuación, leyenda e índice de tablas por página | Una tabla partida entre dos hojas no se lee: la cuadrícula corta por espacios, no por centímetros |

El archivo se guarda por el mismo camino que las exportaciones del panel de
resultados. En el texto se ofrece además **copiar al portapapeles**, que es lo
que de verdad se usa para pegarlo en un `README`.

Las relaciones sugeridas viajan a la exportación **marcadas como sugeridas**, o
no viajan. En Mermaid y DBML, comentadas. Un diagrama exportado que presenta
suposiciones como claves foráneas es peor que no exportarlo.

---

## 10. Los cuatro motores

Van juntos desde la Fase A, como el diseñador de tablas. Es lo que hizo aparecer
las diferencias el primer día en vez del último.

| Motor | Qué cambia |
| --- | --- |
| PostgreSQL | `pg_constraint` con `confrelid` y `conkey`. Las claves cruzan esquemas con normalidad, así que el ámbito ancho se nota aquí primero |
| SQL Server | `sys.foreign_keys` y `sys.foreign_key_columns`. Base y esquema son cosas distintas y las claves no cruzan bases: un lienzo con dos bases tendrá islas y es correcto |
| MySQL y MariaDB | No hay esquema aparte de la base; el nodo se etiqueta con la base. `information_schema.KEY_COLUMN_USAGE` con `REFERENTIAL_CONSTRAINTS`. **Solo InnoDB tiene claves foráneas**: en MyISAM la inferencia no es una comodidad, es lo único que dibuja algo |
| Informix | `sysconstraints`, `sysreferences` y `syscoldepend`, con el propietario en el papel del esquema y las columnas por número de posición. Es el que más se aleja, y por eso entra en las contractuales desde el primer día |

---

## 11. Fases

### Fase A — La lectura masiva ✅

Contrato `GetTableDetailsAsync` en lote, las cuatro implementaciones,
`GetSchemaGraphAsync` y el endpoint del grafo. Sin interfaz.

**Criterio de salida:** el grafo de un esquema de cincuenta tablas se lee en los
cuatro motores, y la contractual comprueba que cuesta un número de viajes
acotado, no uno por tabla.

_Cerrada en la sesión 039._ El coste quedó en cuatro consultas (PostgreSQL,
MySQL) y cinco (SQL Server, Informix), **sean dos tablas o sesenta**; en Informix
eran unas diez **por tabla**. Contar los viajes de verdad exigiría instrumentar
los cuatro drivers, que no comparten un punto por donde pasen sus consultas, así
que la contractual comprueba dos cosas verificables: que el proveedor **declara**
su propia implementación —quedarse en la base la hace fallar— y que el lote
devuelve exactamente lo mismo que leer tabla a tabla, con una tabla que da
claves, otra que las recibe, una suelta que no debe heredar nada y una cuarta que
no existe.

### Fase B — El lienzo que dibuja

Pestaña propia, nodos SVG, aristas con pata de gallo, zoom, pan, minimapa,
colocación automática, virtualización, tres niveles de detalle.

**Criterio de salida:** un esquema de cien tablas se abre, se navega con fluidez y
sus relaciones se leen sin ayuda. El diagrama está en el barrido de `e2e`, y sus
capturas —tema claro y oscuro, anchos de 900, 1024 y 1440— están **miradas**:
ninguna caja superpuesta, ninguna línea sobre el texto, ningún nombre fuera de su
caja.

### Fase C — Qué entra y qué se guarda

Selector de tablas al abrir, invitar tablas de otras bases y esquemas de la
conexión, traer vecinas de una tabla con un clic, tabla `diagrams`, endpoints de
almacenamiento, releer al abrir y marcar lo ausente.

**Criterio de salida:** se cierra Druse, se vuelve a abrir y el diagrama está
donde estaba. Se borra una tabla desde fuera y al abrir el diagrama se dice.

_Cerrada en la sesión 039._ El selector —que llega con todo marcado y no pregunta
sobre una tabla suelta—, **traer vecinas** —que lee el esquema entero una vez y
lo recuerda, porque las tablas que apuntan a una no están en el grafo dibujado—,
y el guardado: tabla `diagrams`, `PRAGMA user_version` 7 y
`/api/workspace/diagrams`. El modelo guardado es `{target, tables, positions}`,
sin una sola columna ni tipo, así que las tablas que ya no existen no vuelven al
lienzo.

Salió además una pieza que el plan no había previsto: **Olvidar**. Sin ella
guardar era irreversible —el esquema se abriría siempre igual, sin forma de
volver a elegir—, y una función que solo se puede activar está a medias.

Sigue sin ser una pestaña: es una capa sobre el shell. Ahora que el diagrama se
guarda, la pestaña ya no tiene nada que la bloquee.

### Fase D — Las relaciones sugeridas

`RelationInference`, confianza, dibujo diferenciado, interruptor, descartar,
aceptar contra la previsualización de DDL.

**Criterio de salida:** una base sin una sola clave foránea declarada sale
dibujada y con las sugerencias distinguibles de un vistazo. Ninguna sugerencia
llega a la base sin pasar por la previsualización.

### Fase E — Editar desde el diagrama

Los gestos de §8 sobre el diseñador de tablas existente, y el redibujado tras
aplicar.

**Criterio de salida:** se añade una columna, se crea una clave foránea y se
cambia un tipo sin salir de la pestaña, y el nodo enseña después lo que el motor
tiene. El camino entero está en `e2e`, con captura de la previsualización del DDL
abierta desde el lienzo.

### Fase F — Las salidas

SVG, PNG, Mermaid, DBML, PDF e impresión.

**Criterio de salida:** el mismo diagrama sale en los cinco formatos, con los
colores y las relaciones sugeridas marcadas, y el PDF de un esquema grande se
lee en papel. La prueba de punta a punta descarga el SVG y el PNG y los compara
con lo que se ve en pantalla: una exportación que pierde los estilos se detecta
ahí y en ningún otro sitio.

---

## 12. Pruebas

Lo mismo que funcionó en el diseñador de tablas y en los respaldos:

- **Contractuales, una por comportamiento, cuatro motores.** Una base de prueba
  con clave compuesta, clave que cruza esquemas, clave hacia sí misma
  —`empleado.jefe_id`— y tabla puente. Las cuatro son las que rompen los
  dibujantes de diagramas.
- **Del coste**: la lectura del grafo cuenta los viajes al servidor. Es la única
  prueba que impide que un proveedor se quede en la implementación base.
- **Unitarias sin servidor** para la inferencia —los aciertos y sobre todo los
  falsos positivos: `estado`, `codigo` y `tipo` no deben sugerir nada—, para la
  cardinalidad deducida, para la detección de tablas puente y para la colocación,
  que al ser determinista se prueba con posiciones esperadas.
- **De interfaz** para el lienzo: que quitar del diagrama no borre nada, que una
  sugerencia descartada siga descartada tras recargar, que el interruptor de
  sugerencias no deje ninguna línea punteada, y que un cambio aplicado redibuje
  el nodo con lo releído.
- **De exportación**: el SVG generado se vuelve a abrir y conserva colores y
  texto; el Mermaid producido se valida; el PDF de cien tablas no parte ninguna
  caja entre hojas.

### De punta a punta, y con capturas

La suite de `e2e/` ya existe —Playwright, que levanta la API y el frontend por su
cuenta contra un PostgreSQL de verdad— y el diagrama entra en ella desde la Fase
B. Aquí es donde de verdad se comprueba, porque un lienzo se rompe en sitios que
ninguna prueba unitaria mira: dos cajas superpuestas, una línea que cruza por
encima del texto, un nombre largo que se sale de su caja.

- **Camino completo en `e2e`**: abrir el explorador, elegir tablas, ver el
  diagrama dibujado con sus relaciones, mover una tabla, cerrar y reabrir la
  pestaña con todo en su sitio.
- **El diagrama entra en el barrido visual** (`e2e/tests/barrido.spec.ts`), que
  no afirma nada: fotografía y mide. Le tocan las capturas `20-mer-*`, y con las
  mismas variantes que el resto —**tema claro y tema oscuro**, y los anchos de
  **900, 1024 y 1440**—, más una del diagrama con muchas tablas, que es donde se
  ve si la colocación sirve.
- **`medir()` se aplica también al lienzo.** Ya detecta sola texto recortado,
  alto escondido sin desplazamiento y botones sin nombre accesible; hay que
  añadirle lo propio de un diagrama: que ninguna caja se solape con otra, que
  ninguna arista pase por encima del texto de un nodo y que ningún nombre de
  tabla salga de su caja.
- **Las capturas se miran**, no solo se generan. Una función del lienzo no está
  terminada hasta haber visto sus imágenes en los dos temas y en los tres anchos.

Hace falta el contenedor: `./build/scripts/test-db.ps1 -Engine postgres`.

---

## 13. Lo que no se hace, y es una decisión

- **No se modela en blanco.** El diagrama parte siempre de una base existente. Un
  lienzo vacío que genera una base entera es otra función —modelado directo— y se
  decidió no meterla aquí.
- **No se mezclan conexiones.** Un diagrama pertenece a una conexión. Dibujar una
  relación entre dos servidores sería inventar algo que ningún motor comprueba.
- **No hay comparación de esquemas.** Es otra entrada del backlog y merece su
  propia pantalla.
- **No hay notación Chen ni UML.** Pata de gallo, que se lee sin leyenda.
- **Las vistas, los procedimientos y los disparadores no son entidades.** Las
  vistas se invitan al lienzo como contexto en gris; el resto no aparece.
- **No se dibujan los datos.** Un diagrama de ochenta tablas no lleva conteos de
  filas: cuestan una consulta por tabla y envejecen en minutos.

---

## 14. Riesgos

| Riesgo | Cómo se ataja |
| --- | --- |
| La colocación propia produce una maraña en esquemas reales | Se mide contra un esquema de más de cien tablas al cerrar la Fase B, con la salida a `dagre` ya identificada y acotada a colocar |
| Trescientas cajas dejan la pestaña sin responder | Virtualización por vista desde el primer commit, no como optimización posterior |
| La lectura del grafo tarda demasiado | Lectura en lote desde la Fase A, con la prueba que cuenta viajes |
| El PNG sale con el texto desplazado o sin estilos | Solo `<text>`, estilos volcados en línea y fuente cargada antes de serializar; prueba de exportación en la Fase F |
| La inferencia llena el diagrama de relaciones falsas | Lista de nombres genéricos excluidos, compatibilidad de tipos obligatoria, umbral de confianza y prueba unitaria dedicada a los falsos positivos |
| Alguien toma una sugerencia por una clave real | Trazo, color y leyenda distintos en pantalla; marcadas o ausentes en toda exportación |
| Editar desde el diagrama abre una vía de escritura sin previsualización | Todos los gestos terminan en el diseñador de tablas existente; ningún endpoint de escritura nuevo |
| Un diagrama guardado envejece y miente | No se guarda ni una columna: se relee el catálogo al abrir y lo ausente se marca |
| Informix se comporta distinto en todo | Entra en las contractuales desde la Fase A, no al final |
