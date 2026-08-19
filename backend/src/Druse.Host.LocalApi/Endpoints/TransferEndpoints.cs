using Druse.Application.Abstractions;
using Druse.Application.Rows;
using Druse.Application.Transfers;
using Druse.Domain;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Traslado de datos de una tabla a otra: previsualizarlo, lanzarlo, mirar cómo va
/// y pararlo.
///
/// Sigue la forma de los respaldos y por el mismo motivo: **el trabajo sobrevive a
/// la petición que lo lanzó**. `run` devuelve un identificador y termina, y el
/// progreso se pregunta aparte. Si la ventana se cierra a mitad, la copia sigue y
/// quien vuelva encuentra cuántas filas llegaron.
///
/// Aquí eso pesa todavía más que en un respaldo: lo que queda a medias no es un
/// archivo que se pueda tirar, sino filas en una base ajena.
/// </summary>
internal static class TransferEndpoints
{
    public static void MapTransferEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/transfers/preview", async (
            TransferRequestDto request,
            TransferService transfers,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var preview = await transfers.PreviewAsync(request.ToDomain(), cancellationToken);

                return Results.Ok(preview.ToDto());
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("PreviewTransfer");

        app.MapPost("/api/transfers", (
            TransferRequestDto request,
            TransferService transfers,
            ITransferTracker tracker,
            ILoggerFactory logs) =>
        {
            DataTransferRequest domain;

            try
            {
                domain = request.ToDomain();
            }
            catch (ArgumentException error)
            {
                return Results.Json(
                    new { message = error.Message },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var id = Guid.NewGuid();

            // El token es el del registro y no el de la petición: la petición
            // termina en cuanto se devuelve el identificador, y el traslado tiene
            // que seguir. Cancelar es lo único que lo para.
            var token = tracker.Start(id, CancellationToken.None);

            tracker.Report(Starting(id, domain));

            _ = Task.Run(
                async () =>
                {
                    var log = logs.CreateLogger("Druse.Transfer");

                    try
                    {
                        var progress = new Progress<TransferProgress>(state =>
                            tracker.Report(state with { Id = id }));

                        var result = await transfers.RunAsync(domain, progress, token);

                        tracker.Report(result with { Id = id });
                    }
                    catch (RowEditRejectedException rejected)
                    {
                        // Un rechazo llega hasta aquí cuando se comprueba ya
                        // lanzado el trabajo —la sesión se cerró entre medias, el
                        // destino resultó ser de solo lectura—. Va al estado y no
                        // a la respuesta, que hace rato que se envió.
                        tracker.Report(Failed(id, domain, rejected.Rejection.Message, tracker.Find(id)));
                    }
                    catch (Exception error)
                    {
                        // Lo que llega aquí es lo que el servicio no supo contar:
                        // sin este registro, el traslado se quedaría «en marcha»
                        // para siempre en la pantalla de quien lo lanzó.
                        log.LogError(error, "El traslado {Id} terminó con un error no previsto.", id);

                        tracker.Report(Failed(id, domain, error.Message, tracker.Find(id)));
                    }
                    finally
                    {
                        tracker.Finish(id);
                    }
                },
                CancellationToken.None);

            return Results.Accepted($"/api/transfers/{id}/status", new { id });
        })
        .WithName("RunTransfer");

        app.MapGet("/api/transfers/{id:guid}/status", (Guid id, ITransferTracker tracker) =>
        {
            var progress = tracker.Find(id);

            return progress is null
                ? Results.NotFound()
                : Results.Ok(progress.ToDto());
        })
        .WithName("GetTransferStatus");

        app.MapPost("/api/transfers/{id:guid}/cancel", (Guid id, ITransferTracker tracker) =>
            tracker.Cancel(id) ? Results.Accepted() : Results.NotFound())
        .WithName("CancelTransfer");
    }

    /// <summary>
    /// El primer estado, publicado antes de que el trabajo empiece a correr.
    ///
    /// Sin él, quien pregunta por el progreso justo después de lanzar el traslado
    /// se llevaría un 404 y creería que se perdió.
    /// </summary>
    private static TransferProgress Starting(Guid id, DataTransferRequest request) =>
        new()
        {
            Id = id,
            Step = TransferStep.ReadingStructure,
            Outcome = TransferOutcome.Running,
            CurrentObject = request.Target.Name,
            RowsEstimated = request.Source.ApproximateRowCount,
        };

    /// <summary>
    /// El estado final de un traslado que se rompió por donde nadie contaba.
    ///
    /// Parte de lo último que se supo y no de cero: las filas que ya habían
    /// entrado siguen en el destino aunque el fallo llegara después, y decir que
    /// fueron cero mandaría a repetir una copia que está hecha a medias.
    /// </summary>
    private static TransferProgress Failed(
        Guid id,
        DataTransferRequest request,
        string message,
        TransferProgress? last) =>
        (last ?? new TransferProgress { Id = id, CurrentObject = request.Target.Name }) with
        {
            Id = id,
            Step = TransferStep.Done,
            Outcome = TransferOutcome.Failed,
            Failure = new TransferFailure(message, last?.RowsCopied ?? 0, Statement: null),
        };

    private static IResult Rejected(RowEditRejectedException exception) =>
        Results.Json(
            new RowEditRejectedResponse
            {
                Reason = exception.Rejection.Reason.ToString().ToLowerInvariant(),
                Message = exception.Rejection.Message,
            },
            statusCode: StatusCodes.Status409Conflict);
}
