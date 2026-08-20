using System.Globalization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Guarda los fragmentos de SQL con nombre.
///
/// Uno a uno y con `INSERT OR REPLACE`, como los perfiles: el identificador lo
/// pone quien guarda, así que renombrar un fragmento y crear otro son la misma
/// operación con distinto identificador, y no hay que preguntar antes cuál de
/// las dos es.
/// </summary>
public sealed class SqliteSqlSnippetStore(DruseDatabase database) : ISqlSnippetStore
{
    private readonly DruseDatabase _database = database;

    public async Task<IReadOnlyList<SqlSnippet>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT id, name, sql_text, created_at_utc, updated_at_utc
            FROM sql_snippets
            ORDER BY updated_at_utc DESC
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var snippets = new List<SqlSnippet>();

        while (await reader.ReadAsync(cancellationToken))
        {
            snippets.Add(new SqlSnippet
            {
                Id = Guid.Parse(reader.GetString(0)),
                Name = reader.GetString(1),
                Sql = reader.GetString(2),
                CreatedAtUtc = ParseInstant(reader.GetString(3)),
                UpdatedAtUtc = ParseInstant(reader.GetString(4)),
            });
        }

        return snippets;
    }

    public async Task SaveAsync(SqlSnippet snippet, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(snippet);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // La fecha de creación no se pisa al reemplazar: un fragmento que se
        // corrige sigue siendo el mismo, y perder cuándo nació borraría la única
        // pista de desde cuándo se usa.
        command.CommandText = """
            INSERT INTO sql_snippets (id, name, sql_text, created_at_utc, updated_at_utc)
            VALUES ($id, $name, $sql, $created, $updated)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                sql_text = excluded.sql_text,
                updated_at_utc = excluded.updated_at_utc;
            """;

        var now = DateTimeOffset.UtcNow;

        command.Parameters.AddWithValue("$id", snippet.Id.ToString());
        command.Parameters.AddWithValue("$name", snippet.Name);
        command.Parameters.AddWithValue("$sql", snippet.Sql);
        command.Parameters.AddWithValue(
            "$created",
            Format(snippet.CreatedAtUtc == default ? now : snippet.CreatedAtUtc));
        command.Parameters.AddWithValue(
            "$updated",
            Format(snippet.UpdatedAtUtc == default ? now : snippet.UpdatedAtUtc));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM sql_snippets WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static string Format(DateTimeOffset instant) =>
        instant.ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseInstant(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
