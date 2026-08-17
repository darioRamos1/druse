# Plan — Respaldos y restauración

> Documento de trabajo de una función concreta. El plan maestro vive en
> `PLAN_TRABAJO_DRUSE.md` y la bitácora en `BITACORA.md`. Aquí está el detalle
> que no cabe en el backlog: qué se construye, en qué orden y qué se decidió
> descartar.

---

## 1. Qué se quiere

Una herramienta de respaldo **que el usuario arma**. No un botón que vuelca la
base entera, sino una selección: estos esquemas, estas tablas, estos
procedimientos; unos con datos y otros sin ellos; estas filas y no todas.

El caso que la justifica es el de todos los días: llevarse la estructura de
producción a desarrollo **sin los datos**, salvo las tablas de catálogo, que sin
sus filas no sirven de nada. Hoy eso exige abrir cada objeto, copiar su DDL a
mano y escribir los `INSERT` uno por uno.

Lo que se entrega es un artefacto que se puede leer, versionar en git, guardar y
volver a aplicar.

---

## 2. Decisiones de partida

Tomadas antes de escribir código, porque cada una cambia el diseño entero.

| Decisión | Elegido | Por qué |
| --- | --- | --- |
| Quién genera el respaldo | **Druse lo guioniza**; las herramientas nativas quedan como adaptador posterior | El catálogo ya se lee en los cuatro motores. Guionizar no exige instalar `pg_dump` ni `dbexport`, funciona igual en los cuatro y es lo único que permite la selección fina que se pide |
| Alcance | **Respaldar y restaurar** | Sin restaurar, el ciclo lo cierra el usuario a mano y nadie comprueba que lo generado se puede aplicar |
| Motor destino al restaurar | **El mismo del origen**, con el formato preparado para no cerrar la traducción | Traducir dialectos es una función entera por sí sola, con pérdidas inevitables |
| Automatización | **Perfiles guardados, lanzados a mano** | La programación exige un servicio vivo con la ventana cerrada; es otra discusión |
| Motores | **Los cuatro a la vez** | Es como se hizo el diseñador de tablas: una prueba contractual, cuatro proveedores, y las diferencias aparecen el primer día en vez del último |
| Interfaz | **Menú contextual y pestaña propia** | El menú es el camino corto; la pestaña es donde cabe un árbol de trescientas tablas |

Lo estructural de estas decisiones queda registrado en
`docs/decisions/0005-respaldos-guionizados-por-druse.md`.

---

## 3. Lo que el usuario elige

Este es el corazón de la función. Todo lo demás existe para sostenerlo.

### 3.1 Qué objetos entran

Un árbol de selección con casillas de tres estados —marcado, sin marcar, parcial—
sobre la jerarquía que el explorador ya sabe leer:

```text
base
└── esquema
    ├── tablas
    ├── vistas
    ├── funciones
    ├── procedimientos
    ├── secuencias
    └── disparadores
```

Marcar un esquema marca lo que cuelga de él, **y lo que se cree después también
entra**: la selección se guarda como «este esquema entero» y no como la lista de
sus tablas de hoy. Marcar objetos sueltos guarda nombres. La diferencia importa
al reutilizar un perfil seis meses más tarde.

Los índices, claves y restricciones no son nodos del árbol: viajan con su tabla y
se gobiernan con un interruptor aparte, porque no se eligen de uno en uno.

Los **usuarios y permisos** son una casilla del nivel de la base, y entran en la
última fase: es lo más dispar entre motores y lo único que exige permisos
elevados en el servidor.

### 3.2 Con datos o sin ellos

Lo pedido explícitamente, y con dos niveles:

- **Un interruptor general** — solo estructura · estructura y datos · solo datos.
  Es el valor por omisión de todo el respaldo.
- **Y el mismo interruptor por tabla**, que gana sobre el general cuando se toca.

Así se expresa en una sola pasada lo que hoy exige dos respaldos: *todo sin
datos, salvo `paises`, `monedas` y `tipos_documento`.*

La interfaz tiene que dejar ver de un vistazo cuáles rompen la regla general;
si no, el usuario no sabe qué va a obtener. El árbol lo marca con una insignia
en la fila, y la cabecera resume «41 tablas · 3 con datos».

**Solo datos** existe para el caso de recargar una base cuya estructura ya está
puesta. Lleva `DELETE`/`TRUNCATE` previo como opción explícita, apagada.

### 3.3 Qué filas entran

Por tabla, y las tres cosas se combinan:

- **Condición `WHERE`** — se escribe a mano y se pega al `SELECT` de lectura.
  Pasa por `SqlSafetyAnalyzer` antes de ejecutarse: es texto del usuario dentro
  de una consulta que arma Druse, y ese es exactamente el camino que el plan §12
  obliga a analizar.
- **Límite de filas** — un tope por tabla, para sacar muestras de desarrollo.
  Cada motor lo escribe a su manera (`LIMIT`, `TOP`, `FIRST`) y eso ya vive en el
  escritor SQL por proveedor.
- **Columnas excluidas** — contraseñas, datos personales. Salen como `NULL` o
  como su valor por omisión.

Excluir una columna `NOT NULL` sin valor por omisión **no se permite**: el
`INSERT` fallaría al restaurar. Se avisa al marcarla, no al fallar.

Un límite de filas sobre una tabla con clave foránea puede dejar hijos sin padre.
No se corrige solo —adivinar qué filas arrastrar es otra función— pero el
manifiesto lo anota y la interfaz lo advierte al marcarlo.

### 3.4 Cómo sale

Los cuatro formatos, combinables:

| Forma | Para qué |
| --- | --- |
| **Un solo `.sql`** | Ejecutar de principio a fin, incluso en el propio editor de Druse |
| **Carpeta por tipo de objeto** | Versionar en git y ver en el diff qué cambió de una semana a otra |
| **`.zip` con manifiesto** | Guardar y mover; el manifiesto dice qué contiene, de qué servidor y cuándo |
| **Datos en CSV** | Tablas grandes: mucho más rápido y pequeño que millones de `INSERT` |

El CSV reutiliza el exportador que ya existe (`IResultExporter`), y al restaurar
lo lee el camino de importación que ya existe. No se escribe nada nuevo para eso.

---

## 4. El artefacto

### 4.1 Manifiesto

Todo respaldo lleva un `manifest.json`, aunque sea un `.sql` suelto —ahí va como
cabecera de comentarios—. Sin él, un archivo encontrado seis meses después no
dice de dónde salió.

```json
{
  "druse": "0.2.0",
  "formato": 1,
  "creado": "2026-08-17T14:03:11Z",
  "origen": {
    "motor": "PostgreSql",
    "version": "18.0",
    "servidor": "srv-prod",
    "base": "ventas"
  },
  "contenido": { "tablas": 41, "conDatos": 3, "vistas": 7, "rutinas": 12 },
  "avisos": ["pedidos: limitada a 1000 filas", "clientes: columna 'clave' excluida"]
}
```

El campo `formato` es la versión del propio artefacto: si mañana cambia su
estructura, un Druse nuevo tiene que saber leer los viejos o negarse con un
mensaje claro, no reventar a medias.

`motor` es lo que impide restaurar un respaldo de SQL Server en PostgreSQL: no se
intenta y se dice por qué.

### 4.2 Orden de escritura

Lo que decide si el respaldo se puede aplicar o no:

1. Esquemas y secuencias
2. Tablas, **sin claves foráneas**
3. Datos
4. Índices, claves primarias, foráneas y restricciones
5. Vistas, funciones, procedimientos
6. Disparadores
7. Valor actual de las secuencias
8. Permisos

Las foráneas van **siempre** después de los datos, no por comodidad: entre tablas
puede haber ciclos, y con un ciclo no existe ningún orden de creación que las
satisfaga a la vez.

El valor actual de las secuencias va al final y no es un adorno: sin él, la base
restaurada choca contra una clave duplicada en el primer `INSERT` que haga el
usuario.

Y donde la identidad es explícita hay que abrirle paso —`SET IDENTITY_INSERT` en
SQL Server, la secuencia reajustada en PostgreSQL, el `SERIAL` de Informix—,
porque copiar los datos significa copiar también las claves que ya tienen.

---

## 5. Backend

### 5.1 Contrato

Un puerto nuevo en `Druse.Database.Abstractions`, al lado de `ITableDesigner`:

```csharp
public interface IDatabaseScripter
{
    DatabaseEngine Engine { get; }
    ScripterCapabilities Capabilities { get; }

    IReadOnlyList<string> ScriptTable(TableStructure table, ScriptOptions options);
    IReadOnlyList<string> ScriptConstraints(TableStructure table);
    IReadOnlyList<string> ScriptRoutine(RoutineDefinition routine);
    IReadOnlyList<string> ScriptSequence(SequenceDefinition sequence, bool includeCurrentValue);
    IReadOnlyList<string> ScriptGrants(ObjectGrants grants);

    string BeginDataLoad(TableStructure table);   // IDENTITY_INSERT, FOREIGN_KEY_CHECKS…
    string EndDataLoad(TableStructure table);
    string FormatLiteral(DatabaseColumn column, object? value);
}
```

`ScripterCapabilities` sigue el patrón de `IndexCapabilities`: la interfaz dibuja
lo que el motor admite en vez de preguntar contra qué está conectada. Informix no
tiene esquemas como PostgreSQL y MySQL no distingue base de esquema; eso se
declara, no se disimula por ahí.

Lo que **no** entra en el contrato: aceptar SQL ya escrito por el cliente. El
guion lo genera siempre el proveedor a partir de la selección, por la misma razón
que el diseñador de tablas —aceptar instrucciones hechas sería una vía para
ejecutar cualquier cosa saltándose el análisis de riesgo—.

Un `ScripterBase` compartido resuelve lo común (orden, cabeceras, troceado de
`INSERT`) igual que `TableDesignerBase`, y cada proveedor pone su dialecto.

### 5.2 Dominio y aplicación

- `BackupPlan` — la selección completa: qué objetos, qué modo de datos general,
  qué anulaciones por tabla, qué filtros, qué formato. Es lo que se guarda como
  perfil y lo que viaja por la API.
- `BackupService` — resuelve el plan contra el catálogo actual, ordena, y escribe
  llamando al escritor del motor.
- `RestoreService` — lee un artefacto, valida el manifiesto contra la conexión
  destino y ejecuta.
- `BackupProfileStore` — perfiles en SQLite, junto a las conexiones.

### 5.3 Tres cosas que no se pueden dejar para después

**Los datos no caben en memoria.** Se lee con el lector del proveedor y se escribe
al archivo por streaming, sin materializar la tabla. Un respaldo que carga una
tabla de diez millones de filas en un `List<>` no falla en las pruebas: falla en
producción, que es donde se usa.

**El respaldo tiene que ser consistente.** Todas las lecturas van dentro de una
misma transacción de solo lectura con instantánea —`REPEATABLE READ` en
PostgreSQL, `SNAPSHOT` en SQL Server, la instantánea consistente de InnoDB—. Sin
eso, la tabla de pedidos se lee a las 10:00 y la de líneas a las 10:04, y el
respaldo nace roto. Donde el motor no lo garantice, **se declara el límite en el
manifiesto** en vez de callarlo. Reutiliza `OperationScope`, que ya decide si una
operación abre su transacción o se une a la del usuario.

**Es una operación larga.** El servicio publica su estado —paso, objeto, filas,
avisos— mientras trabaja, y es cancelable por el mismo camino que ya cancela una
consulta. Sin eso, el usuario no distingue «trabajando» de «colgado» y mata la
aplicación. El detalle está en el §7, que es requisito y no adorno.

### 5.4 Quién escribe el archivo

El navegador no puede escribir en una ruta arbitraria, y un respaldo de dos
gigas no puede pasar por la memoria del navegador para bajar como descarga.

Decisión: **el backend escribe directo en disco**. La carpeta la elige el usuario
con el selector nativo del envoltorio (`IFilePicker`, ya existe) y el proceso
local escribe ahí por streaming. En desarrollo, sin envoltorio, se cae a la
descarga del navegador con un tope de tamaño y se avisa.

### 5.5 API local

```text
POST   /api/backup/preview     → el guion que se generaría, sin ejecutar nada
POST   /api/backup/run         → lanza el respaldo, devuelve su identificador
GET    /api/backup/{id}/status → progreso, objeto en curso, avisos
POST   /api/backup/{id}/cancel
GET    /api/backup/profiles    · POST · PUT · DELETE
POST   /api/restore/inspect    → lee un artefacto y describe qué contiene
POST   /api/restore/run        → aplica, con las mismas garantías de progreso
```

`preview` antes que `run` no es un lujo: es lo que permite que el usuario vea el
SQL exacto antes de que toque nada, como en el resto de Druse.

---

## 6. Frontend

Una función nueva en `features/backup/`, con dos puertas:

- **Menú contextual del explorador** — clic derecho sobre base, esquema o tabla →
  «Respaldar», y el asistente abre con eso ya marcado.
- **Pestaña propia**, abierta desde el asistente con «abrir en pestaña», para
  cuando la selección es grande: árbol a la izquierda, vista previa del guion a
  la derecha en un Monaco de solo lectura.

El asistente tiene cuatro pasos, y ninguno oculta lo que hará el siguiente:

1. **Qué** — el árbol con las casillas de tres estados.
2. **Datos** — el interruptor general, la lista de las tablas que lo anulan y sus
   filtros.
3. **Cómo** — formato, destino, compresión.
4. **Revisar** — el resumen, los avisos y el guion. Y el botón de guardar como
   perfil, aquí y no al principio: solo al final se sabe qué se está guardando.

La restauración es el mismo asistente al revés: se elige el artefacto, se enseña
lo que contiene, se comprueba el motor destino y se muestra **qué se va a
ejecutar y qué se va a sobrescribir** antes de tocar nada.

---

## 7. Progreso, éxito y fallo

Requisito de primer nivel, no un adorno de la última fase. Un respaldo serio tarda
minutos u horas, y durante ese tiempo el usuario tiene que poder responder a tres
preguntas sin adivinar: **qué está haciendo ahora**, **cuánto falta** y **cómo
acabó**. Hoy Druse no tiene ni componente de progreso ni sistema de avisos, así
que esto se construye aquí y se deja reutilizable.

### 7.1 Dos barras, no una

- **La global** — pasos y objetos completados sobre el total.
- **La del objeto en curso** — filas escritas de esa tabla.

Con una sola barra, una tabla de ocho millones de filas deja el indicador
inmóvil durante veinte minutos y el usuario concluye que se colgó. La segunda
barra existe justo para ese rato.

Siempre acompañadas de texto con **nombre propio**, nunca un porcentaje suelto:

```text
Escribiendo datos · ventas.pedidos
1 240 000 de ~3 100 000 filas · 4 de 41 tablas · 2 min 18 s
```

### 7.2 Los pasos son visibles

El trabajo se anuncia por lo que es, no como una única barra opaca:

1. Resolviendo la selección contra el catálogo
2. Leyendo la estructura
3. Escribiendo estructura
4. Escribiendo datos *(tabla a tabla)*
5. Escribiendo índices, claves y restricciones
6. Escribiendo vistas, rutinas y disparadores
7. Empaquetando

El empaquetado es un paso propio porque comprimir varios gigabytes tarda, y
durante ese rato la barra de datos ya está llena: sin nombrarlo, parece colgado
justo al final.

### 7.3 Nada de barras falsas

El total de filas es una **estimación** del catálogo —`reltuples` en PostgreSQL,
`sys.partitions` en SQL Server, `information_schema.TABLES` en MySQL, `nrows` de
`systables` en Informix—, porque un `COUNT(*)` sobre cada tabla seleccionada
antes de empezar puede costar más que el propio respaldo. Por eso el número va
con `~` delante, y así se dice.

Donde no hay estimación fiable —una tabla con condición `WHERE`, o una vista— la
barra del objeto va **indeterminada con contador absoluto**: «487 300 filas
escritas». Una barra que llega al 90 % y se queda ahí es peor que no tener barra,
porque miente sobre lo que falta.

### 7.4 La ventana no se bloquea

La operación vive en el proceso local, no en el diálogo. Se puede **cerrar el
asistente y seguir trabajando**: el progreso continúa visible en la barra de
estado, y desde ahí se vuelve a abrir el detalle. Un respaldo de media hora que
secuestre la aplicación entera es una función que nadie usará dos veces.

**Cómo llega el dato:** sondeo a `GET /api/backup/{id}/status` cada 500 ms, con el
estado en memoria del proceso local. Se elige frente a SSE o WebSocket porque
sobrevive a que la ventana se cierre y se reabra, no exige mantener un flujo
abierto ni tocar la seguridad de la API local, y medio segundo es resolución de
sobra para algo que dura minutos.

**Cancelar está siempre a la vista**, por el mismo camino que ya cancela una
consulta. Al cancelar, **el archivo parcial se borra**: un respaldo a medias con
aspecto de completo es más peligroso que no tener ninguno. En salida por
carpetas, lo escrito se conserva pero el manifiesto queda marcado como incompleto.

### 7.5 Cómo acaba: cuatro estados, ninguno efímero

Terminado el trabajo hay un **resumen que se queda en pantalla** hasta que el
usuario lo cierra. Un aviso que se desvanece a los tres segundos no sirve para
algo que tardó veinte minutos y que quizá ocurrió mientras nadie miraba.

| Estado | Qué dice |
| --- | --- |
| **Correcto** | Qué se llevó —«41 tablas, 3 con datos, 128 439 filas, 12 rutinas»—, dónde quedó, cuánto pesa, cuánto tardó. Con «abrir carpeta» y «abrir en el editor» |
| **Correcto con avisos** | Lo mismo, y la lista de avisos: tablas limitadas, columnas excluidas, objetos omitidos, consistencia que el motor no garantizó. **No se pinta de verde limpio**: el usuario tiene que saber que lo que tiene no es todo |
| **Fallido** | Qué objeto falló, el mensaje del motor pasado por su normalizador, **la instrucción exacta** que lo provocó, y qué se alcanzó a escribir antes |
| **Cancelado** | Dónde se cortó y qué se hizo con lo escrito |

Los avisos van también al manifiesto, no solo a la pantalla: quien abra el
archivo medio año después no vio ese resumen.

### 7.6 Qué se hace cuando algo falla a mitad

No es lo mismo leer que escribir, así que la política por omisión tampoco:

- **Respaldar → seguir y anotar.** Una vista rota o un objeto sin permisos no
  puede tirar tres horas de trabajo. Se omite, se registra el motivo y el
  resultado es «correcto con avisos».
- **Restaurar → parar.** Ahí se está modificando una base: seguir tras un error
  deja un destino a medias que nadie sabe describir. Se detiene, se dice en qué
  instrucción, y se ofrece reanudar desde ahí.

Ambas son el valor por omisión, y ambas se pueden cambiar antes de lanzar.

### 7.7 Un registro que se pueda pegar en un correo

La operación deja una lista de líneas con marca de tiempo —objeto, filas,
duración, error si lo hubo— visible en el detalle y **copiable de una vez**. Es
lo que un usuario manda cuando pide ayuda, y sin ello la respuesta siempre es
«¿y qué decía exactamente?».

### 7.8 Se construye reutilizable

`operation-progress` en `shared/ui`, con el estado de operación larga en `core/`.
La exportación de resultados y la importación de archivos tienen hoy el mismo
problema y no lo resuelven; que esta función lo estrene no significa que le
pertenezca.

---

## 8. Fases

### Fase A — El contrato y la estructura

- [ ] `IDatabaseScripter`, `ScripterBase`, `ScripterCapabilities`.
- [ ] Implementación en los cuatro proveedores: tablas, columnas, tipos, valores
      por omisión, índices, claves y restricciones.
- [ ] Pruebas contractuales idénticas para los cuatro.

**Criterio de salida — ida y vuelta.** Una prueba crea objetos en una base real,
los guioniza, ejecuta el guion en una base limpia, **vuelve a leer la estructura
con el mismo lector de metadatos y compara**. Si lo releído no coincide, el
respaldo no sirve, y esto lo dice sin que nadie mire un archivo a ojo.

### Fase B — Los datos

- [ ] Lectura por streaming y `INSERT` troceados.
- [ ] Literales por motor: fechas, binarios en hexadecimal, JSON, booleanos.
- [ ] El interruptor general y las anulaciones por tabla.
- [ ] Filtros: `WHERE` analizado, límite de filas, columnas excluidas.
- [ ] Transacción con instantánea, y el límite declarado donde no la haya.

**Criterio de salida:** una tabla con una columna de cada tipo común del motor se
respalda, se restaura y sale idéntica, byte a byte donde el tipo lo permita.

### Fase C — El artefacto

- [ ] Manifiesto versionado.
- [ ] Las cuatro formas de salida y sus combinaciones.
- [ ] Escritura en disco por el proceso local, con el selector nativo.
- [ ] **Estado de la operación en el proceso local:** paso en curso, objeto,
      filas escritas, estimación, avisos y estado terminal, servido por
      `GET /api/backup/{id}/status`.
- [ ] Estimación de filas desde el catálogo de los cuatro motores, marcada como
      aproximada.
- [ ] Cancelación, y borrado del archivo parcial.
- [ ] Recolección de avisos y errores por objeto, con la instrucción que falló.

**Criterio de salida:** una base entera con las cuatro formas de salida; el
manifiesto describe sin faltas lo que hay dentro **y el estado consultado durante
la operación dice en todo momento qué objeto se está escribiendo**.

### Fase D — La interfaz

- [ ] Árbol de selección con casillas de tres estados.
- [ ] Asistente de cuatro pasos, desde el menú contextual y como pestaña.
- [ ] Vista previa del guion antes de ejecutar.
- [ ] **`operation-progress` en `shared/ui`**: las dos barras, el paso en curso
      con nombre de objeto, el tiempo transcurrido y el botón de cancelar.
- [ ] **Indicador en la barra de estado** que sobrevive a cerrar el asistente, y
      que devuelve al detalle al pulsarlo.
- [ ] **Resumen final en los cuatro estados** —correcto, correcto con avisos,
      fallido y cancelado—, que no se desvanece solo, con «abrir carpeta» y
      «abrir en el editor».
- [ ] Registro con marca de tiempo, copiable de una vez.

**Criterio de salida:** el caso del §1 —todo sin datos salvo tres tablas— se
resuelve sin escribir SQL, **y en ningún momento de la operación la pantalla deja
de decir qué se está haciendo**. Cerrar el asistente a mitad no interrumpe el
respaldo ni pierde el resultado.

### Fase E — Perfiles

- [ ] `backup_profiles` en SQLite, con su migración.
- [ ] Guardar, renombrar, duplicar y borrar.
- [ ] **Reconciliar al abrir:** un perfil de hace medio año nombra tablas que ya
      no existen. Se abre igual, marcando lo que falta, en vez de fallar.

**Criterio de salida:** un perfil guardado reproduce el mismo respaldo, y uno con
objetos desaparecidos lo dice sin romperse.

### Fase F — Restauración

- [ ] `RestoreService` y la inspección del artefacto.
- [ ] Comprobación de motor y versión de formato.
- [ ] Vista previa de lo que se ejecuta y de lo que se sobrescribe.
- [ ] Restauración de los CSV por el camino de importación existente.
- [ ] **El mismo progreso que al respaldar**, y la parada ante el primer error
      diciendo en qué instrucción, con la opción de reanudar desde ahí.

**Criterio de salida:** una base se respalda, se restaura en un servidor limpio y
las dos estructuras releídas coinciden. Con los cuatro motores. Y una
restauración que falla a mitad **deja claro qué se aplicó y qué no**.

---

## 9. Pruebas

Lo mismo que se hizo con el diseñador de tablas, que es lo que funcionó:

- **Contractuales, una por comportamiento, cuatro motores.** Las diferencias
  aparecen el primer día.
- **La prueba de ida y vuelta es la importante.** Comparar cadenas de SQL
  esperado comprueba que el generador no cambió; releer la estructura comprueba
  que el respaldo *sirve*. Solo la segunda encuentra los errores de verdad.
- **Unitarias sin servidor** para el orden de dependencias, los ciclos de claves
  foráneas, la resolución del plan y el formateo de literales.
- **De interfaz** para las casillas de tres estados y las anulaciones por tabla.
- **Del progreso**, que es lógica y no decoración: que el porcentaje nunca
  retroceda ni pase del cien, que una tabla sin estimación caiga a barra
  indeterminada en vez de inventarse un total, que cerrar el diálogo no mate la
  operación, y que los cuatro estados terminales se distingan. Un fallo forzado
  a mitad tiene que producir el estado «fallido» con su objeto y su instrucción,
  no un silencio.

---

## 10. Lo que no se hace, y es una decisión

- **No hay respaldo binario ni recuperación a un punto en el tiempo.** Eso es
  `BACKUP DATABASE` y el WAL, y pertenece al servidor. Druse genera guiones
  legibles; quien necesite lo otro necesita las herramientas del motor, y la
  interfaz lo dirá en lugar de dejar creer que esto lo sustituye.
- **No se traduce entre motores.** Un respaldo de SQL Server no se aplica en
  PostgreSQL: se comprueba y se rechaza con su motivo.
- **No hay programación ni retención.** Exige un servicio vivo con la ventana
  cerrada.
- **Un límite de filas puede dejar huérfanos.** Se avisa; no se arregla solo.
- **Los permisos no llevan credenciales.** Se guionizan roles y `GRANT`, nunca
  contraseñas ni sus hashes.

## 11. Riesgos

| Riesgo | Cómo se ataja |
| --- | --- |
| Los literales de tipos raros (geometría, JSON, binarios grandes) salen mal | La prueba de ida y vuelta con una columna de cada tipo, en la Fase B |
| Una base grande tarda muchísimo o agota la memoria | Streaming desde el primer commit, y medir con una tabla de millones de filas antes de cerrar la fase |
| El `WHERE` escrito a mano como vía de ejecución arbitraria | `SqlSafetyAnalyzer` sobre la consulta armada, igual que el resto |
| Un respaldo inconsistente que nadie nota hasta restaurarlo | Transacción con instantánea, y el límite escrito en el manifiesto donde el motor no la dé |
| Informix se comporta distinto en todo | Va en las contractuales desde la Fase A, no al final |
| La estimación de filas del catálogo se aleja tanto de la realidad que la barra engaña | El número se muestra siempre con `~`, y con filtro `WHERE` se cae a barra indeterminada con contador absoluto (§7.3) |
| El sondeo del estado cada 500 ms compite con el propio respaldo | El estado se lee de memoria, sin tocar la base ni el archivo; y el sondeo se espacia cuando la ventana no está visible |
