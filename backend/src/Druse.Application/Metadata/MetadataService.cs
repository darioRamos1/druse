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

        var database = parent.Kind == DatabaseObjectKind.Database
            ? parent.Database ?? parent.Name
            : parent.Database;

        return await _connections.UseDatabaseAsync(
            session,
            database,
            selected => reader.GetChildrenAsync(selected, parent, cancellationToken),
            cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
        Guid sessionId,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await _connections.UseDatabaseAsync(
            session,
            table.Database,
            selected => reader.GetColumnsAsync(selected, table, cancellationToken),
            cancellationToken);
    }

    /// <summary>
    /// Índices, claves foráneas y demás restricciones de una tabla.
    ///
    /// Pasa por el mismo turno que el resto del catálogo: es una lectura más, y
    /// la conexión sigue sin admitir dos cosas a la vez.
    /// </summary>
    public async Task<TableStructure> GetTableStructureAsync(
        Guid sessionId,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(table);

        if (table.Kind != DatabaseObjectKind.Table)
        {
            throw new ArgumentException(
                "Solo las tablas tienen índices y restricciones.",
                nameof(table));
        }

        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await _connections.UseDatabaseAsync(
            session,
            table.Database,
            selected => reader.GetTableStructureAsync(selected, table, cancellationToken),
            cancellationToken);
    }

    public async Task<string> GetDefinitionAsync(
        Guid sessionId,
        DatabaseObject databaseObject,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(databaseObject);

        if (databaseObject.Kind is not (DatabaseObjectKind.View or DatabaseObjectKind.Procedure))
        {
            throw new ArgumentException(
                "Solo se puede obtener la definición de una vista o un procedimiento.",
                nameof(databaseObject));
        }

        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var reader = _providers.GetMetadataReader(session.Engine);

        return await _connections.UseDatabaseAsync(
            session,
            databaseObject.Database,
            selected => reader.GetDefinitionAsync(selected, databaseObject, cancellationToken),
            cancellationToken);
    }
}
