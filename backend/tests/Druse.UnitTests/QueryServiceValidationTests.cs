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
}
