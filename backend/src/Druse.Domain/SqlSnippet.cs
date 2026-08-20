namespace Druse.Domain;

/// <summary>
/// Un trozo de SQL guardado con nombre, para reutilizarlo.
///
/// Es lo que el usuario escribe una vez y repite muchas: el `JOIN` de siempre,
/// el `WHERE` con los tres filtros de rigor, la consulta de comprobación que se
/// lanza cada mañana. Hasta ahora había que ir a buscarlo al historial, y el
/// historial solo guarda lo que llegó a ejecutarse.
///
/// **No se ata a ninguna conexión.** Un fragmento se guarda por lo que dice, no
/// por dónde se ejecutó, y el mismo `SELECT` sirve en la base de pruebas y en la
/// de producción. Atarlo a un perfil obligaría a decidir qué hacer con él
/// cuando ese perfil se borra.
/// </summary>
public sealed record SqlSnippet
{
    public required Guid Id { get; init; }

    /// <summary>Con lo que se busca y se reconoce. No tiene por qué ser único.</summary>
    public required string Name { get; init; }

    public required string Sql { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}
