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
        MapEditorTabs(app);
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
                    await connections.HasStoredPasswordAsync(profile.Id, cancellationToken),
                    await connections.HasStoredSshSecretAsync(profile.Id, cancellationToken)));
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
                cancellationToken,
                request.SshSecret,
                request.StoreSshSecret);

            return Results.Created(
                $"/api/connections/{result.Profile.Id}",
                result.Profile.ToSavedDto(result.PasswordStored, result.SshSecretStored));
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
                cancellationToken,
                request.SshSecret,
                request.StoreSshSecret);

            return Results.Ok(
                result.Profile.ToSavedDto(result.PasswordStored, result.SshSecretStored));
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

            // Con autenticación de Windows no hay contraseña: ni se busca en el
            // almacén ni se pide, porque la identidad la pone la sesión del sistema.
            var credentials = profile.UsesIntegratedSecurity
                ? new Database.Abstractions.DatabaseCredentials(null)
                : string.IsNullOrEmpty(request?.Password)
                    ? await saved.GetCredentialsAsync(id, cancellationToken)
                    : new Database.Abstractions.DatabaseCredentials(request.Password);

            if (!profile.UsesIntegratedSecurity && string.IsNullOrEmpty(credentials.Password))
            {
                return Results.Json(
                    new { message = "Esta conexión no tiene contraseña guardada.", requiresPassword = true },
                    statusCode: StatusCodes.Status428PreconditionRequired);
            }

            // El secreto del túnel sigue el mismo camino que el de la base: lo que
            // manda el cliente pesa más que lo guardado, porque es lo que el
            // usuario acaba de escribir.
            var ssh = string.IsNullOrEmpty(request?.SshSecret)
                ? await saved.GetSshCredentialsAsync(id, cancellationToken)
                : new SshCredentials(request.SshSecret, null);

            ssh = ssh with { VerificationCode = request?.SshVerificationCode };

            if (profile.UsesSshTunnel
                && profile.SshTunnel!.Authentication == SshAuthenticationMode.Password
                && string.IsNullOrEmpty(ssh.Secret))
            {
                return Results.Json(
                    new
                    {
                        message = "Esta conexión no tiene guardada la contraseña de su túnel SSH.",
                        requiresSshSecret = true,
                    },
                    statusCode: StatusCodes.Status428PreconditionRequired);
            }

            var session = await connections.OpenAsync(profile, credentials, ssh, cancellationToken);

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

    /// <summary>
    /// El trabajo sin ejecutar del editor.
    ///
    /// Se guarda entero de una vez y no pestaña a pestaña: es lo que evita que un
    /// cierre a media escritura deje guardado un conjunto que nunca existió.
    /// </summary>
    private static void MapEditorTabs(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/workspace/tabs", async (
            IEditorTabStore tabs,
            CancellationToken cancellationToken) =>
            Results.Ok((await tabs.GetAllAsync(cancellationToken)).Select(tab => tab.ToDto())))
        .WithName("GetEditorTabs");

        app.MapPut("/api/workspace/tabs", async (
            EditorTabDto[] request,
            IEditorTabStore tabs,
            CancellationToken cancellationToken) =>
        {
            await tabs.ReplaceAllAsync([.. request.Select(tab => tab.ToDomain())], cancellationToken);

            return Results.NoContent();
        })
        .WithName("SaveEditorTabs");
    }
}
