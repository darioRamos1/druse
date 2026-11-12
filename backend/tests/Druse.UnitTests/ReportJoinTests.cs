using System.Data;
using Druse.Application.Reports;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.UnitTests;

public sealed class ReportJoinTests
{
    [Fact]
    public async Task LeeTiposYDetectaSiElLimiteDejoFilasFuera()
    {
        using var table = new DataTable { Locale = System.Globalization.CultureInfo.InvariantCulture };
        table.Columns.Add("codigo", typeof(string));
        table.Columns.Add("mes", typeof(DateTime));
        table.Columns.Add("ventas", typeof(decimal));
        table.Rows.Add("05001", new DateTime(2026, 1, 1), 80.25m);
        table.Rows.Add("11001", new DateTime(2026, 1, 1), DBNull.Value);
        var columns = new[]
        {
            Column<string>("codigo", 0),
            Column<DateTime>("mes", 1) with { DataType = "date" },
            Column<decimal>("ventas", 2),
        };

        using var fullReader = table.CreateDataReader();
        var full = await TypedQueryResult.ReadAsync(fullReader, columns, 2, CancellationToken.None);
        Assert.False(full.Truncated);
        Assert.Equal("05001", full.Rows[0][0]);
        Assert.Equal(new DateOnly(2026, 1, 1), full.Rows[0][1]);
        Assert.Equal(80.25m, full.Rows[0][2]);
        Assert.Null(full.Rows[1][2]);

        using var sampleReader = table.CreateDataReader();
        var sample = await TypedQueryResult.ReadAsync(sampleReader, columns, 1, CancellationToken.None);
        Assert.True(sample.Truncated);
        Assert.Single(sample.Rows);
    }

    [Fact]
    public async Task TruncaUnaFuenteAnchaAntesDeLlegarAlLimiteDeFilas()
    {
        using var table = new DataTable { Locale = System.Globalization.CultureInfo.InvariantCulture };
        table.Columns.Add("detalle", typeof(string));
        var text = new string('a', 8 * 1024);
        const int total = 2_500;
        for (var index = 0; index < total; index++)
        {
            table.Rows.Add(text);
        }

        using var reader = table.CreateDataReader();
        var result = await TypedQueryResult.ReadAsync(
            reader, [Column<string>("detalle", 0)], total, CancellationToken.None);

        Assert.True(result.Truncated);
        Assert.InRange(result.Rows.Count, 1, total - 1);
    }

    [Fact]
    public void UnePorMesYMunicipioYCuentaLosRegistrosSinCoincidencia()
    {
        var enero = new DateOnly(2026, 1, 1);
        var febrero = new DateOnly(2026, 2, 1);
        var sales = Data(
            [[enero, "05001", 80m], [enero, "08001", 100m], [enero, "11001", 40m], [febrero, null, 20m]]);
        var goals = Data(
            [[enero, "05001", 100m], [enero, "08001", 200m], [febrero, "05001", 200m], [febrero, null, 10m]]);

        var result = ReportJoin.Combine(sales, goals, Keys, ReportJoinKind.Left, CancellationToken.None);

        Assert.Equal(4, result.Rows.Count);
        Assert.Equal(100m, result.Rows[0][5]);
        Assert.Null(result.Rows[2][5]);
        Assert.Null(result.Rows[3][5]);
        Assert.Equal(2, result.UnmatchedLeftRows);
        Assert.Equal(2, result.UnmatchedRightRows);
        Assert.Equal("derecha.valor", result.Columns[5].Name);
        Assert.Equal(5, result.Columns[5].Ordinal);

        var inner = ReportJoin.Combine(sales, goals, Keys, ReportJoinKind.Inner, CancellationToken.None);
        Assert.Equal(2, inner.Rows.Count);
        Assert.Equal(220m, result.Rows.Where(row => Equals(row[0], enero))
            .Sum(row => Assert.IsType<decimal>(row[2])));
        Assert.Equal(0.60m, inner.Rows.Sum(row => Assert.IsType<decimal>(row[2]))
            / inner.Rows.Sum(row => Assert.IsType<decimal>(row[5])));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void RechazaClavesDuplicadasEnCualquieraDeLasFuentes(bool duplicateLeft)
    {
        var enero = new DateOnly(2026, 1, 1);
        var unique = Data([[enero, "05001", 80m]]);
        var duplicated = Data([[enero, "05001", 100m], [enero, "05001", 101m]]);

        var error = Assert.Throws<ReportJoinDuplicateKeysException>(() => ReportJoin.Combine(
            duplicateLeft ? duplicated : unique, duplicateLeft ? unique : duplicated,
            Keys, ReportJoinKind.Left, CancellationToken.None));

        Assert.Contains("duplicadas", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void RechazaUnaFuenteTruncadaYClavesDeTipoIncompatible()
    {
        var source = Data([]);
        var truncated = source with { Truncated = true };
        var incompatible = source with
        {
            Columns = [Column<DateOnly>("mes", 0), Column<int>("municipio", 1), Column<decimal>("valor", 2)],
        };

        Assert.Contains("truncada", Assert.Throws<ReportProblemException>(() => ReportJoin.Combine(
            source, truncated, Keys, ReportJoinKind.Left, CancellationToken.None)).Message, StringComparison.Ordinal);
        Assert.Contains("tipos distintos", Assert.Throws<ReportProblemException>(() => ReportJoin.Combine(
            source, incompatible, Keys, ReportJoinKind.Left, CancellationToken.None)).Message, StringComparison.Ordinal);
    }

    private static readonly ReportJoinKey[] Keys = [new("mes", "mes"), new("municipio", "municipio")];

    private static TypedQueryResult Data(IReadOnlyList<IReadOnlyList<object?>> rows) =>
        new([Column<DateOnly>("mes", 0), Column<string>("municipio", 1), Column<decimal>("valor", 2)],
            rows, Truncated: false);

    private static ResultColumn Column<T>(string name, int ordinal) =>
        new() { Name = name, DataType = typeof(T).Name, ClrType = typeof(T).Name, Ordinal = ordinal };
}
