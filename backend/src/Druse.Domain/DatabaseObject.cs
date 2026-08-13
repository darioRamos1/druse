namespace Druse.Domain;

/// <summary>Clase de objeto dentro del explorador.</summary>
public enum DatabaseObjectKind
{
    Database = 0,
    Schema = 1,
    Table = 2,
    View = 3,
    Function = 4,
    Procedure = 5,
    Column = 6,
    /// <summary>Agrupador sin equivalente en el catálogo, como «Tables» o «Views».</summary>
    Folder = 7,
}

/// <summary>
/// Nodo del explorador de objetos.
///
/// Es deliberadamente genérico: cada proveedor rellena estos campos desde su
/// propio catálogo, que no se parece al de los demás. Lo que comparten todos los
/// motores es la forma del árbol, no las consultas que lo producen.
/// </summary>
public sealed record DatabaseObject
{
    /// <summary>Identificador estable dentro de la sesión. Sirve para pedir sus hijos.</summary>
    public required string Id { get; init; }

    /// <summary>Nombre a mostrar, sin comillas ni corchetes.</summary>
    public required string Name { get; init; }

    public required DatabaseObjectKind Kind { get; init; }

    /// <summary>Base a la que pertenece, si aplica.</summary>
    public string? Database { get; init; }

    /// <summary>Esquema al que pertenece, si aplica.</summary>
    public string? Schema { get; init; }

    /// <summary>Puede tener hijos. Evita expandir nodos vacíos.</summary>
    public bool HasChildren { get; init; }

    /// <summary>Recuento aproximado de filas o de hijos. Solo informativo.</summary>
    public long? ApproximateRowCount { get; init; }
}

/// <summary>Columna de una tabla o vista.</summary>
public sealed record DatabaseColumn
{
    public required string Name { get; init; }

    /// <summary>Tipo tal y como lo nombra el motor. No se normaliza: se muestra literal.</summary>
    public required string DataType { get; init; }

    public required bool IsNullable { get; init; }

    public bool IsPrimaryKey { get; init; }

    /// <summary>La rellena el motor: identidad, autoincremento o columna calculada.</summary>
    public bool IsGenerated { get; init; }

    public string? DefaultValue { get; init; }

    /// <summary>Posición dentro de la tabla, empezando en 1.</summary>
    public required int Ordinal { get; init; }
}
