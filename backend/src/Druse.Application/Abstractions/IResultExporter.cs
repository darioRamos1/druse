using Druse.Database.Abstractions;

namespace Druse.Application.Abstractions;

/// <summary>Formatos a los que se puede exportar un resultado.</summary>
public enum ExportFormat
{
    Csv = 0,
    Xlsx = 1,
}

/// <summary>
/// Codificación del archivo CSV.
///
/// Se ofrece elección porque Excel en Windows abre los CSV con la página de
/// códigos del sistema salvo que encuentre una marca BOM, y un archivo UTF-8 sin
/// ella muestra los acentos rotos. `Utf8Bom` es lo que casi siempre se quiere;
/// `Utf8` sirve para procesar el archivo con otras herramientas.
/// </summary>
public enum CsvEncoding
{
    Utf8Bom = 0,
    Utf8 = 1,
    Latin1 = 2,
}

/// <summary>Opciones de una exportación.</summary>
public sealed record ExportOptions
{
    public ExportFormat Format { get; init; } = ExportFormat.Csv;

    public CsvEncoding Encoding { get; init; } = CsvEncoding.Utf8Bom;

    /// <summary>Separador de campos. La coma no sirve en configuraciones donde el decimal es coma.</summary>
    public char Delimiter { get; init; } = ',';

    public bool IncludeHeaders { get; init; } = true;

    /// <summary>Texto con el que se representa un nulo. Vacío lo hace indistinguible de la cadena vacía.</summary>
    public string NullText { get; init; } = string.Empty;

    /// <summary>Tope de filas. Protege de exportar sin querer una tabla entera.</summary>
    public int MaxRows { get; init; } = 1_000_000;
}

/// <summary>Resultado de exportar.</summary>
public readonly record struct ExportResult(long RowCount, bool Truncated);

/// <summary>
/// Escribe un resultado en un archivo.
///
/// Recibe el lector, no una lista de filas: exportar debe poder recorrer
/// millones de registros sin que crezca la memoria del proceso (plan §6).
/// </summary>
public interface IResultExporter
{
    ExportFormat Format { get; }

    /// <summary>Extensión del archivo, sin el punto.</summary>
    string FileExtension { get; }

    string ContentType { get; }

    Task<ExportResult> WriteAsync(
        IQueryResultReader reader,
        Stream destination,
        ExportOptions options,
        CancellationToken cancellationToken);
}
