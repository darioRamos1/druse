using System.Text;
using Druse.Application.Abstractions;

namespace Druse.Infrastructure.Importing;

/// <summary>
/// Lee un CSV según el RFC 4180, que es el mismo con el que Druse exporta.
///
/// Está escrito a mano por la misma razón que el exportador: son cuatro reglas
/// —comillas, comillas dobladas, separador dentro de comillas y salto de línea
/// dentro de comillas— y una dependencia para esto habría que justificarla.
///
/// Lo que **no** hace es adivinar. No detecta el separador, ni la codificación,
/// ni qué es un nulo: todo eso lo dice el usuario en las opciones, porque
/// equivocarse al adivinar sobre un archivo que va a acabar dentro de una tabla
/// es peor que preguntar.
/// </summary>
public sealed class CsvTableFileReader : ITableFileReader
{
    public ImportFormat Format => ImportFormat.Csv;

    public async Task<TableFile> ReadAsync(
        Stream file,
        ImportOptions options,
        int maxRows,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(options);

        var encoding = options.Encoding switch
        {
            CsvEncoding.Latin1 => Encoding.Latin1,
            _ => new UTF8Encoding(false),
        };

        // `detectEncodingFromByteOrderMarks` se queda activo: si el archivo trae
        // BOM manda el BOM, que es lo que escribe el propio exportador.
        using var reader = new StreamReader(file, encoding, detectEncodingFromByteOrderMarks: true);

        var texto = await reader.ReadToEndAsync(cancellationToken);
        var filas = Parse(texto, options.Delimiter);

        if (filas.Count == 0)
        {
            return new TableFile { Columns = [], Rows = [] };
        }

        var columnas = options.HasHeaders
            ? filas[0].Select((valor, indice) => Nombre(valor, indice)).ToList()
            : Enumerable.Range(1, filas.Max(fila => fila.Count))
                .Select(indice => $"Columna {indice}")
                .ToList();

        var cuerpo = filas.Skip(options.HasHeaders ? 1 : 0).Take(maxRows);

        return new TableFile
        {
            Columns = columnas,
            Rows = [.. cuerpo.Select(fila => Ajustar(fila, columnas.Count, options.NullText))],
        };
    }

    /// <summary>Una columna sin nombre igual necesita uno para poder mapearla.</summary>
    private static string Nombre(string? valor, int indice) =>
        string.IsNullOrWhiteSpace(valor) ? $"Columna {indice + 1}" : valor.Trim();

    /// <summary>
    /// Iguala la fila al número de columnas.
    ///
    /// Una fila corta se completa con nulos y una larga se recorta: un archivo
    /// con una fila desalineada no debería impedir importar las demás, y el
    /// usuario lo verá en la previsualización.
    /// </summary>
    private static string?[] Ajustar(
        List<string> fila,
        int columnas,
        string nullText)
    {
        var valores = new string?[columnas];

        for (var i = 0; i < columnas; i++)
        {
            if (i >= fila.Count)
            {
                valores[i] = null;
                continue;
            }

            var valor = fila[i];

            valores[i] = nullText.Length > 0 && valor == nullText ? null : valor;
        }

        return valores;
    }

    /// <summary>
    /// Parte el texto en filas y campos.
    ///
    /// Se recorre carácter a carácter porque partir por comas y saltos de línea
    /// rompe en cuanto un campo contiene cualquiera de los dos, que es
    /// exactamente lo que las comillas del RFC existen para permitir.
    /// </summary>
    private static List<List<string>> Parse(string texto, char delimiter)
    {
        var filas = new List<List<string>>();
        var fila = new List<string>();
        var campo = new StringBuilder();
        var entreComillas = false;

        for (var i = 0; i < texto.Length; i++)
        {
            var c = texto[i];

            if (entreComillas)
            {
                if (c != '"')
                {
                    campo.Append(c);
                    continue;
                }

                // Dos comillas seguidas son una comilla dentro del campo.
                if (i + 1 < texto.Length && texto[i + 1] == '"')
                {
                    campo.Append('"');
                    i++;
                    continue;
                }

                entreComillas = false;
                continue;
            }

            switch (c)
            {
                case '"' when campo.Length == 0:
                    entreComillas = true;
                    break;

                case '\r':
                    // Se ignora: el salto lo marca el \n que viene detrás.
                    break;

                case '\n':
                    fila.Add(campo.ToString());
                    campo.Clear();
                    filas.Add(fila);
                    fila = [];
                    break;

                default:
                    if (c == delimiter)
                    {
                        fila.Add(campo.ToString());
                        campo.Clear();
                    }
                    else
                    {
                        campo.Append(c);
                    }

                    break;
            }
        }

        // Lo que quede sin salto de línea final también es una fila.
        if (campo.Length > 0 || fila.Count > 0)
        {
            fila.Add(campo.ToString());
            filas.Add(fila);
        }

        return filas;
    }
}
