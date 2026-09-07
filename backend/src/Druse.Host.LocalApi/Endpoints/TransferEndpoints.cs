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

        app.MapPost("/api/transfers/translation", async (
            TransferRequestDto request,
            TransferService transfers,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var translations = await transfers.TranslateAsync(
                    request.ToDomain(),
                    cancellationToken);

                return Results.Ok(new
                {
                    translations = translations.Select(translation => new TypeTranslationDto
                    {
                        Column = translation.Column,
                        SourceType = translation.SourceType,
                        TargetType = translation.TargetType,
                        Fidelity = translation.Fidelity.ToString(),
                        Note = translation.Note,
                    }),
                });
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("TranslateTransferTypes");

        app.MapPost("/api/transfers/target", async (
            TransferRequestDto request,
            TransferService transfers,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var statements = await transfers.CreateTargetAsync(
                    request.ToDomain(),
                    cancellationToken);

                return Results.Ok(new { statements });
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("CreateTransferTarget");

        app.MapPost("/api/transfers/set/order", async (
            TransferSetRequestDto request,
            TransferService transfers,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var order = await transfers.OrderAsync(request.ToDomain(), cancellationToken);

                return Results.Ok(order.ToDto());
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("OrderTransferSet");

        // Una tabla es una pasada de una: el camino de las tres primeras fases no
        // se mantiene aparte, porque serían dos formas de hacer lo mismo y solo
        // una se probaría a fondo.
        app.MapPost("/api/transfers", (
            TransferRequestDto request,
            IBackgroundJobs jobs,
            ITransferTracker tracker,
            ILoggerFactory logs) =>
            Launch(new TransferSetRequestDto { Tables = [request] }, jobs, tracker, logs))
        .WithName("RunTransfer");

        app.MapPost("/api/transfers/set", (
            TransferSetRequestDto request,
            IBackgroundJobs jobs,
            ITransferTracker tracker,
            ILoggerFactory logs) =>
            Launch(request, jobs, tracker, logs))
        .WithName("RunTransferSet");

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

        MapProfiles(app);
    }

    /// <summary>
    /// Las migraciones guardadas para repetirlas.
    ///
    /// Van bajo `/api/transfers/profiles` porque son el mismo asunto: lo que se
    /// guarda es lo que la pasada recibe, con los dos extremos todavía sin
    /// resolver.
    /// </summary>
    private static void MapProfiles(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/transfers/profiles", async (
            TransferProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            var all = await profiles.GetAllAsync(cancellationToken);

            return Results.Ok(all.Select(profile => profile.ToDto()));
        })
        .WithName("GetTransferProfiles");

        app.MapGet("/api/transfers/profiles/{id:guid}", async (
            Guid id,
            TransferProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            var profile = await profiles.FindAsync(id, cancellationToken);

            return profile is null ? Results.NotFound() : Results.Ok(profile.ToDto());
        })
        .WithName("GetTransferProfile");

        // Guardar, renombrar y duplicar son el mismo camino: lo que cambia entre
        // ellos es qué manda el cliente.
        app.MapPost("/api/transfers/profiles", async (
            TransferProfileDto request,
            TransferProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.Name))
            {
                return Results.Json(
                    new { message = "El perfil necesita un nombre." },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            if (request.Tables.Count == 0)
            {
                return Results.Json(
                    new { message = "Un perfil sin tablas no repetiría nada." },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var existing = request.Id is { } id
                ? await profiles.FindAsync(id, cancellationToken)
                : null;

            var profile = request.ToDomain(existing);

            await profiles.SaveAsync(profile, cancellationToken);

            return Results.Ok(profile.ToDto());
        })
        .WithName("SaveTransferProfile");

        app.MapDelete("/api/transfers/profiles/{id:guid}", async (
            Guid id,
            TransferProfileService profiles,
            CancellationToken cancellationToken) =>
            await profiles.DeleteAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound())
        .WithName("DeleteTransferProfile");

        // Abrir un perfil es resolverlo contra dos conexiones vivas: qué de lo que
        // pedía existe hoy a los dos lados y qué no.
        app.MapPost("/api/transfers/profiles/{id:guid}/resolve", async (
            Guid id,
            ResolveTransferProfileDto request,
            TransferProfileService profiles,
            CancellationToken cancellationToken) =>
        {
            var profile = await profiles.FindAsync(id, cancellationToken);

            if (profile is null)
            {
                return Results.NotFound();
            }

            var resolution = await profiles.ResolveAsync(
                profile,
                request.SourceSessionId,
                request.TargetSessionId,
                cancellationToken);

            return Results.Ok(resolution.ToDto());
        })
        .WithName("ResolveTransferProfile");

        // Que un perfil se haya lanzado no lo modifica, así que se anota aparte.
        app.MapPost("/api/transfers/profiles/{id:guid}/ran", async (
            Guid id,
            TransferProfileService profiles,
            CancellationToken cancellationToken) =>
            await profiles.MarkRunAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound())
        .WithName("MarkTransferProfileRun");
    }

    /// <summary>
    /// Lanza la pasada y devuelve su identificador.
    ///
    /// El trabajo se va a la cola y la petición termina: lo que sigue se pregunta
    /// por `status`. Es lo mismo que hace un respaldo, y aquí importa más, porque
    /// lo que queda a medias son filas en una base ajena.
    /// </summary>
    private static IResult Launch(
        TransferSetRequestDto request,
        IBackgroundJobs jobs,
        ITransferTracker tracker,
        ILoggerFactory logs)
    {
        DataTransferSetRequest domain;

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

        if (domain.Tables.Count == 0)
        {
            return Results.Json(
                new { message = "No hay ninguna tabla que trasladar." },
                statusCode: StatusCodes.Status400BadRequest);
        }

        var id = Guid.NewGuid();

        // El token es el del registro y no el de la petición: la petición termina
        // en cuanto se devuelve el identificador, y el traslado tiene que seguir.
        // Cancelar es lo único que lo para.
        var token = tracker.Start(id, CancellationToken.None);

        tracker.Report(Starting(id, domain));

        jobs.Enqueue(new QueuedJob
        {
            Id = id,
            Kind = JobKind.Transfer,
            Subject = domain.Tables.Count == 1
                ? domain.Tables[0].Target.Name
                : $"{domain.Tables.Count} tablas",
            Token = token,
            RunAsync = async (services, cancellationToken) =>
            {
                var transfers = services.GetRequiredService<TransferService>();
                var log = logs.CreateLogger("Druse.Transfer");

                try
                {
                    var progress = new Progress<TransferProgress>(state =>
                        tracker.Report(state with { Id = id }));

                    var result = await transfers.RunSetAsync(domain, progress, cancellationToken);

                    tracker.Report(result with { Id = id });

                    return result.Outcome.ToString();
                }
                catch (RowEditRejectedException rejected)
                {
                    // Un rechazo llega hasta aquí cuando se comprueba ya lanzado el
                    // trabajo —la sesión se cerró entre medias, el destino resultó
                    // ser de solo lectura—. Va al estado y no a la respuesta, que
                    // hace rato que se envió.
                    tracker.Report(Failed(id, domain, rejected.Rejection.Message, tracker.Find(id)));

                    return nameof(TransferOutcome.Failed);
                }
                catch (Exception error)
                {
                    // Lo que llega aquí es lo que el servicio no supo contar: sin
                    // este registro, el traslado se quedaría «en marcha» para
                    // siempre en la pantalla de quien lo lanzó.
                    log.LogError(error, "El traslado {Id} terminó con un error no previsto.", id);

                    tracker.Report(Failed(id, domain, error.Message, tracker.Find(id)));

                    return nameof(TransferOutcome.Failed);
                }
                finally
                {
                    tracker.Finish(id);
                }
            },
        });

        return Results.Accepted($"/api/transfers/{id}/status", new { id });
    }

    /// <summary>
    /// El primer estado, publicado antes de que el trabajo empiece a correr.
    ///
    /// Sin él, quien pregunta por el progreso justo después de lanzar el traslado
    /// se llevaría un 404 y creería que se perdió.
    /// </summary>
    private static TransferProgress Starting(Guid id, DataTransferSetRequest request) =>
        new()
        {
            Id = id,
            Step = TransferStep.ReadingStructure,
            Outcome = TransferOutcome.Running,
            CurrentObject = request.Tables[0].Target.Name,
            RowsEstimated = request.Tables[0].Source.ApproximateRowCount,
            TablesTotal = request.Tables.Count,
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
        DataTransferSetRequest request,
        string message,
        TransferProgress? last) =>
        (last ?? new TransferProgress { Id = id, CurrentObject = request.Tables[0].Target.Name }) with
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
