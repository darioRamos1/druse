using Druse.Platform.Abstractions;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>Una carpeta que se puede elegir.</summary>
public sealed record FolderEntryDto
{
    public required string Name { get; init; }

    public required string Path { get; init; }

    /// <summary>`Folder`, `Drive` o `Known`, para poder pintarle su icono.</summary>
    public required string Kind { get; init; }
}

/// <summary>Lo que hay dentro de una carpeta.</summary>
public sealed record FolderListingDto
{
    public required string Path { get; init; }

    public string? Parent { get; init; }

    /// <summary>Separador de este sistema, para componer la ruta en la pantalla.</summary>
    public required string Separator { get; init; }

    public required IReadOnlyList<FolderEntryDto> Folders { get; init; }

    public bool CanWrite { get; init; }

    public string? Error { get; init; }
}

/// <summary>Un destino ya compuesto, con lo que pasaría al usarlo.</summary>
public sealed record FolderTargetDto
{
    public required string Path { get; init; }

    public bool CanWrite { get; init; }

    public bool Exists { get; init; }

    public string? Problem { get; init; }
}

/// <summary>Crear una carpeta desde el selector.</summary>
public sealed record CreateFolderRequest
{
    public required string Parent { get; init; }

    public required string Name { get; init; }
}

/// <summary>
/// Enseña las carpetas del equipo para poder elegir dónde se guarda un respaldo.
///
/// Existe por el navegador: una página no ve el sistema de archivos, así que sin
/// esto la única forma de decir dónde va el archivo es teclear la ruta entera y
/// acertar. La aplicación de escritorio usa su diálogo nativo y no pasa por aquí.
///
/// **Solo carpetas, nunca archivos**, y solo lectura salvo crear una carpeta
/// nueva. La API escucha en loopback y exige token, igual que el resto.
/// </summary>
internal static class FolderEndpoints
{
    public static void MapFolderEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/folders", (IFolderBrowser browser, string? path) =>
            Results.Ok(Listing(browser, string.IsNullOrWhiteSpace(path)
                ? browser.Roots()
                : browser.List(path))))
        .WithName("BrowseFolders");

        app.MapGet("/api/folders/target", (IFolderBrowser browser, string folder, string name) =>
            Results.Ok(Target(browser.Resolve(folder, name))))
        .WithName("ResolveFolderTarget");

        app.MapPost("/api/folders", (IFolderBrowser browser, CreateFolderRequest request) =>
        {
            ArgumentNullException.ThrowIfNull(request);

            var created = browser.Create(request.Parent, request.Name);

            // Un nombre que no vale o una carpeta sin permisos son peticiones
            // mal formadas, no errores del servidor: se devuelven con su motivo
            // para que la pantalla lo enseñe junto al campo.
            return created.Problem is null
                ? Results.Ok(Target(created))
                : Results.BadRequest(Target(created));
        })
        .WithName("CreateFolder");
    }

    private static FolderListingDto Listing(IFolderBrowser browser, FolderListing listing) => new()
    {
        Path = listing.Path,
        Parent = listing.Parent,
        Separator = browser.Separator.ToString(),
        Folders =
        [
            .. listing.Folders.Select(folder => new FolderEntryDto
            {
                Name = folder.Name,
                Path = folder.Path,
                Kind = folder.Kind.ToString(),
            }),
        ],
        CanWrite = listing.CanWrite,
        Error = listing.Error,
    };

    private static FolderTargetDto Target(FolderTarget target) => new()
    {
        Path = target.Path,
        CanWrite = target.CanWrite,
        Exists = target.Exists,
        Problem = target.Problem,
    };
}
