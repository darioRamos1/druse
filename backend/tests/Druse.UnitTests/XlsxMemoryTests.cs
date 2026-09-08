using System.Globalization;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Exports;
using Xunit.Abstractions;

namespace Druse.UnitTests;

/// <summary>
/// Una medición, no una prueba: cuánta memoria pide exportar a XLSX.
///
/// El tope de filas del exportador estaba puesto a ojo —«200 000 cabe
/// holgadamente»— y esa es exactamente la clase de número que hay que medir: si
/// se queda corto, se le niega al usuario algo que su equipo aguanta; si se pasa,
/// el proceso muere a mitad de una exportación larga y se lleva por delante el
/// trabajo de la sesión.
///
/// No corre en cada `dotnet test`: con los tamaños grandes tarda minutos y pide
/// varios gigas, que en un runner compartido es una forma de romper el CI ajeno.
/// Se pide a mano:
///
/// ```powershell
/// $env:DRUSE_MEDIR_XLSX = 1
/// dotnet test backend/tests/Druse.UnitTests -m:1 --filter FullyQualifiedName~XlsxMemoryTests
/// ```
///
/// Lo que se mide es el pico de memoria administrada durante la construcción del
/// libro, que es lo que decide si el proceso sobrevive; los bytes reservados en
/// total van al lado porque explican la presión sobre el recolector.
/// </summary>
public sealed class XlsxMemoryTests(ITestOutputHelper output)
{
    private readonly ITestOutputHelper _output = output;

    /// <summary>Diez columnas de texto corriente: una tabla como las que se exportan.</summary>
    private const int Columns = 10;

    [MeasuresMemoryTheory]
    [InlineData(10_000)]
    [InlineData(50_000)]
    [InlineData(100_000)]
    [InlineData(200_000)]
    public async Task MideLaMemoriaDeUnaExportacion(int rows)
    {
        var exporter = new XlsxResultExporter();

        await using var destination = new MemoryStream();
        await using var reader = new GeneratedReader(Columns, rows);

        // Se parte de un montón limpio para que lo medido sea de esta
        // exportación y no de lo que dejó la anterior.
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);
        GC.WaitForPendingFinalizers();
        GC.Collect(2, GCCollectionMode.Forced, blocking: true);

        var allocatedBefore = GC.GetTotalAllocatedBytes(precise: true);
        var start = DateTime.UtcNow;

        var result = await exporter.WriteAsync(
            reader,
            destination,
            new ExportOptions { MaxRows = rows },
            CancellationToken.None);

        // Sin recolectar: es el montón vivo al terminar de escribir, que es lo
        // más cerca del pico que se puede mirar sin un perfilador.
        var live = GC.GetTotalMemory(forceFullCollection: false);
        var allocated = GC.GetTotalAllocatedBytes(precise: true) - allocatedBefore;
        var elapsed = DateTime.UtcNow - start;

        _output.WriteLine(string.Create(
            CultureInfo.InvariantCulture,
            $"{rows,9:N0} filas x {Columns} columnas | " +
            $"vivo {Megabytes(live),7:N0} MB | reservado {Megabytes(allocated),8:N0} MB | " +
            $"archivo {Megabytes(destination.Length),5:N0} MB | {elapsed.TotalSeconds,6:N1} s"));

        Assert.Equal(rows, result.Rows);
    }

    private static double Megabytes(long bytes) => bytes / 1024d / 1024d;

    /// <summary>
    /// Filas inventadas al vuelo, sin base de datos ni lista en memoria.
    ///
    /// Materializarlas antes de exportar mediría las dos cosas a la vez y el
    /// número no diría nada del exportador. Se reutiliza el mismo array por fila,
    /// que es lo que hace el lector de verdad.
    /// </summary>
    private sealed class GeneratedReader(int columns, int rows) : IQueryResultReader
    {
        private readonly string?[] _buffer = new string?[columns];

        public IReadOnlyList<ResultColumn> Columns { get; } =
            [.. Enumerable.Range(0, columns).Select(index => new ResultColumn
            {
                Name = string.Create(CultureInfo.InvariantCulture, $"columna_{index}"),
                DataType = "text",
                ClrType = "String",
                Ordinal = index,
            })];

        public async IAsyncEnumerable<IReadOnlyList<string?>> ReadRowsAsync(
            [System.Runtime.CompilerServices.EnumeratorCancellation]
            CancellationToken cancellationToken)
        {
            for (var row = 0; row < rows; row++)
            {
                cancellationToken.ThrowIfCancellationRequested();

                for (var column = 0; column < _buffer.Length; column++)
                {
                    // Textos de longitud parecida a la de una tabla de verdad:
                    // ni una letra ni un párrafo.
                    _buffer[column] = string.Create(
                        CultureInfo.InvariantCulture,
                        $"valor-{row}-{column}-relleno");
                }

                yield return _buffer;
            }

            await Task.CompletedTask;
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

/// <summary>
/// Una medición que solo corre cuando se pide.
///
/// Con `DRUSE_MEDIR_XLSX=1`. Sin eso se omite: tarda minutos y reserva varios
/// gigas, y ninguna de las dos cosas cabe en una suite que se ejecuta en cada
/// commit.
/// </summary>
public sealed class MeasuresMemoryTheoryAttribute : TheoryAttribute
{
    public MeasuresMemoryTheoryAttribute()
    {
        if (Environment.GetEnvironmentVariable("DRUSE_MEDIR_XLSX") != "1")
        {
            Skip = "Medición de memoria; se pide con DRUSE_MEDIR_XLSX=1.";
        }
    }
}
