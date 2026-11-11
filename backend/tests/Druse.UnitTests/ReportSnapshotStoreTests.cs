using Druse.Application.Reports;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

public sealed class ReportSnapshotStoreTests
{
    private static readonly DateOnly Mes = new(2026, 1, 1);
    private static readonly DateTimeOffset Inicio = new(2026, 11, 11, 14, 0, 0, TimeSpan.Zero);
    private const decimal Importe = 9007199254740993.1234m;

    [Fact]
    public async Task ReabreElUltimoCruceConSusTiposYFilasSinCoincidencia()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var dataset = Dataset();
        var service = new ReportSnapshotService(new SqliteReportSnapshotStore(paths));
        var left = Data([[Mes, "05001", Importe], [Mes, "11001", 40m]]);
        var right = Data([[Mes, "05001", 100m]]);

        Assert.True(await service.CombineAndSaveAsync(dataset, Window(Inicio), left, right, CancellationToken.None));

        var reopened = new SqliteReportSnapshotStore(paths);
        var snapshot = await reopened.FindAsync(dataset.DatasetId, CancellationToken.None);
        Assert.NotNull(snapshot);
        Assert.Equal(1, snapshot.DefinitionVersion);
        Assert.Equal(Window(Inicio), snapshot.Window);
        Assert.Equal(1, snapshot.Result.UnmatchedLeftRows);
        Assert.Equal(Mes, Assert.IsType<DateOnly>(snapshot.Result.Rows[0][0]));
        Assert.Equal("05001", Assert.IsType<string>(snapshot.Result.Rows[0][1]));
        Assert.Equal(Importe, Assert.IsType<decimal>(snapshot.Result.Rows[0][2]));
        Assert.Null(snapshot.Result.Rows[1][5]);
        Assert.Null(await reopened.FindAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task UnResultadoQueSuperaElLimiteEnBytesNoSustituyeAlGuardado()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var store = new SqliteReportSnapshotStore(paths);
        var service = new ReportSnapshotService(store);
        var dataset = Dataset();
        var source = Data([[Mes, "05001", Importe]]);
        Assert.True(await service.CombineAndSaveAsync(dataset, Window(Inicio), source, source, CancellationToken.None));

        const int cellLength = 128 * 1024;
        IReadOnlyList<object?> row = [new string('a', cellLength)];
        var oversized = new ReportJoinResult(
            [Column<string>("detalle", 0)],
            Enumerable.Repeat(row, SqliteReportSnapshotStore.MaxPayloadBytes / cellLength + 1).ToArray(),
            0,
            0);
        var later = new ReportSnapshot(dataset.DatasetId, 1, Window(Inicio.AddMinutes(1)), oversized);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => store.SaveAsync(later, CancellationToken.None));
        Assert.Contains("32 MiB", error.Message, StringComparison.Ordinal);

        var remaining = await store.FindAsync(dataset.DatasetId, CancellationToken.None);
        Assert.NotNull(remaining);
        Assert.Equal(Window(Inicio), remaining.Window);
        Assert.Equal(Importe, Assert.IsType<decimal>(Assert.Single(remaining.Result.Rows)[2]));
    }

    [Fact]
    public async Task ConservaElResultadoSiLaActualizacionFallaOSeCancela()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var store = new SqliteReportSnapshotStore(paths);
        var service = new ReportSnapshotService(store);
        var dataset = Dataset();
        var source = Data([[Mes, "05001", Importe]]);
        Assert.True(await service.CombineAndSaveAsync(dataset, Window(Inicio), source, source, CancellationToken.None));

        var later = Window(Inicio.AddMinutes(1));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CombineAndSaveAsync(
            dataset, later, source, source with { Truncated = true }, CancellationToken.None));

        var duplicate = Data([[Mes, "05001", 100m], [Mes, "05001", 101m]]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CombineAndSaveAsync(
            dataset, later, source, duplicate, CancellationToken.None));

        var invalid = Data([[Mes, "05001", "valor incompatible"]]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.CombineAndSaveAsync(
            dataset, later, source, invalid, CancellationToken.None));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.CombineAndSaveAsync(
            dataset, later, source, source, new CancellationToken(canceled: true)));

        var remaining = await store.FindAsync(dataset.DatasetId, CancellationToken.None);
        Assert.NotNull(remaining);
        Assert.Equal(Window(Inicio), remaining.Window);
        Assert.Equal(Importe, Assert.IsType<decimal>(Assert.Single(remaining.Result.Rows)[5]));
    }

    [Fact]
    public async Task PublicaSoloCapturasMasRecientesDeLaMismaDefinicionOUnaNueva()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var store = new SqliteReportSnapshotStore(paths);
        var service = new ReportSnapshotService(store);
        var dataset = Dataset();
        var source = Data([[Mes, "05001", 100m]]);
        var updated = Data([[Mes, "05001", 110m]]);

        Assert.True(await service.CombineAndSaveAsync(dataset, Window(Inicio), source, source, CancellationToken.None));
        Assert.True(await service.CombineAndSaveAsync(
            dataset, Window(Inicio.AddMinutes(2)), source, updated, CancellationToken.None));
        Assert.False(await service.CombineAndSaveAsync(
            dataset, Window(Inicio.AddMinutes(1)), source, source, CancellationToken.None));

        var newDefinition = dataset with { DefinitionVersion = 2 };
        Assert.True(await service.CombineAndSaveAsync(
            newDefinition, Window(Inicio.AddMinutes(3)), source, updated, CancellationToken.None));
        Assert.False(await service.CombineAndSaveAsync(
            dataset, Window(Inicio.AddMinutes(4)), source, source, CancellationToken.None));

        var snapshot = await store.FindAsync(dataset.DatasetId, CancellationToken.None);
        Assert.NotNull(snapshot);
        Assert.Equal(2, snapshot.DefinitionVersion);
        Assert.Equal(110m, Assert.IsType<decimal>(Assert.Single(snapshot.Result.Rows)[5]));
    }

    private static ReportDatasetJoin Dataset() =>
        new(Guid.NewGuid(), 1, [new("mes", "mes"), new("municipio", "municipio")], ReportJoinKind.Left);

    private static ReportReadWindow Window(DateTimeOffset start) => new(start, start.AddSeconds(1));

    private static TypedQueryResult Data(IReadOnlyList<IReadOnlyList<object?>> rows) =>
        new([Column<DateOnly>("mes", 0), Column<string>("municipio", 1), Column<decimal>("valor", 2)],
            rows, Truncated: false);

    private static ResultColumn Column<T>(string name, int ordinal) =>
        new() { Name = name, DataType = typeof(T).Name, ClrType = typeof(T).Name, Ordinal = ordinal };
}
