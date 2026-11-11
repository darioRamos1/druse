using Druse.Application.Abstractions;
using Druse.Database.Abstractions;

namespace Druse.Application.Reports;

/// <summary>Publica el cruce cuando las dos fuentes y sus claves son válidas.</summary>
public sealed class ReportSnapshotService(IReportSnapshotStore snapshots)
{
    public Task<bool> CombineAndSaveAsync(
        ReportDatasetJoin dataset,
        ReportReadWindow window,
        TypedQueryResult left,
        TypedQueryResult right,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        ArgumentNullException.ThrowIfNull(window);

        // Si falla una validación, la publicación ni siquiera llega al almacén.
        var result = ReportJoin.Combine(left, right, dataset.Keys, dataset.Kind, cancellationToken);
        return snapshots.SaveAsync(
            new ReportSnapshot(dataset.DatasetId, dataset.DefinitionVersion, window, result), cancellationToken);
    }
}
