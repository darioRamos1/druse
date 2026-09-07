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

    /// <summary>
    /// Si un nulo y una cadena vacía tienen que poder distinguirse al releer el
    /// archivo.
    ///
    /// Con esto activado el nulo se deja en blanco y la cadena vacía se escribe
    /// entrecomillada, que es lo que hace `COPY ... WITH CSV` de PostgreSQL y la
    /// única forma de devolver los dos valores tal como estaban. Lo usa el
    /// respaldo, donde el archivo se va a volver a meter en una base.
    ///
    /// No se activa siempre porque una exportación normal acaba en una hoja de
    /// cálculo: ahí `NullText` es una decisión de presentación —«(nulo)», «N/A»,
    /// nada— y unas comillas de más se ven.
    ///
    /// Manda sobre <see cref="NullText"/>: representar el nulo con un texto lo
    /// vuelve indistinguible de un dato que diga eso mismo.
    /// </summary>
    public bool DistinguishNull { get; init; }

    /// <summary>
    /// Neutraliza los valores que una hoja de cálculo tomaría por fórmula.
    ///
    /// Excel y sus parientes interpretan como fórmula cualquier celda que empiece
    /// por `=`, `+`, `-` o `@`, y una fórmula puede llamar a funciones que traen
    /// datos de fuera o piden abrir un programa. Ese texto no lo escribió Druse:
    /// **está en la base de datos**, y basta con que alguien haya podido escribir
    /// una fila para que llegue hasta aquí.
    ///
    /// Con esto activado, esos valores salen entrecomillados y con un apóstrofo
    /// delante, que es lo que las hojas de cálculo entienden por «esto es texto».
    /// El dato cambia —el apóstrofo se ve en un editor de texto— y por eso **no
    /// se activa en los respaldos**: allí el archivo se vuelve a meter en una base
    /// y tiene que volver tal cual salió.
    /// </summary>
    public bool EscapeFormulas { get; init; }

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
