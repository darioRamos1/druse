using System.Net;

namespace Druse.IntegrationTests;

/// <summary>
/// Las rutas de la transacción manual, sin motor detrás.
///
/// Lo que se comprueba aquí es que existen, que piden credenciales como el resto
/// y que una sesión que no está abierta se contesta con un 404 en lugar de con un
/// error del servidor. El ciclo de verdad —abrir, escribir, deshacer— se ejercita
/// en las pruebas unitarias contra una base real.
/// </summary>
public sealed class TransactionEndpointTests(DruseApiFactory factory)
    : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    [Theory]
    [InlineData("")]
    [InlineData("/commit")]
    [InlineData("/rollback")]
    public async Task SinSesionAbierta_DevuelveNoEncontrado(string accion)
    {
        using var client = _factory.CreateAuthenticatedClient();

        using var response = await client.PostAsync(
            $"/api/sessions/{Guid.NewGuid()}/transaction{accion}",
            content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ConsultarElEstadoDeUnaSesionQueNoExiste_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        using var response = await client.GetAsync($"/api/sessions/{Guid.NewGuid()}/transaction");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// Una transacción abierta puede tener dentro los cambios de media mañana:
    /// la ruta no puede quedar fuera de la comprobación de credenciales.
    /// </summary>
    [Fact]
    public async Task SinCredenciales_NoSePuedeTocarLaTransaccion()
    {
        using var client = _factory.CreateClient();

        using var response = await client.PostAsync(
            $"/api/sessions/{Guid.NewGuid()}/transaction",
            content: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
