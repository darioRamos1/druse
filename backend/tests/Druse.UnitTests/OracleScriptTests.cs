using Druse.Provider.Oracle;

namespace Druse.UnitTests;

/// <summary>
/// Partir un guion de Oracle en instrucciones.
///
/// Es la pieza que permite que pegar dos consultas y pulsar Ejecutar funcione en
/// el único motor que no encadena. Y es de las que más daño hacen al fallar:
/// partir de más manda media instrucción al servidor, y partir de menos devuelve
/// `ORA-00911` sobre algo que el usuario escribió bien. Por eso las pruebas van
/// justo por los sitios donde un `;` no separa.
/// </summary>
public sealed class OracleScriptTests
{
    private static string[] Split(string sql) =>
        [.. OracleScript.Split(sql).Select(statement => statement.Text)];

    [Fact]
    public void SeparaPorElPuntoYComa()
    {
        var statements = Split("SELECT 1 FROM DUAL; SELECT 2 FROM DUAL;");

        Assert.Equal(["SELECT 1 FROM DUAL", "SELECT 2 FROM DUAL"], statements);
    }

    [Fact]
    public void LaÚltimaSinPuntoYComaTambiénCuenta()
    {
        var statements = Split("SELECT 1 FROM DUAL; SELECT 2 FROM DUAL");

        Assert.Equal(["SELECT 1 FROM DUAL", "SELECT 2 FROM DUAL"], statements);
    }

    [Fact]
    public void UnaSolaInstrucciónSigueSiendoUna()
    {
        Assert.Equal(["SELECT 1 FROM DUAL"], Split("SELECT 1 FROM DUAL"));
    }

    [Fact]
    public void UnGuionVacíoNoTieneNadaQueEjecutar()
    {
        Assert.Empty(OracleScript.Split("   \n\t  "));
    }

    [Fact]
    public void LoQueSoloEsComentarioNoSeManda()
    {
        var statements = Split("SELECT 1 FROM DUAL;\n-- y aquí se acabó\n");

        Assert.Equal(["SELECT 1 FROM DUAL"], statements);
    }

    /// <summary>
    /// El caso por el que no vale partir por `;` a lo bruto: dentro de un texto
    /// es un carácter más.
    /// </summary>
    [Fact]
    public void ElPuntoYComaDeUnLiteralNoSepara()
    {
        var statements = Split("SELECT 'O''Donnell; 12' FROM DUAL; SELECT 2 FROM DUAL");

        Assert.Equal(["SELECT 'O''Donnell; 12' FROM DUAL", "SELECT 2 FROM DUAL"], statements);
    }

    [Fact]
    public void ElPuntoYComaDeUnIdentificadorCitadoNoSepara()
    {
        var statements = Split("SELECT \"raro; nombre\" FROM t; SELECT 2 FROM DUAL");

        Assert.Equal(["SELECT \"raro; nombre\" FROM t", "SELECT 2 FROM DUAL"], statements);
    }

    [Fact]
    public void ElPuntoYComaDeUnComentarioDeLíneaNoSepara()
    {
        var statements = Split("SELECT 1 FROM DUAL -- no; esto no separa\n; SELECT 2 FROM DUAL");

        Assert.Equal(
            ["SELECT 1 FROM DUAL -- no; esto no separa", "SELECT 2 FROM DUAL"],
            statements);
    }

    [Fact]
    public void ElPuntoYComaDeUnComentarioDeBloqueNoSepara()
    {
        var statements = Split("SELECT 1 /* uno; dos */ FROM DUAL; SELECT 2 FROM DUAL");

        Assert.Equal(["SELECT 1 /* uno; dos */ FROM DUAL", "SELECT 2 FROM DUAL"], statements);
    }

    /// <summary>
    /// El literal alternativo existe para escribir textos llenos de comillas, así
    /// que es donde más daño haría cortar mal.
    /// </summary>
    [Theory]
    [InlineData("q'[uno; dos]'")]
    [InlineData("q'{uno; dos}'")]
    [InlineData("q'(uno; dos)'")]
    [InlineData("q'<uno; dos>'")]
    [InlineData("q'!uno; dos!'")]
    [InlineData("Q'[uno; dos]'")]
    public void ElPuntoYComaDeUnLiteralAlternativoNoSepara(string literal)
    {
        var statements = Split($"SELECT {literal} FROM DUAL; SELECT 2 FROM DUAL");

        Assert.Equal([$"SELECT {literal} FROM DUAL", "SELECT 2 FROM DUAL"], statements);
    }

    /// <summary>
    /// Una columna que acabe en `q` no abre un literal alternativo, y creerlo se
    /// tragaría el resto del guion buscando un cierre que no existe.
    /// </summary>
    [Fact]
    public void UnaQPegadaAUnNombreNoAbreLiteral()
    {
        var statements = Split("SELECT abcq FROM DUAL; SELECT 2 FROM DUAL");

        Assert.Equal(["SELECT abcq FROM DUAL", "SELECT 2 FROM DUAL"], statements);
    }

    /// <summary>
    /// Dentro de un bloque los puntos y coma son del lenguaje: partir por ellos
    /// mandaría al servidor un `BEGIN` sin su `END`.
    /// </summary>
    [Fact]
    public void UnBloqueNoSeParteporSusPuntosYComa()
    {
        const string Script = """
            BEGIN
              INSERT INTO t VALUES (1);
              INSERT INTO t VALUES (2);
            END;
            /
            SELECT 1 FROM DUAL;
            """;

        var statements = Split(Script);

        Assert.Equal(2, statements.Length);
        Assert.StartsWith("BEGIN", statements[0], StringComparison.Ordinal);
        Assert.EndsWith("END;", statements[0], StringComparison.Ordinal);
        Assert.Equal("SELECT 1 FROM DUAL", statements[1]);
    }

    [Fact]
    public void UnProcedimientoTampocoSeParte()
    {
        const string Script = """
            CREATE OR REPLACE PROCEDURE saluda AS
            BEGIN
              DBMS_OUTPUT.PUT_LINE('hola');
            END;
            /
            SELECT 1 FROM DUAL
            """;

        var statements = Split(Script);

        Assert.Equal(2, statements.Length);
        Assert.Contains("PUT_LINE", statements[0], StringComparison.Ordinal);
        Assert.Equal("SELECT 1 FROM DUAL", statements[1]);
    }

    /// <summary>
    /// Un bloque que empieza con su comentario sigue siendo un bloque. Sin mirar
    /// más allá del comentario se partiría por el primer `;` de dentro.
    /// </summary>
    [Fact]
    public void UnBloqueComentadoSigueSiendoUnBloque()
    {
        const string Script = """
            -- Lo que hace este bloque
            BEGIN
              INSERT INTO t VALUES (1);
            END;
            /
            """;

        var statements = Split(Script);

        Assert.Single(statements);
        Assert.EndsWith("END;", statements[0], StringComparison.Ordinal);
    }

    /// <summary>
    /// La barra solo termina cuando está sola: una división escrita al final de
    /// una línea no cierra nada.
    /// </summary>
    [Fact]
    public void UnaBarraQueNoEstáSolaNoTerminaElBloque()
    {
        const string Script = """
            BEGIN
              total := uno / dos;
            END;
            /
            """;

        var statements = Split(Script);

        Assert.Single(statements);
        Assert.Contains("uno / dos", statements[0], StringComparison.Ordinal);
    }

    /// <summary>
    /// Lo que hacen SQL*Plus y los clientes de escritorio, y que conviene tener
    /// escrito: sin barra, el bloque llega hasta el final.
    /// </summary>
    [Fact]
    public void UnBloqueSinBarraSeLlevaElResto()
    {
        const string Script = """
            BEGIN
              INSERT INTO t VALUES (1);
            END;
            SELECT 1 FROM DUAL;
            """;

        var statements = Split(Script);

        Assert.Single(statements);
        Assert.Contains("SELECT 1 FROM DUAL", statements[0], StringComparison.Ordinal);
    }

    /// <summary>
    /// El sitio que se guarda es donde empieza lo que se manda —su comentario
    /// incluido, que viaja con ella— y no donde quedó el punto y coma anterior:
    /// es lo que permite decir cuál de las instrucciones falló.
    /// </summary>
    [Fact]
    public void GuardaDóndeEmpiezaCadaInstrucción()
    {
        const string Script = "SELECT 1 FROM DUAL;\n-- un comentario\nSELECT 2 FROM DUAL";

        var statements = OracleScript.Split(Script);

        Assert.Equal(0, statements[0].StartOffset);
        Assert.Equal(
            Script.IndexOf("-- un comentario", StringComparison.Ordinal),
            statements[1].StartOffset);
    }

    /// <summary>
    /// Un literal sin cerrar es SQL malo, y el partidor no es quien tiene que
    /// decirlo: lo manda entero y que conteste el motor, que sabe explicarlo.
    /// </summary>
    [Fact]
    public void UnLiteralSinCerrarSeMandaEnteroAlMotor()
    {
        var statements = Split("SELECT 'sin cerrar FROM DUAL; SELECT 2 FROM DUAL");

        Assert.Single(statements);
    }
}
