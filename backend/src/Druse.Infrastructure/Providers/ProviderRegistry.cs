using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Infrastructure.Providers;

/// <summary>
/// Registro de proveedores construido desde las implementaciones inyectadas.
///
/// El MVP no carga ensamblados desconocidos en tiempo de ejecución, pero la forma
/// del registro ya es la de un sistema de complementos: para añadir un motor basta
/// registrar sus tres piezas en el contenedor.
/// </summary>
public sealed class ProviderRegistry : IProviderRegistry
{
    private readonly Dictionary<DatabaseEngine, IDatabaseProvider> _providers;
    private readonly Dictionary<DatabaseEngine, IDatabaseMetadataReader> _readers;
    private readonly Dictionary<DatabaseEngine, IQueryExecutor> _executors;
    private readonly Dictionary<DatabaseEngine, IRowEditor> _rowEditors;

    public ProviderRegistry(
        IEnumerable<IDatabaseProvider> providers,
        IEnumerable<IDatabaseMetadataReader> readers,
        IEnumerable<IQueryExecutor> executors,
        IEnumerable<IRowEditor> rowEditors)
    {
        ArgumentNullException.ThrowIfNull(providers);
        ArgumentNullException.ThrowIfNull(readers);
        ArgumentNullException.ThrowIfNull(executors);
        ArgumentNullException.ThrowIfNull(rowEditors);

        _providers = providers.ToDictionary(provider => provider.Engine);
        _readers = readers.ToDictionary(reader => reader.Engine);
        _executors = executors.ToDictionary(executor => executor.Engine);
        _rowEditors = rowEditors.ToDictionary(editor => editor.Engine);
    }

    public IReadOnlyCollection<DatabaseEngine> SupportedEngines => _providers.Keys;

    public IDatabaseProvider GetProvider(DatabaseEngine engine) =>
        _providers.TryGetValue(engine, out var provider)
            ? provider
            : throw new UnsupportedEngineException(engine);

    public IDatabaseMetadataReader GetMetadataReader(DatabaseEngine engine) =>
        _readers.TryGetValue(engine, out var reader)
            ? reader
            : throw new UnsupportedEngineException(engine);

    public IQueryExecutor GetQueryExecutor(DatabaseEngine engine) =>
        _executors.TryGetValue(engine, out var executor)
            ? executor
            : throw new UnsupportedEngineException(engine);

    public IRowEditor GetRowEditor(DatabaseEngine engine) =>
        _rowEditors.TryGetValue(engine, out var editor)
            ? editor
            : throw new UnsupportedEngineException(engine);
}
