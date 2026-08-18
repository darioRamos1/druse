using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Lo que un perfil de respaldo tiene que sobrevivir: cerrar la aplicación.
///
/// La selección, las anulaciones y los filtros van como JSON dentro de una
/// columna, así que aquí se comprueba lo que esa decisión pone en riesgo —que
/// vuelvan tal cual—, y no que SQLite sepa guardar texto.
/// </summary>
public sealed class BackupProfileStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly DruseDatabase _database;
    private readonly SqliteBackupProfileStore _store;

    public BackupProfileStoreTests()
    {
        _database = new DruseDatabase(_paths);
        _database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteBackupProfileStore(_database);
    }

    public void Dispose() => _paths.Dispose();

    private static BackupProfile Profile(string name = "Estructura a desarrollo") => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        ConnectionId = Guid.NewGuid(),
        Database = "druse_test",
        Selection =
        [
            BackupSelector.ForSchema("tienda"),
            BackupSelector.ForTable("public", "clientes"),
        ],
        Data = new DataSelection
        {
            Default = TableDataMode.StructureOnly,
            Overrides = new Dictionary<string, TableDataMode>(StringComparer.Ordinal)
            {
                ["tienda.cat_paises"] = TableDataMode.StructureAndData,
            },
            Filters = new Dictionary<string, TableDataFilter>(StringComparer.Ordinal)
            {
                ["tienda.pedidos"] = new TableDataFilter
                {
                    Where = "creado > '2026-01-01'",
                    MaxRows = 500,
                    ExcludedColumns = ["notas"],
                },
            },
        },
        Output = new BackupOutput
        {
            Layout = BackupLayout.FolderByKind,
            Data = BackupDataFormat.Csv,
            Compress = true,
        },
        Destination = @"C:\respaldos\tienda",
        KnownTables = ["tienda.cat_paises", "tienda.pedidos"],
        CreatedAtUtc = DateTimeOffset.UtcNow.AddDays(-30),
        UpdatedAtUtc = DateTimeOffset.UtcNow.AddDays(-30),
    };

    [Fact]
    public async Task GuardaYDevuelveElPerfilEntero()
    {
        var profile = Profile();

        await _store.SaveAsync(profile, CancellationToken.None);

        var found = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(found);
        Assert.Equal(profile.Name, found.Name);
        Assert.Equal(profile.ConnectionId, found.ConnectionId);
        Assert.Equal(profile.Destination, found.Destination);
        Assert.Equal(TableDataMode.StructureOnly, found.Data.Default);
        Assert.Equal(BackupLayout.FolderByKind, found.Output.Layout);
        Assert.Equal(BackupDataFormat.Csv, found.Output.Data);
        Assert.True(found.Output.Compress);
    }

    /// <summary>
    /// Un esquema guardado como esquema tiene que volver como esquema.
    ///
    /// Es la diferencia entera del §3.1: si al releerlo se convirtiera en la lista
    /// de sus tablas de aquel día, el perfil dejaría de recoger lo que se cree
    /// después y nadie lo notaría hasta echar en falta una tabla.
    /// </summary>
    [Fact]
    public async Task ConservaSiSeEligióUnEsquemaEnteroOUnaTablaSuelta()
    {
        var profile = Profile();

        await _store.SaveAsync(profile, CancellationToken.None);

        var found = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(found);
        Assert.Equal(2, found.Selection.Count);
        Assert.Equal(BackupSelectorKind.Schema, found.Selection[0].Kind);
        Assert.Equal("tienda", found.Selection[0].Schema);
        Assert.Null(found.Selection[0].Name);
        Assert.Equal(BackupSelectorKind.Table, found.Selection[1].Kind);
        Assert.Equal("public.clientes", found.Selection[1].Label);
    }

    [Fact]
    public async Task ConservaLasAnulacionesYLosFiltrosPorTabla()
    {
        var profile = Profile();

        await _store.SaveAsync(profile, CancellationToken.None);

        var found = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(found);
        Assert.Equal(
            TableDataMode.StructureAndData,
            found.Data.Overrides["tienda.cat_paises"]);

        var filter = found.Data.Filters["tienda.pedidos"];

        Assert.Equal("creado > '2026-01-01'", filter.Where);
        Assert.Equal(500, filter.MaxRows);
        Assert.Equal(["notas"], filter.ExcludedColumns);
    }

    /// <summary>
    /// Guardar un cambio no vuelve nuevo al perfil ni borra que se lanzó ayer.
    ///
    /// Importa porque la lista se ordena por lo último que se usó: si actualizar
    /// pisara esa fecha, renombrar un perfil lo mandaría al principio de la lista
    /// sin haberlo ejecutado.
    /// </summary>
    [Fact]
    public async Task AlActualizarConservaLaFechaDeCreaciónYLaDeÚltimaEjecución()
    {
        var profile = Profile();

        await _store.SaveAsync(profile, CancellationToken.None);

        var run = DateTimeOffset.UtcNow;

        Assert.True(await _store.TouchAsync(profile.Id, run, CancellationToken.None));

        await _store.SaveAsync(
            profile with { Name = "Otro nombre", CreatedAtUtc = DateTimeOffset.UtcNow },
            CancellationToken.None);

        var found = await _store.FindAsync(profile.Id, CancellationToken.None);

        Assert.NotNull(found);
        Assert.Equal("Otro nombre", found.Name);
        Assert.Equal(profile.CreatedAtUtc.ToUnixTimeSeconds(), found.CreatedAtUtc.ToUnixTimeSeconds());
        Assert.NotNull(found.LastRunAtUtc);
        Assert.Equal(run.ToUnixTimeSeconds(), found.LastRunAtUtc.Value.ToUnixTimeSeconds());
    }

    [Fact]
    public async Task LaListaEmpiezaPorElUsadoMásRecientemente()
    {
        var viejo = Profile("Viejo");
        var reciente = Profile("Reciente");

        await _store.SaveAsync(viejo, CancellationToken.None);
        await _store.SaveAsync(reciente, CancellationToken.None);

        await _store.TouchAsync(viejo.Id, DateTimeOffset.UtcNow.AddDays(-7), CancellationToken.None);
        await _store.TouchAsync(reciente.Id, DateTimeOffset.UtcNow, CancellationToken.None);

        var all = await _store.GetAllAsync(CancellationToken.None);

        Assert.Equal(["Reciente", "Viejo"], all.Select(profile => profile.Name));
    }

    [Fact]
    public async Task BorrarDevuelveFalsoCuandoNoExistía()
    {
        var profile = Profile();

        await _store.SaveAsync(profile, CancellationToken.None);

        Assert.True(await _store.DeleteAsync(profile.Id, CancellationToken.None));
        Assert.False(await _store.DeleteAsync(profile.Id, CancellationToken.None));
        Assert.Null(await _store.FindAsync(profile.Id, CancellationToken.None));
    }

    [Fact]
    public async Task AnotarUnaEjecuciónDeUnPerfilQueNoExisteNoInventaNada()
    {
        Assert.False(
            await _store.TouchAsync(Guid.NewGuid(), DateTimeOffset.UtcNow, CancellationToken.None));

        Assert.Empty(await _store.GetAllAsync(CancellationToken.None));
    }
}
