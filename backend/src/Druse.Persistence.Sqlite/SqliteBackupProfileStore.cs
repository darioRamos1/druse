using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Perfiles de respaldo en la base local, junto a las conexiones.
///
/// **La selección y las anulaciones van como JSON en una columna.** Son listas y
/// diccionarios de tamaño libre, y darles tablas propias obligaría a tres
/// consultas y un ensamblado para leer algo que solo se usa entero. El resto —el
/// nombre, la conexión, las fechas— sí son columnas: es lo que se lista, se
/// ordena y se busca.
/// </summary>
public sealed class SqliteBackupProfileStore(DruseDatabase database) : IBackupProfileStore
{
    private readonly DruseDatabase _database = database;

    /// <summary>
    /// Cómo se serializa lo que va en JSON.
    ///
    /// Los enumerados van como texto **a propósito**: este archivo lo abre la
    /// persona que quiere entender por qué su respaldo hace lo que hace, y un
    /// `"mode": 2` no se lo dice. Además sobrevive a que alguien reordene el
    /// enumerado, cosa que un número no.
    /// </summary>
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    private const string Columns = """
        id, name, connection_id, database_name, selection_json, data_json,
        output_json, destination, known_tables_json, created_at_utc,
        updated_at_utc, last_run_at_utc
        """;

    public async Task<IReadOnlyList<BackupProfile>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // El más usado primero, y los que nunca se han lanzado por su fecha de
        // creación: quien abre esta lista busca casi siempre el de la última vez.
        command.CommandText = $"""
            SELECT {Columns}
            FROM backup_profiles
            ORDER BY COALESCE(last_run_at_utc, created_at_utc) DESC, name
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var profiles = new List<BackupProfile>();

        while (await reader.ReadAsync(cancellationToken))
        {
            profiles.Add(Read(reader));
        }

        return profiles;
    }

    public async Task<BackupProfile?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = $"SELECT {Columns} FROM backup_profiles WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task SaveAsync(BackupProfile profile, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO backup_profiles (
                id, name, connection_id, database_name, selection_json, data_json,
                output_json, destination, known_tables_json, created_at_utc,
                updated_at_utc, last_run_at_utc
            ) VALUES (
                $id, $name, $connection, $database, $selection, $data,
                $output, $destination, $known, $created,
                $updated, $lastRun
            )
            ON CONFLICT(id) DO UPDATE SET
                name              = excluded.name,
                connection_id     = excluded.connection_id,
                database_name     = excluded.database_name,
                selection_json    = excluded.selection_json,
                data_json         = excluded.data_json,
                output_json       = excluded.output_json,
                destination       = excluded.destination,
                known_tables_json = excluded.known_tables_json,
                updated_at_utc    = excluded.updated_at_utc
            """;

        command.Parameters.AddWithValue("$id", profile.Id.ToString());
        command.Parameters.AddWithValue("$name", profile.Name);
        command.Parameters.AddWithValue(
            "$connection",
            profile.ConnectionId?.ToString() ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("$database", profile.Database ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("$selection", JsonSerializer.Serialize(profile.Selection, Json));
        command.Parameters.AddWithValue("$data", JsonSerializer.Serialize(profile.Data, Json));
        command.Parameters.AddWithValue("$output", JsonSerializer.Serialize(profile.Output, Json));
        command.Parameters.AddWithValue("$destination", profile.Destination);
        command.Parameters.AddWithValue("$known", JsonSerializer.Serialize(profile.KnownTables, Json));
        command.Parameters.AddWithValue("$created", Text(profile.CreatedAtUtc));
        command.Parameters.AddWithValue("$updated", Text(profile.UpdatedAtUtc));
        command.Parameters.AddWithValue(
            "$lastRun",
            profile.LastRunAtUtc is { } run ? Text(run) : (object)DBNull.Value);

        // `created_at_utc` y `last_run_at_utc` no se pisan al actualizar: guardar
        // un cambio no vuelve nuevo al perfil ni borra que se lanzó ayer.
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM backup_profiles WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<bool> TouchAsync(
        Guid id,
        DateTimeOffset runAtUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            UPDATE backup_profiles SET last_run_at_utc = $run WHERE id = $id
            """;

        command.Parameters.AddWithValue("$id", id.ToString());
        command.Parameters.AddWithValue("$run", Text(runAtUtc));

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static BackupProfile Read(Microsoft.Data.Sqlite.SqliteDataReader reader) => new()
    {
        Id = Guid.Parse(reader.GetString(0)),
        Name = reader.GetString(1),
        ConnectionId = reader.IsDBNull(2) ? null : Guid.Parse(reader.GetString(2)),
        Database = reader.IsDBNull(3) ? null : reader.GetString(3),
        Selection = Deserialize<List<BackupSelector>>(reader.GetString(4)) ?? [],
        Data = Deserialize<DataSelection>(reader.GetString(5)) ?? new DataSelection(),
        Output = Deserialize<BackupOutput>(reader.GetString(6)) ?? new BackupOutput(),
        Destination = reader.GetString(7),
        KnownTables = Deserialize<List<string>>(reader.GetString(8)) ?? [],
        CreatedAtUtc = Moment(reader.GetString(9)),
        UpdatedAtUtc = Moment(reader.GetString(10)),
        LastRunAtUtc = reader.IsDBNull(11) ? null : Moment(reader.GetString(11)),
    };

    /// <summary>
    /// Lee un campo JSON sin llevarse por delante el perfil entero si está roto.
    ///
    /// Es un archivo del usuario y puede haberlo tocado, o venir de una versión
    /// que escribía otra cosa. Un perfil que se abre con la selección vacía se ve
    /// y se arregla; una lista de perfiles que no carga deja sin acceso también a
    /// los sanos.
    /// </summary>
    private static T? Deserialize<T>(string text)
    {
        try
        {
            return JsonSerializer.Deserialize<T>(text, Json);
        }
        catch (JsonException)
        {
            return default;
        }
    }

    private static string Text(DateTimeOffset moment) =>
        moment.ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset Moment(string text) =>
        DateTimeOffset.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
