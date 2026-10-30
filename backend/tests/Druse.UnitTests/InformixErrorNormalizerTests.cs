using Druse.Jdbc;
using Druse.Provider.Informix;

namespace Druse.UnitTests;

public sealed class InformixErrorNormalizerTests
{
    [Fact]
    public void LaSintaxisDelServidorSeExplicaSinPerderSuCodigoNiElDetalle()
    {
        const string detalle = "A syntax error has occurred near position 15.";
        var excepcion = new JdbcException(new java.sql.SQLException(detalle, "42000", -201));

        var error = InformixErrorNormalizer.Normalize(excepcion);

        Assert.Equal("-201", error.Code);
        Assert.Contains("sintaxis", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.EndsWith(detalle, error.Message, StringComparison.Ordinal);
        Assert.Null(error.Position);
        Assert.Equal("42000", excepcion.SqlStateValue);
    }

    [Fact]
    public void LaSintaxisDelParserAnteriorConservaLaExplicacionUtil()
    {
        var excepcion = new JdbcException(new java.sql.SQLException(
            "System or internal error", "IX000", -79716));

        var error = InformixErrorNormalizer.Normalize(excepcion);

        Assert.Equal("-201", error.Code);
        Assert.Contains("sintaxis", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("antes de enviarla", error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("System or internal error", error.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(-79716, "El transporte perdió la conexión.")]
    [InlineData(-206, "The specified table does not exist.")]
    public void OtrosFallosNoSeConviertenEnSintaxis(int codigo, string detalle)
    {
        var excepcion = new JdbcException(new java.sql.SQLException(detalle, "IX000", codigo));

        var error = InformixErrorNormalizer.Normalize(excepcion);

        Assert.Equal(codigo.ToString(System.Globalization.CultureInfo.InvariantCulture), error.Code);
        Assert.Equal(detalle, error.Message);
    }
}
