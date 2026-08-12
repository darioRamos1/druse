using System.Text.Json;
using Druse.Application.Abstractions;
using Druse.Application.Rows;
using Druse.Domain;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Importación de CSV y XLSX a una tabla.
///
/// Son dos rutas, igual que en la edición de filas: **ver qué va a pasar y
/// hacerlo son cosas distintas**. Aquí la separación importa todavía más, porque
/// una importación mal mapeada no falla, funciona: mete los datos en la columna
/// equivocada y nadie se entera hasta mucho después.
///
/// El archivo llega como `multipart/form-data` y no como JSON en base64: un
/// Excel de diez megas se triplica al codificarlo, y aquí no hay motivo para
/// pagar eso.
/// </summary>
internal static class ImportEndpoints
{
    /// <summary>
    /// Tope de filas que se leen del archivo.
    ///
    /// La previsualización revisa todas las que se van a insertar, así que el
    /// tope es lo que impide que un archivo enorme se cargue entero en memoria.
    /// </summary>
    private const int MaxRows = 100_000;

    public static void MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/imports/preview", async (
            HttpRequest http,
            IEnumerable<ITableFileReader> readers,
            ImportService imports,
            CancellationToken cancellationToken) =>
        {
            var (request, error) = await ReadAsync(http, readers, confirmed: false, cancellationToken);

            if (error is not null)
            {
                return error;
            }

            try
            {
                return Results.Ok(await imports.PreviewAsync(request!, cancellationToken));
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("PreviewImport")
        .DisableAntiforgery();

        app.MapPost("/api/imports", async (
            HttpRequest http,
            IEnumerable<ITableFileReader> readers,
            ImportService imports,
            CancellationToken cancellationToken) =>
        {
            var (request, error) = await ReadAsync(http, readers, confirmed: true, cancellationToken);

            if (error is not null)
            {
                return error;
            }

            try
            {
                var result = await imports.ImportAsync(request!, cancellationToken);

                return Results.Ok(new RowEditResponse
                {
                    RowsAffected = result.RowsAffected,
                    DurationMs = (long)result.Duration.TotalMilliseconds,
                    Statements = result.Statements,
                });
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("Import")
        .DisableAntiforgery();
    }

    /// <summary>
    /// Lee el formulario y el archivo.
    ///
    /// El formato se decide por la extensión y no por el tipo MIME que declare el
    /// navegador, que miente a menudo con los XLSX.
    /// </summary>
    private static async Task<(ImportRequest? Request, IResult? Error)> ReadAsync(
        HttpRequest http,
        IEnumerable<ITableFileReader> readers,
        bool confirmed,
        CancellationToken cancellationToken)
    {
        if (!http.HasFormContentType)
        {
            return (null, Results.BadRequest(new { message = "Falta el archivo que importar." }));
        }

        var form = await http.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");

        if (file is null || file.Length == 0)
        {
            return (null, Results.BadRequest(new { message = "Falta el archivo que importar." }));
        }

        if (!Guid.TryParse(form["sessionId"], out var sessionId))
        {
            return (null, Results.BadRequest(new { message = "Falta la sesión." }));
        }

        var table = JsonSerializer.Deserialize<DatabaseObjectDto>(
            form["table"].ToString(),
            JsonSerializerOptions.Web);

        if (table is null)
        {
            return (null, Results.BadRequest(new { message = "Falta la tabla de destino." }));
        }

        var extension = Path.GetExtension(file.FileName);
        var format = extension.Equals(".xlsx", StringComparison.OrdinalIgnoreCase)
            ? ImportFormat.Xlsx
            : ImportFormat.Csv;

        var options = new ImportOptions
        {
            Format = format,
            HasHeaders = form["hasHeaders"] != "false",
            Delimiter = form["delimiter"].ToString() is { Length: 1 } d ? d[0] : ',',
            Encoding = Enum.TryParse<CsvEncoding>(
                form["encoding"].ToString().Replace("-", string.Empty, StringComparison.Ordinal),
                ignoreCase: true,
                out var encoding)
                ? encoding
                : CsvEncoding.Utf8Bom,
            NullText = form["nullText"].ToString(),
        };

        var reader = readers.FirstOrDefault(candidate => candidate.Format == format);

        if (reader is null)
        {
            return (null, Results.BadRequest(new { message = $"No se puede leer un archivo {extension}." }));
        }

        await using var stream = file.OpenReadStream();
        var content = await reader.ReadAsync(stream, options, MaxRows, cancellationToken);

        var mappings = form["mappings"].ToString() is { Length: > 0 } json
            ? JsonSerializer.Deserialize<List<ColumnMapping>>(json, JsonSerializerOptions.Web) ?? []
            : [];

        return (
            new ImportRequest
            {
                SessionId = sessionId,
                Table = table.ToDomain(),
                File = content,
                Mappings = mappings,
                Confirmed = confirmed,
            },
            null);
    }

    private static IResult Rejected(RowEditRejectedException exception) =>
        Results.Json(
            new RowEditRejectedResponse
            {
                Reason = exception.Rejection.Reason.ToString().ToLowerInvariant(),
                Message = exception.Rejection.Message,
            },
            statusCode: StatusCodes.Status409Conflict);
}
