namespace Druse.Application.Abstractions;

/// <summary>Formatos que se pueden importar. Los mismos a los que se exporta.</summary>
public enum ImportFormat
{
    Csv = 0,
    Xlsx = 1,
}

/// <summary>Cómo leer el archivo.</summary>
public sealed record ImportOptions
{
    public ImportFormat Format { get; init; } = ImportFormat.Csv;

    /// <summary>
    /// La primera fila trae los nombres de las columnas.
    ///
    /// Si no, las columnas se llaman por su posición y hay que mapearlas a mano.
    /// </summary>
    public bool HasHeaders { get; init; } = true;

    public char Delimiter { get; init; } = ',';

    public CsvEncoding Encoding { get; init; } = CsvEncoding.Utf8Bom;

    /// <summary>
    /// Texto que representa un nulo en el archivo.
    ///
    /// Vacío significa que una celda vacía es una cadena vacía, no un nulo: en un
    /// archivo hecho a mano las dos cosas se escriben igual y solo quien lo
    /// generó sabe cuál quería.
    /// </summary>
    public string NullText { get; init; } = string.Empty;
}

/// <summary>Contenido tabular de un archivo, ya leído.</summary>
public sealed record TableFile
{
    /// <summary>Nombres de las columnas del archivo, en su orden.</summary>
    public required IReadOnlyList<string> Columns { get; init; }

    /// <summary>Filas leídas. `null` en una celda es un nulo, no una cadena vacía.</summary>
    public required IReadOnlyList<IReadOnlyList<string?>> Rows { get; init; }

    /// <summary>
    /// El archivo tenía más filas de las que se leyeron.
    ///
    /// Se corta **mientras se lee**, no después: un archivo de dos gigas no cabe
    /// en memoria, y leerlo entero para quedarse con las primeras mil es la forma
    /// de tumbar el proceso justo cuando el usuario está probando una
    /// importación.
    /// </summary>
    public bool Truncated { get; init; }
}

/// <summary>
/// Lee un archivo tabular.
///
/// Devuelve texto sin interpretar a propósito: convertir cada valor al tipo de
/// su columna exige saber a qué tabla va, y eso lo decide el caso de uso, no
/// quien lee el archivo.
/// </summary>
public interface ITableFileReader
{
    ImportFormat Format { get; }

    /// <summary>
    /// Lee hasta <paramref name="maxRows"/> filas.
    ///
    /// El tope existe para la previsualización, que solo necesita las primeras, y
    /// para no cargar en memoria un archivo de un millón de filas por accidente.
    /// </summary>
    Task<TableFile> ReadAsync(
        Stream file,
        ImportOptions options,
        int maxRows,
        CancellationToken cancellationToken);
}
