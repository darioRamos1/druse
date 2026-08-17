namespace Druse.Domain;

/// <summary>
/// Una pestaña del editor tal como estaba la última vez que se tocó.
///
/// Es **trabajo sin ejecutar**: lo que el usuario llevaba escrito cuando cerró,
/// que hasta ahora se perdía porque solo se guardaba lo que llegaba a
/// ejecutarse, en el historial. Se conserva para poder devolverlo tal cual al
/// volver a abrir.
///
/// No guarda resultados: se vuelven a pedir ejecutando, y conservarlos sería
/// almacenar datos de producción en el disco del usuario sin que nadie lo haya
/// pedido.
/// </summary>
public sealed record EditorTabState
{
    public required string Id { get; init; }

    /// <summary>Orden en la barra de pestañas, empezando por 0.</summary>
    public int Position { get; init; }

    public required string Title { get; init; }

    public string Sql { get; init; } = string.Empty;

    /// <summary>La que estaba delante al cerrar.</summary>
    public bool IsActive { get; init; }

    /// <summary>Tenía cambios sin guardar en su archivo.</summary>
    public bool IsDirty { get; init; }

    /// <summary>
    /// Conexión contra la que se ejecutaba.
    ///
    /// Se conserva el identificador del perfil, no la sesión: al volver a abrir
    /// no hay ninguna sesión viva, y lo que importa es saber a qué conexión
    /// volver a atar la pestaña cuando el usuario la abra.
    /// </summary>
    public string? ConnectionId { get; init; }

    public string? Database { get; init; }

    public string? FileName { get; init; }

    /// <summary>Identificador opaco del archivo, conservado por el escritorio.</summary>
    public string? DocumentId { get; init; }

    public DateTimeOffset SavedAtUtc { get; init; }
}
