using System.Globalization;
using System.Text.Json;
using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteAiBusinessNoteStore(DruseDatabase database) : IAiBusinessNoteStore
{
    public async Task<IReadOnlyList<AiBusinessNote>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, connection_id, database_name, text, enabled, reference_json, updated_at_utc, format_version FROM ai_business_notes ORDER BY updated_at_utc DESC, id";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var notes = new List<AiBusinessNote>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var version = reader.GetInt32(7);
            notes.Add(new AiBusinessNote(Guid.Parse(reader.GetString(0)), Guid.Parse(reader.GetString(1)),
                reader.GetString(2), reader.GetString(3), reader.GetInt32(4) != 0,
                reader.IsDBNull(5) || version != 1 ? null : JsonSerializer.Deserialize<AiNoteReference>(reader.GetString(5)),
                DateTimeOffset.Parse(reader.GetString(6), CultureInfo.InvariantCulture), version));
        }
        return notes;
    }

    public async Task SaveAsync(AiBusinessNote note, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(note);
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        // Cada nota se escribe por separado: dos editores no sustituyen una colección entera.
        command.CommandText = """
            INSERT INTO ai_business_notes (id, connection_id, database_name, text, enabled, reference_json, updated_at_utc, format_version)
            VALUES ($id, $connection, $database, $text, $enabled, $reference, $updated, $version)
            ON CONFLICT (id) DO UPDATE SET connection_id = excluded.connection_id,
                database_name = excluded.database_name, text = excluded.text, enabled = excluded.enabled,
                reference_json = excluded.reference_json, updated_at_utc = excluded.updated_at_utc
            WHERE ai_business_notes.format_version = 1;
            """;
        command.Parameters.AddWithValue("$id", note.Id.ToString());
        command.Parameters.AddWithValue("$connection", note.ConnectionId.ToString());
        command.Parameters.AddWithValue("$database", note.Database);
        command.Parameters.AddWithValue("$text", note.Text);
        command.Parameters.AddWithValue("$enabled", note.Enabled ? 1 : 0);
        command.Parameters.AddWithValue("$reference", note.Reference is null ? DBNull.Value : JsonSerializer.Serialize(note.Reference));
        command.Parameters.AddWithValue("$updated", note.UpdatedAtUtc.ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$version", note.FormatVersion);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM ai_business_notes WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());
        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }
}
