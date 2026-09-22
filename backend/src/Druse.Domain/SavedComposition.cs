namespace Druse.Domain;

/// <summary>
/// Una consulta guardada desde el compositor, para volver a ella.
///
/// Es de una tabla concreta de una conexión: el compositor se abre siempre sobre
/// una tabla, y lo que se guarda —columnas elegidas, filtros, cruces— solo tiene
/// sentido ahí.
///
/// `Model` viaja como JSON por lo mismo que el de <see cref="SavedDiagram"/>: su
/// forma la decide el formulario y cambiará con él, mientras que lo que la base
/// necesita para listar y borrar son las columnas de al lado. Lleva el SQL
/// generado y el estado del formulario.
/// </summary>
public sealed record SavedComposition
{
    public required Guid Id { get; init; }

    public required Guid ConnectionId { get; init; }

    /// <summary>La base de la conexión donde vive la tabla.</summary>
    public required string Database { get; init; }

    /// <summary>Vacío en los motores sin esquemas.</summary>
    public required string Schema { get; init; }

    public required string Table { get; init; }

    /// <summary>Cómo se llama en la lista. Lo pone quien la guarda.</summary>
    public required string Name { get; init; }

    /// <summary>El SQL y el estado del formulario, en JSON.</summary>
    public required string Model { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}
