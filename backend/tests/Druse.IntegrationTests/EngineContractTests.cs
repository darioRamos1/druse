using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Todo motor que la API anuncia tiene que poder usarse.
///
/// Existe por un fallo que se descubrió probando el paquete portable contra un
/// Informix real: `/api/engines` lo ofrecía —esa lista sale del registro de
/// proveedores— pero el traductor del contrato no reconocía su identificador, y
/// devolvía «Motor desconocido». **El motor entero era inalcanzable desde la
/// aplicación** con su proveedor perfectamente cargado.
///
/// Las pruebas contractuales de proveedor no podían verlo: construyen el perfil
/// directamente en el dominio, sin pasar por el contrato HTTP. Este agujero solo
/// se ve entrando por donde entra la interfaz.
/// </summary>
public sealed class EngineContractTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public EngineContractTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    private sealed record EngineDto(string Id, string Name, int DefaultPort);

    [Fact]
    public async Task TodoMotorAnunciado_SeAceptaAlConectar()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var engines = await client.GetFromJsonAsync<EngineDto[]>("/api/engines");

        Assert.NotNull(engines);
        Assert.NotEmpty(engines);

        foreach (var engine in engines)
        {
            var request = new
            {
                profile = new
                {
                    name = $"Prueba de {engine.Id}",
                    engine = engine.Id,
                    // Un host que no existe: lo que se comprueba es que la
                    // petición **llega al proveedor**, no que haya servidor. Si
                    // el identificador no se reconociera, ni siquiera llegaría.
                    host = "host-que-no-existe.invalid",
                    port = engine.DefaultPort,
                    database = "druse_test",
                    username = "quien-sea",
                    connectTimeoutSeconds = 2,
                },
                password = "lo-que-sea",
            };

            using var response = await client.PostAsJsonAsync("/api/connections/test", request);
            var cuerpo = await response.Content.ReadAsStringAsync();

            Assert.False(
                response.StatusCode == HttpStatusCode.BadRequest,
                $"«{engine.Id}» aparece en /api/engines pero la API lo rechaza: {cuerpo}");

            // Y la respuesta es la de un intento real: falla por la conexión, que
            // es lo esperado contra un host inventado.
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            using var json = JsonDocument.Parse(cuerpo);

            Assert.False(
                json.RootElement.GetProperty("succeeded").GetBoolean(),
                $"«{engine.Id}» no debería conectar con un host inventado.");
        }
    }
}
