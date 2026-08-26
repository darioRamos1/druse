using Druse.Application.Queries;
using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>Reglas de ejecución que valen para todos los motores.</summary>
public sealed class QueryServiceValidationTests
{
    private static readonly QueryContext ReadWrite = new(DatabaseEngine.PostgreSql, ReadOnly: false);
    private static readonly QueryContext ReadOnly = new(DatabaseEngine.PostgreSql, ReadOnly: true);

    private static QueryRequest Request(string sql, bool confirmed = false) => new()
    {
        SessionId = Guid.NewGuid(),
        Sql = sql,
        DestructiveConfirmed = confirmed,
    };

    [Fact]
    public void PermiteUnSelectNormal()
    {
        var rejection = QueryService.Validate(ReadWrite, Request("SELECT * FROM users"));

        Assert.Null(rejection);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\n\t")]
    public void RechazaSqlVacio(string sql)
    {
        var rejection = QueryService.Validate(ReadWrite, Request(sql));

        Assert.NotNull(rejection);
        Assert.Equal(QueryRejectionReason.EmptyStatement, rejection.Reason);
    }

    [Fact]
    public void RechazaEscriturasEnConexionDeSoloLectura()
    {
        var rejection = QueryService.Validate(ReadOnly, Request("UPDATE users SET x = 1 WHERE id = 2"));

        Assert.NotNull(rejection);
        Assert.Equal(QueryRejectionReason.ReadOnlyConnection, rejection.Reason);
    }

    [Fact]
    public void PermiteLecturasEnConexionDeSoloLectura()
    {
        Assert.Null(QueryService.Validate(ReadOnly, Request("SELECT * FROM users")));
    }

    [Fact]
    public void LaConfirmacionNoSaltaElModoSoloLectura()
    {
        // Confirmar sirve para asumir un riesgo, no para saltarse la marca de solo
        // lectura: son cosas distintas y esta tiene prioridad.
        var rejection = QueryService.Validate(ReadOnly, Request("DROP TABLE users", confirmed: true));

        Assert.NotNull(rejection);
        Assert.Equal(QueryRejectionReason.ReadOnlyConnection, rejection.Reason);
    }

    [Fact]
    public void PideConfirmacionParaInstruccionesDestructivas()
    {
        var rejection = QueryService.Validate(ReadWrite, Request("DROP TABLE users"));

        Assert.NotNull(rejection);
        Assert.Equal(QueryRejectionReason.UnconfirmedDestructive, rejection.Reason);
        Assert.NotEmpty(rejection.Risks);
    }

    [Fact]
    public void EjecutaLoDestructivoCuandoElUsuarioConfirma()
    {
        Assert.Null(QueryService.Validate(ReadWrite, Request("DROP TABLE users", confirmed: true)));
    }

    [Fact]
    public void ElRechazoExplicaElRiesgo()
    {
        var rejection = QueryService.Validate(ReadWrite, Request("DELETE FROM users"));

        Assert.NotNull(rejection);
        Assert.Contains(rejection.Risks, risk => risk.Kind == SqlRiskKind.DeleteWithoutFilter);
        Assert.False(string.IsNullOrWhiteSpace(rejection.Risks[0].Description));
    }

    /// <summary>
    /// Exportar exige algo que devuelva filas.
    ///
    /// Lo destapó una vista abierta desde el explorador: esa pestaña no lleva un
    /// SELECT sino el CREATE VIEW que la define, y exportarla llegaba al motor.
    /// Con la vista ya creada respondía con un error ilegible; sin ella, **la
    /// creaba** y el archivo salía vacío dando la exportación por buena.
    /// </summary>
    [Theory]
    [InlineData("CREATE VIEW dbo.v AS SELECT 1 AS uno")]
    [InlineData("CREATE TABLE t (id int)")]
    [InlineData("INSERT INTO users (id) VALUES (1)")]
    [InlineData("UPDATE users SET x = 1 WHERE id = 2")]
    [InlineData("DROP TABLE users")]
    public void NoSeExportaLoQueEscribe(string sql)
    {
        var rejection = ExportService.Validate(ReadWrite, Request(sql, confirmed: true));

        Assert.NotNull(rejection);
        Assert.Equal(QueryRejectionReason.NotExportable, rejection.Reason);
    }

    /// <summary>
    /// Confirmar lo destructivo no abre la puerta a exportarlo.
    ///
    /// Son dos preguntas distintas: «¿seguro que quieres borrar?» y «¿esto da un
    /// archivo?». Un DROP confirmado se ejecuta desde el editor, pero sigue sin
    /// tener filas que escribir en un CSV.
    /// </summary>
    [Fact]
    public void ConfirmarNoConvierteUnaEscrituraEnExportable()
    {
        var rejection = ExportService.Validate(ReadWrite, Request("DROP TABLE users", confirmed: true));

        Assert.NotNull(rejection);
        Assert.Equal(QueryRejectionReason.NotExportable, rejection.Reason);
    }

    [Theory]
    [InlineData("SELECT * FROM dbo.v_ventas")]
    [InlineData("WITH previas AS (SELECT id FROM users) SELECT * FROM previas")]
    [InlineData("SHOW TABLES")]
    [InlineData("SELECT 'CREATE VIEW no cuenta dentro de un literal' AS aviso")]
    public void SeExportaLoQueDevuelveFilas(string sql)
    {
        Assert.Null(ExportService.Validate(ReadWrite, Request(sql)));
    }

    /// <summary>Las reglas de siempre siguen valiendo al exportar.</summary>
    [Fact]
    public void ExportarHeredaLasReglasDeEjecucion()
    {
        var vacio = ExportService.Validate(ReadWrite, Request("   "));

        Assert.NotNull(vacio);
        Assert.Equal(QueryRejectionReason.EmptyStatement, vacio.Reason);

        var soloLectura = ExportService.Validate(ReadOnly, Request("INSERT INTO users (id) VALUES (1)"));

        Assert.NotNull(soloLectura);
        Assert.Equal(QueryRejectionReason.ReadOnlyConnection, soloLectura.Reason);
    }
}
