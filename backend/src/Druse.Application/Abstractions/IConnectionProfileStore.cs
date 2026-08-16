using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Perfiles de conexión guardados.
///
/// **La contraseña no forma parte de este contrato.** `ConnectionProfile` no
/// tiene dónde llevarla, así que ninguna implementación puede persistirla sin
/// cambiar el dominio, cosa que una prueba impide (plan §12).
/// </summary>
public interface IConnectionProfileStore
{
    Task<IReadOnlyList<ConnectionProfile>> GetAllAsync(CancellationToken cancellationToken);

    Task<ConnectionProfile?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Inserta o reemplaza según el identificador.</summary>
    Task SaveAsync(ConnectionProfile profile, CancellationToken cancellationToken);

    /// <summary>Devuelve `false` si no existía.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken);
}

/// <summary>Entrada del historial de ejecución.</summary>
public sealed record QueryHistoryEntry
{
    public required Guid Id { get; init; }

    /// <summary>Perfil con el que se ejecutó. `null` si esa conexión ya se borró.</summary>
    public Guid? ConnectionId { get; init; }

    public required string ConnectionName { get; init; }

    public required string Database { get; init; }

    public required string Sql { get; init; }

    public required DateTimeOffset ExecutedAtUtc { get; init; }

    public required long DurationMs { get; init; }

    public required bool Succeeded { get; init; }

    public long? RowCount { get; init; }

    /// <summary>Mensaje de error cuando falló, ya normalizado.</summary>
    public string? ErrorMessage { get; init; }
}

/// <summary>
/// Historial local de consultas.
///
/// Guarda el SQL que escribió el usuario, que puede contener datos sensibles en
/// literales. Vive solo en su máquina y debe poder borrarse por completo.
/// </summary>
public interface IQueryHistoryStore
{
    Task AddAsync(QueryHistoryEntry entry, CancellationToken cancellationToken);

    /// <summary>Últimas entradas, de la más reciente a la más antigua.</summary>
    Task<IReadOnlyList<QueryHistoryEntry>> GetRecentAsync(
        int limit,
        string? search,
        CancellationToken cancellationToken);

    /// <summary>Vacía el historial. Devuelve cuántas entradas se borraron.</summary>
    Task<int> ClearAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Las pestañas abiertas del editor, para poder devolverlas tras cerrar.
///
/// Se guardan y se leen **todas de una vez**: son pocas, cambian juntas y
/// reemplazar el conjunto entero evita tener que decidir qué hacer con las que
/// ya no están.
/// </summary>
public interface IEditorTabStore
{
    /// <summary>En el orden en que estaban en la barra.</summary>
    Task<IReadOnlyList<EditorTabState>> GetAllAsync(CancellationToken cancellationToken);

    /// <summary>Sustituye lo guardado por lo que hay ahora.</summary>
    Task ReplaceAllAsync(IReadOnlyList<EditorTabState> tabs, CancellationToken cancellationToken);
}

/// <summary>Preferencias sencillas del usuario, guardadas como pares clave-valor.</summary>
public interface IPreferencesStore
{
    Task<string?> GetAsync(string key, CancellationToken cancellationToken);

    Task SetAsync(string key, string value, CancellationToken cancellationToken);

    Task<IReadOnlyDictionary<string, string>> GetAllAsync(CancellationToken cancellationToken);
}
