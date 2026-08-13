using System.Globalization;
using Druse.Application.Abstractions;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Historial de consultas en la base local.
///
/// El SQL se guarda tal y como lo escribió el usuario, así que puede contener
/// datos sensibles en literales. Por eso vive solo en su máquina y existe
/// <see cref="ClearAsync"/> para borrarlo entero.
/// </summary>
public sealed class SqliteQueryHistoryStore(DruseDatabase database) : IQueryHistoryStore
{
    /// <summary>Tope de resultados por consulta, para que el historial no ahogue la interfaz.</summary>
    private const int MaxLimit = 500;

    private readonly DruseDatabase _database = database;

    public async Task AddAsync(QueryHistoryEntry entry, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entry);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO query_history (
                id, connection_id, connection_name, database_name, sql_text,
                executed_at_utc, duration_ms, succeeded, row_count, error_message
            )
            VALUES (
                $id, $connectionId, $connectionName, $database, $sql,
                $executedAt, $duration, $succeeded, $rowCount, $error
            );
            """;

        command.Parameters.AddWithValue("$id", entry.Id.ToString());
        command.Parameters.AddWithValue("$connectionId", (object?)entry.ConnectionId?.ToString() ?? DBNull.Value);
        command.Parameters.AddWithValue("$connectionName", entry.ConnectionName);
        command.Parameters.AddWithValue("$database", entry.Database);
        command.Parameters.AddWithValue("$sql", entry.Sql);
        command.Parameters.AddWithValue("$executedAt", entry.ExecutedAtUtc.ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$duration", entry.DurationMs);
        command.Parameters.AddWithValue("$succeeded", entry.Succeeded ? 1 : 0);
        command.Parameters.AddWithValue("$rowCount", (object?)entry.RowCount ?? DBNull.Value);
        command.Parameters.AddWithValue("$error", (object?)entry.ErrorMessage ?? DBNull.Value);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<QueryHistoryEntry>> GetRecentAsync(
        int limit,
        string? search,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        var filter = string.IsNullOrWhiteSpace(search)
            ? string.Empty
            : """
              WHERE sql_text LIKE $search ESCAPE '\'
                 OR connection_name LIKE $search ESCAPE '\'
              """;

        command.CommandText = $"""
            SELECT id, connection_id, connection_name, database_name, sql_text,
                   executed_at_utc, duration_ms, succeeded, row_count, error_message
            FROM query_history
            {filter}
            ORDER BY executed_at_utc DESC
            LIMIT $limit;
            """;

        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, MaxLimit));

        if (filter.Length > 0)
        {
            command.Parameters.AddWithValue("$search", $"%{EscapeLikePattern(search!)}%");
        }

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var entries = new List<QueryHistoryEntry>();

        while (await reader.ReadAsync(cancellationToken))
        {
            entries.Add(new QueryHistoryEntry
            {
                Id = Guid.Parse(reader.GetString(0)),
                ConnectionId = reader.IsDBNull(1) ? null : Guid.Parse(reader.GetString(1)),
                ConnectionName = reader.GetString(2),
                Database = reader.GetString(3),
                Sql = reader.GetString(4),
                ExecutedAtUtc = DateTimeOffset.Parse(reader.GetString(5), CultureInfo.InvariantCulture),
                DurationMs = reader.GetInt64(6),
                Succeeded = reader.GetInt32(7) != 0,
                RowCount = reader.IsDBNull(8) ? null : reader.GetInt64(8),
                ErrorMessage = reader.IsDBNull(9) ? null : reader.GetString(9),
            });
        }

        return entries;
    }

    public async Task<int> ClearAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM query_history;";

        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>
    /// Neutraliza los comodines de LIKE dentro del término de búsqueda.
    ///
    /// El parámetro ya impide inyectar SQL, pero sin esto un `%` escrito por el
    /// usuario devolvería el historial entero y un `_` casaría con cualquier
    /// carácter. Quien busca «100%» espera encontrar «100%», no todo.
    /// </summary>
    private static string EscapeLikePattern(string term) =>
        term.Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("%", @"\%", StringComparison.Ordinal)
            .Replace("_", @"\_", StringComparison.Ordinal);
}

/// <summary>Preferencias como pares clave-valor.</summary>
public sealed class SqlitePreferencesStore(DruseDatabase database) : IPreferencesStore
{
    private readonly DruseDatabase _database = database;

    public async Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "SELECT value FROM preferences WHERE key = $key";
        command.Parameters.AddWithValue("$key", key);

        return await command.ExecuteScalarAsync(cancellationToken) as string;
    }

    public async Task SetAsync(string key, string value, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        ArgumentNullException.ThrowIfNull(value);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO preferences (key, value) VALUES ($key, $value)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value;
            """;

        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<string, string>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "SELECT key, value FROM preferences";

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var preferences = new Dictionary<string, string>(StringComparer.Ordinal);

        while (await reader.ReadAsync(cancellationToken))
        {
            preferences[reader.GetString(0)] = reader.GetString(1);
        }

        return preferences;
    }
}
