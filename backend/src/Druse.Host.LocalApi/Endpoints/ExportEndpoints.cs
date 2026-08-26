using System.Globalization;
using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Queries;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Exportación de resultados a CSV y XLSX (plan §7).
///
/// El archivo se escribe directamente sobre la respuesta, sin construirlo antes
/// en memoria ni en disco: una exportación grande no debe hacer crecer el
/// proceso ni dejar restos si el usuario cancela la descarga.
/// </summary>
internal static class ExportEndpoints
{
    private const string RowCountTrailer = "X-Druse-Row-Count";
    private const string TruncatedTrailer = "X-Druse-Truncated";

    public static void MapExportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/exports/csv", (
            ExportRequest request,
            ExportService exports,
            ConnectionService connections,
            HttpContext context,
            CancellationToken cancellationToken) =>
            WriteAsync(request, ExportFormat.Csv, exports, connections, context, cancellationToken))
        .WithName("ExportCsv");

        app.MapPost("/api/exports/xlsx", (
            ExportRequest request,
            ExportService exports,
            ConnectionService connections,
            HttpContext context,
            CancellationToken cancellationToken) =>
            WriteAsync(request, ExportFormat.Xlsx, exports, connections, context, cancellationToken))
        .WithName("ExportXlsx");
    }

    private static async Task<IResult> WriteAsync(
        ExportRequest request,
        ExportFormat format,
        ExportService exports,
        ConnectionService connections,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var domainRequest = request.ToDomain();

        // Se comprueba **antes** de tocar la respuesta: una vez empieza a salir
        // el cuerpo ya no se puede cambiar el código de estado ni las cabeceras.
        var session = connections.Require(domainRequest.SessionId);
        var rejection = ExportService.Validate(QueryContext.From(session), domainRequest);

        if (rejection is not null)
        {
            return Results.Json(rejection.ToResponse(), statusCode: StatusCodes.Status409Conflict);
        }

        var exporter = exports.GetExporter(format);
        var fileName = BuildFileName(request.FileName, exporter.FileExtension);

        context.Response.ContentType = exporter.ContentType;
        context.Response.Headers.ContentDisposition = ContentDisposition(fileName);

        // El recuento de filas solo se conoce al terminar de escribir, y para
        // entonces las cabeceras ya se enviaron. Los trailers existen justo para
        // esto: viajan detrás del cuerpo.
        var supportsTrailers = context.Response.SupportsTrailers();

        if (supportsTrailers)
        {
            context.Response.DeclareTrailer(RowCountTrailer);
            context.Response.DeclareTrailer(TruncatedTrailer);
        }

        var result = await exports.ExportAsync(
            domainRequest,
            request.ToOptions(format),
            context.Response.Body,
            cancellationToken);

        if (supportsTrailers)
        {
            context.Response.AppendTrailer(
                RowCountTrailer,
                result.RowCount.ToString(CultureInfo.InvariantCulture));

            context.Response.AppendTrailer(TruncatedTrailer, result.Truncated ? "true" : "false");
        }

        return Results.Empty;
    }

    /// <summary>
    /// Compone la cabecera con el nombre del archivo.
    ///
    /// **Una cabecera HTTP solo admite ASCII**, y el nombre sale del título de la
    /// pestaña, que casi nunca lo es: en español lleva acentos, y una pestaña
    /// abierta con «Ver DDL» se titula <c>vista · DDL</c>, con un punto medio.
    /// Metido tal cual, Kestrel se niega —«Invalid non-ASCII or control character
    /// in header»— y la exportación entera muere con un error del servidor que no
    /// dice nada de esto. Era lo que rompía exportar tras mirar una vista.
    ///
    /// Se escriben los dos parámetros que define el RFC 6266: <c>filename</c> con
    /// lo que sobrevive en ASCII, para cualquier cliente antiguo, y
    /// <c>filename*</c> con el nombre de verdad en UTF-8. Los navegadores
    /// prefieren el segundo, así que el usuario conserva sus acentos.
    /// </summary>
    private static string ContentDisposition(string fileName)
    {
        var ascii = new string([.. fileName
            .Where(character => character is >= ' ' and < (char)127)
            .Where(character => character is not ('"' or '\\'))]);

        if (ascii.Length == 0)
        {
            ascii = "druse";
        }

        // `EscapeDataString` deja el nombre en porcentajes, que es justo lo que
        // pide `filename*`; el prefijo declara en qué juego de caracteres viene.
        return $"attachment; filename=\"{ascii}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
    }

    /// <summary>
    /// Compone un nombre de archivo seguro.
    ///
    /// El nombre viene del cliente y acaba en una cabecera HTTP: hay que quitar
    /// separadores de ruta, comillas y saltos de línea antes de usarlo.
    /// </summary>
    private static string BuildFileName(string? requested, string extension)
    {
        var stem = string.IsNullOrWhiteSpace(requested)
            ? $"druse-{DateTime.Now:yyyyMMdd-HHmmss}"
            : requested;

        var safe = new string([.. stem
            .Where(character => !Path.GetInvalidFileNameChars().Contains(character))
            .Where(character => character is not ('"' or '\r' or '\n'))]);

        if (safe.Length == 0)
        {
            safe = "druse";
        }

        return safe.EndsWith($".{extension}", StringComparison.OrdinalIgnoreCase)
            ? safe
            : $"{safe}.{extension}";
    }
}
