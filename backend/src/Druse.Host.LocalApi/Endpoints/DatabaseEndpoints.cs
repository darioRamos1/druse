using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Application.Rows;
using Druse.Application.Tables;
using Druse.Application.Transactions;
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
        MapTableDesign(app);
        MapTransactions(app);
    }

    /// <summary>
    /// Las transacciones que el usuario abre y cierra a mano.
    ///
    /// Cuelgan de la sesión y no de la pestaña porque es de la conexión de quien
    /// son: dos pestañas del mismo perfil comparten sesión y, por tanto,
    /// transacción.
    /// </summary>
    private static void MapTransactions(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/sessions/{sessionId:guid}/transaction", (
            Guid sessionId,
            TransactionService transactions) =>
            Results.Ok(transactions.Get(sessionId).ToResponse()))
        .WithName("GetTransaction");

        app.MapPost("/api/sessions/{sessionId:guid}/transaction", async (
            Guid sessionId,
            TransactionService transactions,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var state = await transactions.BeginAsync(sessionId, cancellationToken);

                return Results.Ok(state.ToResponse());
            }
            catch (TransactionRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("BeginTransaction");

        // Confirmar y deshacer son dos rutas y no una con bandera: son las dos
        // decisiones opuestas que puede tomar el usuario, y un cliente que se
        // equivoque de valor no puede acabar tirando el trabajo de una hora.
        app.MapPost("/api/sessions/{sessionId:guid}/transaction/commit", async (
            Guid sessionId,
            TransactionService transactions,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var state = await transactions.CommitAsync(sessionId, cancellationToken);

                return Results.Ok(state.ToResponse());
            }
            catch (TransactionRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("CommitTransaction");

        app.MapPost("/api/sessions/{sessionId:guid}/transaction/rollback", async (
            Guid sessionId,
            TransactionService transactions,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var state = await transactions.RollbackAsync(sessionId, cancellationToken);

                return Results.Ok(state.ToResponse());
            }
            catch (TransactionRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("RollbackTransaction");
    }

    private static IResult Rejected(TransactionRejectedException exception) =>
        Results.Json(
            new TransactionRejectedResponse
            {
                Reason = exception.Rejection.Reason.ToString().ToLowerInvariant(),
                Message = exception.Rejection.Message,
            },
            statusCode: StatusCodes.Status409Conflict);

    /// <summary>
    /// Crear y modificar tablas.
    ///
    /// Cada operación tiene su ruta de vista previa: el SQL se enseña antes de
    /// ejecutarlo, igual que en la edición de filas, y el servidor se niega a
    /// aplicar nada que el usuario no haya confirmado.
    /// </summary>
    private static void MapTableDesign(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/sessions/{sessionId:guid}/tables/data-types", (
            Guid sessionId,
            TableDesignService tables) =>
            Results.Ok(tables.DataTypes(sessionId)))
        .WithName("GetTableDataTypes");

        app.MapGet("/api/sessions/{sessionId:guid}/tables/capabilities", (
            Guid sessionId,
            TableDesignService tables) =>
            Results.Ok(tables.IndexCapabilities(sessionId).ToResponse()))
        .WithName("GetTableCapabilities");

        app.MapPost("/api/sessions/{sessionId:guid}/tables/structure", async (
            Guid sessionId,
            DatabaseObjectDto table,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var structure = await metadata.GetTableStructureAsync(
                sessionId,
                table.ToDomain(),
                cancellationToken);

            return Results.Ok(structure.ToResponse());
        })
        .WithName("GetTableStructure");

        app.MapPost("/api/tables/preview", (
            CreateTableRequest request,
            TableDesignService tables) =>
        {
            try
            {
                return Results.Ok(new
                {
                    statements = tables.PreviewCreate(request.SessionId, request.ToDomain()),
                });
            }
            catch (TableChangeRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("PreviewCreateTable");

        app.MapPost("/api/tables", async (
            CreateTableRequest request,
            TableDesignService tables,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var result = await tables.CreateAsync(
                    request.SessionId,
                    request.ToDomain(),
                    request.Confirmed,
                    cancellationToken);

                return Results.Ok(result.ToResponse());
            }
            catch (TableChangeRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("CreateTable");

        app.MapPost("/api/tables/alter/preview", async (
            AlterTableRequest request,
            TableDesignService tables,
            CancellationToken cancellationToken) =>
        {
            try
            {
                return Results.Ok(new
                {
                    statements = await tables.PreviewAlterAsync(
                        request.SessionId,
                        request.ToDomain(),
                        cancellationToken),
                });
            }
            catch (TableChangeRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("PreviewAlterTable");

        app.MapPost("/api/tables/alter", async (
            AlterTableRequest request,
            TableDesignService tables,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var result = await tables.AlterAsync(
                    request.SessionId,
                    request.ToDomain(),
                    request.Confirmed,
                    request.ConfirmedDestructive,
                    cancellationToken);

                return Results.Ok(result.ToResponse());
            }
            catch (TableChangeRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("AlterTable");
    }

    /// <summary>
    /// Un rechazo no es un error del servidor: la petición se entendió y la
    /// respuesta es que no se aplica, con el motivo para que el cliente decida.
    /// </summary>
    private static IResult Rejected(TableChangeRejectedException exception) =>
        Results.Json(exception.Rejection.ToResponse(), statusCode: StatusCodes.Status409Conflict);

    private static void MapEngines(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/engines", (IProviderRegistry registry) =>
        {
            var engines = registry.SupportedEngines
                .Select(engine =>
                {
                    var provider = registry.GetProvider(engine);

                    return new EngineDto
                    {
                        Id = ContractMapper.EngineId(engine),
                        Name = ContractMapper.EngineName(engine),
                        DefaultPort = provider.DefaultPort,
                        DefaultDatabase = provider.DefaultDatabase,
                        Capabilities = provider.Capabilities.ToDto(),
                    };
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
            var ssh = new SshCredentials(request.SshSecret, request.SshVerificationCode);

            var result = await connections.TestAsync(profile, credentials, ssh, cancellationToken);

            // Un fallo de credenciales no es un error de la API: la petición se
            // atendió correctamente y su respuesta es «no se pudo conectar».
            return Results.Ok(result.ToResponse());
        })
        .WithName("TestConnection");

        app.MapPost("/api/connections/test-tunnel", async (
            ConnectRequest request,
            ConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profile = request.Profile.ToDomain();
            var ssh = new SshCredentials(request.SshSecret, request.SshVerificationCode);

            // Sin credenciales del motor a propósito: aquí no se abre ninguna
            // conexión de base de datos, así que no hay para qué mandarlas.
            var result = await connections.TestTunnelAsync(profile, ssh, cancellationToken);

            // Como en «probar», que no se llegue es la respuesta, no un fallo de
            // la API: el formulario quiere leer hasta dónde se llegó.
            return Results.Ok(result.ToResponse());
        })
        .WithName("TestTunnel");

        app.MapPost("/api/connections/databases", async (
            ConnectRequest request,
            ConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            var profile = request.Profile.ToDomain();
            var credentials = new DatabaseCredentials(request.Password);
            var ssh = new SshCredentials(request.SshSecret, request.SshVerificationCode);

            var databases = await connections.ListDatabasesAsync(
                profile,
                credentials,
                ssh,
                cancellationToken);

            // Al contrario que probar, aquí un fallo **sí** es un no de la API: el
            // formulario pidió una lista y no la hay. El motor dirá por qué, y el
            // middleware lo traduce a un 409 con su mensaje.
            return Results.Ok(new { databases });
        })
        .WithName("ListConnectionDatabases");

        // Crear una base es **otra cosa que abrirla**, y por eso es otra ruta.
        //
        // Hoy solo la atienden los motores que son un archivo, que son los que
        // pueden crear uno vacío sin preguntar nada: no hay codificación, ni
        // espacio de tablas, ni cotejo que decidir. Los demás lo rechazan con su
        // motivo, que el middleware traduce a un 409.
        app.MapPost("/api/connections/database", async (
            ConnectRequest request,
            ConnectionService connections,
            CancellationToken cancellationToken) =>
        {
            await connections.CreateDatabaseAsync(
                request.Profile.ToDomain(),
                new DatabaseCredentials(request.Password),
                cancellationToken);

            return Results.NoContent();
        })
        .WithName("CreateConnectionDatabase");
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
            var ssh = new SshCredentials(request.SshSecret, request.SshVerificationCode);

            var session = await connections.OpenAsync(profile, credentials, ssh, cancellationToken);

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

        app.MapPost("/api/sessions/{sessionId:guid}/metadata/graph", async (
            Guid sessionId,
            SchemaGraphRequest request,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var graph = await metadata.GetSchemaGraphAsync(
                    sessionId,
                    [.. request.Tables.Select(table => table.ToDomain())],
                    cancellationToken);

                return Results.Ok(graph.ToResponse());
            }
            catch (ArgumentException error)
            {
                // Pedir vistas o más tablas de la cuenta es una petición mal
                // formada, no un fallo del servidor: se contesta con el motivo.
                return Results.BadRequest(new { message = error.Message });
            }
        })
        .WithName("GetSchemaGraph");

        app.MapPost("/api/sessions/{sessionId:guid}/metadata/definition", async (
            Guid sessionId,
            DatabaseObjectDto databaseObject,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var sql = await metadata.GetDefinitionAsync(
                sessionId,
                databaseObject.ToDomain(),
                cancellationToken);

            return Results.Ok(new { sql });
        })
        .WithName("GetDefinition");

        app.MapPost("/api/sessions/{sessionId:guid}/metadata/routine", async (
            Guid sessionId,
            DatabaseObjectDto routine,
            MetadataService metadata,
            CancellationToken cancellationToken) =>
        {
            var signature = await metadata.GetRoutineSignatureAsync(
                sessionId,
                routine.ToDomain(),
                cancellationToken);

            return Results.Ok(signature.ToDto());
        })
        .WithName("GetRoutineSignature");
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

        // Borrar tiene rutas propias por lo mismo que ver y guardar están
        // separados: enseñar el DELETE y ejecutarlo son cosas distintas, y
        // mezclarlas dejaría que un cliente mal escrito borre por mirar.
        app.MapPost("/api/rows/delete/preview", async (
            RowDeleteRequest request,
            RowEditService rows,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var statements = await rows.PreviewDeleteAsync(request.ToDomain(), cancellationToken);

                return Results.Ok(new { statements });
            }
            catch (RowEditRejectedException exception)
            {
                return Rejected(exception);
            }
        })
        .WithName("PreviewRowDeletes");

        app.MapPost("/api/rows/delete", async (
            RowDeleteRequest request,
            RowEditService rows,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var result = await rows.DeleteAsync(request.ToDomain(), cancellationToken);

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
                return Results.Conflict(new RowEditRejectedResponse
                {
                    Reason = "unexpectedrowcount",
                    Message = exception.Message,
                });
            }
        })
        .WithName("DeleteRows");
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
                    Database = request.Database ?? session.Profile.Database,
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
