using Druse.Application.Connections;

namespace Druse.UnitTests;

/// <summary>
/// A qué base entra Druse cuando el perfil no dice ninguna.
///
/// Se prueba sin motor porque la lista ya viene filtrada por el catálogo: aquí
/// solo se elige. Y se prueba a fondo porque los casos que importan —un usuario
/// que solo ve bases del sistema, un servidor recién instalado— son justo los que
/// no aparecen al probarlo a mano contra un servidor que tiene de todo.
/// </summary>
public sealed class DatabaseChoiceTests
{
    private static readonly string[] Postgres = ["postgres", "template0", "template1"];

    /// <summary>Lo normal: la primera que no sea del motor.</summary>
    [Fact]
    public void ElijeLaPrimeraQueNoEsDelMotor()
    {
        var chosen = DatabaseChoice.Pick(["postgres", "compras", "ventas"], Postgres);

        Assert.Equal("compras", chosen);
    }

    /// <summary>
    /// Si solo hay bases del motor, se usa una.
    ///
    /// Conectar a `postgres` y dejar ver el explorador es mejor que negarse a
    /// abrir la conexión: quien no tiene bases propias todavía suele estar a punto
    /// de crear la primera.
    /// </summary>
    [Fact]
    public void SiSoloHayDelMotorSeUsaUna()
    {
        var chosen = DatabaseChoice.Pick(["postgres", "template1"], Postgres);

        Assert.Equal("postgres", chosen);
    }

    /// <summary>Sin ninguna base no se inventa un nombre.</summary>
    [Fact]
    public void SinBasesNoSeElijeNada()
    {
        Assert.Null(DatabaseChoice.Pick([], Postgres));
    }

    /// <summary>
    /// Las mayúsculas no hacen que una base del motor pase por propia.
    ///
    /// SQL Server devuelve los nombres como se escribieron, y `Master` es la misma
    /// base de siempre.
    /// </summary>
    [Fact]
    public void LasMayusculasNoDisfrazanUnaBaseDelMotor()
    {
        var chosen = DatabaseChoice.Pick(
            ["Master", "TempDB", "Ventas"],
            ["master", "model", "msdb", "tempdb"]);

        Assert.Equal("Ventas", chosen);
    }

    /// <summary>Un nombre vacío en la lista no se elige nunca.</summary>
    [Fact]
    public void UnNombreVacioNoSeElije()
    {
        var chosen = DatabaseChoice.Pick(["", "  ", "ventas"], Postgres);

        Assert.Equal("ventas", chosen);
    }

    /// <summary>Sin bases del motor que apartar, la primera es la primera.</summary>
    [Fact]
    public void SinListaDeSistemaSeTomaLaPrimera()
    {
        Assert.Equal("compras", DatabaseChoice.Pick(["compras", "ventas"], []));
    }
}
