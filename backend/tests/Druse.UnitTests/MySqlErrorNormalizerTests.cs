using Druse.Provider.MySql;

namespace Druse.UnitTests;

/// <summary>
/// De dónde saca Druse la línea del error en MySQL.
///
/// A diferencia de los otros tres motores, aquí no hay ningún campo que leer: la
/// línea aparece **escrita dentro del mensaje**, al final. Rascarla de ahí es un
/// heurístico, y lo que estas pruebas fijan es hasta dónde llega y dónde se
/// planta: ante la duda, ninguna línea, porque señalar la equivocada en el
/// editor es peor que no señalar nada.
/// </summary>
public sealed class MySqlErrorNormalizerTests
{
    /// <summary>El mensaje real de un `SELECT\n uno,\n FROM tabla_x` contra MySQL 8.</summary>
    private const string Sintaxis =
        "You have an error in your SQL syntax; check the manual that corresponds to your " +
        "MySQL server version for the right syntax to use near 'FROM tabla_x' at line 3";

    [Fact]
    public void SacaLaLineaDelMensaje()
    {
        Assert.Equal(3, MySqlErrorNormalizer.LineOf(Sintaxis));
    }

    [Fact]
    public void UnErrorSinLineaNoInventaNinguna()
    {
        // Los errores que no son de sintaxis no la llevan, y son la mayoría.
        Assert.Null(MySqlErrorNormalizer.LineOf("Table 'druse_test.pedidos' doesn't exist"));
        Assert.Null(MySqlErrorNormalizer.LineOf("Unknown column 'total' in 'field list'"));
    }

    /// <summary>
    /// Solo cuenta la del final, que es donde la escribe el servidor.
    ///
    /// El mensaje incluye un trozo del SQL del usuario, y ese trozo puede
    /// contener cualquier cosa: un literal que diga «at line 99» no debe mover el
    /// subrayado noventa líneas más abajo.
    /// </summary>
    [Fact]
    public void NoSeCreeLoQueVengaDentroDelSqlDelUsuario()
    {
        Assert.Equal(
            7,
            MySqlErrorNormalizer.LineOf("...syntax to use near ''at line 99'' at line 7"));

        Assert.Null(MySqlErrorNormalizer.LineOf("...near 'INSERT INTO log VALUES (''at line 99'')'"));
    }

    [Fact]
    public void UnaLineaCeroNoSeSenala()
    {
        // No debería pasar, pero si pasara, la línea 0 no existe en el editor.
        Assert.Null(MySqlErrorNormalizer.LineOf("algo raro at line 0"));
    }
}
