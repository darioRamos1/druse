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
            BackupService backups,
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

            _ = Task.Run(
                async () =>
                {
                    var log = logs.CreateLogger("Druse.Backup");

                    try
                    {
                        await using (sink)
                        {
                            var progress = new Progress<BackupProgress>(state =>
                                tracker.Report(state with { Id = id }));

                            var result = await backups.RunAsync(domain, sink, progress, token);

                            tracker.Report(result with { Id = id });
                        }
                    }
                    catch (Exception error)
                    {
                        // Lo que llega aquí es lo que el servicio no supo contar:
                        // sin este registro, el respaldo se quedaría «en marcha»
                        // para siempre en la pantalla de quien lo lanzó.
                        log.LogError(error, "El respaldo {Id} terminó con un error no previsto.", id);

                        tracker.Report(Failed(id, domain.Tables.Count, error));
                    }
                    finally
                    {
                        tracker.Finish(id);
                    }
                },
                CancellationToken.None);

            return Results.Accepted($"/api/backup/{id}/status", new { id });
        })
        .WithName("RunBackup");

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
        { Layout: BackupLayout.FolderByKind } => new FolderBackupSink(request.Destination),
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
