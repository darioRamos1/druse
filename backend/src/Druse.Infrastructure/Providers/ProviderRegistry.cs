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
    private readonly Dictionary<DatabaseEngine, ITableDesigner> _tableDesigners;
    private readonly Dictionary<DatabaseEngine, IDatabaseScripter> _scripters;

    public ProviderRegistry(
        IEnumerable<IDatabaseProvider> providers,
        IEnumerable<IDatabaseMetadataReader> readers,
        IEnumerable<IQueryExecutor> executors,
        IEnumerable<IRowEditor> rowEditors,
        IEnumerable<ITableDesigner> tableDesigners,
        IEnumerable<IDatabaseScripter> scripters)
    {
        ArgumentNullException.ThrowIfNull(providers);
        ArgumentNullException.ThrowIfNull(readers);
        ArgumentNullException.ThrowIfNull(executors);
        ArgumentNullException.ThrowIfNull(rowEditors);
        ArgumentNullException.ThrowIfNull(tableDesigners);
        ArgumentNullException.ThrowIfNull(scripters);

        _providers = providers.ToDictionary(provider => provider.Engine);
        _readers = readers.ToDictionary(reader => reader.Engine);
        _executors = executors.ToDictionary(executor => executor.Engine);
        _rowEditors = rowEditors.ToDictionary(editor => editor.Engine);
        _tableDesigners = tableDesigners.ToDictionary(designer => designer.Engine);
        _scripters = scripters.ToDictionary(scripter => scripter.Engine);
    }

    public IReadOnlyCollection<DatabaseEngine> SupportedEngines => _providers.Keys;

    public IDatabaseProvider GetProvider(DatabaseEngine engine) => Buscar(_providers, engine);

    public IDatabaseMetadataReader GetMetadataReader(DatabaseEngine engine) =>
        Buscar(_readers, engine);

    public IQueryExecutor GetQueryExecutor(DatabaseEngine engine) => Buscar(_executors, engine);

    public IRowEditor GetRowEditor(DatabaseEngine engine) => Buscar(_rowEditors, engine);

    public ITableDesigner GetTableDesigner(DatabaseEngine engine) =>
        Buscar(_tableDesigners, engine);

    public IDatabaseScripter GetScripter(DatabaseEngine engine) => Buscar(_scripters, engine);

    /// <summary>
    /// Busca el servicio del motor, y si no lo hay prueba con el que comparte.
    ///
    /// Existe por Informix, que tiene dos motores para un solo producto: DRDA y
    /// SQLI cambian por dónde se entra, pero **el SQL, el catálogo, los tipos y
    /// el diseñador son los mismos**. Registrar cinco duplicados que solo se
    /// diferencian en el valor de una propiedad diría que son distintos cuando
    /// no lo son, y obligaría a acordarse de tocarlos de dos en dos.
    ///
    /// La conexión sí es propia de cada uno, así que el proveedor no comparte:
    /// hay uno registrado por transporte y este atajo nunca llega a usarse.
    /// </summary>
    private static T Buscar<T>(Dictionary<DatabaseEngine, T> registro, DatabaseEngine engine)
    {
        if (registro.TryGetValue(engine, out var encontrado))
        {
            return encontrado;
        }

        if (Comparte(engine) is { } hermano && registro.TryGetValue(hermano, out var compartido))
        {
            return compartido;
        }

        throw new UnsupportedEngineException(engine);
    }

    /// <summary>Con qué motor comparte todo lo que no sea abrir la conexión.</summary>
    private static DatabaseEngine? Comparte(DatabaseEngine engine) => engine switch
    {
        DatabaseEngine.InformixSqli => DatabaseEngine.Informix,
        _ => null,
    };
}
