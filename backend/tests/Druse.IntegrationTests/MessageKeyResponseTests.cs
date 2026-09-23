using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

using Druse.Domain;

namespace Druse.IntegrationTests;

/// <summary>
/// Que la clave del mensaje llegue al cliente, y no solo el texto.
///
/// Es lo que permite que la ventana enseñe el motivo en el idioma que el usuario
/// eligió. Se comprueba por HTTP y no en el validador porque lo que puede
/// perderse es justo el camino: un mapeo que se olvide del campo deja el texto
/// en español para siempre, y todo lo demás sigue pasando.
/// </summary>
public sealed class MessageKeyResponseTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public MessageKeyResponseTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task UnPerfilInvalido_LlegaConLaClaveDeCadaMotivo()
    {
        using var client = _factory.CreateAuthenticatedClient();

        // Sin servidor y con un puerto imposible: dos motivos, no uno.
        var response = await client.PostAsJsonAsync("/api/sessions", new
        {
            profile = new
            {
                name = "Sin servidor",
                engine = "postgresql",
                host = "",
                port = 0,
                database = "druse",
                username = "druse",
            },
            password = "da igual",
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);

        var body = await response.ReadJsonAsync();
        var claves = body
            .GetProperty("messages")
            .EnumerateArray()
            .Select(message => message.GetProperty("key").GetString())
            .ToList();

        Assert.Contains(MessageKeys.Connection.Host, claves);
        Assert.Contains(MessageKeys.Connection.Port, claves);

        // Y el texto en español sigue yendo: es lo que ve quien llame a la API
        // sin catálogo delante.
        Assert.Contains("servidor", body.GetProperty("message").GetString() ?? string.Empty,
            StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UnaSesionQueNoExiste_LlegaConSuClaveYSuIdentificador()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.GetAsync(
            new Uri($"/api/sessions/{Guid.NewGuid()}/transaction", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        var body = await response.ReadJsonAsync();
        var mensaje = body.GetProperty("messages").EnumerateArray().Single();

        Assert.Equal(MessageKeys.Session.NotOpen, mensaje.GetProperty("key").GetString());

        // El identificador va como parámetro, no pegado dentro de la frase: es
        // lo que permite escribirla en otro idioma sin perderlo.
        Assert.False(
            string.IsNullOrWhiteSpace(
                mensaje.GetProperty("args").GetProperty("session").GetString()));
    }

    /// <summary>
    /// Un túnel que no está configurado se explica con clave.
    ///
    /// Es el camino por el que el motivo no viaja como excepción sino dentro del
    /// resultado, que es donde es más fácil olvidarse del campo nuevo.
    /// </summary>
    [Fact]
    public async Task UnTunelQueNoEsta_LlegaConSuClave()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/connections/test-tunnel", new
        {
            profile = new
            {
                name = "Sin túnel",
                engine = "postgresql",
                host = "127.0.0.1",
                port = 5432,
                database = "druse",
                username = "druse",
            },
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.ReadJsonAsync();

        Assert.False(body.GetProperty("succeeded").GetBoolean());
        Assert.Equal(
            MessageKeys.Tunnel.NotConfigured,
            body.GetProperty("error").GetProperty("key").GetString());
    }
}
