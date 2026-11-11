using System.Text.Json;
using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Domain;
using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteReportSnapshotStore(IAppPaths paths) : IReportSnapshotStore
{
    public const int MaxPayloadBytes = 32 * 1024 * 1024;
    private const int PayloadVersion = 1;

    private static readonly Dictionary<string, Type> ColumnTypes = new[]
    {
        typeof(string), typeof(bool), typeof(byte), typeof(short), typeof(int), typeof(long),
        typeof(float), typeof(double), typeof(decimal), typeof(Guid), typeof(DateOnly), typeof(TimeOnly),
        typeof(DateTime), typeof(DateTimeOffset), typeof(TimeSpan), typeof(byte[]),
    }.ToDictionary(type => type.Name, StringComparer.Ordinal);

    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<ReportSnapshot?> FindAsync(Guid datasetId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!File.Exists(_databaseFile))
        {
            return null;
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT definition_version, started_utc_ticks, completed_utc_ticks, payload_version, payload
            FROM report_snapshots
            WHERE dataset_id = $id;
            """;
        command.Parameters.AddWithValue("$id", datasetId.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        if (reader.GetInt32(3) != PayloadVersion)
        {
            throw new InvalidOperationException("La versión del resultado BI guardado no es compatible.");
        }

        return new ReportSnapshot(datasetId, reader.GetInt64(0),
            new ReportReadWindow(
                new DateTimeOffset(reader.GetInt64(1), TimeSpan.Zero),
                new DateTimeOffset(reader.GetInt64(2), TimeSpan.Zero)),
            Deserialize(reader.GetFieldValue<byte[]>(4), cancellationToken));
    }

    public async Task<bool> SaveAsync(ReportSnapshot snapshot, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentOutOfRangeException.ThrowIfLessThan(snapshot.DefinitionVersion, 1);
        if (snapshot.DatasetId == Guid.Empty || snapshot.Window.CompletedAtUtc < snapshot.Window.StartedAtUtc)
        {
            throw new ArgumentException("El resultado BI requiere un conjunto y un intervalo de captura válidos.", nameof(snapshot));
        }

        cancellationToken.ThrowIfCancellationRequested();
        var payload = await SerializeAsync(snapshot.Result, cancellationToken);
        await using var connection = await OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // Una sentencia cambia los datos y su versión juntos. Una ejecución
        // atrasada no puede reemplazar un resultado de una captura más nueva.
        command.CommandText = """
            INSERT INTO report_snapshots (
                dataset_id, definition_version, started_utc_ticks, completed_utc_ticks, payload_version, payload)
            VALUES ($id, $definition, $started, $completed, $format, $payload)
            ON CONFLICT (dataset_id) DO UPDATE SET
                definition_version = excluded.definition_version,
                started_utc_ticks = excluded.started_utc_ticks,
                completed_utc_ticks = excluded.completed_utc_ticks,
                payload_version = excluded.payload_version,
                payload = excluded.payload
            WHERE excluded.definition_version > report_snapshots.definition_version
               OR (excluded.definition_version = report_snapshots.definition_version
                   AND excluded.started_utc_ticks > report_snapshots.started_utc_ticks);
            """;
        command.Parameters.AddWithValue("$id", snapshot.DatasetId.ToString());
        command.Parameters.AddWithValue("$definition", snapshot.DefinitionVersion);
        command.Parameters.AddWithValue("$started", snapshot.Window.StartedAtUtc.UtcTicks);
        command.Parameters.AddWithValue("$completed", snapshot.Window.CompletedAtUtc.UtcTicks);
        command.Parameters.AddWithValue("$format", PayloadVersion);
        command.Parameters.AddWithValue("$payload", payload);

        cancellationToken.ThrowIfCancellationRequested();
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken) =>
        ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);

    private static ReportJoinResult Deserialize(byte[] payload, CancellationToken cancellationToken)
    {
        // Un solo documento evita copiar un fragmento de JSON por cada celda.
        using var document = JsonDocument.Parse(payload);
        var root = document.RootElement;
        var columns = root.GetProperty(nameof(ReportJoinResult.Columns)).Deserialize<ResultColumn[]>()
            ?? throw new InvalidOperationException("El resultado BI guardado no tiene columnas.");
        var types = ResolveTypes(columns);
        var storedRows = root.GetProperty(nameof(ReportJoinResult.Rows));
        var rows = new List<IReadOnlyList<object?>>(storedRows.GetArrayLength());
        foreach (var stored in storedRows.EnumerateArray())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (stored.GetArrayLength() != types.Length)
            {
                throw new InvalidOperationException("Una fila del resultado BI no coincide con su esquema.");
            }

            var row = new object?[types.Length];
            var ordinal = 0;
            foreach (var cell in stored.EnumerateArray())
            {
                row[ordinal] = ReadValue(cell, types[ordinal]);
                ordinal++;
            }

            rows.Add(row);
        }

        return new ReportJoinResult(columns, rows,
            root.GetProperty(nameof(ReportJoinResult.UnmatchedLeftRows)).GetInt32(),
            root.GetProperty(nameof(ReportJoinResult.UnmatchedRightRows)).GetInt32())
        {
            // Las capturas del hito 1 no lo tenían: eran todas 1:1.
            RepeatedColumns = root.TryGetProperty(nameof(ReportJoinResult.RepeatedColumns), out var repeated)
                ? repeated.Deserialize<string[]>() ?? []
                : [],
        };
    }

    private static object? ReadValue(JsonElement cell, Type type)
    {
        if (cell.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return Type.GetTypeCode(type) switch
        {
            TypeCode.String => cell.GetString(),
            TypeCode.Boolean => cell.GetBoolean(),
            TypeCode.Byte => cell.GetByte(),
            TypeCode.Int16 => cell.GetInt16(),
            TypeCode.Int32 => cell.GetInt32(),
            TypeCode.Int64 => cell.GetInt64(),
            TypeCode.Single => cell.GetSingle(),
            TypeCode.Double => cell.GetDouble(),
            TypeCode.Decimal => cell.GetDecimal(),
            TypeCode.DateTime => cell.GetDateTime(),
            _ => cell.Deserialize(type),
        };
    }

    private static async Task<byte[]> SerializeAsync(ReportJoinResult result, CancellationToken cancellationToken)
    {
        var types = ResolveTypes(result.Columns);
        foreach (var row in result.Rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (row.Count != types.Length)
            {
                throw new InvalidOperationException("Una fila del resultado BI no coincide con su esquema.");
            }

            for (var i = 0; i < row.Count; i++)
            {
                if (row[i] is { } value && value.GetType() != types[i])
                {
                    throw new InvalidOperationException($"El valor de {result.Columns[i].Name} no coincide con su tipo declarado.");
                }
            }
        }

        using var buffer = new SnapshotBuffer();
        await JsonSerializer.SerializeAsync(buffer, result, cancellationToken: cancellationToken);
        return buffer.ToArray();
    }

    private static Type[] ResolveTypes(IReadOnlyList<ResultColumn> columns) => columns.Select(column =>
        ColumnTypes.TryGetValue(column.ClrType, out var type) ? type : throw new InvalidOperationException(
            $"La columna {column.Name} tiene un tipo que aún no se puede guardar en BI. Convierte su valor en la consulta."))
        .ToArray();

    // El límite se verifica al recibir cada bloque serializado, antes de que
    // el resultado pueda sustituir al que ya está guardado.
    private sealed class SnapshotBuffer : MemoryStream
    {
        public override void Write(byte[] buffer, int offset, int count)
        {
            if (count > MaxPayloadBytes - Position)
            {
                throw new InvalidOperationException("El resultado BI supera los 32 MiB. Reduce las filas o columnas de la consulta.");
            }

            base.Write(buffer, offset, count);
        }

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Write(buffer.Span);
            return ValueTask.CompletedTask;
        }
    }
}
