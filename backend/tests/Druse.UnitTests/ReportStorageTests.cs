using Druse.Application.Reports;
using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Hito 5.2 de Reportes BI: cuánto ocupa lo guardado, la cuota que lo acota,
/// borrar los datos de un conjunto y la retención del historial.
/// </summary>
public sealed class ReportStorageTests
{
    private static readonly DateTimeOffset Ahora = new(2026, 11, 12, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task UnResultadoQueSuperaLaCuotaNoSeGuardaYElAnteriorSeQueda()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var generoso = new SqliteReportSnapshotStore(paths);
        var uno = Guid.NewGuid();
        var otro = Guid.NewGuid();

        Assert.True(await generoso.SaveAsync(Snapshot(uno, 1, filas: 50), CancellationToken.None));
        var usado = (await generoso.GetUsageAsync(CancellationToken.None)).SnapshotBytes;
        Assert.True(usado > 0);

        // Con la cuota justa para lo que hay, otro conjunto ya no cabe…
        var justo = new SqliteReportSnapshotStore(paths, usado + 10);
        var error = await Assert.ThrowsAsync<ReportProblemException>(
            () => justo.SaveAsync(Snapshot(otro, 1, filas: 50), CancellationToken.None));
        Assert.Equal(MessageKeys.Reports.Quota, error.Localized.Key);
        Assert.Null(await justo.FindAsync(otro, CancellationToken.None));

        // …pero el mismo conjunto puede sustituir el suyo: no se cuenta dos veces.
        Assert.True(await justo.SaveAsync(Snapshot(uno, 2, filas: 50), CancellationToken.None));
        Assert.Equal(2, (await justo.FindAsync(uno, CancellationToken.None))!.DefinitionVersion);
    }

    [Fact]
    public async Task BorrarLosDatosGuardadosConservaElConjuntoYSuHistorial()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var clock = TimeProvider.System;
        var datasets = new SqliteReportDatasetStore(paths, clock);
        var snapshots = new SqliteReportSnapshotStore(paths);
        var runs = new SqliteReportRunStore(paths);
        var dataset = await datasets.SaveAsync(Dataset(), CancellationToken.None);
        await snapshots.SaveAsync(Snapshot(dataset.Id, dataset.Version, filas: 200), CancellationToken.None);
        await runs.AddAsync(Intento(dataset.Id, Ahora), CancellationToken.None);

        var antes = await snapshots.GetUsageAsync(CancellationToken.None);
        var entrada = Assert.Single(antes.Datasets);
        Assert.Equal("Ventas", entrada.Name);
        Assert.Equal(antes.SnapshotBytes, entrada.SnapshotBytes);
        Assert.Equal(1, entrada.RunCount);
        Assert.NotNull(entrada.CapturedAtUtc);
        Assert.Equal(ReportStorage.QuotaBytes, antes.QuotaBytes);
        Assert.True(antes.FileBytes >= antes.SnapshotBytes);

        Assert.True(await snapshots.DeleteAsync(dataset.Id, CancellationToken.None));
        Assert.False(await snapshots.DeleteAsync(dataset.Id, CancellationToken.None));

        Assert.Null(await snapshots.FindAsync(dataset.Id, CancellationToken.None));
        Assert.NotNull(await datasets.FindAsync(dataset.Id, CancellationToken.None));
        Assert.Single(await runs.GetRecentAsync(dataset.Id, 5, CancellationToken.None));
        var despues = await snapshots.GetUsageAsync(CancellationToken.None);
        Assert.Equal(0, despues.SnapshotBytes);
        Assert.Null(Assert.Single(despues.Datasets).CapturedAtUtc);
    }

    [Fact]
    public async Task LosIntentosDeHaceMasDeNoventaDiasSeOlvidan()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var runs = new SqliteReportRunStore(paths);
        var datasetId = Guid.NewGuid();

        await runs.AddAsync(Intento(datasetId, Ahora.AddDays(-120)), CancellationToken.None);
        await runs.AddAsync(Intento(datasetId, Ahora.AddDays(-30)), CancellationToken.None);
        await runs.AddAsync(Intento(datasetId, Ahora), CancellationToken.None);

        var quedan = await runs.GetRecentAsync(datasetId, 20, CancellationToken.None);
        Assert.Equal([Ahora, Ahora.AddDays(-30)], quedan.Select(run => run.StartedAtUtc));
    }

    private static ReportSnapshot Snapshot(Guid datasetId, long version, int filas)
    {
        ResultColumn[] columnas =
        [
            new() { Name = "municipio", DataType = "String", ClrType = "String", Ordinal = 0 },
            new() { Name = "venta", DataType = "Int32", ClrType = "Int32", Ordinal = 1 },
        ];
        var datos = Enumerable.Range(0, filas)
            .Select(i => (IReadOnlyList<object?>)[$"{i:00000}", i])
            .ToArray();
        return new ReportSnapshot(datasetId, version, new ReportReadWindow(Ahora, Ahora.AddSeconds(1)),
            new ReportJoinResult(columnas, datos, 0, 0));
    }

    private static ReportRun Intento(Guid datasetId, DateTimeOffset started) => new()
    {
        Id = Guid.NewGuid(),
        DatasetId = datasetId,
        DefinitionVersion = 1,
        Origin = ReportRunOrigin.Manual,
        Status = ReportRunStatus.Succeeded,
        StartedAtUtc = started,
        CompletedAtUtc = started.AddSeconds(1),
    };

    private static ReportDataset Dataset() => new()
    {
        Id = Guid.NewGuid(),
        Name = "Ventas",
        Sources =
        [
            new ReportSourceDefinition
            {
                Alias = "Ventas",
                ConnectionId = Guid.NewGuid(),
                Database = "ventas",
                Mode = ReportSourceMode.Sql,
                Sql = "SELECT municipio, venta FROM ventas",
            },
        ],
    };
}
