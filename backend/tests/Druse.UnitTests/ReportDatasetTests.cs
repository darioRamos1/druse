using Druse.Application.Reports;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

public sealed class ReportDatasetTests
{
    private static readonly DateOnly Enero = new(2026, 1, 1);
    private static readonly ReportJoinKey[] PorMesYMunicipio = [new("mes", "mes"), new("municipio", "municipio")];

    [Fact]
    public void LaUnionMuchosAUnoRepiteLaMetaYAvisaDeQueNoSePuedeSumar()
    {
        // Ventas por día (varias por mes y municipio) frente a una meta mensual.
        var ventas = Data(
            [Column<DateOnly>("mes", 0), Column<string>("municipio", 1), Column<decimal>("venta", 2)],
            [[Enero, "05001", 30m], [Enero, "05001", 50m], [Enero, "08001", 100m], [Enero, "11001", 40m]]);
        var metas = Data(
            [Column<DateOnly>("mes", 0), Column<string>("municipio", 1), Column<decimal>("meta", 2), Column<string>("region", 3)],
            [[Enero, "05001", 100m, "Andina"], [Enero, "08001", 200m, "Caribe"], [Enero, "76001", 50m, "Pacífico"]]);

        var result = ReportJoin.Combine(
            ventas, metas, PorMesYMunicipio, ReportJoinKind.Left, ReportJoinCardinality.ManyToOne, CancellationToken.None);

        Assert.Equal(4, result.Rows.Count);
        Assert.Equal(220m, result.Rows.Sum(row => (decimal)row[2]!));
        Assert.Equal(1, result.UnmatchedLeftRows);
        Assert.Equal(1, result.UnmatchedRightRows);
        Assert.Equal(["derecha.meta"], result.RepeatedColumns);
    }

    [Fact]
    public void UnaUnionMuchosAUnoSinRepeticionesNoMarcaColumnas()
    {
        var ventas = Data([Column<string>("municipio", 0), Column<decimal>("venta", 1)], [["05001", 80m], ["08001", 100m]]);
        var metas = Data([Column<string>("municipio", 0), Column<decimal>("meta", 1)], [["05001", 100m], ["08001", 200m]]);

        var result = ReportJoin.Combine(ventas, metas, [new("municipio", "municipio")],
            ReportJoinKind.Inner, ReportJoinCardinality.ManyToOne, CancellationToken.None);

        Assert.Empty(result.RepeatedColumns);
        Assert.Equal(0, result.UnmatchedRightRows);
    }

    [Fact]
    public void LasClavesDuplicadasDetienenLaUnionConEjemplos()
    {
        var repetida = Data([Column<string>("municipio", 0), Column<decimal>("valor", 1)],
            [["05001", 1m], ["05001", 2m], ["08001", 3m], ["08001", 4m]]);
        var unica = Data([Column<string>("municipio", 0), Column<decimal>("valor", 1)], [["05001", 1m]]);
        ReportJoinKey[] keys = [new("municipio", "municipio")];

        var izquierda = Assert.Throws<ReportJoinDuplicateKeysException>(() => ReportJoin.Combine(
            repetida, unica, keys, ReportJoinKind.Left, ReportJoinCardinality.OneToOne, CancellationToken.None));
        Assert.Equal(["05001", "08001"], izquierda.SampleKeys);
        Assert.Contains("1:N", izquierda.Message, StringComparison.Ordinal);

        // La derecha es el lado «uno» en las dos cardinalidades: repetirla sería N:N.
        var derecha = Assert.Throws<ReportJoinDuplicateKeysException>(() => ReportJoin.Combine(
            unica, repetida, keys, ReportJoinKind.Left, ReportJoinCardinality.ManyToOne, CancellationToken.None));
        Assert.Equal(["05001", "08001"], derecha.SampleKeys);
    }

    [Fact]
    public void ElValidadorExigeUnionConDosFuentesYEstadoVisual()
    {
        var errores = ReportDatasetValidator.Validate(Dataset() with { Join = null });
        Assert.Contains(errores, error => error.Contains("columna de unión", StringComparison.Ordinal));

        var sinEstado = Dataset() with
        {
            Sources = [Dataset().Sources[0] with { VisualModel = "{roto" }, Dataset().Sources[1]],
        };
        Assert.Contains(ReportDatasetValidator.Validate(sinEstado),
            error => error.Contains("compositor", StringComparison.Ordinal));

        var aliasRepetido = Dataset() with
        {
            Sources = [Dataset().Sources[0], Dataset().Sources[1] with { Alias = "VENTAS" }],
        };
        Assert.Contains(ReportDatasetValidator.Validate(aliasRepetido),
            error => error.Contains("alias distintos", StringComparison.Ordinal));

        Assert.Empty(ReportDatasetValidator.Validate(Dataset()));
    }

    [Fact]
    public async Task ElAlmacenSubeLaVersionSoloSiCambiaLaDefinicion()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var clock = new ManualClock(new DateTimeOffset(2026, 11, 11, 15, 0, 0, TimeSpan.Zero));
        var store = new SqliteReportDatasetStore(paths, clock);
        var dataset = Dataset();

        var primero = await store.SaveAsync(dataset, CancellationToken.None);
        Assert.Equal(1, primero.Version);

        clock.Advance(TimeSpan.FromMinutes(1));
        var renombrado = await store.SaveAsync(dataset with { Name = " Ventas y metas 2026 " }, CancellationToken.None);
        Assert.Equal(1, renombrado.Version);
        Assert.Equal("Ventas y metas 2026", renombrado.Name);
        Assert.Equal(primero.CreatedAtUtc, renombrado.CreatedAtUtc);

        var otraConsulta = dataset with
        {
            Name = renombrado.Name,
            Sources = [dataset.Sources[0], dataset.Sources[1] with { Sql = "SELECT mes, municipio, meta FROM metas_2026" }],
        };
        Assert.Equal(2, (await store.SaveAsync(otraConsulta, CancellationToken.None)).Version);

        // Otra instancia lee el mismo archivo, como tras reiniciar Druse.
        var reabierto = await new SqliteReportDatasetStore(paths, clock).FindAsync(dataset.Id, CancellationToken.None);
        Assert.NotNull(reabierto);
        Assert.Equal(2, reabierto.Version);
        Assert.Equal(ReportSourceMode.Visual, reabierto.Sources[0].Mode);
        Assert.Equal(dataset.Sources[0].VisualModel, reabierto.Sources[0].VisualModel);
        Assert.Equal(ReportSourceMode.Sql, reabierto.Sources[1].Mode);
        Assert.Equal(dataset.Sources[1].ExpectedColumns, reabierto.Sources[1].ExpectedColumns);
        Assert.Equal(ReportJoinCardinality.ManyToOne, reabierto.Join!.Cardinality);
        Assert.Equal(PorMesYMunicipio, reabierto.Join.Keys);
        Assert.Single(await store.GetAllAsync(CancellationToken.None));
    }

    [Fact]
    public async Task BorrarElConjuntoBorraTambienSuResultadoGuardado()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var store = new SqliteReportDatasetStore(paths, TimeProvider.System);
        var snapshots = new SqliteReportSnapshotStore(paths);
        var dataset = await store.SaveAsync(Dataset(), CancellationToken.None);
        var fuente = Data([Column<string>("municipio", 0)], [["05001"]]);
        await new ReportSnapshotService(snapshots).CombineAndSaveAsync(
            new ReportDatasetJoin(dataset.Id, dataset.Version, [new("municipio", "municipio")], ReportJoinKind.Inner),
            new ReportReadWindow(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow), fuente, fuente, CancellationToken.None);
        Assert.NotNull(await snapshots.FindAsync(dataset.Id, CancellationToken.None));

        await store.DeleteAsync(dataset.Id, CancellationToken.None);

        Assert.Null(await store.FindAsync(dataset.Id, CancellationToken.None));
        Assert.Null(await snapshots.FindAsync(dataset.Id, CancellationToken.None));
    }

    [Fact]
    public async Task ElHistorialDeIntentosSeQuedaConLosMasRecientes()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var runs = new SqliteReportRunStore(paths);
        var datasetId = Guid.NewGuid();
        var otro = Guid.NewGuid();
        var inicio = new DateTimeOffset(2026, 11, 11, 8, 0, 0, TimeSpan.Zero);

        for (var i = 0; i < ReportRefreshService.RunHistoryLimit + 5; i++)
        {
            await runs.AddAsync(Intento(datasetId, inicio.AddMinutes(i), i % 2 == 0), CancellationToken.None);
        }

        await runs.AddAsync(Intento(otro, inicio, ok: true), CancellationToken.None);

        var recientes = await runs.GetRecentAsync(datasetId, 100, CancellationToken.None);
        Assert.Equal(ReportRefreshService.RunHistoryLimit, recientes.Count);
        Assert.Equal(inicio.AddMinutes(ReportRefreshService.RunHistoryLimit + 4), recientes[0].StartedAtUtc);
        Assert.Equal(ReportRunStatus.Succeeded, recientes[0].Status);
        Assert.Equal("Metas", recientes[1].Sources.Single().Alias);

        // Podar un conjunto no toca los intentos de otro.
        Assert.Single(await runs.GetRecentAsync(otro, 5, CancellationToken.None));

        static ReportRun Intento(Guid datasetId, DateTimeOffset started, bool ok) => new()
        {
            Id = Guid.NewGuid(),
            DatasetId = datasetId,
            DefinitionVersion = 1,
            Origin = ReportRunOrigin.Manual,
            Status = ok ? ReportRunStatus.Succeeded : ReportRunStatus.Failed,
            StartedAtUtc = started,
            CompletedAtUtc = started.AddSeconds(2),
            Message = ok ? null : "No se pudo leer alguna fuente.",
            Sources = [new ReportRunSource("Metas", ok ? null : "database-error", null, 2, false, started, started)],
        };
    }

    [Fact]
    public void ElEsquemaComparadoCuentaLoQueFaltaCambiaYSobra()
    {
        ReportExpectedColumn[] esperado = [new("mes", "DateOnly"), new("municipio", "String"), new("meta", "Decimal")];
        ResultColumn[] actual = [Column<DateOnly>("mes", 0), Column<int>("municipio", 1), Column<string>("region", 2)];

        var cambios = ReportDatasetPreviewService.CompareSchema(esperado, actual);

        Assert.Equal(
            [
                new ReportSchemaChange("municipio", ReportSchemaChangeKind.TypeChanged, "String", "Int32"),
                new ReportSchemaChange("meta", ReportSchemaChangeKind.Missing, "Decimal", null),
                new ReportSchemaChange("region", ReportSchemaChangeKind.Added, null, "String"),
            ],
            cambios);
        Assert.Empty(ReportDatasetPreviewService.CompareSchema([], actual));
    }

    private static ReportDataset Dataset() => new()
    {
        Id = Guid.Parse("8b0f3c55-21d4-4c6e-9d8e-3f5b9f2a1c01"),
        Name = "Ventas y metas",
        Sources =
        [
            new ReportSourceDefinition
            {
                Alias = "Ventas",
                ConnectionId = Guid.Parse("11111111-2222-3333-4444-555555555555"),
                Database = "ventas",
                Mode = ReportSourceMode.Visual,
                Sql = "SELECT mes, municipio, SUM(importe) AS venta FROM ventas GROUP BY mes, municipio",
                VisualModel = """{"table":"ventas","groupBy":["mes","municipio"]}""",
            },
            new ReportSourceDefinition
            {
                Alias = "Metas",
                ConnectionId = Guid.Parse("66666666-7777-8888-9999-000000000000"),
                Database = "metas",
                Mode = ReportSourceMode.Sql,
                Sql = "SELECT mes, municipio, meta FROM metas",
                ExpectedColumns = [new("mes", "DateOnly"), new("municipio", "String"), new("meta", "Decimal")],
            },
        ],
        Join = new ReportJoinDefinition(PorMesYMunicipio, ReportJoinKind.Left, ReportJoinCardinality.ManyToOne),
    };

    private static TypedQueryResult Data(ResultColumn[] columns, IReadOnlyList<IReadOnlyList<object?>> rows) =>
        new(columns, rows, Truncated: false);

    private static ResultColumn Column<T>(string name, int ordinal) =>
        new() { Name = name, DataType = typeof(T).Name, ClrType = typeof(T).Name, Ordinal = ordinal };

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan delta) => _now += delta;
    }
}
