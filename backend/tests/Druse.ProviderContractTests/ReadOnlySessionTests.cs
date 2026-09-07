using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Qué pasa de verdad cuando una conexión está marcada como «solo lectura».
///
/// Druse tiene un analizador de SQL que avisa antes de mandar nada al motor, pero
/// **eso no es una frontera de seguridad**: es un análisis del texto, y hay
/// escrituras que no ve —un procedimiento que escribe por dentro, un `SELECT
/// INTO`—. Estas pruebas comprueban la otra mitad: que donde el motor tiene
/// sesiones de solo lectura, Druse las usa; y que donde no las tiene, no se
/// promete lo contrario.
///
/// Van por motor y no en el contrato común a propósito: **lo que se comprueba es
/// distinto en cada uno**, y esa diferencia es justo el resultado.
/// </summary>
public sealed class ReadOnlySessionTests
{
    /// <summary>
    /// PostgreSQL sí tiene sesiones de solo lectura, y esta prueba usa el caso que
    /// mejor lo demuestra: `SELECT … INTO` **crea una tabla** y el analizador de
    /// Druse no lo marca como escritura —no lleva ninguna de sus palabras—, así
    /// que llega intacto al servidor. Si el motor no lo parase, no lo pararía
    /// nadie.
    /// </summary>
    [Fact]
    public async Task PostgreSql_ConSesionDeSoloLectura_ElMotorRechazaUnSelectInto()
    {
        var fixture = new PostgreSqlFixture();

        if (!fixture.IsAvailable) { return; }

        var tabla = $"druse_ro_{Guid.NewGuid():N}"[..24];

        await using var session = await fixture.Provider.OpenSessionAsync(
            fixture.Profile(onlyRead: true),
            fixture.Credentials,
            CancellationToken.None);

        Assert.True(
            session.ReadOnlyEnforcedByEngine,
            "PostgreSQL admite sesiones de solo lectura: Druse tiene que pedirlas.");

        // Lo que el analizador de Druse dejaría pasar, porque no dice INSERT ni
        // CREATE en ninguna parte.
        Assert.False(SqlSafetyAnalyzer.IsMutating($"SELECT 1 AS uno INTO {tabla}"));

        // La sesión está en solo lectura de verdad, y lo dice el propio servidor.
        var estado = await fixture.Executor.ExecuteAsync(
            session,
            Query("SHOW default_transaction_read_only"),
            CancellationToken.None);

        Assert.Equal("on", estado.ResultSets[0].Rows[0][0]);

        // El ejecutor no lanza: un error del motor es un resultado fallido, que
        // es lo que la interfaz enseña.
        var rechazado = await fixture.Executor.ExecuteAsync(
            session,
            Query($"SELECT 1 AS uno INTO {tabla}"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Failed, rechazado.State);
        Assert.Contains(
            "read-only",
            rechazado.Error?.Message ?? string.Empty,
            StringComparison.OrdinalIgnoreCase);

        // Y no quedó nada creado: se comprueba con otra sesión, esta sí de
        // escritura, porque preguntar por la de solo lectura no probaría nada.
        await using var writable = await fixture.Provider.OpenSessionAsync(
            fixture.Profile(),
            fixture.Credentials,
            CancellationToken.None);

        var check = await fixture.Executor.ExecuteAsync(
            writable,
            Query($"SELECT to_regclass('{tabla}') IS NULL AS ausente"),
            CancellationToken.None);

        Assert.Equal("True", check.ResultSets[0].Rows[0][0], ignoreCase: true);
    }

    /// <summary>
    /// El mismo caso en MySQL, con la escritura más directa que hay: si el motor
    /// la rechaza, lo hace por la sesión y no por el analizador, porque aquí se
    /// habla con el ejecutor directamente.
    /// </summary>
    [Fact]
    public async Task MySql_ConSesionDeSoloLectura_ElMotorRechazaCrearUnaTabla()
    {
        var fixture = new MySqlFixture();

        if (!fixture.IsAvailable) { return; }

        var tabla = $"druse_ro_{Guid.NewGuid():N}"[..24];

        await using var session = await fixture.Provider.OpenSessionAsync(
            fixture.Profile(onlyRead: true),
            fixture.Credentials,
            CancellationToken.None);

        Assert.True(
            session.ReadOnlyEnforcedByEngine,
            "MySQL admite sesiones de solo lectura: Druse tiene que pedirlas.");

        var rechazado = await fixture.Executor.ExecuteAsync(
            session,
            Query($"CREATE TABLE {tabla} (id int)"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Failed, rechazado.State);
        Assert.Contains(
            "read only",
            rechazado.Error?.Message ?? string.Empty,
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// SQL Server **no** tiene sesiones de solo lectura, y Druse no finge que sí.
    ///
    /// `ApplicationIntent=ReadOnly` solo enruta hacia una réplica de lectura en un
    /// grupo de disponibilidad; poner la base entera en `READ_ONLY` es cosa del
    /// servidor. Aquí lo único que hay es el aviso del analizador, y la garantía
    /// de verdad es un usuario con permisos restringidos.
    ///
    /// La prueba existe para que **si algún día cambia, alguien se entere**.
    /// </summary>
    [Fact]
    public async Task SqlServer_NoPrometeUnaProteccionQueElMotorNoDa()
    {
        var fixture = new SqlServerFixture();

        if (!fixture.IsAvailable) { return; }

        await using var session = await fixture.Provider.OpenSessionAsync(
            fixture.Profile(onlyRead: true),
            fixture.Credentials,
            CancellationToken.None);

        Assert.True(session.Profile.ReadOnly);
        Assert.False(session.ReadOnlyEnforcedByEngine);
    }

    private static QueryRequest Query(string sql) => new()
    {
        SessionId = Guid.NewGuid(),
        Sql = sql,
        MaxRows = 100,
        TimeoutSeconds = 30,
        DestructiveConfirmed = true,
    };
}
