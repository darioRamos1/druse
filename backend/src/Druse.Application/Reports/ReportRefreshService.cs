using System.Collections.Concurrent;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;

namespace Druse.Application.Reports;

/// <summary>
/// Una sola actualización a la vez por conjunto de datos.
///
/// Singleton: dos peticiones (o, más adelante, un horario y un clic) sobre el
/// mismo conjunto leerían dos veces los orígenes para publicar uno solo.
/// </summary>
public sealed class ReportRunGate
{
    private readonly ConcurrentDictionary<Guid, byte> _running = new();

    public bool TryEnter(Guid datasetId) => _running.TryAdd(datasetId, 0);

    public void Exit(Guid datasetId) => _running.TryRemove(datasetId, out _);
}

public enum ReportRefreshOutcome
{
    Refreshed,
    Failed,
    NotFound,
    Busy,
}

public sealed record ReportRefreshResult(ReportRefreshOutcome Outcome, ReportRun? Run);

/// <summary>
/// «Actualizar ahora»: lee las fuentes, las cruza y publica el resultado.
///
/// La regla que manda es que **un intento fallido no toca el último resultado
/// bueno**: una fuente caída, truncada o con claves duplicadas deja el resultado
/// anterior donde estaba y queda contado en el historial de intentos.
/// </summary>
public sealed class ReportRefreshService(
    IReportDatasetStore datasets,
    IReportSnapshotStore snapshots,
    IReportRunStore runs,
    ReportDatasetPreviewService reader,
    ReportRunGate gate,
    TimeProvider clock)
{
    /// <summary>Intentos que se conservan por conjunto.</summary>
    public const int RunHistoryLimit = 20;

    public async Task<ReportRefreshResult> RefreshAsync(
        Guid datasetId, ReportRunOrigin origin, CancellationToken cancellationToken)
    {
        var dataset = await datasets.FindAsync(datasetId, cancellationToken);
        if (dataset is null)
        {
            return new(ReportRefreshOutcome.NotFound, null);
        }

        if (!gate.TryEnter(datasetId))
        {
            return new(ReportRefreshOutcome.Busy, null);
        }

        var started = clock.GetUtcNow();
        try
        {
            var run = await RunAsync(dataset, origin, started, cancellationToken);
            await runs.AddAsync(run, CancellationToken.None);
            return new(run.Status == ReportRunStatus.Succeeded
                ? ReportRefreshOutcome.Refreshed
                : ReportRefreshOutcome.Failed, run);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Se anota sin el token cancelado: si no, el intento desaparecería sin rastro.
            await runs.AddAsync(Run(dataset, origin, started) with
            {
                Status = ReportRunStatus.Canceled,
                Message = "Se canceló la actualización.",
            }, CancellationToken.None);
            throw;
        }
        finally
        {
            gate.Exit(datasetId);
        }
    }

    private async Task<ReportRun> RunAsync(
        ReportDataset dataset, ReportRunOrigin origin, DateTimeOffset started, CancellationToken cancellationToken)
    {
        var failed = Run(dataset, origin, started) with { Status = ReportRunStatus.Failed };
        var errors = ReportDatasetValidator.Validate(dataset);
        if (errors.Count > 0)
        {
            return failed with { Message = string.Join(" ", errors), CompletedAtUtc = clock.GetUtcNow() };
        }

        var reads = new List<(ReportSourcePreview Preview, TypedQueryResult? Data)>();
        foreach (var source in dataset.Sources)
        {
            reads.Add(await reader.ReadSourceAsync(source, cancellationToken));
        }

        var sources = reads.Select(read => new ReportRunSource(
            read.Preview.Alias, read.Preview.FailureCode, read.Preview.Message, read.Preview.RowCount,
            read.Preview.Truncated, read.Preview.StartedAtUtc, read.Preview.CompletedAtUtc)).ToArray();
        failed = failed with { Sources = sources };

        if (reads.Any(read => read.Data is null))
        {
            return failed with
            {
                Message = "No se pudo leer alguna fuente. Se conserva el resultado anterior.",
                CompletedAtUtc = clock.GetUtcNow(),
            };
        }

        if (reads.Any(read => read.Data!.Truncated))
        {
            return failed with
            {
                Message = "Alguna fuente supera el límite de filas o de tamaño. Agrupa o filtra su consulta.",
                CompletedAtUtc = clock.GetUtcNow(),
            };
        }

        ReportJoinResult result;
        try
        {
            result = reads.Count == 1
                ? new ReportJoinResult(reads[0].Data!.Columns, reads[0].Data!.Rows, 0, 0)
                : ReportJoin.Combine(reads[0].Data!, reads[1].Data!, dataset.Join!.Keys,
                    dataset.Join.Kind, dataset.Join.Cardinality, cancellationToken);
        }
        catch (ReportJoinDuplicateKeysException exception)
        {
            return failed with
            {
                Message = exception.Message,
                DuplicateKeys = exception.SampleKeys,
                CompletedAtUtc = clock.GetUtcNow(),
            };
        }
        catch (InvalidOperationException exception) when (!cancellationToken.IsCancellationRequested)
        {
            return failed with { Message = exception.Message, CompletedAtUtc = clock.GetUtcNow() };
        }

        // La ventana va de la primera lectura a la última: dos motores
        // independientes pueden reflejar momentos distintos, y eso se enseña.
        var window = new ReportReadWindow(
            sources.Min(source => source.StartedAtUtc), sources.Max(source => source.CompletedAtUtc));
        try
        {
            var saved = await snapshots.SaveAsync(
                new ReportSnapshot(dataset.Id, dataset.Version, window, result), cancellationToken);
            if (!saved)
            {
                return failed with
                {
                    Message = "Ya hay un resultado más reciente; este intento no lo sustituye.",
                    CompletedAtUtc = clock.GetUtcNow(),
                };
            }
        }
        catch (InvalidOperationException exception) when (!cancellationToken.IsCancellationRequested)
        {
            // Más de 32 MiB o un tipo que todavía no se sabe guardar.
            return failed with { Message = exception.Message, CompletedAtUtc = clock.GetUtcNow() };
        }

        return failed with
        {
            Status = ReportRunStatus.Succeeded,
            RowCount = result.Rows.Count,
            CompletedAtUtc = clock.GetUtcNow(),
        };
    }

    private static ReportRun Run(ReportDataset dataset, ReportRunOrigin origin, DateTimeOffset started) => new()
    {
        Id = Guid.NewGuid(),
        DatasetId = dataset.Id,
        DefinitionVersion = dataset.Version,
        Origin = origin,
        Status = ReportRunStatus.Failed,
        StartedAtUtc = started,
        CompletedAtUtc = started,
    };
}
