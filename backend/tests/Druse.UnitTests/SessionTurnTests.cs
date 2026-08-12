using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Sessions;

namespace Druse.UnitTests;

/// <summary>
/// Una sesión es **una conexión**, y una conexión no ejecuta dos cosas a la vez.
///
/// El caso real: al conectar, el precalentado del catálogo pedía las tablas y
/// las vistas de un esquema a la vez, y SQL Server respondía que la conexión «no
/// es compatible con MultipleActiveResultSets». Bastaba con expandir dos nodos
/// seguidos del árbol para provocarlo, así que el turno tiene que estar en el
/// servidor y no solo en la buena educación del cliente.
/// </summary>
public sealed class SessionTurnTests
{
    [Fact]
    public async Task DosUsosDeLaMismaSesion_NoSeSolapan()
    {
        var registry = new SessionRegistry();
        var session = new FakeSession();
        registry.Add(session);

        var dentro = 0;
        var solapes = 0;

        async Task Usar()
        {
            using var turn = await registry.EnterAsync(session.Id, CancellationToken.None);

            if (Interlocked.Increment(ref dentro) > 1)
            {
                Interlocked.Increment(ref solapes);
            }

            // Sin la espera, el segundo podría entrar cuando el primero ya salió
            // y la prueba pasaría sin comprobar nada.
            await Task.Delay(50);

            Interlocked.Decrement(ref dentro);
        }

        await Task.WhenAll(Usar(), Usar(), Usar());

        Assert.Equal(0, solapes);
    }

    [Fact]
    public async Task ElTurnoSeLibera_AunqueElTrabajoFalle()
    {
        var registry = new SessionRegistry();
        var session = new FakeSession();
        registry.Add(session);

        await Assert.ThrowsAsync<InvalidOperationException>(async () =>
        {
            using var turn = await registry.EnterAsync(session.Id, CancellationToken.None);
            throw new InvalidOperationException("algo salió mal");
        });

        // Si el turno no se devolviera, la sesión quedaría inutilizable para
        // siempre: cualquier petición posterior esperaría sin fin.
        using var cancelacion = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        using var siguiente = await registry.EnterAsync(session.Id, cancelacion.Token);

        Assert.NotNull(siguiente);
    }

    [Fact]
    public async Task SesionesDistintas_NoSeEsperanEntreSi()
    {
        var registry = new SessionRegistry();
        var primera = new FakeSession();
        var segunda = new FakeSession();
        registry.Add(primera);
        registry.Add(segunda);

        using var retenida = await registry.EnterAsync(primera.Id, CancellationToken.None);

        // Cada conexión va por su cuenta; encolarlas todas juntas sería
        // convertir el servidor en un embudo.
        using var cancelacion = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        using var otra = await registry.EnterAsync(segunda.Id, cancelacion.Token);

        Assert.NotNull(otra);
    }

    /// <summary>Sesión que no habla con ningún motor.</summary>
    private sealed class FakeSession : IDatabaseSession
    {
        public Guid Id { get; } = Guid.NewGuid();

        public DatabaseEngine Engine => DatabaseEngine.PostgreSql;

        public ConnectionProfile Profile => new()
        {
            Id = Guid.NewGuid(),
            Name = "prueba",
            Engine = DatabaseEngine.PostgreSql,
            Host = "localhost",
            Port = 5432,
            Database = "x",
            Username = "y",
        };

        public string ServerVersion => "0";

        public bool IsOpen => true;

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
