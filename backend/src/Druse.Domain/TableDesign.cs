namespace Druse.Domain;

/// <summary>
/// Columna tal y como la describe quien diseña la tabla.
///
/// No es <see cref="DatabaseColumn"/>: aquella cuenta lo que el motor ya tiene, y
/// esta lo que se quiere que tenga. Se parecen porque describen lo mismo, pero
/// una es una lectura del catálogo y la otra una intención todavía sin ejecutar.
/// </summary>
public sealed record TableColumnDefinition
{
    public required string Name { get; init; }

    /// <summary>
    /// Tipo en el dialecto del motor, tal y como se escribirá.
    ///
    /// Va como texto y no como enumerado porque los tipos no se corresponden entre
    /// motores: `NVARCHAR(50)`, `VARCHAR(50)` y `TEXT` no son el mismo tipo, y
    /// traducirlos automáticamente escondería decisiones que son del usuario.
    /// </summary>
    public required string DataType { get; init; }

    public bool IsNullable { get; init; } = true;

    public bool IsPrimaryKey { get; init; }

    /// <summary>El motor genera el valor: identidad, serial o autoincremento.</summary>
    public bool IsIdentity { get; init; }

    /// <summary>
    /// Expresión por omisión, ya escrita en SQL.
    ///
    /// Se copia literalmente en la instrucción: `0`, `''`, `GETDATE()`. Es la
    /// única parte del diseño que no se puede citar por el proveedor, porque una
    /// llamada a función y una cadena literal se escriben distinto.
    /// </summary>
    public string? DefaultValue { get; init; }
}

/// <summary>Tabla que se va a crear.</summary>
public sealed record TableDefinition
{
    public string? Database { get; init; }

    /// <summary>Esquema donde crearla. En MySQL no aplica: allí el esquema es la base.</summary>
    public string? Schema { get; init; }

    public required string Name { get; init; }

    public required IReadOnlyList<TableColumnDefinition> Columns { get; init; }

    /// <summary>
    /// Índices que se crean junto a la tabla.
    ///
    /// Van aparte del `CREATE TABLE` porque los tres motores los declaran con su
    /// propia instrucción; solo las restricciones caben dentro del paréntesis.
    /// </summary>
    public IReadOnlyList<IndexDefinition> Indexes { get; init; } = [];

    public IReadOnlyList<ForeignKeyDefinition> ForeignKeys { get; init; } = [];

    public IReadOnlyList<UniqueConstraintDefinition> UniqueConstraints { get; init; } = [];

    public IReadOnlyList<CheckConstraintDefinition> CheckConstraints { get; init; } = [];

    /// <summary>Columnas marcadas como clave primaria, en el orden en que se escribieron.</summary>
    public IReadOnlyList<string> PrimaryKeyColumns =>
        [.. Columns.Where(column => column.IsPrimaryKey).Select(column => column.Name)];
}

/// <summary>
/// Cambio sobre un índice que ya existe.
///
/// Ningún motor sabe cambiarle las columnas a un índice, así que esto se
/// convierte siempre en un borrado seguido de una creación. Se modela como una
/// sola intención porque es una sola: quien lo pide quiere el índice de otra
/// forma, no quedarse sin él a mitad.
/// </summary>
public sealed record IndexAlteration
{
    /// <summary>Nombre que el índice tiene hoy en la base.</summary>
    public required string CurrentName { get; init; }

    /// <summary>Cómo debe quedar. Su nombre puede ser otro.</summary>
    public required IndexDefinition Index { get; init; }
}

/// <summary>
/// Cambio sobre una columna que ya existe.
///
/// El nombre actual viaja aparte del deseado porque son cosas distintas: sin él
/// no habría forma de distinguir «renombrar esta columna» de «crear otra nueva y
/// dejar la anterior».
/// </summary>
public sealed record ColumnAlteration
{
    /// <summary>Nombre que la columna tiene hoy en la base.</summary>
    public required string CurrentName { get; init; }

    /// <summary>Cómo debe quedar. Su nombre puede ser otro: eso es un renombrado.</summary>
    public required TableColumnDefinition Column { get; init; }

    public bool IsRename =>
        !string.Equals(CurrentName, Column.Name, StringComparison.Ordinal);
}

/// <summary>
/// Cambios pedidos sobre una tabla existente.
///
/// Son operaciones explícitas y no la tabla resultante: comparar el antes con el
/// después obligaría a adivinar qué pasó con cada columna, y adivinar mal
/// significa borrar una columna que solo se había renombrado.
/// </summary>
public sealed record TableAlteration
{
    public required DatabaseObject Table { get; init; }

    /// <summary>Nombre nuevo de la tabla, o `null` para dejarlo como está.</summary>
    public string? NewName { get; init; }

    public IReadOnlyList<TableColumnDefinition> AddedColumns { get; init; } = [];

    public IReadOnlyList<ColumnAlteration> AlteredColumns { get; init; } = [];

    /// <summary>Columnas que se borran, por su nombre actual.</summary>
    public IReadOnlyList<string> DroppedColumns { get; init; } = [];

    public IReadOnlyList<IndexDefinition> AddedIndexes { get; init; } = [];

    /// <summary>Índices que se rehacen: se borra el actual y se crea el nuevo.</summary>
    public IReadOnlyList<IndexAlteration> AlteredIndexes { get; init; } = [];

    /// <summary>Índices que se quitan, por su nombre actual.</summary>
    public IReadOnlyList<string> DroppedIndexes { get; init; } = [];

    public IReadOnlyList<ForeignKeyDefinition> AddedForeignKeys { get; init; } = [];

    public IReadOnlyList<string> DroppedForeignKeys { get; init; } = [];

    public IReadOnlyList<UniqueConstraintDefinition> AddedUniqueConstraints { get; init; } = [];

    public IReadOnlyList<string> DroppedUniqueConstraints { get; init; } = [];

    public IReadOnlyList<CheckConstraintDefinition> AddedCheckConstraints { get; init; } = [];

    public IReadOnlyList<string> DroppedCheckConstraints { get; init; } = [];

    /// <summary>
    /// Clave primaria nueva, o `null` para dejar la que haya.
    ///
    /// Poner una donde ya hay otra obliga a soltar la anterior, y para eso hace
    /// falta su nombre: por eso viaja <see cref="DroppedPrimaryKeyName"/> aparte.
    /// </summary>
    public PrimaryKeyDefinition? NewPrimaryKey { get; init; }

    /// <summary>
    /// Nombre de la clave primaria que se suelta.
    ///
    /// Va explícito y no deducido del catálogo porque soltar la clave equivocada
    /// no se deshace, y porque el catálogo pudo cambiar desde que se abrió el
    /// diseñador.
    /// </summary>
    public string? DroppedPrimaryKeyName { get; init; }

    /// <summary>
    /// Lo que no se recupera con otro `ALTER`.
    ///
    /// Un índice se vuelve a crear, pero reconstruirlo sobre una tabla grande
    /// puede tardar horas y bloquearla, así que quitarlo también se pregunta.
    /// Cambiar la clave primaria entra aquí porque suelta la que había.
    /// </summary>
    public bool IsDestructive =>
        DroppedColumns.Count > 0
        || DroppedIndexes.Count > 0
        || AlteredIndexes.Count > 0
        || DroppedForeignKeys.Count > 0
        || DroppedUniqueConstraints.Count > 0
        || DroppedCheckConstraints.Count > 0
        || DroppedPrimaryKeyName is not null;

    public bool IsEmpty =>
        NewName is null
        && AddedColumns.Count == 0
        && AlteredColumns.Count == 0
        && DroppedColumns.Count == 0
        && AddedIndexes.Count == 0
        && AlteredIndexes.Count == 0
        && DroppedIndexes.Count == 0
        && AddedForeignKeys.Count == 0
        && DroppedForeignKeys.Count == 0
        && AddedUniqueConstraints.Count == 0
        && DroppedUniqueConstraints.Count == 0
        && AddedCheckConstraints.Count == 0
        && DroppedCheckConstraints.Count == 0
        && NewPrimaryKey is null
        && DroppedPrimaryKeyName is null;
}
