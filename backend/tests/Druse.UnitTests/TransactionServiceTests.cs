using Druse.Application.Abstractions;
using Druse.Application.Transactions;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Providers;
using Druse.Infrastructure.Sessions;
using Druse.Provider.MySql;
using Druse.Provider.PostgreSql;
using Microsoft.Data.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Las transacciones que el usuario abre y cierra a mano.
///
/// Se prueban contra una base SQLite en memoria y no contra dobles: lo que hay
/// que comprobar es que **lo escrito dentro desaparece al deshacerla**, y eso un
/// doble no lo puede demostrar. El dialecto no importa aquí, porque lo que se
/// ejercita —abrir, confirmar, deshacer— es lo que los cuatro motores hacen igual.
/// </summary>
public sealed class TransactionServiceTests
{
    [Fact]
    public async Task LoEscritoDentroSobreviveAlConfirmar()
    {
        await using var world = new World();

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);
        await world.InsertAsync("dentro");
        await world.Transactions.CommitAsync(world.Session.Id, CancellationToken.None);

        Assert.Equal(1, await world.CountAsync());
    }

    [Fact]
    public async Task LoEscritoDentroDesapareceAlDeshacer()
    {
        await using var world = new World();

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);
        await world.InsertAsync("dentro");
        await world.Transactions.RollbackAsync(world.Session.Id, CancellationToken.None);

        Assert.Equal(0, await world.CountAsync());
    }

    [Fact]
    public async Task NoSeAbrenDosALaVez()
    {
        await using var world = new World();

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);

        var exception = await Assert.ThrowsAsync<TransactionRejectedException>(() =>
            world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None));

        Assert.Equal(TransactionRefusal.AlreadyOpen, exception.Rejection.Reason);
    }

    [Fact]
    public async Task NoSeConfirmaLaQueNoExiste()
    {
        await using var world = new World();

        var exception = await Assert.ThrowsAsync<TransactionRejectedException>(() =>
            world.Transactions.CommitAsync(world.Session.Id, CancellationToken.None));

        Assert.Equal(TransactionRefusal.NotOpen, exception.Rejection.Reason);
    }

    /// <summary>
    /// En solo lectura no hay nada que confirmar, y la transacción abierta
    /// retendría recursos del servidor a cambio de nada.
    /// </summary>
    [Fact]
    public async Task UnaConexionDeSoloLecturaNoAbreTransaccion()
    {
        await using var world = new World(readOnly: true);

        var exception = await Assert.ThrowsAsync<TransactionRejectedException>(() =>
            world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None));

        Assert.Equal(TransactionRefusal.ReadOnlyConnection, exception.Rejection.Reason);
    }

    /// <summary>
    /// Lo que evita que una transacción olvidada mantenga filas bloqueadas para
    /// todo el mundo mientras su dueño está comiendo.
    /// </summary>
    [Fact]
    public async Task LaTransaccionOlvidadaSeDeshaceSola()
    {
        await using var world = new World(idleTimeout: TimeSpan.Zero);

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);
        await world.InsertAsync("olvidado");

        var abandoned = await world.Transactions.RollbackIdleAsync(CancellationToken.None);

        Assert.Single(abandoned);
        Assert.Equal(0, await world.CountAsync());
        Assert.False(world.Session.Transaction.IsOpen);
    }

    /// <summary>
    /// El usuario no estaba delante cuando pasó, así que el aviso tiene que
    /// esperarle: sin él, sus cambios desaparecerían sin explicación.
    /// </summary>
    [Fact]
    public async Task DeshacerlaSolaDejaAvisoHastaLaSiguiente()
    {
        await using var world = new World(idleTimeout: TimeSpan.Zero);

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);
        await world.Transactions.RollbackIdleAsync(CancellationToken.None);

        var after = world.Transactions.Get(world.Session.Id);

        Assert.False(after.IsOpen);
        Assert.NotNull(after.AutoRolledBackAt);

        var reopened = await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);

        Assert.Null(reopened.AutoRolledBackAt);
    }

    /// <summary>Lo que se deshace es la inactiva, no la larga.</summary>
    [Fact]
    public async Task LaTransaccionConActividadRecienteNoSeToca()
    {
        await using var world = new World(idleTimeout: TimeSpan.FromHours(1));

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);

        var abandoned = await world.Transactions.RollbackIdleAsync(CancellationToken.None);

        Assert.Empty(abandoned);
        Assert.True(world.Session.Transaction.IsOpen);
    }

    /// <summary>
    /// El indicador dice a qué conexión afecta, porque la transacción es de la
    /// conexión y no de la pestaña desde la que se abrió.
    /// </summary>
    [Fact]
    public async Task ElEstadoDiceAQueConexionAfecta()
    {
        await using var world = new World();

        var state = await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);

        Assert.True(state.IsOpen);
        Assert.Equal("preproducción", state.ConnectionName);
        Assert.Equal("ventas", state.Database);
        Assert.NotNull(state.StartedAt);
        Assert.Equal((int)TransactionService.DefaultIdleTimeout.TotalSeconds, state.IdleTimeoutSeconds);
    }

    /// <summary>
    /// En MySQL un `ALTER` queda hecho aunque después se pulse Rollback. La
    /// interfaz necesita saberlo para avisarlo; descubrirlo por su cuenta le
    /// costaría al usuario una tabla que creía revertida.
    /// </summary>
    [Fact]
    public async Task ElEstadoAvisaDeQueElDdlDeMySqlNoSeDeshace()
    {
        await using var postgres = new World();
        await using var mysql = new World(engine: DatabaseEngine.MySql);

        Assert.True(postgres.Transactions.Get(postgres.Session.Id).DdlIsReversible);
        Assert.False(mysql.Transactions.Get(mysql.Session.Id).DdlIsReversible);
    }

    /// <summary>
    /// Una conexión ocupada no puede retrasar al resto.
    ///
    /// Mientras se espera su turno, las demás transacciones olvidadas seguirían
    /// reteniendo filas, que es justo lo que este barrido existe para evitar.
    /// </summary>
    [Fact]
    public async Task UnaSesionOcupadaNoDetieneElBarridoDeLasDemas()
    {
        await using var world = new World(
            idleTimeout: TimeSpan.Zero,
            turnTimeout: TimeSpan.FromMilliseconds(50));

        var otra = world.AddSession();

        await world.Transactions.BeginAsync(world.Session.Id, CancellationToken.None);
        await world.Transactions.BeginAsync(otra.Id, CancellationToken.None);

        // Alguien está usando la primera conexión y no suelta el turno.
        using var ocupada = await world.Sessions.EnterAsync(world.Session.Id, CancellationToken.None);

        var abandoned = await world.Transactions.RollbackIdleAsync(CancellationToken.None);

        Assert.Single(abandoned);
        Assert.Equal(otra.Id, abandoned[0].SessionId);
        Assert.False(otra.Transaction.IsOpen);

        // La ocupada se atenderá en el barrido siguiente, dentro de un minuto.
        Assert.True(world.Session.Transaction.IsOpen);
    }

    /// <summary>Una sesión abierta con una tabla vacía y su servicio ya montado.</summary>
    private sealed class World : IAsyncDisposable
    {
        private readonly SqliteConnection _connection;

        private readonly List<SqliteConnection> _extra = [];

        public World(
            bool readOnly = false,
            TimeSpan? idleTimeout = null,
            DatabaseEngine engine = DatabaseEngine.PostgreSql,
            TimeSpan? turnTimeout = null)
        {
            // La base en memoria vive mientras viva su conexión, que es
            // exactamente lo que dura una sesión.
            _connection = new SqliteConnection("Data Source=:memory:");
            _connection.Open();

            using var create = _connection.CreateCommand();
            create.CommandText = "CREATE TABLE clientes (nombre TEXT)";
            create.ExecuteNonQuery();

            Session = new FakeSession(_connection, readOnly, engine);

            Sessions = new SessionRegistry();
            Sessions.Add(Session);

            var providers = new ProviderRegistry(
                [],
                [],
                [],
                [],
                [new PostgreSqlTableDesigner(), new MySqlTableDesigner()],
                []);

            Transactions = new TransactionService(providers, Sessions, idleTimeout, turnTimeout);
        }

        public FakeSession Session { get; }

        public SessionRegistry Sessions { get; }

        /// <summary>Otra conexión del mismo proceso, con su propia transacción.</summary>
        public FakeSession AddSession()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            connection.Open();
            _extra.Add(connection);

            var session = new FakeSession(connection, readOnly: false, DatabaseEngine.PostgreSql);
            Sessions.Add(session);

            return session;
        }

        public TransactionService Transactions { get; }

        /// <summary>Escribe por la conexión de la sesión, dentro de lo que haya abierto.</summary>
        public async Task InsertAsync(string nombre)
        {
            await using var command = _connection.CreateCommand();
            command.CommandText = "INSERT INTO clientes (nombre) VALUES ($n)";
            command.Parameters.AddWithValue("$n", nombre);
            command.Transaction = (SqliteTransaction?)Session.Transaction.Current;

            await command.ExecuteNonQueryAsync();
        }

        public async Task<long> CountAsync()
        {
            await using var command = _connection.CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM clientes";
            command.Transaction = (SqliteTransaction?)Session.Transaction.Current;

            return (long)(await command.ExecuteScalarAsync())!;
        }

        public async ValueTask DisposeAsync()
        {
            await Session.DisposeAsync();
            await _connection.DisposeAsync();

            foreach (var connection in _extra)
            {
                await connection.DisposeAsync();
            }
        }
    }

    private sealed class FakeSession(
        SqliteConnection connection,
        bool readOnly,
        DatabaseEngine engine) : IDatabaseSession
    {
        public Guid Id { get; } = Guid.NewGuid();

        public DatabaseEngine Engine => engine;

        public SessionTransaction Transaction { get; } = new(connection);

        /// <summary>Los dobles no hablan con ningún motor: no hay nada que garantizar.</summary>
        public bool ReadOnlyEnforcedByEngine => false;

        public ConnectionProfile Profile => new()
        {
            Id = Guid.NewGuid(),
            Name = "preproducción",
            Engine = engine,
            Host = "localhost",
            Port = 5432,
            Database = "ventas",
            Username = "druse",
            ReadOnly = readOnly,
        };

        public string ServerVersion => "0";

        public bool IsOpen => true;

        public ValueTask DisposeAsync() => Transaction.DisposeAsync();
    }
}
