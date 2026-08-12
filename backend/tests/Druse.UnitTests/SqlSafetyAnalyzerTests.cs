using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// El analizador es una ayuda visual, no un control de seguridad (plan §12).
/// Lo que se prueba aquí es que avisa cuando debe y, sobre todo, que **no** avisa
/// cuando no debe: un aviso que salta sin motivo acaba ignorándose siempre.
/// </summary>
public sealed class SqlSafetyAnalyzerTests
{
    [Theory]
    [InlineData("DROP TABLE users")]
    [InlineData("drop table if exists users")]
    [InlineData("DROP DATABASE produccion")]
    [InlineData("ALTER TABLE users DROP COLUMN email")]
    public void DetectaDrop(string sql)
    {
        var risks = SqlSafetyAnalyzer.Analyze(sql);

        Assert.Contains(risks, risk => risk.Kind == SqlRiskKind.Drop);
    }

    [Fact]
    public void DetectaTruncate()
    {
        var risks = SqlSafetyAnalyzer.Analyze("TRUNCATE TABLE eventos;");

        Assert.Contains(risks, risk => risk.Kind == SqlRiskKind.Truncate);
    }

    [Fact]
    public void DetectaDeleteSinWhere()
    {
        var risks = SqlSafetyAnalyzer.Analyze("DELETE FROM users;");

        Assert.Contains(risks, risk => risk.Kind == SqlRiskKind.DeleteWithoutFilter);
    }

    [Fact]
    public void NoMarcaDeleteConWhere()
    {
        var risks = SqlSafetyAnalyzer.Analyze("DELETE FROM users WHERE id = 42;");

        Assert.DoesNotContain(risks, risk => risk.Kind == SqlRiskKind.DeleteWithoutFilter);
    }

    [Fact]
    public void DetectaUpdateSinWhere()
    {
        var risks = SqlSafetyAnalyzer.Analyze("UPDATE users SET is_active = false");

        Assert.Contains(risks, risk => risk.Kind == SqlRiskKind.UpdateWithoutFilter);
    }

    [Fact]
    public void NoMarcaUpdateConWhere()
    {
        var risks = SqlSafetyAnalyzer.Analyze("UPDATE users SET is_active = false WHERE id = 1");

        Assert.Empty(risks);
    }

    [Fact]
    public void ElWhereDeUnaSentenciaNoProtegeALaSiguiente()
    {
        // Un lote donde la primera está filtrada y la segunda no. Mirar el texto
        // entero de una vez daría por bueno el DELETE sin filtro.
        var risks = SqlSafetyAnalyzer.Analyze(
            "UPDATE users SET x = 1 WHERE id = 2; DELETE FROM logs;");

        Assert.Contains(risks, risk => risk.Kind == SqlRiskKind.DeleteWithoutFilter);
    }

    [Fact]
    public void IgnoraPalabrasPeligrosasDentroDeCadenas()
    {
        var risks = SqlSafetyAnalyzer.Analyze("SELECT 'drop table users' AS aviso");

        Assert.Empty(risks);
    }

    [Fact]
    public void IgnoraPalabrasPeligrosasDentroDeComentarios()
    {
        var sql = """
            -- TODO: aquí había un DROP TABLE users
            SELECT 1;
            /* TRUNCATE TABLE pedidos */
            """;

        var risks = SqlSafetyAnalyzer.Analyze(sql);

        Assert.Empty(risks);
    }

    [Fact]
    public void IgnoraIdentificadoresCitados()
    {
        // Una tabla que se llame literalmente «delete from» es rara, pero legal.
        var risks = SqlSafetyAnalyzer.Analyze("""SELECT * FROM "delete from users" """);

        Assert.Empty(risks);
    }

    [Fact]
    public void ManejaComillasEscapadasSinPerderElHilo()
    {
        // La comilla doblada no cierra el literal: si se interpretara mal, el
        // analizador leería el resto de la cadena como SQL.
        var risks = SqlSafetyAnalyzer.Analyze("SELECT 'no es un ''DROP TABLE users''' AS texto");

        Assert.Empty(risks);
    }

    [Theory]
    [InlineData("SELECT * FROM users")]
    [InlineData("SELECT count(*) FROM pedidos WHERE total > 100")]
    [InlineData("")]
    [InlineData("   ")]
    public void NoMarcaConsultasDeLectura(string sql)
    {
        Assert.Empty(SqlSafetyAnalyzer.Analyze(sql));
    }

    [Theory]
    [InlineData("INSERT INTO users (name) VALUES ('ana')", true)]
    [InlineData("UPDATE users SET name = 'ana' WHERE id = 1", true)]
    [InlineData("CREATE TABLE t (id int)", true)]
    [InlineData("SELECT * FROM users", false)]
    [InlineData("SELECT 'insert into' AS texto", false)]
    [InlineData("", false)]
    public void IdentificaInstruccionesQueEscriben(string sql, bool expected)
    {
        Assert.Equal(expected, SqlSafetyAnalyzer.IsMutating(sql));
    }

    [Fact]
    public void DetectaCambiosDePermisos()
    {
        var risks = SqlSafetyAnalyzer.Analyze("GRANT ALL ON users TO publico");

        Assert.Contains(risks, risk => risk.Kind == SqlRiskKind.PermissionChange);
    }
}
