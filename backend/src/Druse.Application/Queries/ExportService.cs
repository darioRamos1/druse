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
        var rejection = QueryService.Validate(QueryContext.From(session), request);

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
                await using var reader = await executor.OpenReaderAsync(
                    selected,
                    request,
                    cancellationToken);

                return await exporter.WriteAsync(reader, destination, options, cancellationToken);
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
