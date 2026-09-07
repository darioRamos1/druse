using Druse.Application.Abstractions;
using Druse.Application.Backups;
using Druse.Domain;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Restauración: mirar un artefacto, aplicarlo y ver cómo va.
///
/// **Mirar y aplicar están separados a propósito**, igual que en el respaldo la
/// vista previa no es una bandera de lanzar. Aquí importa todavía más: entre las
/// dos cosas está la única oportunidad de ver qué se va a sobrescribir.
///
/// Y como el respaldo, la restauración **sobrevive a la petición que la lanzó**:
/// `run` devuelve un identificador y termina, el trabajo sigue en el proceso
/// local y el progreso se pregunta aparte.
/// </summary>
internal static class RestoreEndpoints
{
    public static void MapRestoreEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/restore/inspect", async (
            InspectRestoreDto request,
            RestoreService restore,
            CancellationToken cancellationToken) =>
        {
            var inspection = await restore.InspectAsync(
                request.SessionId,
                request.Path,
                cancellationToken);

            return Results.Ok(inspection.ToDto());
        })
        .WithName("InspectRestore");

        app.MapPost("/api/restore/run", async (
            RestoreRequestDto request,
            RestoreService restore,
            IBackgroundJobs jobs,
            IRestoreTracker tracker,
            ILoggerFactory logs,
            CancellationToken cancellationToken) =>
        {
            // Se vuelve a inspeccionar aunque el cliente ya lo hiciera: entre
            // mirar y aceptar puede haber pasado cualquier cosa, y aplicar un
            // respaldo de otro motor porque nadie volvió a comprobarlo dejaría la
            // base a medias.
            var inspection = await restore.InspectAsync(
                request.SessionId,
                request.Path,
                cancellationToken);

            if (!inspection.CanRestore)
            {
                return Results.Json(
                    new
                    {
                        message = inspection.Rejections[0].Message,
                        rejections = inspection.ToDto().Rejections,
                    },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var id = Guid.NewGuid();

            // El token es el del registro y no el de la petición: la petición
            // termina en cuanto se devuelve el identificador.
            var token = tracker.Start(id, CancellationToken.None);

            tracker.Report(new RestoreProgress
            {
                Id = id,
                Step = RestoreStep.Reading,
                StatementsTotal = inspection.Statements,
            });

            // A la cola: la petición termina aquí y la restauración dura lo que
            // dure. El servicio que la ejecuta se resuelve allí, con su propio
            // scope; el de esta petición se cierra al responder.
            jobs.Enqueue(new QueuedJob
            {
                Id = id,
                Kind = JobKind.Restore,
                Subject = request.Path,
                Token = token,
                RunAsync = async (services, cancellationToken) =>
                {
                    var restoring = services.GetRequiredService<RestoreService>();
                    var log = logs.CreateLogger("Druse.Restore");

                    try
                    {
                        var progress = new Progress<RestoreProgress>(state =>
                            tracker.Report(state with { Id = id }));

                        var result = await restoring.RunAsync(
                            new RestoreRequest
                            {
                                SessionId = request.SessionId,
                                Path = request.Path,
                                ResumeFrom = request.ResumeFrom,
                                NewDatabase = request.NewDatabase,
                            },
                            progress,
                            cancellationToken);

                        tracker.Report(result with { Id = id });

                        return result.Outcome.ToString();
                    }
                    catch (Exception error)
                    {
                        // Lo que llega aquí es lo que el servicio no supo contar.
                        // Sin este registro, la restauración se quedaría «en
                        // marcha» para siempre en la pantalla de quien la lanzó.
                        log.LogError(error, "La restauración {Id} terminó con un error no previsto.", id);

                        tracker.Report(new RestoreProgress
                        {
                            Id = id,
                            Step = RestoreStep.Done,
                            Outcome = RestoreOutcome.Failed,
                            Failure = new RestoreFailure(0, string.Empty, error.Message),
                        });

                        return nameof(RestoreOutcome.Failed);
                    }
                    finally
                    {
                        tracker.Finish(id);
                    }
                },
            });

            return Results.Accepted($"/api/restore/{id}/status", new { id });
        })
        .WithName("RunRestore");

        app.MapGet("/api/restore/{id:guid}/status", (Guid id, IRestoreTracker tracker) =>
        {
            var progress = tracker.Find(id);

            return progress is null ? Results.NotFound() : Results.Ok(progress.ToDto());
        })
        .WithName("GetRestoreStatus");

        app.MapPost("/api/restore/{id:guid}/cancel", (Guid id, IRestoreTracker tracker) =>
            tracker.Cancel(id) ? Results.Accepted() : Results.NotFound())
        .WithName("CancelRestore");
    }
}
