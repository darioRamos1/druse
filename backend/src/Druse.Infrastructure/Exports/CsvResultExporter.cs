using System.Text;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;

namespace Druse.Infrastructure.Exports;

/// <summary>
/// Exporta a CSV según RFC 4180.
///
/// Se escribe a mano en lugar de usar una biblioteca porque el formato son
/// cuatro reglas y añadir una dependencia para esto habría que justificarlo
/// (plan §13). Las cuatro reglas están en <see cref="WriteField"/>.
/// </summary>
public sealed class CsvResultExporter : IResultExporter
{
    public ExportFormat Format => ExportFormat.Csv;

    public string FileExtension => "csv";

    public string ContentType => "text/csv";

    public async Task<ExportResult> WriteAsync(
        IQueryResultReader reader,
        Stream destination,
        ExportOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reader);
        ArgumentNullException.ThrowIfNull(destination);
        ArgumentNullException.ThrowIfNull(options);

        var encoding = Resolve(options.Encoding);

        // `leaveOpen` para que quien abrió el destino decida cuándo cerrarlo.
        await using var writer = new StreamWriter(destination, encoding, leaveOpen: true);

        if (options.IncludeHeaders)
        {
            await WriteRowAsync(
                writer,
                reader.Columns.Select(column => column.Name).ToArray(),
                options,
                cancellationToken);
        }

        long rows = 0;
        var truncated = false;

        await foreach (var row in reader.ReadRowsAsync(cancellationToken))
        {
            if (rows >= options.MaxRows)
            {
                truncated = true;
                break;
            }

            await WriteRowAsync(writer, row, options, cancellationToken);
            rows++;
        }

        await writer.FlushAsync(cancellationToken);

        return new ExportResult(rows, truncated);
    }

    private static async Task WriteRowAsync(
        StreamWriter writer,
        IReadOnlyList<string?> values,
        ExportOptions options,
        CancellationToken cancellationToken)
    {
        var line = new StringBuilder();

        for (var index = 0; index < values.Count; index++)
        {
            if (index > 0)
            {
                line.Append(options.Delimiter);
            }

            var value = values[index];

            if (!options.DistinguishNull)
            {
                WriteField(line, value ?? options.NullText, options.Delimiter);
                continue;
            }

            // El nulo se deja en blanco y la cadena vacía se escribe con sus dos
            // comillas. Escritos así, quien relea el archivo puede devolver cada
            // uno a lo que era; con los dos en blanco, no.
            if (value is null)
            {
                continue;
            }

            if (value.Length == 0)
            {
                line.Append(EmptyString);
                continue;
            }

            WriteField(line, value, options.Delimiter);
        }

        // Fin de línea CRLF: es lo que exige el RFC y lo que espera Excel.
        await writer.WriteAsync(line.Append("\r\n").ToString().AsMemory(), cancellationToken);
    }

    /// <summary>La cadena vacía escrita de forma que se distinga de un nulo.</summary>
    private const string EmptyString = "\"\"";

    /// <summary>
    /// Escribe un campo entrecomillándolo solo cuando hace falta.
    ///
    /// Hay que entrecomillar si contiene el separador, comillas o un salto de
    /// línea; dentro, las comillas se duplican. Sin esto, un valor con una coma
    /// desplazaría todas las columnas siguientes de esa fila.
    /// </summary>
    private static void WriteField(StringBuilder line, string value, char delimiter)
    {
        var needsQuotes =
            value.Contains(delimiter) ||
            value.Contains('"') ||
            value.Contains('\n') ||
            value.Contains('\r');

        if (!needsQuotes)
        {
            line.Append(value);
            return;
        }

        line.Append('"');

        foreach (var character in value)
        {
            if (character == '"')
            {
                line.Append('"');
            }

            line.Append(character);
        }

        line.Append('"');
    }

    private static Encoding Resolve(CsvEncoding encoding) => encoding switch
    {
        // Sin BOM, Excel en Windows abre el archivo con la página de códigos del
        // sistema y los acentos salen rotos.
        CsvEncoding.Utf8Bom => new UTF8Encoding(encoderShouldEmitUTF8Identifier: true),
        CsvEncoding.Utf8 => new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
        CsvEncoding.Latin1 => Encoding.Latin1,
        _ => new UTF8Encoding(encoderShouldEmitUTF8Identifier: true),
    };
}
