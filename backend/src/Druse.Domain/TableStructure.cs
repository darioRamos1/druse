namespace Druse.Domain;

/// <summary>
/// Índice tal y como está hoy en el catálogo.
///
/// No es <see cref="IndexDefinition"/>, por lo mismo que una columna leída no es
/// una columna diseñada: esto es lo que el motor tiene, y aquello lo que se
/// quiere que tenga. Además trae cosas que no se piden pero conviene enseñar,
/// como que el índice lo sostiene una restricción y no se puede borrar suelto.
/// </summary>
public sealed record DatabaseIndex
{
    public required string Name { get; init; }

    public required IReadOnlyList<IndexColumn> Columns { get; init; }

    public bool IsUnique { get; init; }

    /// <summary>
    /// El índice existe porque lo exige una clave primaria o una restricción de
    /// unicidad. Borrarlo por su cuenta lo rechazan los tres motores: hay que
    /// quitar la restricción, así que la interfaz no debe ofrecerlo.
    /// </summary>
    public bool IsConstraintIndex { get; init; }

    public bool IsPrimaryKey { get; init; }

    public IReadOnlyList<string> IncludedColumns { get; init; } = [];

    public string? Filter { get; init; }

    public string? Method { get; init; }

    /// <summary>
    /// El `CREATE INDEX` tal y como lo escribe el motor, cuando la lista de
    /// columnas no basta para reproducirlo.
    ///
    /// Un índice **sobre una expresión** —`lower(nit)`, `(a || b)`— no tiene
    /// columnas que enumerar: el catálogo devuelve la lista vacía, y guionizarlo
    /// desde ahí produce un `USING btree ()` que el motor rechaza al restaurar.
    /// Donde el motor sabe devolver su propia definición, se guarda aquí y se usa
    /// literalmente.
    /// </summary>
    public string? Definition { get; init; }
}

/// <summary>Clave foránea tal y como está hoy en el catálogo.</summary>
public sealed record DatabaseForeignKey
{
    public required string Name { get; init; }

    public required IReadOnlyList<string> Columns { get; init; }

    public string? ReferencedSchema { get; init; }

    public required string ReferencedTable { get; init; }

    public required IReadOnlyList<string> ReferencedColumns { get; init; }

    public ForeignKeyAction OnDelete { get; init; } = ForeignKeyAction.NoAction;

    public ForeignKeyAction OnUpdate { get; init; } = ForeignKeyAction.NoAction;
}

/// <summary>Restricción de unicidad tal y como está hoy en el catálogo.</summary>
public sealed record DatabaseUniqueConstraint
{
    public required string Name { get; init; }

    public required IReadOnlyList<string> Columns { get; init; }
}

/// <summary>Restricción de comprobación tal y como está hoy en el catálogo.</summary>
public sealed record DatabaseCheckConstraint
{
    public required string Name { get; init; }

    /// <summary>La expresión que devuelve el motor, que rara vez es la que se escribió.</summary>
    public required string Expression { get; init; }
}

/// <summary>Clave primaria tal y como está hoy en el catálogo.</summary>
public sealed record DatabasePrimaryKey
{
    public required string Name { get; init; }

    public required IReadOnlyList<string> Columns { get; init; }
}

/// <summary>
/// Todo lo que sostiene una tabla además de sus columnas.
///
/// Va junto en una sola lectura porque se enseña junto y porque separarlo
/// obligaría a cuatro turnos contra una conexión que no admite dos cosas a la
/// vez.
/// </summary>
public sealed record TableStructure
{
    public DatabasePrimaryKey? PrimaryKey { get; init; }

    public IReadOnlyList<DatabaseIndex> Indexes { get; init; } = [];

    public IReadOnlyList<DatabaseForeignKey> ForeignKeys { get; init; } = [];

    public IReadOnlyList<DatabaseUniqueConstraint> UniqueConstraints { get; init; } = [];

    public IReadOnlyList<DatabaseCheckConstraint> CheckConstraints { get; init; } = [];
}
