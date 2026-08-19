using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Transfers;

/// <summary>
/// Migraciones guardadas: guardarlas, y **traerlas al presente** al abrirlas.
///
/// Lo segundo es lo que justifica que exista un servicio y no solo un almacén, y
/// aquí pesa más que en los respaldos porque hay **dos catálogos** que pueden
/// haber cambiado. Un perfil guarda una intención —«estas seis tablas de ventas, a
/// ventas de producción»— y las dos bases se mueven debajo: alguien borra una
/// tabla en el origen, alguien todavía no ha creado otra en el destino.
///
/// Resolver es leer los dos catálogos de hoy y decir en qué se ha convertido
/// aquello, sin negarse a abrirlo y sin fingir que nada ha cambiado.
/// </summary>
public sealed class TransferProfileService(
    ITransferProfileStore profiles,
    IProviderRegistry providers,
    ConnectionService connections)
{
    private readonly ITransferProfileStore _profiles = profiles;
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;

    public Task<IReadOnlyList<TransferProfile>> GetAllAsync(CancellationToken cancellationToken) =>
        _profiles.GetAllAsync(cancellationToken);

    public Task<TransferProfile?> FindAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.FindAsync(id, cancellationToken);

    public Task SaveAsync(TransferProfile profile, CancellationToken cancellationToken) =>
        _profiles.SaveAsync(profile, cancellationToken);

    public Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.DeleteAsync(id, cancellationToken);

    public Task<bool> MarkRunAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.TouchAsync(id, DateTimeOffset.UtcNow, cancellationToken);

    /// <summary>
    /// Qué migraría hoy este perfil, y qué de lo que pedía ya no se puede.
    ///
    /// Los dos extremos se resuelven contra **las conexiones que se le den**, que
    /// no tienen por qué ser las de aquel día: repetir en otro entorno la misma
    /// migración es justo para lo que se guarda un perfil.
    ///
    /// Cada esquema se lee una sola vez aunque el perfil nombre veinte tablas: un
    /// perfil grande contra una base remota pagaría esa lectura en cada nombre, y
    /// abrirlo dejaría de ser instantáneo.
    /// </summary>
    public async Task<TransferProfileResolution> ResolveAsync(
        TransferProfile profile,
        Guid sourceSessionId,
        Guid targetSessionId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var source = await TablesAsync(
            sourceSessionId,
            profile.SourceSchema,
            cancellationToken);

        var target = await TablesAsync(
            targetSessionId,
            profile.TargetSchema,
            cancellationToken);

        var pairs = new List<TransferProfilePair>();
        var gaps = new List<TransferProfileGap>();

        foreach (var name in profile.Tables)
        {
            if (!source.TryGetValue(name, out var origen))
            {
                gaps.Add(new TransferProfileGap(
                    name,
                    $"«{name}» ya no está en el origen."));

                continue;
            }

            if (!target.TryGetValue(name, out var destino))
            {
                // No se ofrece crearla desde aquí: crear una tabla es una decisión
                // con tipos y clave primaria, y se toma de una en una.
                gaps.Add(new TransferProfileGap(
                    name,
                    $"«{name}» no existe en el destino: créala antes o migra esa tabla aparte."));

                continue;
            }

            pairs.Add(new TransferProfilePair(origen, destino));
        }

        return new TransferProfileResolution
        {
            Profile = profile,
            Tables = pairs,
            Gaps = gaps,
        };
    }

    /// <summary>
    /// Las tablas de un esquema, por nombre.
    ///
    /// Sin esquema —los motores que no los tienen, o un perfil viejo— se recorre
    /// la base entera: es más lento, pero devolver vacío diría que no queda nada
    /// de la migración cuando lo que falta es el dato.
    /// </summary>
    private async Task<Dictionary<string, DatabaseObject>> TablesAsync(
        Guid sessionId,
        string? schema,
        CancellationToken cancellationToken)
    {
        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var metadata = _providers.GetMetadataReader(session.Engine);

        var schemas = await CatalogLookup.SchemasAsync(session, metadata, cancellationToken);
        var tables = new Dictionary<string, DatabaseObject>(StringComparer.OrdinalIgnoreCase);

        var roots = string.IsNullOrWhiteSpace(schema)
            ? schemas.Values
            : schemas.TryGetValue(schema, out var only) ? [only] : (IEnumerable<DatabaseObject>)[];

        foreach (var root in roots)
        {
            foreach (var table in await CatalogLookup.TablesUnderAsync(
                session,
                metadata,
                root,
                cancellationToken))
            {
                tables.TryAdd(table.Name, table);
            }
        }

        return tables;
    }
}
