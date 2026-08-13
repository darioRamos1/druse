using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Domain;

namespace Druse.Application.Metadata;

/// <summary>
/// Explora el catálogo de una sesión abierta.
///
/// Cada llamada devuelve un solo nivel: es lo que hace posible la carga perezosa
/// del árbol. Pedir el catálogo entero de una base grande tardaría demasiado y la
/// mayor parte no se llegaría a mirar.
/// </summary>
public sealed class MetadataService(
    IProviderRegistry providers,
    ConnectionService connections)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;

    public async Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await reader.GetDatabasesAsync(session, cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseObject>> GetChildrenAsync(
        Guid sessionId,
        DatabaseObject parent,
        CancellationToken cancellationToken)
    {
        // El explorador y el editor piden metadatos a la vez sin coordinarse
        // entre ellos: sin turno, la segunda petición reventaría la conexión.
        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await reader.GetChildrenAsync(session, parent, cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
        Guid sessionId,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await reader.GetColumnsAsync(session, table, cancellationToken);
    }

    public async Task<string> GetViewDefinitionAsync(
        Guid sessionId,
        DatabaseObject view,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(view);

        if (view.Kind != DatabaseObjectKind.View)
        {
            throw new ArgumentException("Solo se puede obtener la definición de una vista.", nameof(view));
        }

        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await reader.GetViewDefinitionAsync(session, view, cancellationToken);
    }
}
