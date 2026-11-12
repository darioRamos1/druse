using System.Data;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// Hito 6 de Reportes BI: la lectura tipada deja cada columna con un solo tipo
/// que se sabe guardar, venga del motor que venga.
/// </summary>
public sealed class TypedQueryResultTests
{
    [Fact]
    public async Task SqliteMezclaEnterosYRealesComoRealYNumerosYTextoComoTexto()
    {
        var result = await ReadAsync(
            [("importe", "", typeof(object)), ("codigo", "", typeof(object))],
            [[10L, "05001"], [2.5, 8001L], [null, null]]);

        Assert.Equal(nameof(Double), result.Columns[0].ClrType);
        Assert.Equal([10d, 2.5d, null], result.Rows.Select(row => row[0]));
        Assert.Equal(nameof(String), result.Columns[1].ClrType);
        Assert.Equal(["05001", "8001", null], result.Rows.Select(row => row[1]));
    }

    [Fact]
    public async Task UnaFechaConHoraNoPierdeLaHoraYUnaSinHoraQuedaComoFecha()
    {
        var result = await ReadAsync(
            [("oracle_date", "DATE", typeof(DateTime)), ("mysql_date", "DATE", typeof(DateTime)), ("sqlite_date", "DATE", typeof(string))],
            [
                [new DateTime(2026, 1, 1, 8, 30, 0), new DateTime(2026, 1, 1), "2026-01-01"],
                [new DateTime(2026, 1, 2), new DateTime(2026, 1, 2), "2026-01-02"],
            ]);

        Assert.Equal(nameof(DateTime), result.Columns[0].ClrType);
        Assert.Equal(new DateTime(2026, 1, 1, 8, 30, 0), result.Rows[0][0]);
        Assert.Equal(nameof(DateOnly), result.Columns[1].ClrType);
        Assert.Equal(new DateOnly(2026, 1, 2), result.Rows[1][1]);
        Assert.Equal(nameof(DateOnly), result.Columns[2].ClrType);
        Assert.Equal(new DateOnly(2026, 1, 1), result.Rows[0][2]);
    }

    [Fact]
    public async Task LosEnterosSinSignoSubenAlTipoQueLosContiene()
    {
        var result = await ReadAsync(
            [("pequeno", "TINYINT", typeof(sbyte)), ("grande", "BIGINT UNSIGNED", typeof(ulong)), ("vacio", "INT UNSIGNED", typeof(uint))],
            [[(sbyte)-3, ulong.MaxValue, null]]);

        Assert.Equal(nameof(Int16), result.Columns[0].ClrType);
        Assert.Equal((short)-3, result.Rows[0][0]);
        Assert.Equal(nameof(Decimal), result.Columns[1].ClrType);
        Assert.Equal((decimal)ulong.MaxValue, result.Rows[0][1]);

        // Sin filas que mirar, se traduce el tipo declarado.
        Assert.Equal(nameof(Int64), result.Columns[2].ClrType);
    }

    [Fact]
    public async Task CadaValorCoincideConElTipoDeSuColumna()
    {
        var result = await ReadAsync(
            [("a", "", typeof(object)), ("b", "", typeof(object)), ("c", "", typeof(object))],
            [[1, 1.5m, new byte[] { 1, 2 }], [2L, 3, "x"], ['z', 4L, null]]);

        foreach (var (column, ordinal) in result.Columns.Select((column, ordinal) => (column, ordinal)))
        {
            Assert.Contains(column.ClrType, TypedQueryResult.SupportedTypes);
            Assert.All(result.Rows.Select(row => row[ordinal]).OfType<object>(),
                value => Assert.Equal(column.ClrType, value.GetType().Name));
        }

        Assert.Equal(["1", "2", "z"], result.Rows.Select(row => row[0]));
        Assert.Equal([1.5m, 3m, 4m], result.Rows.Select(row => row[1]));
        Assert.Equal(["0102", "x", null], result.Rows.Select(row => row[2]));
    }

    private static async Task<TypedQueryResult> ReadAsync(
        (string Name, string DataType, Type Type)[] columns, object?[][] rows)
    {
        using var table = new DataTable { Locale = CultureInfo.InvariantCulture };
        foreach (var (name, _, type) in columns)
        {
            table.Columns.Add(name, type);
        }

        foreach (var row in rows)
        {
            table.Rows.Add(row.Select(value => value ?? DBNull.Value).ToArray());
        }

        using var reader = table.CreateDataReader();
        var described = columns
            .Select((column, ordinal) => new ResultColumn
            {
                Name = column.Name,
                DataType = column.DataType,
                ClrType = column.Type.Name,
                Ordinal = ordinal,
            })
            .ToArray();
        return await TypedQueryResult.ReadAsync(reader, described, 100, CancellationToken.None);
    }
}
