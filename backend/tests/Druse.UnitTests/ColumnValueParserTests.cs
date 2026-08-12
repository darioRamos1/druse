using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// Convertir lo que el usuario escribe en la cuadrícula al valor que espera el
/// motor.
///
/// Es el sitio donde un descuido cambia datos sin avisar: un `1,5` guardado como
/// 15, una cadena vacía guardada como cero, un `0x` mal leído. De ahí que la
/// regla sea negarse antes que adivinar.
/// </summary>
public sealed class ColumnValueParserTests
{
    [Theory]
    // Los tres motores llaman parecido a lo mismo.
    [InlineData("int4", ColumnFamily.Integral)]
    [InlineData("bigint", ColumnFamily.Integral)]
    [InlineData("int", ColumnFamily.Integral)]
    [InlineData("numeric(10,2)", ColumnFamily.Fractional)]
    [InlineData("decimal(12,2)", ColumnFamily.Fractional)]
    [InlineData("boolean", ColumnFamily.Boolean)]
    [InlineData("bit", ColumnFamily.Boolean)]
    [InlineData("tinyint(1)", ColumnFamily.Boolean)]
    [InlineData("date", ColumnFamily.Date)]
    [InlineData("timestamp", ColumnFamily.Timestamp)]
    [InlineData("datetime2(7)", ColumnFamily.Timestamp)]
    // Los que se parecen y no son lo mismo: el orden de las comprobaciones es
    // justo lo que los distingue.
    [InlineData("timestamptz", ColumnFamily.TimestampWithZone)]
    [InlineData("datetimeoffset(7)", ColumnFamily.TimestampWithZone)]
    [InlineData("varchar(200)", ColumnFamily.Text)]
    [InlineData("bytea", ColumnFamily.Binary)]
    [InlineData("varbinary(max)", ColumnFamily.Binary)]
    [InlineData("uniqueidentifier", ColumnFamily.Uuid)]
    public void ClasificaLosTiposDeLosTresMotores(string dataType, ColumnFamily expected)
    {
        Assert.Equal(expected, ColumnValueParser.Classify(dataType));
    }

    [Fact]
    public void UnNumeroSeLeeEnCulturaInvariante()
    {
        Assert.True(ColumnValueParser.TryParse("numeric(10,2)", "1.5", out var value, out _));
        Assert.Equal(1.5m, value);

        // Y con la coma decimal **se niega**, en lugar de guardar 15: es el error
        // que nadie descubre hasta que los totales no cuadran.
        Assert.False(ColumnValueParser.TryParse("numeric(10,2)", "1,5", out _, out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void ElNuloEsNuloYNoCadenaVacia()
    {
        Assert.True(ColumnValueParser.TryParse("text", null, out var nulo, out _));
        Assert.Equal(DBNull.Value, nulo);

        Assert.True(ColumnValueParser.TryParse("text", string.Empty, out var vacio, out _));
        Assert.Equal(string.Empty, vacio);
    }

    [Fact]
    public void EnUnaColumnaQueNoEsTexto_LaCadenaVaciaEsNulo()
    {
        // Guardarla como 0 o como 1900-01-01 sería inventar un dato.
        Assert.True(ColumnValueParser.TryParse("int4", string.Empty, out var value, out _));
        Assert.Equal(DBNull.Value, value);
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("1", true)]
    [InlineData("false", false)]
    [InlineData("0", false)]
    public void ElBooleanoAceptaLasFormasDeLosTresMotores(string text, bool expected)
    {
        Assert.True(ColumnValueParser.TryParse("boolean", text, out var value, out _));
        Assert.Equal(expected, value);
    }

    [Fact]
    public void UnBooleanoQueNoLoEs_SeRechazaConMensaje()
    {
        Assert.False(ColumnValueParser.TryParse("boolean", "quizá", out _, out var error));
        Assert.Contains("true o false", error, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("0x00FF")]
    [InlineData("\\x00ff")]
    public void ElBinarioSeAceptaComoSeMuestra(string text)
    {
        Assert.True(ColumnValueParser.TryParse("bytea", text, out var value, out _));
        Assert.Equal(new byte[] { 0x00, 0xFF }, value);
    }

    [Fact]
    public void UnTextoQueNoEsDelTipo_NoSeConvierteALaFuerza()
    {
        Assert.False(ColumnValueParser.TryParse("int4", "abc", out _, out var error));
        Assert.Contains("abc", error, StringComparison.Ordinal);
    }

    [Fact]
    public void ElLiteralQueSeEnsena_EscapaLasComillas()
    {
        // Sin escapar, un nombre con apóstrofo mostraría un SQL a medias y quien
        // lo revisara no entendería lo que va a ejecutarse.
        Assert.Equal("'O''Brien'", ColumnValueParser.ToLiteral("text", "O'Brien"));
        Assert.Equal("NULL", ColumnValueParser.ToLiteral("text", null));
        Assert.Equal("42", ColumnValueParser.ToLiteral("int4", "42"));
    }
}
