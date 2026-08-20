using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Migraciones guardadas en la base local, junto a las conexiones y a los
/// perfiles de respaldo.
///
/// Misma forma que el de respaldos y por lo mismo: **las tablas y las opciones van
/// como JSON** —son una lista y un puñado de banderas que solo se usan enteras— y
/// lo que se lista, se ordena y se busca —el nombre, las conexiones, las fechas—
/// tiene columna propia.
/// </summary>
public sealed class SqliteTransferProfileStore(DruseDatabase database) : ITransferProfileStore
{
    private readonly DruseDatabase _database = database;

    /// <summary>
    /// Cómo se serializa lo que va en JSON.
    ///
    /// Los enumerados van como texto **a propósito**, igual que en los respaldos:
    /// este archivo lo abre quien quiere entender por qué su migración hace lo que
    /// hace, y un `"mode": 2` no se lo dice. Además sobrevive a que alguien
    /// reordene el enumerado, cosa que un número no.
    /// </summary>
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    private const string Columns = """
        id, name, source_connection_id, source_database, source_schema,
        target_connection_id, target_database, target_schema, tables_json,
        options_json, created_at_utc, updated_at_utc, last_run_at_utc
        """;

    /// <summary>Lo que viaja dentro de `options_json`: cómo se copia, no qué.</summary>
    private sealed record Options
    {
        public TransferMode Mode { get; init; } = TransferMode.Insert;

        public bool Ordered { get; init; } = true;

        public bool Atomic { get; init; }

        public bool KeepIdentity { get; init; } = true;

        public int BatchSize { get; init; } = DataTransferRequest.DefaultBatchSize;

        /// <summary>
        /// Lo que cada tabla hace distinto, por su nombre.
        ///
        /// Va aquí dentro y no en columnas propias por lo mismo que la lista de
        /// tablas: es un diccionario de tamaño libre que solo se usa entero.
        /// </summary>
        public Dictionary<string, TransferTableOptions> TableOptions { get; init; } =
            new(StringComparer.OrdinalIgnoreCase);
    }

    public async Task<IReadOnlyList<TransferProfile>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // El más usado primero, y los que nunca se han lanzado por su fecha de
        // creación: quien abre esta lista busca casi siempre el de la última vez.
        command.CommandText = $"""
            SELECT {Columns}
            FROM transfer_profiles
            ORDER BY COALESCE(last_run_at_utc, created_at_utc) DESC, name
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var profiles = new List<TransferProfile>();

        while (await reader.ReadAsync(cancellationToken))
        {
            profiles.Add(Read(reader));
        }

        return profiles;
    }

    public async Task<TransferProfile?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = $"SELECT {Columns} FROM transfer_profiles WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task SaveAsync(TransferProfile profile, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO transfer_profiles (
                id, name, source_connection_id, source_database, source_schema,
                target_connection_id, target_database, target_schema, tables_json,
                options_json, created_at_utc, updated_at_utc, last_run_at_utc
            ) VALUES (
                $id, $name, $sourceConnection, $sourceDatabase, $sourceSchema,
                $targetConnection, $targetDatabase, $targetSchema, $tables,
                $options, $created, $updated, $lastRun
            )
            ON CONFLICT(id) DO UPDATE SET
                name                 = excluded.name,
                source_connection_id = excluded.source_connection_id,
                source_database      = excluded.source_database,
                source_schema        = excluded.source_schema,
                target_connection_id = excluded.target_connection_id,
                target_database      = excluded.target_database,
                target_schema        = excluded.target_schema,
                tables_json          = excluded.tables_json,
                options_json         = excluded.options_json,
                updated_at_utc       = excluded.updated_at_utc
            """;

        command.Parameters.AddWithValue("$id", profile.Id.ToString());
        command.Parameters.AddWithValue("$name", profile.Name);
        command.Parameters.AddWithValue(
            "$sourceConnection",
            profile.SourceConnectionId?.ToString() ?? (object)DBNull.Value);
        command.Parameters.AddWithValue(
            "$sourceDatabase",
            profile.SourceDatabase ?? (object)DBNull.Value);
        command.Parameters.AddWithValue(
            "$sourceSchema",
            profile.SourceSchema ?? (object)DBNull.Value);
        command.Parameters.AddWithValue(
            "$targetConnection",
            profile.TargetConnectionId?.ToString() ?? (object)DBNull.Value);
        command.Parameters.AddWithValue(
            "$targetDatabase",
            profile.TargetDatabase ?? (object)DBNull.Value);
        command.Parameters.AddWithValue(
            "$targetSchema",
            profile.TargetSchema ?? (object)DBNull.Value);
        command.Parameters.AddWithValue("$tables", JsonSerializer.Serialize(profile.Tables, Json));
        command.Parameters.AddWithValue("$options", JsonSerializer.Serialize(
            new Options
            {
                Mode = profile.Mode,
                Ordered = profile.Ordered,
                Atomic = profile.Atomic,
                KeepIdentity = profile.KeepIdentity,
                BatchSize = profile.BatchSize,
                TableOptions = new Dictionary<string, TransferTableOptions>(
                    profile.TableOptions,
                    StringComparer.OrdinalIgnoreCase),
            },
            Json));
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

        command.CommandText = "DELETE FROM transfer_profiles WHERE id = $id";
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
            UPDATE transfer_profiles SET last_run_at_utc = $run WHERE id = $id
            """;

        command.Parameters.AddWithValue("$id", id.ToString());
        command.Parameters.AddWithValue("$run", Text(runAtUtc));

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static TransferProfile Read(Microsoft.Data.Sqlite.SqliteDataReader reader)
    {
        var options = Deserialize<Options>(reader.GetString(9)) ?? new Options();

        return new TransferProfile
        {
            Id = Guid.Parse(reader.GetString(0)),
            Name = reader.GetString(1),
            SourceConnectionId = reader.IsDBNull(2) ? null : Guid.Parse(reader.GetString(2)),
            SourceDatabase = reader.IsDBNull(3) ? null : reader.GetString(3),
            SourceSchema = reader.IsDBNull(4) ? null : reader.GetString(4),
            TargetConnectionId = reader.IsDBNull(5) ? null : Guid.Parse(reader.GetString(5)),
            TargetDatabase = reader.IsDBNull(6) ? null : reader.GetString(6),
            TargetSchema = reader.IsDBNull(7) ? null : reader.GetString(7),
            Tables = Deserialize<List<string>>(reader.GetString(8)) ?? [],
            Mode = options.Mode,
            Ordered = options.Ordered,
            Atomic = options.Atomic,
            KeepIdentity = options.KeepIdentity,
            BatchSize = options.BatchSize,
            TableOptions = options.TableOptions,
            CreatedAtUtc = Moment(reader.GetString(10)),
            UpdatedAtUtc = Moment(reader.GetString(11)),
            LastRunAtUtc = reader.IsDBNull(12) ? null : Moment(reader.GetString(12)),
        };
    }

    /// <summary>
    /// Lee un campo JSON sin llevarse por delante el perfil entero si está roto.
    ///
    /// Es un archivo del usuario y puede haberlo tocado, o venir de una versión
    /// que escribía otra cosa. Un perfil que se abre sin tablas se ve y se
    /// arregla; una lista que no carga deja sin acceso también a los sanos.
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
