using Druse.Provider.PostgreSql;
using Npgsql;

namespace Druse.UnitTests;

/// <summary>
/// Lo que lee el usuario cuando el servidor no le deja entrar.
///
/// PostgreSQL explica muy bien los errores de SQL, pero los de acceso los cuenta
/// en sus propios términos —habla de `pg_hba.conf`, que es un archivo suyo— y en
/// inglés. Quien conecta desde otro equipo necesita saber qué hacer, no cómo se
/// llama el archivo que se lo impide.
/// </summary>
public sealed class PostgreSqlErrorNormalizerTests
{
    /// <summary>
    /// El caso que apareció al probar desde otro equipo.
    ///
    /// La pista está en «no encryption»: la conexión llegó en claro y el servidor
    /// solo admite cifradas desde esa dirección, así que lo primero que hay que
    /// probar es subir el cifrado a «Requerir».
    /// </summary>
    [Fact]
    public void SinCifrado_ExplicaQueProbarConRequerirCifrado()
    {
        var error = PostgreSqlErrorNormalizer.Normalize(Postgres(
            "28000",
            "no pg_hba.conf entry for host \"152.200.142.226\", user \"edna.tovar\", " +
            "database \"postgres\", no encryption"));

        Assert.Contains("sin cifrar", error.Message);
        Assert.Contains("«Requerir»", error.Message);

        // El texto del servidor se conserva: es lo que hay que enseñarle a quien
        // administra la base.
        Assert.Contains("152.200.142.226", error.Message);
        Assert.Equal("28000", error.Code);
    }

    /// <summary>
    /// Con cifrado y el mismo rechazo, el cliente ya no puede hacer nada: la
    /// dirección no está autorizada y eso se arregla en el servidor.
    /// </summary>
    [Fact]
    public void ConCifrado_DiceQueHayQueAutorizarLaDireccionEnElServidor()
    {
        var error = PostgreSqlErrorNormalizer.Normalize(Postgres(
            "28000",
            "no pg_hba.conf entry for host \"152.200.142.226\", user \"edna.tovar\", " +
            "database \"postgres\", SSL encryption"));

        Assert.Contains("no tiene autorizada", error.Message);
        Assert.Contains("No es la contraseña", error.Message);
        Assert.DoesNotContain("«Requerir»", error.Message);
    }

    [Fact]
    public void ContraseñaIncorrecta_SeDiceConPalabras()
    {
        var error = PostgreSqlErrorNormalizer.Normalize(Postgres(
            "28P01",
            "password authentication failed for user \"edna.tovar\""));

        Assert.StartsWith("La contraseña no es correcta", error.Message);
    }

    [Fact]
    public void BaseInexistente_SeDiceConPalabras()
    {
        var error = PostgreSqlErrorNormalizer.Normalize(Postgres(
            "3D000",
            "database \"ventas\" does not exist"));

        Assert.StartsWith("Esa base de datos no existe", error.Message);
        Assert.Contains("ventas", error.Message);
    }

    /// <summary>
    /// Los errores de SQL se dejan como están: PostgreSQL dice qué columna y qué
    /// tipo, y reescribirlos sería perder información.
    /// </summary>
    [Fact]
    public void UnErrorDeSql_SeConservaTalCual()
    {
        const string original = "column \"nombre\" does not exist";

        var error = PostgreSqlErrorNormalizer.Normalize(Postgres("42703", original));

        Assert.Equal(original, error.Message);
    }

    private static PostgresException Postgres(string sqlState, string message) =>
        new(message, "ERROR", "ERROR", sqlState);
}
