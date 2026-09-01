using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Los diagramas guardados.
///
/// Lo que se comprueba aquí, además de que se guardan y se leen, es la decisión
/// que sostiene la función: **el modelo no contiene el esquema**, y por eso un
/// diagrama guardado hace meses sigue sirviendo aunque las tablas hayan cambiado.
/// </summary>
public sealed class DiagramStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly DruseDatabase _database;
    private readonly SqliteDiagramStore _store;

    public DiagramStoreTests()
    {
        _paths.EnsureCreated();
        _database = new DruseDatabase(_paths);
        _database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteDiagramStore(_database);
    }

    public void Dispose() => _paths.Dispose();

    private static SavedDiagram Diagram(
        Guid connectionId,
        string name = "Ventas",
        string? model = null) => new()
    {
        Id = Guid.NewGuid(),
        ConnectionId = connectionId,
        Name = name,
        Model = model ?? """{"tables":["ventas.factura"],"positions":{"ventas.factura":{"x":24,"y":40}}}""",
    };

    [Fact]
    public async Task GuardaYDevuelveUnDiagrama()
    {
        var connectionId = Guid.NewGuid();
        var diagram = Diagram(connectionId);

        await _store.SaveAsync(diagram, CancellationToken.None);

        var found = await _store.FindAsync(diagram.Id, CancellationToken.None);

        Assert.NotNull(found);
        Assert.Equal("Ventas", found!.Name);
        Assert.Equal(connectionId, found.ConnectionId);
        Assert.Contains("ventas.factura", found.Model, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un diagrama es de su conexión. Mezclarlos dibujaría relaciones que ningún
    /// motor puede comprobar.
    /// </summary>
    [Fact]
    public async Task SoloDevuelveLosDeLaConexionQueSePide()
    {
        var mine = Guid.NewGuid();
        var other = Guid.NewGuid();

        await _store.SaveAsync(Diagram(mine, "El mío"), CancellationToken.None);
        await _store.SaveAsync(Diagram(other, "El otro"), CancellationToken.None);

        var found = await _store.GetAllAsync(mine, CancellationToken.None);

        Assert.Equal(["El mío"], found.Select(diagram => diagram.Name));
    }

    /// <summary>
    /// Reordenar un diagrama no lo convierte en otro: conserva su fecha de
    /// creación, que es la única pista de desde cuándo se usa.
    /// </summary>
    [Fact]
    public async Task AlGuardarDeNuevoConservaCuandoNacio()
    {
        var diagram = Diagram(Guid.NewGuid()) with
        {
            CreatedAtUtc = new DateTimeOffset(2026, 1, 4, 10, 0, 0, TimeSpan.Zero),
        };

        await _store.SaveAsync(diagram, CancellationToken.None);

        await _store.SaveAsync(
            diagram with { Name = "Ventas y compras", Model = """{"tables":[]}""" },
            CancellationToken.None);

        var found = await _store.FindAsync(diagram.Id, CancellationToken.None);

        Assert.Equal("Ventas y compras", found!.Name);
        Assert.Equal(2026, found.CreatedAtUtc.Year);
        Assert.True(found.UpdatedAtUtc > found.CreatedAtUtc);
    }

    [Fact]
    public async Task BorraElQueSePide()
    {
        var connectionId = Guid.NewGuid();
        var diagram = Diagram(connectionId);

        await _store.SaveAsync(diagram, CancellationToken.None);
        await _store.DeleteAsync(diagram.Id, CancellationToken.None);

        Assert.Null(await _store.FindAsync(diagram.Id, CancellationToken.None));
        Assert.Empty(await _store.GetAllAsync(connectionId, CancellationToken.None));
    }

    [Fact]
    public async Task LosDevuelvePorLoUltimoQueSeToco()
    {
        var connectionId = Guid.NewGuid();
        var primero = Diagram(connectionId, "Primero");
        var segundo = Diagram(connectionId, "Segundo");

        await _store.SaveAsync(primero, CancellationToken.None);
        await _store.SaveAsync(segundo, CancellationToken.None);
        await _store.SaveAsync(primero with { Name = "Primero, retocado" }, CancellationToken.None);

        var found = await _store.GetAllAsync(connectionId, CancellationToken.None);

        Assert.Equal("Primero, retocado", found[0].Name);
    }
}
