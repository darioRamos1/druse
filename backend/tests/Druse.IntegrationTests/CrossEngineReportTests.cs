using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Druse.IntegrationTests;

public sealed class CrossEngineReportTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    [RequiresTwoEnginesFact]
    public async Task CruzaVentasDeSqlServerYMetasDePostgreSql()
    {
        using var scope = factory.Services.CreateScope();
        var reports = scope.ServiceProvider.GetRequiredService<ReportQueryService>();
        var started = DateTimeOffset.UtcNow;
        var sales = await reports.ReadAsync(
            new ConnectionProfile
            {
                Id = Guid.NewGuid(),
                Name = "Ventas de prueba",
                Engine = DatabaseEngine.SqlServer,
                Host = TestSqlServer.Host,
                Port = TestSqlServer.Port,
                Database = TestSqlServer.Database,
                Username = TestSqlServer.Username,
                SslMode = SslMode.Require,
            },
            new DatabaseCredentials(TestSqlServer.Password), default,
            """
            SELECT CAST('2026-01-01' AS date) AS mes, municipio, CAST(importe AS decimal(10,2)) AS importe
            FROM (VALUES ('05001', 80), ('08001', 100), ('11001', 40)) AS ventas(municipio, importe)
            ORDER BY municipio
            """,
            CancellationToken.None);
        var goals = await reports.ReadAsync(
            new ConnectionProfile
            {
                Id = Guid.NewGuid(),
                Name = "Metas de prueba",
                Engine = DatabaseEngine.PostgreSql,
                Host = TestDatabase.Host,
                Port = TestDatabase.Port,
                Database = TestDatabase.Database,
                Username = TestDatabase.Username,
            },
            new DatabaseCredentials(TestDatabase.Password), default,
            """
            SELECT DATE '2026-01-01' AS mes, municipio, importe::numeric(10,2) AS meta
            FROM (VALUES ('05001', 100), ('08001', 200)) AS metas(municipio, importe)
            """,
            CancellationToken.None);

        var dataset = new ReportDatasetJoin(Guid.NewGuid(), 1,
            [new("mes", "mes"), new("municipio", "municipio")], ReportJoinKind.Left);
        var snapshots = scope.ServiceProvider.GetRequiredService<ReportSnapshotService>();
        Assert.True(await snapshots.CombineAndSaveAsync(
            dataset, new ReportReadWindow(started, DateTimeOffset.UtcNow), sales, goals, CancellationToken.None));

        var store = scope.ServiceProvider.GetRequiredService<IReportSnapshotStore>();
        var snapshot = await store.FindAsync(dataset.DatasetId, CancellationToken.None);
        Assert.NotNull(snapshot);
        var result = snapshot.Result;

        Assert.Equal(3, result.Rows.Count);
        Assert.Equal("05001", Assert.IsType<string>(result.Rows[0][1]));
        Assert.Equal(new DateOnly(2026, 1, 1), Assert.IsType<DateOnly>(result.Rows[0][0]));
        Assert.Equal(220m, result.Rows.Sum(row => Assert.IsType<decimal>(row[2])));
        Assert.Equal(1, result.UnmatchedLeftRows);
        Assert.Null(result.Rows[2][5]);

        var matched = result.Rows.Where(row => row[5] is not null).ToArray();
        var achievement = matched.Sum(row => Assert.IsType<decimal>(row[2]))
            / matched.Sum(row => Assert.IsType<decimal>(row[5]));
        Assert.Equal(0.60m, achievement);
    }
}
