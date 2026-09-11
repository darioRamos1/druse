namespace Druse.Domain;

/// <summary>
/// Una tabla leída del catálogo, con todo lo necesario para volver a crearla.
///
/// Es lo que entra al guionizado, y por eso son lecturas y no intenciones:
/// <see cref="DatabaseColumn"/> y <see cref="TableStructure"/> cuentan lo que el
/// motor tiene hoy. Un respaldo que partiera de un diseño reproduciría lo que
/// alguien quiso, no lo que hay.
///
/// Las tres piezas viajan juntas porque no sirven por separado: sin las columnas
/// no hay `CREATE TABLE`, y sin la estructura la tabla recreada se queda sin
/// clave, sin índices y sin restricciones.
/// </summary>
public sealed record ScriptedTable
{
    /// <summary>La tabla, con su base y su esquema para poder calificarla.</summary>
    public required DatabaseObject Table { get; init; }

    public required IReadOnlyList<DatabaseColumn> Columns { get; init; }

    public required TableStructure Structure { get; init; }
}

/// <summary>
/// Lo que un motor conserva de aquello que se guioniza.
///
/// Sirve para lo mismo que <see cref="IndexCapabilities"/> en el diseñador: quien
/// use el guion sabe qué esperar sin preguntar contra qué motor está. Aquí importa
/// sobre todo porque **comparar lo guionizado con lo releído** es la forma de
/// comprobar que un respaldo sirve, y esa comparación tiene que saber qué es una
/// diferencia real y qué es una limitación declarada.
/// </summary>
public sealed record ScripterCapabilities
{
    /// <summary>
    /// La clave primaria conserva el nombre con el que se creó.
    ///
    /// En MySQL no: toda clave primaria se llama `PRIMARY`, se escriba lo que se
    /// escriba. Guionizar allí un `CONSTRAINT pk_pedidos PRIMARY KEY` produce una
    /// tabla que el motor acepta y que después nombra de otra forma, así que no se
    /// escribe el nombre en lugar de escribir uno que se va a perder.
    /// </summary>
    public bool NamesPrimaryKey { get; init; } = true;

    /// <summary>
    /// Las restricciones de unicidad conservan el nombre con el que se crearon.
    ///
    /// En Informix no, y por el mismo motivo que la clave primaria: lo que se lee
    /// del catálogo es el nombre del **índice** que la sostiene —` 112_50`, con un
    /// espacio delante y distinto en cada creación—, que es el que hace falta para
    /// soltarla. Reproducirlo no copiaría nada: inventaría un nombre interno.
    /// </summary>
    public bool NamesUniqueConstraints { get; init; } = true;

    /// <summary>
    /// El motor tiene esquemas dentro de una base.
    ///
    /// En MySQL el esquema **es** la base: no hay dos niveles que calificar, y un
    /// respaldo que agrupara por esquema allí estaría inventando una jerarquía que
    /// el motor no tiene.
    /// </summary>
    public bool SupportsSchemas { get; init; } = true;

    /// <summary>
    /// Cuántas filas caben en un solo `INSERT`.
    ///
    /// Agrupar filas es lo que separa un respaldo utilizable de uno con un millón
    /// de instrucciones, pero **Informix no admite más de una**: allí
    /// `VALUES (1), (2)` es un error de sintaxis, no una forma menos eficiente de
    /// escribirlo.
    /// </summary>
    public int MaxRowsPerInsert { get; init; } = 100;

    /// <summary>
    /// El motor sabe escribir un valor binario dentro de una instrucción.
    ///
    /// En Informix no: los tipos `BYTE` y `BLOB` se cargan por otros caminos y no
    /// tienen forma literal. Una columna así no se puede respaldar como texto, y
    /// eso se dice en vez de escribir algo que no es el dato.
    /// </summary>
    public bool SupportsBinaryLiterals { get; init; } = true;

    /// <summary>
    /// Las claves foráneas se pueden colgar de una tabla que ya existe.
    ///
    /// En SQLite no: no hay `ALTER TABLE … ADD CONSTRAINT`, y una clave foránea
    /// **solo existe dentro del `CREATE TABLE`**. Guionizarla aparte produce una
    /// instrucción que ese motor rechaza con un error de sintaxis, y con ella se
    /// cae el respaldo entero de cualquier base con relaciones.
    ///
    /// Donde es `false`, las claves viajan dentro de la tabla y
    /// `ScriptForeignKeys` no escribe nada. Eso cambia **cuándo** se comprueban
    /// —la tabla se crea nombrando a una que quizá aún no existe— y ahí SQLite
    /// ayuda: no valida la referencia al crear, sino al escribir filas, que es
    /// después de que el guion haya creado todas las tablas.
    ///
    /// Se declara aquí y no en el proveedor para que el motor que venga mañana
    /// con la misma limitación herede el comportamiento en vez de repetirlo.
    /// </summary>
    public bool AddsForeignKeysAfterwards { get; init; } = true;

    /// <summary>
    /// Con qué aislamiento se lee un respaldo entero para que todas las tablas se
    /// vean en el mismo instante.
    ///
    /// No es una preferencia: sin él, la tabla de pedidos leída a las 10:00 y la
    /// de líneas leída a las 10:04 producen un respaldo que no corresponde a
    /// ningún momento real de la base.
    /// </summary>
    public BackupIsolation Isolation { get; init; } = BackupIsolation.RepeatableRead;
}

/// <summary>
/// Cómo consigue cada motor que un respaldo se lea de una pieza.
///
/// Se declara en vez de suponerse porque **pedir el nivel equivocado no degrada,
/// falla**: SQL Server rechaza `SNAPSHOT` si la base no lo tiene habilitado, y
/// entonces el respaldo ni empezaría.
/// </summary>
public enum BackupIsolation
{
    /// <summary>El motor no ofrece ninguno utilizable; se lee sin garantía y se dice.</summary>
    None = 0,

    /// <summary>Lecturas repetibles, que es lo que dan PostgreSQL, MySQL e Informix.</summary>
    RepeatableRead = 1,

    /// <summary>
    /// Instantánea sin bloqueos, propia de SQL Server.
    ///
    /// Se prefiere a las lecturas repetibles porque allí estas bloquean a quien
    /// escriba: un respaldo no debe parar la base que está copiando.
    /// </summary>
    Snapshot = 2,

    /// <summary>
    /// Transacción serializable, que es como se pide en Oracle lo que los demás
    /// llaman lecturas repetibles.
    ///
    /// No es lo mismo aunque se parezca: allí una transacción serializable ve la
    /// base como estaba al empezar y **no bloquea a quien escriba**, que es justo
    /// lo que hace falta en un respaldo. Su driver además rechaza los otros dos
    /// niveles, así que no es una preferencia: es el único que concede.
    /// </summary>
    Serializable = 3,
}
