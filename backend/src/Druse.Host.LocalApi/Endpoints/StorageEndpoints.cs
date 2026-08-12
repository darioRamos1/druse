using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Domain;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Endpoints de conexiones guardadas, historial y preferencias.
///
/// Ninguna respuesta lleva contraseñas: como mucho, un indicador de si hay una
/// guardada (plan §7 y §12).
/// </summary>
internal static class StorageEndpoints
{
    public static void MapStorageEndpoints(this IEndpointRouteBuilder app)
    {
        MapConnections(app);
        MapHistory(app);
        MapPreferences(app);
    }

    private static void MapConnections(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/connections", async (
            SavedConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profiles = await connections.GetAllAsync(cancellationToken);
            var result = new List<SavedConnectionDto>(profiles.Count);

            foreach (var profile in profiles)
            {
                result.Add(profile.ToSavedDto(
                    await connections.HasStoredPasswordAsync(profile.Id, cancellationToken)));
            }

            return Results.Ok(result);
        })
        .WithName("GetConnections");

        app.MapGet("/api/connections/secret-store", (SavedConnectionService connections) =>
            Results.Ok(new SecretStoreStatusDto
            {
                Available = connections.CanStorePasswords,
                Description = connections.SecretStoreDescription,
            }))
        .WithName("GetSecretStoreStatus");

        app.MapPost("/api/connections", async (
            SaveConnectionRequest request,
            SavedConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profile = request.Profile.ToDomain();

            var result = await connections.SaveAsync(
                profile,
                request.Password,
                request.StorePassword,
                cancellationToken);

            return Results.Created(
                $"/api/connections/{result.Profile.Id}",
                result.Profile.ToSavedDto(result.PasswordStored));
        })
        .WithName("CreateConnection");

        app.MapPut("/api/connections/{id:guid}", async (
            Guid id,
            SaveConnectionRequest request,
            SavedConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var existing = await connections.FindAsync(id, cancellationToken);

            if (existing is null)
            {
                return Results.NotFound();
            }

            // El identificador manda el de la ruta, no el del cuerpo: si no
            // coincidieran, se estaría creando un perfil nuevo por accidente.
            var profile = request.Profile.ToDomain() with { Id = id };

            var result = await connections.SaveAsync(
                profile,
                request.Password,
                request.StorePassword,
                cancellationToken);

            return Results.Ok(result.Profile.ToSavedDto(result.PasswordStored));
        })
        .WithName("UpdateConnection");

        app.MapDelete("/api/connections/{id:guid}", async (
            Guid id,
            SavedConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var deleted = await connections.DeleteAsync(id, cancellationToken);

            return deleted ? Results.NoContent() : Results.NotFound();
        })
        .WithName("DeleteConnection");

        // Abre sesión con un perfil guardado. La contraseña sale del almacén del
        // sistema; si no hay ninguna guardada, el cliente debe enviarla.
        app.MapPost("/api/connections/{id:guid}/sessions", async (
            Guid id,
            OpenSavedSessionRequest? request,
            SavedConnectionService saved,
            ConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profile = await saved.FindAsync(id, cancellationToken);

            if (profile is null)
            {
                return Results.NotFound();
            }

            var credentials = string.IsNullOrEmpty(request?.Password)
                ? await saved.GetCredentialsAsync(id, cancellationToken)
                : new Database.Abstractions.DatabaseCredentials(request.Password);

            if (string.IsNullOrEmpty(credentials.Password))
            {
                return Results.Json(
                    new { message = "Esta conexión no tiene contraseña guardada.", requiresPassword = true },
                    statusCode: StatusCodes.Status428PreconditionRequired);
            }

            var session = await connections.OpenAsync(profile, credentials, cancellationToken);

            return Results.Created($"/api/sessions/{session.Id}", session.ToResponse());
        })
        .WithName("OpenSavedSession");
    }

    private static void MapHistory(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/history", async (
            IQueryHistoryStore history,
            CancellationToken cancellationToken,
            int? limit,
            string? search) =>
        {
            var entries = await history.GetRecentAsync(limit ?? 100, search, cancellationToken);

            return Results.Ok(entries.Select(entry => entry.ToDto()));
        })
        .WithName("GetHistory");

        app.MapDelete("/api/history", async (
            IQueryHistoryStore history,
            CancellationToken cancellationToken) =>
        {
            var removed = await history.ClearAsync(cancellationToken);

            return Results.Ok(new { removed });
        })
        .WithName("ClearHistory");
    }

    private static void MapPreferences(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/preferences", async (
            IPreferencesStore preferences,
            CancellationToken cancellationToken) =>
            Results.Ok(await preferences.GetAllAsync(cancellationToken)))
        .WithName("GetPreferences");

        app.MapPut("/api/preferences/{key}", async (
            string key,
            PreferenceValueDto value,
            IPreferencesStore preferences,
            CancellationToken cancellationToken) =>
        {
            await preferences.SetAsync(key, value.Value, cancellationToken);

            return Results.NoContent();
        })
        .WithName("SetPreference");
    }
}
