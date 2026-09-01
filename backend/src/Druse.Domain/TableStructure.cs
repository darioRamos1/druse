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
/// Una tabla concreta dentro de una lectura en lote.
///
/// El <see cref="DatabaseObject"/> entero no sirve como clave: trae el
/// identificador del nodo del explorador y el recuento aproximado de filas, que
/// cambian sin que la tabla cambie. Lo que identifica a una tabla dentro de una
/// base es su esquema y su nombre, y eso es lo que se compara aquí.
/// </summary>
public readonly record struct TableRef(string? Schema, string Name)
{
    public static TableRef Of(DatabaseObject table) => new(table.Schema, table.Name);
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

/// <summary>
/// Todo lo que un diagrama necesita de una tabla: sus columnas y lo que la
/// sostiene.
///
/// Existe porque la unidad de una lectura en lote es la tabla entera. Pedir
/// primero todas las columnas y después todas las estructuras dejaría al que
/// llama emparejando dos listas por esquema y nombre, que es justo lo que este
/// tipo evita hacer cuatro veces.
/// </summary>
public sealed record TableDetail
{
    /// <summary>La tabla tal y como se pidió, con su identificador del explorador.</summary>
    public required DatabaseObject Table { get; init; }

    public required IReadOnlyList<DatabaseColumn> Columns { get; init; }

    public required TableStructure Structure { get; init; }
}

/// <summary>
/// Lo que se leyó de un conjunto de tablas pedido de una vez.
///
/// Lleva aparte las que no aparecieron. Devolver solo las encontradas dejaría al
/// diagrama dibujando cincuenta y nueve cajas sin poder decir qué pasó con la
/// sexagésima, y la respuesta —alguien la borró— es justo la que hay que enseñar.
/// </summary>
public sealed record SchemaGraph
{
    public required IReadOnlyList<TableDetail> Tables { get; init; }

    /// <summary>Las que se pidieron y ya no están en el catálogo.</summary>
    public required IReadOnlyList<DatabaseObject> Missing { get; init; }

    /// <summary>
    /// Relaciones que Druse **supone** por el nombre de las columnas.
    ///
    /// No son claves foráneas: nadie las comprueba. Viajan aparte de
    /// <see cref="TableStructure.ForeignKeys"/> justamente para que no se puedan
    /// confundir con ellas por descuido de quien las lee.
    /// </summary>
    public IReadOnlyList<SuggestedRelation> Suggestions { get; init; } = [];
}

/// <summary>Cuánto se puede confiar en una relación supuesta.</summary>
public enum SuggestionConfidence
{
    /// <summary>Se enseña sola: el nombre lo dice y el tipo encaja exacto.</summary>
    High = 0,

    /// <summary>Se cuenta, pero no se dibuja salvo que se pidan.</summary>
    Low = 1,
}

/// <summary>
/// Una relación que el motor no declara y el nombre sugiere.
///
/// Existe porque media base real no tiene claves foráneas —MyISAM, y casi
/// cualquier esquema heredado— y un diagrama que solo lea el catálogo dibujaría
/// ochenta tablas sueltas: correcto e inútil.
///
/// **Nunca se disfraza de hecho.** Lleva su motivo escrito para poder enseñarlo,
/// y quien la acepte pasa por la previsualización del `ALTER TABLE` como
/// cualquier otro cambio.
/// </summary>
public sealed record SuggestedRelation
{
    /// <summary>Tabla que llevaría la clave foránea.</summary>
    public required TableRef From { get; init; }

    public required string Column { get; init; }

    /// <summary>Tabla a la que parece apuntar.</summary>
    public required TableRef To { get; init; }

    /// <summary>Columna de destino, que es siempre su clave primaria.</summary>
    public required string ReferencedColumn { get; init; }

    public required SuggestionConfidence Confidence { get; init; }

    /// <summary>Por qué se supone, en una frase que se pueda enseñar.</summary>
    public required string Reason { get; init; }
}
