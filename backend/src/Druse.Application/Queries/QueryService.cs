using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Queries;

/// <summary>Motivo por el que una ejecución se rechazó antes de llegar al motor.</summary>
public enum QueryRejectionReason
{
    None = 0,
    /// <summary>La conexión está marcada como solo lectura y el SQL escribe.</summary>
    ReadOnlyConnection = 1,
    /// <summary>Hay instrucciones destructivas sin confirmación explícita.</summary>
    UnconfirmedDestructive = 2,
    /// <summary>El SQL está vacío.</summary>
    EmptyStatement = 3,
}

/// <summary>Ejecución rechazada, con los riesgos que la motivaron.</summary>
public sealed record QueryRejection(
    QueryRejectionReason Reason,
    string Message,
    IReadOnlyList<SqlRisk> Risks);

/// <summary>
/// Orquesta la ejecución de consultas.
///
/// Aplica las reglas que valen para todos los motores —solo lectura, límites,
/// confirmación de instrucciones destructivas y cancelación— y delega en el
/// proveedor todo lo que dependa del dialecto.
/// </summary>
public sealed class QueryService(
    IProviderRegistry providers,
    ConnectionService connections,
    IQueryExecutionTracker tracker)
{
    /// <summary>Tope absoluto de filas, por encima de lo que pida el cliente.</summary>
    public const int MaxRowLimit = 100_000;

    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;
    private readonly IQueryExecutionTracker _tracker = tracker;

    /// <summary>
    /// Comprueba si la petición puede ejecutarse.
    ///
    /// Se hace antes de tocar el motor para que el usuario reciba una advertencia
    /// clara en lugar de un error del servidor a medio camino.
    /// </summary>
    public static QueryRejection? Validate(QueryContext context, QueryRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (string.IsNullOrWhiteSpace(request.Sql))
        {
            return new QueryRejection(
                QueryRejectionReason.EmptyStatement,
                "No hay ninguna instrucción que ejecutar.",
                []);
        }

        var risks = SqlSafetyAnalyzer.Analyze(request.Sql);

        if (context.ReadOnly && SqlSafetyAnalyzer.IsMutating(request.Sql))
        {
            return new QueryRejection(
                QueryRejectionReason.ReadOnlyConnection,
                "La conexión está marcada como solo lectura y la instrucción modifica datos.",
                risks);
        }

        if (risks.Count > 0 && !request.DestructiveConfirmed)
        {
            return new QueryRejection(
                QueryRejectionReason.UnconfirmedDestructive,
                "La instrucción puede destruir datos. Confirma para continuar.",
                risks);
        }

        return null;
    }

    /// <summary>Ejecuta la consulta y devuelve el resultado ya normalizado.</summary>
    public async Task<QueryResult> ExecuteAsync(QueryRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var session = _connections.Require(request.SessionId);
        var executor = _providers.GetQueryExecutor(session.Engine);

        var effective = request with
        {
            MaxRows = Math.Clamp(request.MaxRows, 1, MaxRowLimit),
            TimeoutSeconds = Math.Clamp(request.TimeoutSeconds, 1, 3600),
        };

        // El identificador se genera aquí, antes de ejecutar, para que el cliente
        // pueda cancelar una consulta que todavía no ha respondido.
        var executionId = Guid.NewGuid();
        var token = _tracker.Register(executionId, cancellationToken);

        try
        {
            var result = await executor.ExecuteAsync(session, effective, token);

            // El proveedor genera su propio identificador; se sustituye por el que
            // ya conoce el cliente, que es con el que podría haber cancelado.
            return result with { ExecutionId = executionId };
        }
        finally
        {
            _tracker.Complete(executionId);
        }
    }

    /// <summary>Solicita la cancelación de una ejecución en curso.</summary>
    public bool Cancel(Guid executionId) => _tracker.Cancel(executionId);
}

/// <summary>
/// Lo que las reglas de ejecución necesitan saber de una sesión.
///
/// Se extrae de la sesión en lugar de pasarla entera para que las reglas se
/// puedan probar sin abrir una conexión real.
/// </summary>
public readonly record struct QueryContext(DatabaseEngine Engine, bool ReadOnly)
{
    public static QueryContext From(IDatabaseSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        return new QueryContext(session.Engine, session.Profile.ReadOnly);
    }
}
