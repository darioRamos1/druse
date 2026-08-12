using System.Text;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Exports;

namespace Druse.UnitTests;

/// <summary>Lector de prueba con filas fijas, sin base de datos detrás.</summary>
internal sealed class FakeReader(
    IReadOnlyList<string> columnNames,
    IReadOnlyList<string?[]> rows) : IQueryResultReader
{
    public IReadOnlyList<ResultColumn> Columns { get; } =
        [.. columnNames.Select((name, index) => new ResultColumn
        {
            Name = name,
            DataType = "text",
            ClrType = "String",
            Ordinal = index,
        })];

    public async IAsyncEnumerable<IReadOnlyList<string?>> ReadRowsAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken)
    {
        foreach (var row in rows)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return row;
            await Task.Yield();
        }
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

public sealed class CsvResultExporterTests
{
    private static async Task<string> ExportAsync(
        IReadOnlyList<string> columns,
        IReadOnlyList<string?[]> rows,
        ExportOptions? options = null)
    {
        var exporter = new CsvResultExporter();
        using var destination = new MemoryStream();

        await exporter.WriteAsync(
            new FakeReader(columns, rows),
            destination,
            options ?? new ExportOptions(),
            CancellationToken.None);

        // Se lee sin BOM para comparar el texto con comodidad; que el BOM esté
        // se comprueba aparte.
        return new UTF8Encoding(false).GetString(destination.ToArray()).TrimStart('﻿');
    }

    [Fact]
    public async Task EscribeCabecerasYFilas()
    {
        var csv = await ExportAsync(["id", "nombre"], [["1", "Ana"], ["2", "Luis"]]);

        Assert.Equal("id,nombre\r\n1,Ana\r\n2,Luis\r\n", csv);
    }

    [Fact]
    public async Task PuedeOmitirLasCabeceras()
    {
        var csv = await ExportAsync(
            ["id"],
            [["1"]],
            new ExportOptions { IncludeHeaders = false });

        Assert.Equal("1\r\n", csv);
    }

    [Fact]
    public async Task EntrecomillaLosValoresConSeparador()
    {
        var csv = await ExportAsync(["texto"], [["Madrid, España"]]);

        // Sin comillas, la coma desplazaría todas las columnas siguientes.
        Assert.Contains("\"Madrid, España\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DuplicaLasComillasInternas()
    {
        var csv = await ExportAsync(["texto"], [["Dijo \"hola\""]]);

        Assert.Contains("\"Dijo \"\"hola\"\"\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EntrecomillaLosValoresConSaltoDeLinea()
    {
        var csv = await ExportAsync(["texto"], [["primera\nsegunda"]]);

        Assert.Contains("\"primera\nsegunda\"", csv, StringComparison.Ordinal);
        // La fila sigue siendo una sola: el salto va dentro de las comillas.
        Assert.EndsWith("\r\n", csv, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LosNulosSeEscribenVaciosPorDefecto()
    {
        var csv = await ExportAsync(["a", "b"], [["x", null]]);

        Assert.Equal("a,b\r\nx,\r\n", csv);
    }

    [Fact]
    public async Task ElTextoDeNuloEsConfigurable()
    {
        var csv = await ExportAsync(
            ["a", "b"],
            [["x", null]],
            new ExportOptions { NullText = "NULL" });

        // Con vacío, un nulo es indistinguible de una cadena vacía.
        Assert.Equal("a,b\r\nx,NULL\r\n", csv);
    }

    [Fact]
    public async Task AdmiteOtroSeparador()
    {
        var csv = await ExportAsync(
            ["a", "b"],
            [["1", "2"]],
            new ExportOptions { Delimiter = ';' });

        Assert.Equal("a;b\r\n1;2\r\n", csv);
    }

    [Fact]
    public async Task ConPuntoYComaNoEntrecomillaLasComas()
    {
        var csv = await ExportAsync(
            ["texto"],
            [["1,5"]],
            new ExportOptions { Delimiter = ';' });

        // La coma ya no es separador, así que no hay nada que proteger.
        Assert.Equal("texto\r\n1,5\r\n", csv);
    }

    [Fact]
    public async Task RespetaElLimiteDeFilasYLoAvisa()
    {
        var rows = Enumerable.Range(1, 100)
            .Select(n => new string?[] { n.ToString(System.Globalization.CultureInfo.InvariantCulture) })
            .ToList();

        var exporter = new CsvResultExporter();
        using var destination = new MemoryStream();

        var result = await exporter.WriteAsync(
            new FakeReader(["n"], rows),
            destination,
            new ExportOptions { MaxRows = 10 },
            CancellationToken.None);

        Assert.Equal(10, result.RowCount);
        Assert.True(result.Truncated);
    }

    [Fact]
    public async Task NoMarcaRecortadoSiCabeEntero()
    {
        var exporter = new CsvResultExporter();
        using var destination = new MemoryStream();

        var result = await exporter.WriteAsync(
            new FakeReader(["n"], [["1"], ["2"]]),
            destination,
            new ExportOptions { MaxRows = 10 },
            CancellationToken.None);

        Assert.Equal(2, result.RowCount);
        Assert.False(result.Truncated);
    }

    [Fact]
    public async Task EscribeLaMarcaBomPorDefecto()
    {
        var exporter = new CsvResultExporter();
        using var destination = new MemoryStream();

        await exporter.WriteAsync(
            new FakeReader(["a"], [["ñ"]]),
            destination,
            new ExportOptions(),
            CancellationToken.None);

        var bytes = destination.ToArray();

        // Sin BOM, Excel en Windows abre el archivo con la página de códigos del
        // sistema y los acentos salen rotos.
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
    }

    [Fact]
    public async Task PuedeEscribirseSinMarcaBom()
    {
        var exporter = new CsvResultExporter();
        using var destination = new MemoryStream();

        await exporter.WriteAsync(
            new FakeReader(["a"], [["x"]]),
            destination,
            new ExportOptions { Encoding = CsvEncoding.Utf8 },
            CancellationToken.None);

        Assert.NotEqual(0xEF, destination.ToArray()[0]);
    }

    [Fact]
    public async Task ConservaLosAcentos()
    {
        var csv = await ExportAsync(["nombre"], [["Lucía Gómez"]]);

        Assert.Contains("Lucía Gómez", csv, StringComparison.Ordinal);
    }
}

public sealed class XlsxResultExporterTests
{
    [Fact]
    public async Task EscribeUnLibroValido()
    {
        var exporter = new XlsxResultExporter();
        using var destination = new MemoryStream();

        var result = await exporter.WriteAsync(
            new FakeReader(["id", "nombre"], [["1", "Ana"], ["2", null]]),
            destination,
            new ExportOptions { Format = ExportFormat.Xlsx },
            CancellationToken.None);

        Assert.Equal(2, result.RowCount);
        Assert.False(result.Truncated);

        var bytes = destination.ToArray();

        Assert.NotEmpty(bytes);
        // Un XLSX es un ZIP: debe empezar por «PK».
        Assert.Equal([0x50, 0x4B], bytes[..2]);
    }

    [Fact]
    public async Task DeclaraSuTipoDeContenido()
    {
        var exporter = new XlsxResultExporter();

        Assert.Equal("xlsx", exporter.FileExtension);
        Assert.Contains("spreadsheetml", exporter.ContentType, StringComparison.Ordinal);

        await Task.CompletedTask;
    }

    [Fact]
    public async Task RespetaElLimiteDeFilas()
    {
        var rows = Enumerable.Range(1, 50)
            .Select(n => new string?[] { n.ToString(System.Globalization.CultureInfo.InvariantCulture) })
            .ToList();

        var exporter = new XlsxResultExporter();
        using var destination = new MemoryStream();

        var result = await exporter.WriteAsync(
            new FakeReader(["n"], rows),
            destination,
            new ExportOptions { Format = ExportFormat.Xlsx, MaxRows = 5 },
            CancellationToken.None);

        Assert.Equal(5, result.RowCount);
        Assert.True(result.Truncated);
    }
}
