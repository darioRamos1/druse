using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Domain;

namespace Druse.Application.Queries;

/// <summary>
/// Exporta el resultado de una consulta a un archivo.
///
/// La consulta se vuelve a ejecutar contra el motor en lugar de exportar lo que
/// el cliente tiene en pantalla: así se puede exportar el resultado completo
/// aunque la cuadrícula solo muestre las primeras filas, que es justo lo que se
/// espera al pulsar «Exportar».
/// </summary>
public sealed class ExportService(
    IProviderRegistry providers,
    ConnectionService connections,
    IEnumerable<IResultExporter> exporters)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;

    private readonly Dictionary<ExportFormat, IResultExporter> _exporters =
        exporters.ToDictionary(exporter => exporter.Format);

    /// <summary>
    /// Comprueba si la petición puede exportarse.
    ///
    /// Son las reglas de una ejecución normal **y una más**: lo que se exporta
    /// tiene que devolver filas. Exportar no es una forma de ejecutar: el archivo
    /// es el objetivo, así que mandar al motor algo que escribe sería un efecto
    /// que nadie pidió al pulsar «Exportar».
    ///
    /// El caso que lo destapó es una vista abierta desde el explorador. Esa
    /// pestaña no lleva un SELECT sino el <c>CREATE VIEW</c> que la define, y
    /// exportarla llegaba al motor: si la vista ya existía, el servidor
    /// respondía con un error que nadie sabía leer, y **si no existía la creaba**
    /// y el archivo salía vacío con un «Exportado» encima.
    ///
    /// Se decide por lo que escribe y no por una lista de lo que se acepta:
    /// cada motor tiene sus formas de devolver filas —<c>SHOW</c>, <c>EXPLAIN</c>,
    /// procedimientos— y una lista blanca las iría dejando fuera de una en una.
    /// </summary>
    public static QueryRejection? Validate(QueryContext context, QueryRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var rejection = QueryService.Validate(context, request);

        if (rejection is not null)
        {
            return rejection;
        }

        if (SqlSafetyAnalyzer.IsMutating(request.Sql))
        {
            return new QueryRejection(
                QueryRejectionReason.NotExportable,
                "Esto no devuelve filas: modifica la base de datos. Para exportar hace falta "
                    + "una consulta. Si has abierto una vista desde el explorador, lo que tienes "
                    + "delante es su definición; escribe un SELECT sobre ella.",
                SqlSafetyAnalyzer.Analyze(request.Sql));
        }

        return null;
    }

    public IResultExporter GetExporter(ExportFormat format) =>
        _exporters.TryGetValue(format, out var exporter)
            ? exporter
            : throw new ArgumentException($"No hay exportador para el formato '{format}'.", nameof(format));

    /// <summary>
    /// Ejecuta y escribe el resultado en el destino.
    ///
    /// Se comprueban las mismas reglas que en una ejecución normal: una conexión
    /// de solo lectura no debe poder escribir por el hecho de llamarse
    /// «exportar», y una instrucción destructiva sigue necesitando confirmación.
    /// </summary>
    public async Task<ExportResult> ExportAsync(
        QueryRequest request,
        ExportOptions options,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(options);

        // El turno cubre toda la exportación, no solo la apertura: el lector va
        // trayendo filas mientras se escribe, y la conexión sigue ocupada.
        using var turn = await _connections.EnterAsync(request.SessionId, cancellationToken);

        var session = _connections.Require(request.SessionId);
        var rejection = Validate(QueryContext.From(session), request);

        if (rejection is not null)
        {
            throw new ExportRejectedException(rejection);
        }

        var executor = _providers.GetQueryExecutor(session.Engine);
        var exporter = GetExporter(options.Format);

        return await _connections.UseDatabaseAsync(
            session,
            request.Database,
            async selected =>
            {
                try
                {
                    await using var reader = await executor.OpenReaderAsync(
                        selected,
                        request,
                        cancellationToken);

                    return await exporter.WriteAsync(reader, destination, options, cancellationToken);
                }
                finally
                {
                    // Exportar puede tardar minutos, y todo ese rato la
                    // transacción no recibiría nada más. Sin esto, una
                    // exportación larga acabaría deshaciéndola por «olvidada».
                    selected.Transaction.Touch();
                }
            },
            cancellationToken);
    }
}

/// <summary>La exportación se rechazó por las mismas reglas que una ejecución.</summary>
public sealed class ExportRejectedException(QueryRejection rejection)
    : InvalidOperationException(rejection.Message)
{
    public QueryRejection Rejection { get; } = rejection;
}
