using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Rows;
using Druse.Application.Transfers;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Sessions;
using Druse.Provider.Informix;
using Druse.Provider.MySql;
using Druse.Provider.PostgreSql;
using Druse.Provider.SqlServer;

namespace Druse.UnitTests;

/// <summary>
/// Lo que el traslado decide **antes** de tocar ninguna base.
///
/// Es donde vive la seguridad de la función: a qué columna va cada columna, qué se
/// niega a hacer y qué exige que se confirme. Todo esto se comprueba sin servidor
/// porque no depende de ninguno, y porque un error aquí no se ve en las pruebas de
/// integración: se ve en los datos del destino, semanas después.
/// </summary>
public sealed class TransferPlanTests
{
    // -----------------------------------------------------------------------
    // Lo que se niega a hacer
    // -----------------------------------------------------------------------

    /// <summary>
    /// Una conexión marcada como solo lectura no recibe filas.
    ///
    /// Es la misma promesa que hace el editor de filas, y romperla aquí sería
    /// peor: quien marca así una conexión suele ser porque es la de producción.
    /// </summary>
    [Fact]
    public async Task UnDestinoDeSoloLecturaNoRecibeNada()
    {
        var world = new World(targetReadOnly: true);

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(world.Request(), CancellationToken.None));

        Assert.Equal(RowEditRefusal.ReadOnlyConnection, rejection.Rejection.Reason);
    }

    /// <summary>
    /// Vaciar la tabla destino exige escribir su nombre.
    ///
    /// Una casilla marcada sin querer no se distingue de una marcada a propósito,
    /// y este es el único modo del traslado que borra lo que ya había.
    /// </summary>
    [Fact]
    public async Task VaciarYCargarExigeEscribirElNombreDeLaTabla()
    {
        var world = new World();

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.RunAsync(
                world.Request() with { Mode = TransferMode.Replace, Confirmed = true },
                progress: null,
                CancellationToken.None));

        Assert.Equal(RowEditRefusal.Unconfirmed, rejection.Rejection.Reason);
        Assert.Contains("escribir el nombre", rejection.Rejection.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Con el nombre bien escrito ya no es la confirmación lo que falta.
    ///
    /// De paso queda dicha la otra mitad del contrato: **un rechazo se lanza y un
    /// fallo de ejecución se devuelve**. Lo primero es «esto no se va a hacer» y
    /// tiene que llegar como error a quien lo pidió; lo segundo es «se intentó y
    /// se rompió por aquí», y eso es un resultado con su recuento de filas.
    /// </summary>
    [Fact]
    public async Task VaciarYCargarPasaLaConfirmacionConElNombreExacto()
    {
        var world = new World();

        var request = world.Request() with
        {
            Mode = TransferMode.Replace,
            Confirmed = true,
            ReplaceConfirmation = "pedidos",
        };

        var progress = await world.Service.RunAsync(request, progress: null, CancellationToken.None);

        // Falla, porque este doble no sabe leer filas de ninguna parte. Lo que
        // importa es que falló **ejecutando** y no en las comprobaciones.
        Assert.Equal(TransferOutcome.Failed, progress.Outcome);
        Assert.Equal(0, progress.RowsCopied);
    }

    /// <summary>Y con el nombre mal escrito ni siquiera se intenta.</summary>
    [Fact]
    public async Task VaciarYCargarConOtroNombreNoSeIntenta()
    {
        var world = new World();

        var request = world.Request() with
        {
            Mode = TransferMode.Replace,
            Confirmed = true,
            ReplaceConfirmation = "pedidos_viejos",
        };

        await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.RunAsync(request, progress: null, CancellationToken.None));
    }

    /// <summary>Escribir sin haber visto la vista previa no se admite.</summary>
    [Fact]
    public async Task TrasladarSinConfirmarNoEscribeNada()
    {
        var world = new World();

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.RunAsync(
                world.Request(),
                progress: null,
                CancellationToken.None));

        Assert.Equal(RowEditRefusal.Unconfirmed, rejection.Rejection.Reason);
    }

    // -----------------------------------------------------------------------
    // Reconocer la fila que ya está
    // -----------------------------------------------------------------------

    /// <summary>
    /// Sin clave primaria no hay forma de saber qué fila del destino es cuál.
    ///
    /// Se dice antes de empezar y no cuando el motor se queje: para entonces el
    /// mensaje sería suyo y no diría qué se pretendía.
    /// </summary>
    [Theory]
    [InlineData(TransferMode.Upsert)]
    [InlineData(TransferMode.SkipExisting)]
    public async Task SinClavePrimariaNoSePuedeReconocerLoQueYaEsta(TransferMode mode)
    {
        var world = new World();

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(
                world.Request() with { Mode = mode },
                CancellationToken.None));

        Assert.Equal(RowEditRefusal.NoPrimaryKey, rejection.Rejection.Reason);
    }

    /// <summary>Con clave primaria, esas son las columnas que se usan sin decir nada.</summary>
    [Fact]
    public async Task LaClavePrimariaDelDestinoEsLaQueSeUsaPorOmision()
    {
        var world = new World(source: ["id", "nombre"], target: ["id", "nombre"], primaryKey: ["id"]);

        var preview = await world.Service.PreviewAsync(
            world.Request() with { Mode = TransferMode.Upsert },
            CancellationToken.None);

        Assert.Equal(["id"], preview.KeyColumns);
    }

    /// <summary>
    /// Reconocer la fila por columnas que se pueden repetir se rechaza.
    ///
    /// Sin unicidad, «actualiza la que ya está» toca todas las que coinciden: no
    /// falla, no avisa, y deja el destino con filas que nadie pidió cambiar. Es
    /// el mismo accidente que el resto del editor de filas existe para impedir.
    /// </summary>
    [Fact]
    public async Task UnaClaveQueSePuedeRepetirSeRechaza()
    {
        var world = new World(source: ["id", "nombre"], target: ["id", "nombre"], primaryKey: ["id"]);

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(
                world.Request() with { Mode = TransferMode.Upsert, KeyColumns = ["nombre"] },
                CancellationToken.None));

        Assert.Equal(RowEditRefusal.KeyMismatch, rejection.Rejection.Reason);
        Assert.Contains("no hay nada que garantice", rejection.Rejection.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Una clave que no se copia no sirve para reconocer nada.
    ///
    /// Si la columna no viaja, todas las filas se parecerían en la clave y la
    /// primera actualizaría a la siguiente.
    /// </summary>
    [Fact]
    public async Task UnaClaveQueNoSeCopiaSeRechaza()
    {
        var world = new World(source: ["nombre"], target: ["id", "nombre"], primaryKey: ["id"]);

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(
                world.Request() with { Mode = TransferMode.Upsert },
                CancellationToken.None));

        Assert.Equal(RowEditRefusal.KeyMismatch, rejection.Rejection.Reason);
        Assert.Contains("id", rejection.Rejection.Message, StringComparison.Ordinal);
    }

    /// <summary>Una restricción de unicidad vale igual que la clave primaria.</summary>
    [Fact]
    public async Task UnaRestriccionDeUnicidadTambienSirveParaReconocerLaFila()
    {
        var world = new World(
            source: ["id", "codigo"],
            target: ["id", "codigo"],
            primaryKey: ["id"],
            unique: ["codigo"]);

        var preview = await world.Service.PreviewAsync(
            world.Request() with { Mode = TransferMode.Upsert, KeyColumns = ["codigo"] },
            CancellationToken.None);

        Assert.Equal(["codigo"], preview.KeyColumns);
    }

    /// <summary>Los modos que solo añaden no preguntan por ninguna clave.</summary>
    [Fact]
    public async Task InsertarNoNecesitaSaberQueIdentificaLaFila()
    {
        var world = new World();

        var preview = await world.Service.PreviewAsync(world.Request(), CancellationToken.None);

        Assert.Empty(preview.KeyColumns);
    }

    /// <summary>
    /// Entre motores distintos, la vista previa dice qué tipo tendría cada
    /// columna al otro lado.
    ///
    /// Y dentro del mismo motor no dice nada, porque no hay nada que traducir:
    /// los tipos de las dos tablas ya son del mismo dialecto.
    /// </summary>
    [Fact]
    public async Task EntreMotoresDistintosLaVistaPreviaTraduceLosTipos()
    {
        var world = new World(targetEngine: DatabaseEngine.SqlServer);

        var preview = await world.Service.PreviewAsync(world.Request(), CancellationToken.None);

        var translation = Assert.Single(preview.Translations);

        Assert.Equal("id", translation.Column);
        Assert.Equal("nvarchar(max)", translation.TargetType);
    }

    [Fact]
    public async Task DentroDelMismoMotorNoHayNadaQueTraducir()
    {
        var world = new World();

        var preview = await world.Service.PreviewAsync(world.Request(), CancellationToken.None);

        Assert.Empty(preview.Translations);
    }

    // -----------------------------------------------------------------------
    // El emparejado de columnas
    // -----------------------------------------------------------------------

    /// <summary>
    /// Sin indicaciones, las columnas se emparejan por nombre sin distinguir
    /// mayúsculas, y lo que no case se queda fuera.
    /// </summary>
    [Fact]
    public async Task SinMapeoLasColumnasSeEmparejanPorNombre()
    {
        var world = new World(
            source: ["id", "Cliente", "telefono"],
            target: ["ID", "cliente", "codigo_postal"]);

        var preview = await world.Service.PreviewAsync(
            world.Request(),
            CancellationToken.None);

        Assert.Equal("ID", Target(preview, "id"));
        Assert.Equal("cliente", Target(preview, "Cliente"));

        // Lo que no case **no** se coloca por posición: así es exactamente como se
        // copian teléfonos a la columna del código postal.
        Assert.Null(Target(preview, "telefono"));
        Assert.Contains("telefono", preview.UnmatchedSource, StringComparer.Ordinal);
    }

    /// <summary>Una columna del origen que no existe se dice por su nombre.</summary>
    [Fact]
    public async Task UnaColumnaDeOrigenInventadaSeRechaza()
    {
        var world = new World(source: ["id"], target: ["id"]);

        var request = world.Request() with
        {
            Mappings = [new ColumnMapping("no_existe", "id")],
        };

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(request, CancellationToken.None));

        Assert.Equal(RowEditRefusal.UnknownColumn, rejection.Rejection.Reason);
        Assert.Contains("no_existe", rejection.Rejection.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Dos columnas del origen no pueden ir a la misma del destino.
    ///
    /// El motor solo se quejaría de un `INSERT` con la columna repetida, y su
    /// mensaje no diría cuál fue el error del asistente.
    /// </summary>
    [Fact]
    public async Task DosColumnasNoPuedenIrALaMisma()
    {
        var world = new World(source: ["nombre", "apellido"], target: ["nombre"]);

        var request = world.Request() with
        {
            Mappings =
            [
                new ColumnMapping("nombre", "nombre"),
                new ColumnMapping("apellido", "nombre"),
            ],
        };

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(request, CancellationToken.None));

        Assert.Contains("solo puede recibir una", rejection.Rejection.Message, StringComparison.Ordinal);
    }

    /// <summary>Si nada casa, se dice antes de leer una sola fila.</summary>
    [Fact]
    public async Task SinNingunaColumnaEnComunNoHayTraslado()
    {
        var world = new World(source: ["a"], target: ["b"]);

        var rejection = await Assert.ThrowsAsync<RowEditRejectedException>(
            () => world.Service.PreviewAsync(world.Request(), CancellationToken.None));

        Assert.Equal(RowEditRefusal.UnknownColumn, rejection.Rejection.Reason);
    }

    /// <summary>
    /// Las columnas obligatorias que nadie llena se avisan, pero no impiden nada.
    ///
    /// La columna puede tener un valor por omisión, así que negarse sería decidir
    /// por el usuario; callarlo, en cambio, deja que el motor rechace el primer
    /// lote sin que nadie sepa por qué.
    /// </summary>
    [Fact]
    public async Task LasColumnasObligatoriasSinOrigenSeAvisan()
    {
        var world = new World(
            source: ["id"],
            target: ["id"],
            targetRequired: "creado_por");

        var preview = await world.Service.PreviewAsync(
            world.Request(),
            CancellationToken.None);

        Assert.Contains("creado_por", preview.MissingRequired, StringComparer.Ordinal);
    }

    // -----------------------------------------------------------------------
    // El tamaño de lote
    // -----------------------------------------------------------------------

    /// <summary>
    /// Un lote sin sentido no llega al motor: se ajusta.
    ///
    /// Cero o negativo vendría de un formulario a medio rellenar, y un millón de
    /// filas por lote solo retiene memoria sin ir más rápido.
    /// </summary>
    [Theory]
    [InlineData(0, DataTransferRequest.DefaultBatchSize)]
    [InlineData(-5, DataTransferRequest.DefaultBatchSize)]
    [InlineData(250, 250)]
    [InlineData(1_000_000, DataTransferRequest.MaxBatchSize)]
    public void ElTamanoDeLoteSeAjustaALoQueSeAdmite(int asked, int expected)
    {
        var request = new DataTransferRequest
        {
            SourceSessionId = Guid.NewGuid(),
            Source = Table("pedidos"),
            TargetSessionId = Guid.NewGuid(),
            Target = Table("pedidos"),
            BatchSize = asked,
        };

        Assert.Equal(expected, request.ValidBatchSize);
    }

    // -----------------------------------------------------------------------
    // Vaciar la tabla destino
    // -----------------------------------------------------------------------

    public static TheoryData<IDatabaseScripter> Scripters() =>
    [
        new PostgreSqlTableDesigner(),
        new SqlServerTableDesigner(),
        new MySqlTableDesigner(),
        new InformixTableDesigner(),
    ];

    /// <summary>
    /// Vaciar es un `DELETE` y nunca un `TRUNCATE`.
    ///
    /// No es una preferencia de estilo: MySQL confirma la transacción en curso al
    /// truncar —con lo que «todo o nada» dejaría de ser cierto justo en el modo
    /// que borra— y truncar falla en cuanto otra tabla apunte a esta, que es lo
    /// normal en la tabla que uno quiere reemplazar.
    /// </summary>
    [Theory]
    [MemberData(nameof(Scripters))]
    public void VaciarLaTablaEsUnDeleteYNoUnTruncate(IDatabaseScripter scripter)
    {
        ArgumentNullException.ThrowIfNull(scripter);

        var statements = scripter.ScriptClearTable(new ScriptedTable
        {
            Table = Table("pedidos", "ventas"),
            Columns = [],
            Structure = new TableStructure(),
        });

        var sql = Assert.Single(statements);

        Assert.StartsWith("DELETE FROM ", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("TRUNCATE", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("pedidos", sql, StringComparison.Ordinal);
    }

    // -----------------------------------------------------------------------
    // Andamiaje
    // -----------------------------------------------------------------------

    private static string? Target(TransferPreview preview, string source) =>
        preview.Mappings.First(mapping =>
            string.Equals(mapping.Source, source, StringComparison.Ordinal)).Target;

    private static DatabaseObject Table(string name, string? schema = null) => new()
    {
        Id = schema is null ? name : $"{schema}.{name}",
        Name = name,
        Kind = DatabaseObjectKind.Table,
        Database = "druse_test",
        Schema = schema,
    };

    /// <summary>
    /// Dos sesiones abiertas y un catálogo de mentira.
    ///
    /// No hay servidor detrás: lo que se prueba aquí es lo que se decide antes de
    /// hablar con ninguno, y montar contenedores para comprobar un emparejado de
    /// nombres haría que estas pruebas dejaran de ejecutarse en cualquier máquina.
    /// </summary>
    private sealed class World
    {
        public World(
            IReadOnlyList<string>? source = null,
            IReadOnlyList<string>? target = null,
            bool targetReadOnly = false,
            DatabaseEngine targetEngine = DatabaseEngine.PostgreSql,
            string? targetRequired = null,
            IReadOnlyList<string>? primaryKey = null,
            IReadOnlyList<string>? unique = null)
        {
            SourceSession = new FakeSession(DatabaseEngine.PostgreSql, readOnly: false);
            TargetSession = new FakeSession(targetEngine, targetReadOnly);

            var sessions = new SessionRegistry();
            sessions.Add(SourceSession);
            sessions.Add(TargetSession);

            var catalog = new Dictionary<Guid, IReadOnlyList<DatabaseColumn>>
            {
                [SourceSession.Id] = Columns(source ?? ["id"]),
                [TargetSession.Id] = [
                    .. Columns(target ?? ["id"]),
                    .. targetRequired is null
                        ? Array.Empty<DatabaseColumn>()
                        : [Required(targetRequired, (target ?? ["id"]).Count + 1)],
                ],
            };

            var structure = new TableStructure
            {
                PrimaryKey = primaryKey is null
                    ? null
                    : new DatabasePrimaryKey { Name = "pk", Columns = primaryKey },
                UniqueConstraints = unique is null
                    ? []
                    : [new DatabaseUniqueConstraint { Name = "uq", Columns = unique }],
            };

            var providers = new FakeRegistry(catalog, structure, SourceSession, TargetSession);
            var connections = new ConnectionService(
                providers,
                sessions,
                new FakeTunnelFactory(),
                new FakeTunnelRegistry());

            Service = new TransferService(
                providers,
                connections,
                new MetadataService(providers, connections),
                new TypeTranslator(providers));
        }

        public FakeSession SourceSession { get; }

        public FakeSession TargetSession { get; }

        public TransferService Service { get; }

        public DataTransferRequest Request() => new()
        {
            SourceSessionId = SourceSession.Id,
            Source = Table("pedidos"),
            TargetSessionId = TargetSession.Id,
            Target = Table("pedidos"),
        };

        private static List<DatabaseColumn> Columns(IReadOnlyList<string> names) =>
        [
            .. names.Select((name, index) => new DatabaseColumn
            {
                Name = name,
                DataType = "text",
                IsNullable = true,
                Ordinal = index + 1,
            }),
        ];

        private static DatabaseColumn Required(string name, int ordinal) => new()
        {
            Name = name,
            DataType = "text",
            IsNullable = false,
            Ordinal = ordinal,
        };
    }

    private sealed class FakeSession(DatabaseEngine engine, bool readOnly) : IDatabaseSession
    {
        private bool _disposed;

        public Guid Id { get; } = Guid.NewGuid();

        public DatabaseEngine Engine => engine;

        /// <summary>No habla con ningún motor, así que no hay dónde abrir una.</summary>
        public SessionTransaction Transaction => SessionTransaction.None;

        public ConnectionProfile Profile { get; } = new()
        {
            Id = Guid.NewGuid(),
            Name = readOnly ? "prod" : "dev",
            Engine = engine,
            Host = "127.0.0.1",
            Port = 5432,
            Database = "druse_test",
            Username = "druse",
            ReadOnly = readOnly,
        };

        public string ServerVersion => "18.0";

        public bool IsOpen => !_disposed;

        public ValueTask DisposeAsync()
        {
            _disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    /// <summary>
    /// Registro que solo sabe leer el catálogo de mentira.
    ///
    /// Lo demás se deja sin implementar en lugar de escribir dobles que nadie
    /// llamaría: estas pruebas paran antes de escribir una sola fila.
    /// </summary>
    private sealed class FakeRegistry(
        IReadOnlyDictionary<Guid, IReadOnlyList<DatabaseColumn>> catalog,
        TableStructure structure,
        IDatabaseSession source,
        IDatabaseSession target) : IProviderRegistry
    {
        public IReadOnlyCollection<DatabaseEngine> SupportedEngines =>
            [source.Engine, target.Engine];

        public IDatabaseProvider GetProvider(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IDatabaseMetadataReader GetMetadataReader(DatabaseEngine engine) =>
            new FakeMetadataReader(catalog, structure);

        public IQueryExecutor GetQueryExecutor(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IRowEditor GetRowEditor(DatabaseEngine engine) => new PostgreSqlRowEditor();

        /// <summary>
        /// El diseñador **del motor que se pide**, no el de siempre.
        ///
        /// Importa desde que se traducen tipos: devolver el de PostgreSQL para
        /// todos haría que una traducción a SQL Server contestara con tipos de
        /// PostgreSQL y la prueba pasara diciendo lo contrario de lo que mira.
        /// </summary>
        public ITableDesigner GetTableDesigner(DatabaseEngine engine) => engine switch
        {
            DatabaseEngine.SqlServer => new SqlServerTableDesigner(),
            DatabaseEngine.MySql => new MySqlTableDesigner(),
            DatabaseEngine.Informix => new InformixTableDesigner(),
            _ => new PostgreSqlTableDesigner(),
        };

        public IDatabaseScripter GetScripter(DatabaseEngine engine) =>
            new PostgreSqlTableDesigner();
    }

    private sealed class FakeMetadataReader(
        IReadOnlyDictionary<Guid, IReadOnlyList<DatabaseColumn>> catalog,
        TableStructure structure) : IDatabaseMetadataReader
    {
        public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

        public Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
            IDatabaseSession session,
            DatabaseObject table,
            CancellationToken cancellationToken) =>
            Task.FromResult(catalog[session.Id]);

        public Task<TableStructure> GetTableStructureAsync(
            IDatabaseSession session,
            DatabaseObject table,
            CancellationToken cancellationToken) =>
            Task.FromResult(structure);

        public Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
            IDatabaseSession session,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<DatabaseObject>> GetChildrenAsync(
            IDatabaseSession session,
            DatabaseObject parent,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<string> GetDefinitionAsync(
            IDatabaseSession session,
            DatabaseObject item,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<RoutineSignature> GetRoutineSignatureAsync(
            IDatabaseSession session,
            DatabaseObject routine,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    /// <summary>Ninguna de estas pruebas abre una conexión, así que nada de esto se llama.</summary>
    private sealed class FakeTunnelFactory : ISshTunnelFactory
    {
        public Task<ISshTunnel> OpenAsync(
            SshTunnelSettings settings,
            SshCredentials credentials,
            string remoteHost,
            int remotePort,
            CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    private sealed class FakeTunnelRegistry : ISshTunnelRegistry
    {
        public void Add(Guid sessionId, ISshTunnel tunnel)
        {
        }

        public Task<bool> CloseAsync(Guid sessionId) => Task.FromResult(false);

        public Task CloseAllAsync() => Task.CompletedTask;
    }
}
