using Druse.Application.Abstractions;
using Druse.Application.Backups;
using Druse.Domain;
using Druse.Host.LocalApi.Contracts;
using Druse.Infrastructure.Backups;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Respaldos: lanzar, mirar cómo van y pararlos.
///
/// **El respaldo no viaja por la respuesta.** Lo escribe el proceso local en la
/// ruta que eligió el usuario, porque un archivo de varios gigabytes no puede
/// pasar por la memoria del navegador ni caber dos veces en ella.
///
/// Y por eso el trabajo sobrevive a la petición que lo lanzó: `run` devuelve un
/// identificador y termina, y el progreso se pregunta aparte. Si la ventana se
/// cierra a mitad, el respaldo sigue y quien vuelva lo encuentra donde estaba.
/// </summary>
internal static class BackupEndpoints
{
    public static void MapBackupEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/backup/run", (
            BackupRequestDto request,
            IBackgroundJobs jobs,
            IBackupTracker tracker,
            ILoggerFactory logs) =>
        {
            var domain = request.ToDomain();

            if (!domain.Output.IsValid)
            {
                return Results.Json(
                    new { message = "Los datos en CSV necesitan la salida por carpetas." },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var id = Guid.NewGuid();

            // El token es el del registro y no el de la petición: la petición
            // termina en cuanto se devuelve el identificador, y el respaldo tiene
            // que seguir. Cancelar es lo único que lo para.
            var token = tracker.Start(id, CancellationToken.None);

            IBackupSink sink;

            try
            {
                sink = SinkFor(request, domain.Output);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
                // No poder crear el archivo es un problema del usuario, no del
                // servidor: la carpeta no existe, está protegida o el nombre no
                // vale. Decirlo es más útil que un error genérico.
                tracker.Finish(id);

                return Results.Json(
                    new { message = $"No se puede escribir en «{request.Destination}»: {error.Message}" },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            tracker.Report(Starting(id, domain.Tables.Count));

            // A la cola, no a un `Task.Run` suelto: la petición termina aquí y
            // el respaldo dura lo que dure, así que necesita servicios propios y
            // alguien que sepa que existe.
            jobs.Enqueue(new QueuedJob
            {
                Id = id,
                Kind = JobKind.Backup,
                Subject = request.Destination,
                Token = token,
                RunAsync = async (services, cancellationToken) =>
                {
                    var backups = services.GetRequiredService<BackupService>();
                    var log = logs.CreateLogger("Druse.Backup");

                    try
                    {
                        await using (sink)
                        {
                            var progress = new Progress<BackupProgress>(state =>
                                tracker.Report(state with { Id = id }));

                            var result = await backups.RunAsync(
                                domain,
                                sink,
                                progress,
                                cancellationToken);

                            tracker.Report(result with { Id = id });

                            return result.Outcome.ToString();
                        }
                    }
                    catch (Exception error)
                    {
                        // Lo que llega aquí es lo que el servicio no supo contar:
                        // sin este registro, el respaldo se quedaría «en marcha»
                        // para siempre en la pantalla de quien lo lanzó.
                        log.LogError(error, "El respaldo {Id} terminó con un error no previsto.", id);

                        tracker.Report(Failed(id, domain.Tables.Count, error));

                        return nameof(BackupOutcome.Failed);
                    }
                    finally
                    {
                        tracker.Finish(id);
                    }
                },
            });

            return Results.Accepted($"/api/backup/{id}/status", new { id });
        })
        .WithName("RunBackup");

        app.MapPost("/api/backup/preview", async (
            BackupRequestDto request,
            BackupService backups,
            CancellationToken cancellationToken) =>
        {
            var preview = await backups.PreviewAsync(request.ToDomain(), cancellationToken);

            return Results.Ok(new
            {
                statements = preview.Statements,
                truncated = preview.Truncated,
                warnings = preview.Warnings.Select(warning => new BackupWarningDto
                {
                    Subject = warning.Subject,
                    Message = warning.Message,
                }),
            });
        })
        .WithName("PreviewBackup");

        app.MapGet("/api/backup/{id:guid}/status", (Guid id, IBackupTracker tracker) =>
        {
            var progress = tracker.Find(id);

            return progress is null
                ? Results.NotFound()
                : Results.Ok(progress.ToDto());
        })
        .WithName("GetBackupStatus");

        app.MapPost("/api/backup/{id:guid}/cancel", (Guid id, IBackupTracker tracker) =>
            tracker.Cancel(id) ? Results.Accepted() : Results.NotFound())
        .WithName("CancelBackup");

        MapProfiles(app);
    }

    /// <summary>
    /// Los respaldos guardados para repetirlos.
    ///
    /// Van bajo `/api/backup/profiles` y no en su propia familia porque son el
    /// mismo asunto: lo que se guarda es exactamente lo que `run` recibe, con la
    /// selección todavía sin resolver.
    /// </summary>
    private static void MapProfiles(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/backup/profiles", async (
            BackupProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            var all = await profiles.GetAllAsync(cancellationToken);

            return Results.Ok(all.Select(profile => profile.ToDto()));
        })
        .WithName("GetBackupProfiles");

        app.MapGet("/api/backup/profiles/{id:guid}", async (
            Guid id,
            BackupProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            var profile = await profiles.FindAsync(id, cancellationToken);

            return profile is null ? Results.NotFound() : Results.Ok(profile.ToDto());
        })
        .WithName("GetBackupProfile");

        // Guardar y renombrar son la misma operación, y duplicar es guardar sin
        // identificador: tres botones distintos en la pantalla, un solo camino
        // aquí, porque lo que cambia entre ellos es qué manda el cliente.
        app.MapPost("/api/backup/profiles", async (
            BackupProfileDto request,
            BackupProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.Json(
                    new { message = "El perfil necesita un nombre." },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var existing = request.Id is { } id
                ? await profiles.FindAsync(id, cancellationToken)
                : null;

            var profile = request.ToDomain(existing);

            await profiles.SaveAsync(profile, cancellationToken);

            return Results.Ok(profile.ToDto());
        })
        .WithName("SaveBackupProfile");

        app.MapDelete("/api/backup/profiles/{id:guid}", async (
            Guid id,
            BackupProfileService profiles,
            CancellationToken cancellationToken) =>
            await profiles.DeleteAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound())
        .WithName("DeleteBackupProfile");

        // Abrir un perfil es resolverlo: qué de lo que pedía existe hoy, qué se
        // borró y qué ha aparecido dentro de los esquemas que eligió enteros.
        app.MapPost("/api/backup/profiles/{id:guid}/resolve", async (
            Guid id,
            ResolveBackupProfileDto request,
            BackupProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            var profile = await profiles.FindAsync(id, cancellationToken);

            if (profile is null)
            {
                return Results.NotFound();
            }

            var resolution = await profiles.ResolveAsync(
                profile,
                request.SessionId,
                cancellationToken);

            return Results.Ok(resolution.ToDto());
        })
        .WithName("ResolveBackupProfile");

        // Que un perfil se haya lanzado no lo modifica, así que se anota aparte:
        // guardar el perfil entero al ejecutarlo daría por buenos los cambios que
        // el usuario tuviera a medias en la pantalla.
        app.MapPost("/api/backup/profiles/{id:guid}/ran", async (
            Guid id,
            BackupProfileService profiles,
            CancellationToken cancellationToken) =>
            await profiles.MarkRunAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound())
        .WithName("MarkBackupProfileRun");
    }

    /// <summary>
    /// Qué forma tendrá el artefacto.
    ///
    /// El zip manda sobre el reparto: un `.zip` lleva dentro el árbol de carpetas
    /// aunque se hubiera pedido un archivo suelto, porque comprimir un solo
    /// archivo no aporta nada que no aporte el propio `.sql`.
    /// </summary>
    private static IBackupSink SinkFor(BackupRequestDto request, BackupOutput output) => output switch
    {
        { Compress: true } => new ZipBackupSink(request.Destination),
        { Layout: BackupLayout.FolderByKind } => new FolderBackupSink(request.Destination, output.Overwrite),
        _ => new SingleFileBackupSink(request.Destination),
    };

    private static BackupProgress Starting(Guid id, int tables) => new()
    {
        Id = id,
        Step = BackupStep.Resolving,
        ObjectsTotal = tables,
    };

    private static BackupProgress Failed(Guid id, int tables, Exception error) => new()
    {
        Id = id,
        Step = BackupStep.Done,
        Outcome = BackupOutcome.Failed,
        ObjectsTotal = tables,
        Failure = new BackupFailure(string.Empty, error.Message, null),
    };
}
