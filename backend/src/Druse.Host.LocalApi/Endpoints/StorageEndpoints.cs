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
        MapSnippets(app);
        MapDiagrams(app);
    }

    /// <summary>
    /// Diagramas guardados, por conexión.
    ///
    /// Lo que viaja en `model` son las decisiones de quien lo armó —qué tablas
    /// entran, dónde están—, nunca el esquema: eso se relee del catálogo al
    /// abrirlo.
    /// </summary>
    private static void MapDiagrams(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/workspace/diagrams", async (
            Guid connectionId,
            IDiagramStore diagrams,
            CancellationToken cancellationToken) =>
            Results.Ok(
                (await diagrams.GetAllAsync(connectionId, cancellationToken))
                    .Select(diagram => diagram.ToDto())))
        .WithName("GetDiagrams");

        app.MapPut("/api/workspace/diagrams/{id:guid}", async (
            Guid id,
            SavedDiagramDto request,
            IDiagramStore diagrams,
            CancellationToken cancellationToken) =>
        {
            var name = request.Name?.Trim() ?? string.Empty;

            // Sin nombre no se vuelve a encontrar en la lista, y sin modelo no
            // hay nada que volver a dibujar.
            if (name.Length == 0 || string.IsNullOrWhiteSpace(request.Model))
            {
                return Results.BadRequest(new { message = "Un diagrama necesita nombre y contenido." });
            }

            await diagrams.SaveAsync((request with { Name = name }).ToDomain(id), cancellationToken);

            return Results.NoContent();
        })
        .WithName("SaveDiagram");

        app.MapDelete("/api/workspace/diagrams/{id:guid}", async (
            Guid id,
            IDiagramStore diagrams,
            CancellationToken cancellationToken) =>
        {
            await diagrams.DeleteAsync(id, cancellationToken);

            return Results.NoContent();
        })
        .WithName("DeleteDiagram");
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
                result.Profile.ToSavedDto(
                    result.PasswordStored,
                    result.SshSecretStored,
                    result.SecretWarning));
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
                result.Profile.ToSavedDto(
                    result.PasswordStored,
                    result.SshSecretStored,
                    result.SecretWarning));
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

            // Hay dos motivos por los que una conexión no lleva contraseña, y los
            // dos hay que contemplarlos antes de pedirla:
            //
            // - **La identidad la pone el sistema**, que es la autenticación de
            //   Windows de SQL Server.
            // - **El motor no tiene usuarios.** SQLite es un archivo: quien puede
            //   leerlo puede leer la base, y no hay credencial que guardar ni que
            //   pedir. Pedirla dejaría el motor entero inservible al reabrir una
            //   conexión guardada, que es justo lo que pasaba.
            var motor = connections.Capabilities(profile);
            var pideContraseña = !profile.UsesIntegratedSecurity && (motor?.RequiresUsername ?? true);

            var credentials = !pideContraseña
                ? new Database.Abstractions.DatabaseCredentials(null)
                : string.IsNullOrEmpty(request?.Password)
                    ? await saved.GetCredentialsAsync(id, cancellationToken)
                    : new Database.Abstractions.DatabaseCredentials(request.Password);

            if (pideContraseña && string.IsNullOrEmpty(credentials.Password))
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

    /// <summary>
    /// Fragmentos de SQL guardados con nombre.
    ///
    /// Se guardan de uno en uno —no como las pestañas, que van juntas—: son
    /// independientes entre sí y guardar uno no puede tocar los demás.
    /// </summary>
    private static void MapSnippets(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/workspace/snippets", async (
            ISqlSnippetStore snippets,
            CancellationToken cancellationToken) =>
            Results.Ok((await snippets.GetAllAsync(cancellationToken)).Select(snippet => snippet.ToDto())))
        .WithName("GetSqlSnippets");

        app.MapPut("/api/workspace/snippets/{id:guid}", async (
            Guid id,
            SqlSnippetDto request,
            ISqlSnippetStore snippets,
            CancellationToken cancellationToken) =>
        {
            var name = request.Name?.Trim() ?? string.Empty;

            // Un fragmento sin nombre no se puede volver a encontrar, y uno sin
            // SQL no tiene nada que insertar: las dos cosas son el fragmento.
            if (name.Length == 0 || string.IsNullOrWhiteSpace(request.Sql))
            {
                return Results.BadRequest(new { message = "Un fragmento necesita nombre y SQL." });
            }

            await snippets.SaveAsync((request with { Name = name }).ToDomain(id), cancellationToken);

            return Results.NoContent();
        })
        .WithName("SaveSqlSnippet");

        app.MapDelete("/api/workspace/snippets/{id:guid}", async (
            Guid id,
            ISqlSnippetStore snippets,
            CancellationToken cancellationToken) =>
        {
            var deleted = await snippets.DeleteAsync(id, cancellationToken);

            return deleted ? Results.NoContent() : Results.NotFound();
        })
        .WithName("DeleteSqlSnippet");
    }
}
