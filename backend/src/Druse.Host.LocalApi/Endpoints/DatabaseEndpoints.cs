using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Database.Abstractions;
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
    }

    private static void MapQueries(IEndpointRouteBuilder app)
    {
        app.MapPost("/api/queries", async (
            ExecuteQueryRequest request,
            ConnectionService connections,
            QueryService queries,
            CancellationToken cancellationToken) =>
        {
            var session = connections.Require(request.SessionId);
            var domainRequest = request.ToDomain();

            var rejection = QueryService.Validate(QueryContext.From(session), domainRequest);

            if (rejection is not null)
            {
                // 409: la petición es válida pero el estado actual impide ejecutarla.
                // El cliente puede reintentar con confirmDestructive.
                return Results.Conflict(rejection.ToResponse());
            }

            var result = await queries.ExecuteAsync(domainRequest, cancellationToken);

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
}
