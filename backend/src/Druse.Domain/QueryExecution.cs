namespace Druse.Domain;

/// <summary>Petición de ejecución tal y como llega desde el editor.</summary>
public sealed record QueryRequest
{
    /// <summary>Sesión abierta sobre la que ejecutar.</summary>
    public required Guid SessionId { get; init; }

    /// <summary>
    /// Identificador de la ejecución, elegido por quien la lanza.
    ///
    /// Lo aporta el cliente a propósito: cancelar exige conocer el identificador
    /// **mientras la consulta corre**, y si lo generara el servidor solo llegaría
    /// con la respuesta, es decir, cuando ya no hay nada que cancelar.
    ///
    /// Si viene vacío se genera uno, pero esa ejecución no podrá cancelarse.
    /// </summary>
    public Guid ExecutionId { get; init; }

    /// <summary>Texto a ejecutar. Si el usuario seleccionó algo, ya viene recortado.</summary>
    public required string Sql { get; init; }

    /// <summary>
    /// Base elegida en el explorador. Si falta, se usa la base inicial de la sesión.
    /// </summary>
    public string? Database { get; init; }

    /// <summary>Filas máximas a leer. Protege la memoria y la interfaz.</summary>
    public int MaxRows { get; init; } = 500;

    public int TimeoutSeconds { get; init; } = 30;

    /// <summary>
    /// El usuario ya confirmó una instrucción potencialmente destructiva.
    /// Sin esto, la ejecución se rechaza en lugar de pedir confirmación al vuelo.
    /// </summary>
    public bool DestructiveConfirmed { get; init; }
}

/// <summary>Estado de una ejecución.</summary>
public enum QueryExecutionState
{
    Running = 0,
    Succeeded = 1,
    Failed = 2,
    Canceled = 3,
}

/// <summary>Columna de un conjunto de resultados.</summary>
public sealed record ResultColumn
{
    public required string Name { get; init; }

    /// <summary>Nombre del tipo según el motor.</summary>
    public required string DataType { get; init; }

    /// <summary>Tipo .NET al que el proveedor convirtió los valores.</summary>
    public required string ClrType { get; init; }

    public required int Ordinal { get; init; }
}

/// <summary>
/// Conjunto de resultados devuelto por una instrucción.
///
/// Los valores se transportan como cadenas ya formateadas porque quien conoce el
/// dialecto y la cultura de cada tipo es el proveedor. `null` se mantiene como
/// `null` y no como cadena vacía: son cosas distintas y deben verse distintas.
/// </summary>
public sealed record ResultSet
{
    public required IReadOnlyList<ResultColumn> Columns { get; init; }

    public required IReadOnlyList<IReadOnlyList<string?>> Rows { get; init; }

    /// <summary>Se alcanzó <see cref="QueryRequest.MaxRows"/> y quedaron filas sin leer.</summary>
    public bool Truncated { get; init; }
}

/// <summary>Mensaje informativo emitido por el motor durante la ejecución.</summary>
public sealed record QueryMessage
{
    public required string Text { get; init; }

    public QueryMessageSeverity Severity { get; init; } = QueryMessageSeverity.Info;
}

public enum QueryMessageSeverity
{
    Info = 0,
    Warning = 1,
    Error = 2,
}

/// <summary>Error normalizado, igual para todos los motores.</summary>
public sealed record QueryError
{
    public required string Message { get; init; }

    /// <summary>Código del motor, tal cual. Útil para buscar en su documentación.</summary>
    public string? Code { get; init; }

    /// <summary>Posición dentro del SQL, si el motor la reporta. Base 1.</summary>
    public int? Position { get; init; }

    /// <summary>Línea dentro del SQL, si el motor la reporta. Base 1.</summary>
    public int? Line { get; init; }

    /// <summary>
    /// Consulta que **enseña las filas** por las que el motor dijo que no.
    ///
    /// Hay rechazos que se explican con palabras y no se pueden arreglar con
    /// ellas: «hay filas que no cumplen la condición» es cierto, y quien lo lee
    /// sigue sin saber cuáles. Encontrarlas es escribir una consulta a mano, y
    /// esa consulta la sabe escribir quien rechazó el cambio, que es el único
    /// que sabe qué miró.
    ///
    /// Es SQL listo para ejecutar contra la misma conexión, no una plantilla.
    /// `null` cuando no hay filas que enseñar —un permiso que falta, un nombre
    /// que ya existe— o cuando el motivo no se puede convertir en una consulta.
    /// </summary>
    public string? Diagnostic { get; init; }
}

/// <summary>Resultado completo de una ejecución.</summary>
public sealed record QueryResult
{
    public required Guid ExecutionId { get; init; }

    public required QueryExecutionState State { get; init; }

    public required IReadOnlyList<ResultSet> ResultSets { get; init; }

    public required IReadOnlyList<QueryMessage> Messages { get; init; }

    /// <summary>Filas afectadas por INSERT, UPDATE o DELETE. `null` si no aplica.</summary>
    public long? RowsAffected { get; init; }

    public required TimeSpan Duration { get; init; }

    /// <summary>Presente cuando <see cref="State"/> es <see cref="QueryExecutionState.Failed"/>.</summary>
    public QueryError? Error { get; init; }
}
