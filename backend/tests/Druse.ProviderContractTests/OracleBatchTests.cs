using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Propio de Oracle: **ejecutar un guion con varias instrucciones**.
///
/// No está en el contrato compartido porque los otros cinco motores no tienen
/// este problema: encadenan por su cuenta y el guion entero viaja en un comando.
/// Oracle no —`SELECT 1 FROM DUAL; SELECT 2 FROM DUAL` es `ORA-00911`— así que
/// partirlo es trabajo de Druse, y lo que se comprueba aquí es que ese trabajo
/// se hace bien contra un servidor de verdad.
///
/// Las pruebas del partidor viven aparte, en `OracleScriptTests`, y son las que
/// cubren los casos raros del texto. Estas son las que dicen que lo partido se
/// ejecuta, en orden, y que cuando algo falla se sabe qué.
/// </summary>
public sealed class OracleBatchTests
{
    private readonly OracleFixture _fixture = new();

    private bool Skip => !_fixture.IsAvailable;

    /// <summary>
    /// Lo que el usuario hace de verdad: pegar dos consultas y pulsar Ejecutar.
    /// </summary>
    [Fact]
    public async Task DosConsultasEnUnGuion_DevuelvenSusDosResultados()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(
            session,
            "SELECT 1 AS uno FROM DUAL;\nSELECT 2 AS dos FROM DUAL;");

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Equal(2, result.ResultSets.Count);
        Assert.Equal("1", result.ResultSets[0].Rows[0][0]);
        Assert.Equal("2", result.ResultSets[1].Rows[0][0]);
    }

    /// <summary>
    /// Las instrucciones que no devuelven filas también cuentan, y lo que hacen
    /// tiene que haber pasado de verdad: se comprueba leyendo después.
    /// </summary>
    [Fact]
    public async Task UnGuionQueCreaYRellena_DejaLasFilasPuestas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = $"druse_lote_{Guid.NewGuid():N}"[..28];

        try
        {
            var result = await ExecuteAsync(session, $"""
                CREATE TABLE {table} (id NUMBER(5));
                INSERT INTO {table} (id) VALUES (1);
                INSERT INTO {table} (id) VALUES (2);
                SELECT id FROM {table} ORDER BY id;
                """);

            Assert.Equal(QueryExecutionState.Succeeded, result.State);

            var set = Assert.Single(result.ResultSets);

            Assert.Equal(["1", "2"], set.Rows.Select(row => row[0]));

            // Las filas tocadas son las de las dos inserciones, no las de la
            // última: el guion escribió dos.
            Assert.Equal(2, result.RowsAffected);
        }
        finally
        {
            await QuietlyAsync(session, $"DROP TABLE {table}");
        }
    }

    /// <summary>
    /// Un bloque PL/SQL y una consulta detrás, separados por la barra: es la
    /// forma en que se escribe un guion de Oracle en cualquier cliente.
    /// </summary>
    [Fact]
    public async Task UnBloqueYUnaConsultaDetras_SeEjecutanLosDos()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = $"druse_lote_{Guid.NewGuid():N}"[..28];

        try
        {
            var result = await ExecuteAsync(session, $"""
                CREATE TABLE {table} (id NUMBER(5));
                BEGIN
                  FOR i IN 1 .. 3 LOOP
                    INSERT INTO {table} (id) VALUES (i);
                  END LOOP;
                END;
                /
                SELECT COUNT(*) AS cuantas FROM {table};
                """);

            Assert.Equal(QueryExecutionState.Succeeded, result.State);

            var set = Assert.Single(result.ResultSets);

            Assert.Equal("3", set.Rows[0][0]);
        }
        finally
        {
            await QuietlyAsync(session, $"DROP TABLE {table}");
        }
    }

    /// <summary>
    /// Lo que más falta hace cuando algo sale mal: **cuál** de las instrucciones
    /// falló y qué quedó hecho. Sin eso, un guion largo devuelve un `ORA-…` sin
    /// sitio donde mirar.
    /// </summary>
    [Fact]
    public async Task CuandoFallaUna_DiceCualYQueQuedoHecho()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, """
            SELECT 1 FROM DUAL;
            SELECT * FROM tabla_que_no_existe_jamas;
            SELECT 3 FROM DUAL;
            """);

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);
        Assert.Contains("instrucción 2 de 3", result.Error.Message, StringComparison.Ordinal);

        // Y el error del motor sigue entero: lo de Druse se añade delante, no en
        // lugar de lo que dijo Oracle.
        Assert.Equal("ORA-00942", result.Error.Code);
    }

    /// <summary>
    /// Con una sola instrucción no hay nada que situar, y el mensaje tiene que
    /// quedarse como estaba: es el que ve la inmensa mayoría de las veces.
    /// </summary>
    [Fact]
    public async Task ConUnaSolaInstruccion_ElMensajeNoSeAdorna()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, "SELECT * FROM tabla_que_no_existe_jamas");

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);
        Assert.DoesNotContain("instrucción", result.Error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// El punto y coma final de una consulta suelta se sigue quitando, que era lo
    /// que ya hacía `OracleStatement` antes de que existiera el partidor.
    /// </summary>
    [Fact]
    public async Task UnaConsultaConPuntoYComaFinal_SigueFuncionando()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, "SELECT 1 AS uno FROM DUAL;");

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Single(result.ResultSets);
    }

    /// <summary>
    /// El tope de filas es del guion entero, igual que cuando un solo comando
    /// devuelve varios resultados: dos instrucciones no dan derecho al doble.
    /// </summary>
    [Fact]
    public async Task ElTopeDeFilasValeParaElGuionEntero()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(
            session,
            $"{_fixture.GenerateRows(10)};\n{_fixture.GenerateRows(10)};",
            maxRows: 6);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Equal(6, result.ResultSets.Sum(set => set.Rows.Count));
        Assert.True(result.ResultSets[1].Truncated);
    }

    private async Task<IDatabaseSession> OpenAsync() =>
        await _fixture.Provider.OpenSessionAsync(
            _fixture.Profile(),
            _fixture.Credentials,
            CancellationToken.None);

    private Task<QueryResult> ExecuteAsync(IDatabaseSession session, string sql, int maxRows = 500) =>
        _fixture.Executor.ExecuteAsync(
            session,
            new QueryRequest
            {
                SessionId = Guid.NewGuid(),
                Sql = sql,
                MaxRows = maxRows,
                TimeoutSeconds = 30,
                DestructiveConfirmed = true,
            },
            CancellationToken.None);

    /// <summary>Limpieza: si la tabla no llegó a crearse, no hay nada que decir.</summary>
    private async Task QuietlyAsync(IDatabaseSession session, string sql) =>
        await ExecuteAsync(session, sql);
}
