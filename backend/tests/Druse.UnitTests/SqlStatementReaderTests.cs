using Druse.Infrastructure.Backups;

namespace Druse.UnitTests;

/// <summary>
/// Partir un guion en instrucciones.
///
/// Es la pieza de la que depende toda la restauración: partir de más rompe una
/// instrucción por la mitad y partir de menos manda dos al motor en un comando
/// que no las admite. Y el `;` que separa está a un carácter del `;` que va
/// dentro de un texto —una dirección, una nota, un JSON—, así que las pruebas
/// van justo por ahí.
/// </summary>
public sealed class SqlStatementReaderTests
{
    private static async Task<List<string>> ReadAsync(string script)
    {
        var statements = new List<string>();

        await foreach (var statement in SqlStatementReader.ReadAsync(script))
        {
            statements.Add(statement);
        }

        return statements;
    }

    [Fact]
    public async Task SeparaLasInstruccionesPorElPuntoYComa()
    {
        var statements = await ReadAsync("CREATE TABLE a (id int); INSERT INTO a VALUES (1);");

        Assert.Equal(2, statements.Count);
        Assert.Equal("CREATE TABLE a (id int)", statements[0]);
        Assert.Equal("INSERT INTO a VALUES (1)", statements[1]);
    }

    [Fact]
    public async Task LaÚltimaInstrucciónSinPuntoYComaTambiénCuenta()
    {
        var statements = await ReadAsync("SELECT 1;\nSELECT 2");

        Assert.Equal(["SELECT 1", "SELECT 2"], statements);
    }

    /// <summary>
    /// El caso que justifica la máquina de estados: un `;` dentro de un texto.
    ///
    /// Pasa de verdad —«calle Mayor 3; 2º izquierda»— y partir ahí produciría dos
    /// instrucciones inválidas en lugar de un `INSERT` correcto.
    /// </summary>
    [Fact]
    public async Task UnPuntoYComaDentroDeUnLiteralNoSepara()
    {
        var statements = await ReadAsync(
            "INSERT INTO d VALUES ('calle Mayor 3; 2º izquierda'); SELECT 1;");

        Assert.Equal(2, statements.Count);
        Assert.Contains("2º izquierda", statements[0], StringComparison.Ordinal);
    }

    /// <summary>
    /// `''` es una comilla dentro del texto, no el final del texto.
    ///
    /// Si se tomara por el final, el `;` siguiente separaría donde no debe y el
    /// resto del archivo se leería desplazado un literal.
    /// </summary>
    [Fact]
    public async Task UnaComillaEscapadaNoCierraElLiteral()
    {
        var statements = await ReadAsync(
            "INSERT INTO d VALUES ('O''Donnell; 12'); INSERT INTO d VALUES ('otra');");

        Assert.Equal(2, statements.Count);
        Assert.Contains("O''Donnell; 12", statements[0], StringComparison.Ordinal);
        Assert.Contains("'otra'", statements[1], StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("\"tabla;rara\"")]
    [InlineData("[tabla;rara]")]
    [InlineData("`tabla;rara`")]
    public async Task UnPuntoYComaDentroDeUnIdentificadorCitadoNoSepara(string quoted)
    {
        // Los cuatro motores citan distinto y el artefacto no dice de cuál viene
        // hasta que se lee su manifiesto, así que se reconocen los tres estilos.
        var statements = await ReadAsync($"CREATE TABLE {quoted} (id int); SELECT 1;");

        Assert.Equal(2, statements.Count);
        Assert.Contains(quoted, statements[0], StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnPuntoYComaDentroDeUnComentarioNoSepara()
    {
        var statements = await ReadAsync("""
            -- ojo; esto no separa
            SELECT 1;
            /* ni; esto */
            SELECT 2;
            """);

        Assert.Equal(2, statements.Count);
        Assert.Contains("SELECT 1", statements[0], StringComparison.Ordinal);
        Assert.Contains("SELECT 2", statements[1], StringComparison.Ordinal);
    }

    /// <summary>
    /// Entre la última instrucción y el manifiesto del final solo hay comentarios.
    ///
    /// Mandarlos al motor sería un error donde no había nada que hacer, y encima
    /// el último: la restauración acabaría «fallida» con todo aplicado.
    /// </summary>
    [Fact]
    public async Task LosComentariosSueltosDelFinalNoSonInstrucciones()
    {
        var statements = await ReadAsync("""
            SELECT 1;

            -- Respaldo generado por Druse
            -- Formato: 1
            -- Resultado: Completed
            """);

        Assert.Single(statements);
    }

    /// <summary>El comentario que encabeza un bloque viaja con su instrucción.</summary>
    [Fact]
    public async Task LaCabeceraDeUnBloqueSeConservaConSuInstrucción()
    {
        var statements = await ReadAsync("""
            -- Tabla: pedidos
            CREATE TABLE pedidos (id int);
            """);

        var statement = Assert.Single(statements);

        Assert.StartsWith("-- Tabla: pedidos", statement, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE pedidos", statement, StringComparison.Ordinal);
    }

    [Fact]
    public async Task UnGuionVacíoNoDevuelveNada()
    {
        Assert.Empty(await ReadAsync("   \n\n  ;  \n"));
    }

    /// <summary>
    /// Un `INSERT` de varias filas es **una** instrucción, con sus saltos dentro.
    ///
    /// Es como el respaldo escribe los datos, así que es el caso más frecuente de
    /// todos: si se partiera por las comas o por los saltos, no se restauraría ni
    /// una tabla.
    /// </summary>
    [Fact]
    public async Task UnInsertDeVariasFilasEsUnaSolaInstrucción()
    {
        var statements = await ReadAsync("""
            INSERT INTO "tienda"."cat_paises" ("codigo", "nombre") VALUES
              ('MX', 'México'),
              ('ES', 'España');
            """);

        var statement = Assert.Single(statements);

        Assert.Contains("México", statement, StringComparison.Ordinal);
        Assert.Contains("España", statement, StringComparison.Ordinal);
    }
}
