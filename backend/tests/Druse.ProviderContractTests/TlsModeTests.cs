using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Que el modo de cifrado elegido llegue al motor y **haga algo**.
///
/// Es fácil de creer y difícil de saber: una opción de TLS mal traducida no da
/// ningún error, simplemente cifra menos de lo que la pantalla promete. Aquí se
/// comprueba contra un servidor real que exigir cifrado a uno que no lo ofrece
/// falla, que es la única forma de distinguir «exige» de «lo pone en la
/// pantalla».
///
/// Los contenedores de prueba no tienen TLS configurado, y eso es justo lo que
/// hace la prueba posible.
/// </summary>
public sealed class TlsModeTests
{
    [Fact]
    public async Task PostgreSql_ExigirCifradoContraUnServidorSinTls_Falla()
    {
        var fixture = new PostgreSqlFixture();

        if (!fixture.IsAvailable) { return; }

        // Con `Prefer` entra: cifra si puede y sigue adelante si no.
        await using (var session = await fixture.Provider.OpenSessionAsync(
            fixture.Profile() with { SslMode = SslMode.Prefer },
            fixture.Credentials,
            CancellationToken.None))
        {
            Assert.True(session.IsOpen);
        }

        // Con `Require` no, y ese «no» es la prueba de que la opción llega al
        // driver en lugar de quedarse en la pantalla.
        var error = await Assert.ThrowsAnyAsync<Exception>(() =>
            fixture.Provider.OpenSessionAsync(
                fixture.Profile() with { SslMode = SslMode.Require },
                fixture.Credentials,
                CancellationToken.None));

        Assert.Contains("ssl", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Y comprobar el certificado es más que cifrar: contra el mismo servidor sin
    /// TLS, `VerifyFull` tampoco entra.
    /// </summary>
    [Fact]
    public async Task PostgreSql_VerificarElCertificadoContraUnServidorSinTls_Falla()
    {
        var fixture = new PostgreSqlFixture();

        if (!fixture.IsAvailable) { return; }

        await Assert.ThrowsAnyAsync<Exception>(() =>
            fixture.Provider.OpenSessionAsync(
                fixture.Profile() with { SslMode = SslMode.VerifyFull },
                fixture.Credentials,
                CancellationToken.None));
    }

    [Fact]
    public async Task MySql_ExigirCifradoContraUnServidorSinTls_Falla()
    {
        var fixture = new MySqlFixture();

        if (!fixture.IsAvailable) { return; }

        await using (var session = await fixture.Provider.OpenSessionAsync(
            fixture.Profile() with { SslMode = SslMode.Prefer },
            fixture.Credentials,
            CancellationToken.None))
        {
            Assert.True(session.IsOpen);
        }

        // MySQL 8 trae su propio certificado autofirmado, así que **cifrar sí
        // puede**: lo que no puede es demostrar quién es. Por eso aquí se exige el
        // modo que comprueba el nombre, que es el que tiene que fallar.
        await Assert.ThrowsAnyAsync<Exception>(() =>
            fixture.Provider.OpenSessionAsync(
                fixture.Profile() with { SslMode = SslMode.VerifyFull },
                fixture.Credentials,
                CancellationToken.None));
    }
}
