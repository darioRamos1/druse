using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Application.Rows;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Host.LocalApi.Contracts;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>
/// Endpoints de motores, sesiones, metadatos y consultas.
///
/// Solo adaptan HTTP a los casos de uso: aquí no hay reglas de negocio nuevas
/// (plan §5). Cualquier decisión sobre qué se puede ejecutar vive en Application.
/// </summary>
internal static class DatabaseEndpoints
{
    public static void MapDatabaseEndpoints(this IEndpointRouteBuilder app)
    {
        MapEngines(app);
        MapConnections(app);
        MapSessions(app);
        MapMetadata(app);
        MapQueries(app);
        MapRowEdits(app);
    }

    private static void MapEngines(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/engines", (IProviderRegistry registry) =>
        {
            var engines = registry.SupportedEngines
                .Select(engine => new EngineDto
                {
                    Id = ContractMapper.EngineId(engine),
                    Name = ContractMapper.EngineName(engine),
                    DefaultPort = registry.GetProvider(engine).DefaultPort,
                })
                .OrderBy(engine => engine.Name, StringComparer.Ordinal);

            return Results.Ok(engines);
        })
        .WithName("GetEngines");
    }

    private static void MapConnections(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/connections/test", async (
            ConnectRequest request,
            ConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profile = request.Profile.ToDomain();
            var credentials = new DatabaseCredentials(request.Password);

            var result = await connections.TestAsync(profile, credentials, cancellationToken);

            // Un fallo de credenciales no es un error de la API: la petición se
            // atendió correctamente y su respuesta es «no se pudo conectar».
            return Results.Ok(result.ToResponse());
        })
        .WithName("TestConnection");
    }

    private static void MapSessions(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/sessions", async (
            ConnectRequest request,
            ConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profile = request.Profile.ToDomain();
            var credentials = new DatabaseCredentials(request.Password);

            var session = await connections.OpenAsync(profile, credentials, cancellationToken);

            return Results.Created($"/api/sessions/{session.Id}", session.ToResponse());
        })
        .WithName("OpenSession");

        app.MapDelete("/api/sessions/{sessionId:guid}", async (
            Guid sessionId,
            ConnectionService connections) =>
        {
            var closed = await connections.CloseAsync(sessionId);

            return closed ? Results.NoContent() : Results.NotFound();
        })
        .WithName("CloseSession");
    }

    private static void MapMetadata(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/sessions/{sessionId:guid}/metadata/databases", async (
            Guid sessionId,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var databases = await metadata.GetDatabasesAsync(sessionId, cancellationToken);

            return Results.Ok(databases.Select(database => database.ToDto()));
        })
        .WithName("GetDatabases");

        // Los hijos se piden con POST porque el nodo padre es un objeto completo:
        // codificarlo en la cadena de consulta obligaría a serializarlo a mano y
        // expondría nombres de esquema en la URL.
        app.MapPost("/api/sessions/{sessionId:guid}/metadata/children", async (
            Guid sessionId,
            DatabaseObjectDto parent,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var children = await metadata.GetChildrenAsync(sessionId, parent.ToDomain(), cancellationToken);

            return Results.Ok(children.Select(child => child.ToDto()));
        })
        .WithName("GetChildren");

        app.MapPost("/api/sessions/{sessionId:guid}/metadata/columns", async (
            Guid sessionId,
            DatabaseObjectDto table,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var columns = await metadata.GetColumnsAsync(sessionId, table.ToDomain(), cancellationToken);

            return Results.Ok(columns.Select(column => column.ToDto()));
        })
        .WithName("GetColumns");

        app.MapPost("/api/sessions/{sessionId:guid}/metadata/definition", async (
            Guid sessionId,
            DatabaseObjectDto view,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var sql = await metadata.GetViewDefinitionAsync(
                sessionId,
                view.ToDomain(),
                cancellationToken);

            return Results.Ok(new { sql });
        })
        .WithName("GetViewDefinition");
    }

    /// <summary>
    /// Edición de filas desde la cuadrícula.
    ///
    /// Son dos rutas y no una con bandera a propósito: **ver el SQL y ejecutarlo
    /// son cosas distintas**, y separarlas impide que un cliente mal escrito
    /// acabe guardando cuando solo quería mirar.
    /// </summary>
    private static void MapRowEdits(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/rows/preview", async (
            RowEditRequest request,
            RowEditService rows,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var statements = await rows.PreviewAsync(request.ToDomain(), cancellationToken);

                return Results.Ok(new { statements });
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("PreviewRowEdits");

        app.MapPost("/api/rows", async (
            RowEditRequest request,
            RowEditService rows,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var result = await rows.ApplyAsync(request.ToDomain(), cancellationToken);

                return Results.Ok(new RowEditResponse
                {
                    RowsAffected = result.RowsAffected,
                    DurationMs = (long)result.Duration.TotalMilliseconds,
                    Statements = result.Statements,
                });
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
            catch (RowEditFailedException exception)
            {
                // 409: la petición era válida, pero el estado de la tabla no era
                // el que el usuario tenía delante. No se guardó nada.
                return Results.Conflict(new RowEditRejectedResponse
                {
                    Reason = "unexpectedrowcount",
                    Message = exception.Message,
                });
            }
        })
        .WithName("ApplyRowEdits");
    }

    private static IResult Rejected(RowEditRejectedException exception) =>
        Results.Json(
            new RowEditRejectedResponse
            {
                Reason = exception.Rejection.Reason.ToString().ToLowerInvariant(),
                Message = exception.Rejection.Message,
            },
            statusCode: StatusCodes.Status409Conflict);

    private static void MapQueries(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/queries", async (
            ExecuteQueryRequest request,
            ConnectionService connections,
            QueryService queries,
            IQueryHistoryStore history,
            CancellationToken cancellationToken) =>
        {
            var session = connections.Require(request.SessionId);
            var domainRequest = request.ToDomain();

            var rejection = QueryService.Validate(QueryContext.From(session), domainRequest);

            if (rejection is not null)
            {
                // 409: la petición es válida pero el estado actual impide ejecutarla.
                // El cliente puede reintentar con confirmDestructive.
                // No se registra en el historial: no llegó a ejecutarse.
                return Results.Conflict(rejection.ToResponse());
            }

            var result = await queries.ExecuteAsync(domainRequest, cancellationToken);

            await RecordHistoryAsync(history, session, domainRequest, result, cancellationToken);

            return Results.Ok(result.ToResponse());
        })
        .WithName("ExecuteQuery");

        app.MapDelete("/api/queries/{executionId:guid}", (
            Guid executionId,
            QueryService queries) =>
        {
            var canceled = queries.Cancel(executionId);

            return canceled ? Results.Accepted() : Results.NotFound();
        })
        .WithName("CancelQuery");
    }

    /// <summary>
    /// Anota la ejecución en el historial local.
    ///
    /// Un fallo al escribir el historial no puede tumbar la consulta: el usuario
    /// ya tiene su resultado y perderlo por no poder anotarlo sería absurdo.
    /// </summary>
    private static async Task RecordHistoryAsync(
        IQueryHistoryStore history,
        IDatabaseSession session,
        QueryRequest request,
        QueryResult result,
        CancellationToken cancellationToken)
    {
        try
        {
            await history.AddAsync(
                new QueryHistoryEntry
                {
                    Id = result.ExecutionId,
                    ConnectionId = session.Profile.Id,
                    ConnectionName = session.Profile.Name,
                    Database = session.Profile.Database,
                    Sql = request.Sql,
                    ExecutedAtUtc = DateTimeOffset.UtcNow,
                    DurationMs = (long)result.Duration.TotalMilliseconds,
                    Succeeded = result.State == QueryExecutionState.Succeeded,
                    RowCount = result.ResultSets.Count > 0 ? result.ResultSets[0].Rows.Count : result.RowsAffected,
                    ErrorMessage = result.Error?.Message,
                },
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Se ignora a propósito. Si el historial da problemas de forma
            // sostenida, se verá en los logs del proceso.
        }
    }
}
