using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Las consultas guardadas desde el compositor.
///
/// Además de guardarse y leerse, lo que importa es **dónde se enseñan**: cada una
/// es de su tabla, y una composición sobre `pedidos` que apareciera al abrir el
/// compositor sobre `clientes` produciría SQL contra columnas que no existen.
/// </summary>
public sealed class CompositionStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly DruseDatabase _database;
    private readonly SqliteCompositionStore _store;

    public CompositionStoreTests()
    {
        _paths.EnsureCreated();
        _database = new DruseDatabase(_paths);
        _database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteCompositionStore(_database);
    }

    public void Dispose() => _paths.Dispose();

    private static SavedComposition Composition(
        Guid connectionId,
        string table = "pedidos",
        string name = "Pedidos grandes",
        string schema = "public",
        string database = "ventas") => new()
    {
        Id = Guid.NewGuid(),
        ConnectionId = connectionId,
        Database = database,
        Schema = schema,
        Table = table,
        Name = name,
        Model = """{"sql":"SELECT * FROM pedidos WHERE total > 100;","state":{"limit":100}}""",
    };

    private Task<IReadOnlyList<SavedComposition>> Of(
        Guid connectionId,
        string table = "pedidos",
        string schema = "public",
        string database = "ventas") =>
        _store.GetAllAsync(connectionId, database, schema, table, CancellationToken.None);

    [Fact]
    public async Task GuardaYDevuelveUnaComposicion()
    {
        var connectionId = Guid.NewGuid();
        var composition = Composition(connectionId);

        await _store.SaveAsync(composition, CancellationToken.None);

        var found = Assert.Single(await Of(connectionId));

        Assert.Equal(composition.Id, found.Id);
        Assert.Equal("Pedidos grandes", found.Name);
        Assert.Contains("total > 100", found.Model, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CadaTablaVeSoloLasSuyas()
    {
        var connectionId = Guid.NewGuid();

        await _store.SaveAsync(Composition(connectionId, table: "pedidos"), CancellationToken.None);
        await _store.SaveAsync(Composition(connectionId, table: "clientes"), CancellationToken.None);
        await _store.SaveAsync(Composition(connectionId, schema: "auditoria"), CancellationToken.None);
        await _store.SaveAsync(Composition(connectionId, database: "otra"), CancellationToken.None);
        await _store.SaveAsync(Composition(Guid.NewGuid()), CancellationToken.None);

        Assert.Single(await Of(connectionId, table: "pedidos"));
        Assert.Single(await Of(connectionId, table: "clientes"));
        Assert.Single(await Of(connectionId, schema: "auditoria"));
        Assert.Single(await Of(connectionId, database: "otra"));
    }

    /// <summary>En los motores sin esquemas, el esquema se guarda vacío y se encuentra así.</summary>
    [Fact]
    public async Task SinEsquemaSeEncuentraConElEsquemaVacio()
    {
        var connectionId = Guid.NewGuid();

        await _store.SaveAsync(Composition(connectionId, schema: string.Empty), CancellationToken.None);

        Assert.Single(await Of(connectionId, schema: string.Empty));
    }

    [Fact]
    public async Task GuardarConElMismoIdentificadorLaReemplaza()
    {
        var connectionId = Guid.NewGuid();
        var composition = Composition(connectionId);

        await _store.SaveAsync(composition, CancellationToken.None);
        await _store.SaveAsync(composition with { Name = "Renombrada" }, CancellationToken.None);

        Assert.Equal("Renombrada", Assert.Single(await Of(connectionId)).Name);
    }

    [Fact]
    public async Task BorrarLaQuitaDeLaLista()
    {
        var connectionId = Guid.NewGuid();
        var composition = Composition(connectionId);

        await _store.SaveAsync(composition, CancellationToken.None);
        await _store.DeleteAsync(composition.Id, CancellationToken.None);

        Assert.Empty(await Of(connectionId));
    }
}
