using Druse.Provider.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Leer las condiciones de comprobación del texto de un `CREATE TABLE`.
///
/// Es la única forma de saber cuáles tiene una tabla en SQLite, y por eso estas
/// pruebas se centran en **lo que no es una condición aunque se lea como una**:
/// la palabra `CHECK` dentro de una cadena, de un nombre citado o de un
/// comentario. Ahí es donde un recorrido ingenuo inventa restricciones, y una
/// restricción inventada se escribiría en la tabla al reconstruirla.
/// </summary>
public sealed class SqliteCheckConstraintsTests
{
    /// <summary>Con nombre y sin nombre, las dos, y en el orden en que están.</summary>
    [Fact]
    public void LeeLasQueTienenNombreYLasQueNo()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE pedidos (
              id       INTEGER PRIMARY KEY,
              cantidad INTEGER CHECK (cantidad > 0),
              estado   TEXT,
              CONSTRAINT ck_estado CHECK (estado IN ('nuevo', 'cerrado'))
            )
            """);

        Assert.Equal(2, found.Count);

        // La que va en la columna no tiene nombre, porque SQLite no le pone uno.
        Assert.Equal(string.Empty, found[0].Name);
        Assert.Equal("cantidad > 0", found[0].Expression);

        Assert.Equal("ck_estado", found[1].Name);
        Assert.Equal("estado IN ('nuevo', 'cerrado')", found[1].Expression);
    }

    /// <summary>
    /// Los paréntesis de dentro **se cuentan**: la condición acaba en el que cierra
    /// el suyo, no en el primero que aparezca.
    /// </summary>
    [Fact]
    public void CuentaLosParentesisDeDentro()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE t (
              a INTEGER,
              b INTEGER,
              CHECK ((a + b) > (a * 2) AND length(trim(CAST(a AS TEXT))) < 9)
            )
            """);

        Assert.Equal(
            "(a + b) > (a * 2) AND length(trim(CAST(a AS TEXT))) < 9",
            Assert.Single(found).Expression);
    }

    /// <summary>
    /// **Un `CHECK` dentro de una cadena es texto.** Es el caso que hace falta
    /// acertar: inventarse una condición aquí la escribiría de verdad en la tabla
    /// la próxima vez que se reconstruya.
    /// </summary>
    [Fact]
    public void NoConfundeLoQueHayDentroDeUnaCadena()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE t (
              estado TEXT DEFAULT 'CHECK (esto no es una condición)',
              nota   TEXT DEFAULT 'no''sé CHECK (ni esto)'
            )
            """);

        Assert.Empty(found);
    }

    /// <summary>Ni el que va dentro de un nombre citado, de las tres maneras.</summary>
    [Fact]
    public void NoConfundeLoQueHayDentroDeUnNombreCitado()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE t (
              "CHECK (a)" INTEGER,
              [CHECK (b)] INTEGER,
              `CHECK (c)` INTEGER
            )
            """);

        Assert.Empty(found);
    }

    /// <summary>Ni el que va comentado, de las dos maneras.</summary>
    [Fact]
    public void NoConfundeLoQueVaComentado()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE t (
              a INTEGER, -- CHECK (a > 0) esto se quitó
              /* y esto también: CHECK (a < 0) */
              b INTEGER CHECK (b <> 0)
            )
            """);

        Assert.Equal("b <> 0", Assert.Single(found).Expression);
    }

    /// <summary>
    /// El nombre citado se devuelve **sin las comillas**, que no son parte del
    /// nombre: con ellas, soltar la restricción por su nombre no encontraría nada.
    /// </summary>
    [Fact]
    public void DevuelveElNombreCitadoSinComillas()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE t (a INTEGER, CONSTRAINT "ck de a" CHECK (a > 0))
            """);

        Assert.Equal("ck de a", Assert.Single(found).Name);
    }

    /// <summary>
    /// Un nombre de `CONSTRAINT` **no se pega a la condición siguiente** si en
    /// medio hay otra restricción: el nombre es de la que lo lleva.
    /// </summary>
    [Fact]
    public void NoLeRobaElNombreALaRestriccionDeAlLado()
    {
        var found = SqliteCheckConstraints.Read("""
            CREATE TABLE t (
              a INTEGER,
              b INTEGER,
              CONSTRAINT uq_a UNIQUE (a),
              CHECK (b > 0)
            )
            """);

        Assert.Equal(string.Empty, Assert.Single(found).Name);
    }

    /// <summary>
    /// Lo que no se entiende **no se inventa**. Son entradas que no deberían
    /// llegar —el motor guarda lo que aceptó— y lo que importa es que devuelvan
    /// nada en vez de tirar la lectura de la tabla entera.
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("CREATE TABLE t (a INTEGER)")]
    [InlineData("CREATE TABLE t (a INTEGER, CHECK")]
    [InlineData("CREATE TABLE t (a INTEGER, CHECK (")]
    [InlineData("CREATE TABLE t (a INTEGER, CHECK ()")]
    [InlineData("CREATE TABLE t (a INTEGER, CHECK (a > 0")]
    [InlineData("CREATE TABLE t (a TEXT DEFAULT 'sin cerrar")]
    public void LoQueNoSeEntiendeNoSeInventa(string? sql)
    {
        Assert.Empty(SqliteCheckConstraints.Read(sql));
    }
}
