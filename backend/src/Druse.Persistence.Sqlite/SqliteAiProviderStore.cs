using System.Globalization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Guarda los proveedores de IA configurados.
///
/// **Aquí no hay ninguna clave**, y la tabla tampoco tiene dónde ponerla: las
/// claves viven en el almacén del sistema, igual que las contraseñas de las
/// conexiones (plan §12).
/// </summary>
public sealed class SqliteAiProviderStore(DruseDatabase database) : IAiProviderStore
{
    private const string Columns =
        "id, name, kind, base_url, model, command, own_session, disclosure, is_default, created_at_utc";

    private readonly DruseDatabase _database = database;

    public async Task<IReadOnlyList<AiProviderProfile>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // El de por omisión primero, y el resto por orden de creación: la lista
        // se enseña en un menú donde lo primero es lo que se va a usar.
        command.CommandText = $"""
            SELECT {Columns}
            FROM ai_providers
            ORDER BY is_default DESC, created_at_utc ASC
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var providers = new List<AiProviderProfile>();

        while (await reader.ReadAsync(cancellationToken))
        {
            providers.Add(Read(reader));
        }

        return providers;
    }

    public async Task<AiProviderProfile?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = $"SELECT {Columns} FROM ai_providers WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task SaveAsync(AiProviderProfile profile, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // La fecha de creación no se pisa al reemplazar: un proveedor al que se
        // le cambia el modelo sigue siendo el mismo, y con ella se pierde el
        // orden de la lista.
        command.CommandText = $"""
            INSERT INTO ai_providers ({Columns})
            VALUES ($id, $name, $kind, $baseUrl, $model, $command, $ownSession, $disclosure, $isDefault, $created)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                kind = excluded.kind,
                base_url = excluded.base_url,
                model = excluded.model,
                command = excluded.command,
                own_session = excluded.own_session,
                disclosure = excluded.disclosure,
                is_default = excluded.is_default;
            """;

        command.Parameters.AddWithValue("$id", profile.Id.ToString());
        command.Parameters.AddWithValue("$name", profile.Name);
        command.Parameters.AddWithValue("$kind", (int)profile.Kind);
        command.Parameters.AddWithValue("$baseUrl", profile.BaseUrl);
        command.Parameters.AddWithValue("$model", profile.Model);
        command.Parameters.AddWithValue("$command", profile.Command);
        command.Parameters.AddWithValue("$ownSession", profile.OwnSession ? 1 : 0);
        command.Parameters.AddWithValue("$disclosure", (int)profile.Disclosure);
        command.Parameters.AddWithValue("$isDefault", profile.IsDefault ? 1 : 0);
        command.Parameters.AddWithValue(
            "$created",
            DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM ai_providers WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static AiProviderProfile Read(System.Data.Common.DbDataReader reader) => new()
    {
        Id = Guid.Parse(reader.GetString(0)),
        Name = reader.GetString(1),
        Kind = (AiProviderKind)reader.GetInt32(2),
        BaseUrl = reader.GetString(3),
        Model = reader.GetString(4),
        Command = reader.GetString(5),
        OwnSession = reader.GetInt32(6) != 0,
        Disclosure = (AiDisclosure)reader.GetInt32(7),
        IsDefault = reader.GetInt32(8) != 0,
    };
}
