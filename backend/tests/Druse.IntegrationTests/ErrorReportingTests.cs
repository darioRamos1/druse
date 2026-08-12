using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Druse.IntegrationTests;

/// <summary>
/// Que el motivo de un fallo llegue a la pantalla.
///
/// Antes, cualquier cosa que dijera el motor —una contraseña incorrecta, un
/// permiso que falta— salía por la API como un 500 con «Se produjo un error
/// inesperado», y el motivo se quedaba en el log del servidor, donde no lo iba a
/// leer nadie. Eso convertía problemas que el usuario podía arreglar en un muro.
///
/// Lo que estas pruebas fijan es el equilibrio: **se cuenta el motivo, pero no
/// más de la cuenta**. El mensaje del driver puede traer la cadena de conexión
/// dentro, y con ella la contraseña (plan §12).
/// </summary>
public sealed class ErrorReportingTests : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory;

    public ErrorReportingTests(DruseApiFactory factory)
    {
        _factory = factory;
    }

    [RequiresPostgreSqlFact]
    public async Task UnaContrasenaIncorrecta_SeExplicaEnVezDeSerUnErrorInesperado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        const string WrongPassword = "esta-no-es-la-contrasena";

        var response = await client.PostAsJsonAsync("/api/sessions", new
        {
            profile = new
            {
                name = "PostgreSQL de pruebas",
                engine = "postgresql",
                host = TestDatabase.Host,
                port = TestDatabase.Port,
                database = TestDatabase.Database,
                username = TestDatabase.Username,
                connectTimeoutSeconds = 5,
            },
            password = WrongPassword,
        });

        // 409 y no 500: la petición estaba bien, quien dijo que no fue el motor.
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var body = await response.ReadJsonAsync();
        var message = body.GetProperty("message").GetString() ?? string.Empty;

        Assert.NotEqual("Se produjo un error inesperado.", message);

        // El mensaje del motor dice qué pasó: «password authentication failed
        // for user…». Eso es exactamente lo que el usuario necesita leer.
        Assert.Contains("authentication", message, StringComparison.OrdinalIgnoreCase);

        // Y lo que no puede pasar por contarlo: que lleve dentro la contraseña
        // rechazada, ni la cadena de conexión que la contiene.
        Assert.DoesNotContain(WrongPassword, message, StringComparison.Ordinal);
        Assert.DoesNotContain("Password=", message, StringComparison.OrdinalIgnoreCase);
    }

    [RequiresPostgreSqlFact]
    public async Task UnHostQueNoExiste_DiceQueNoSePudoContactar()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/sessions", new
        {
            profile = new
            {
                name = "Servidor inventado",
                engine = "postgresql",
                host = "host-que-no-existe.invalid",
                port = 5432,
                database = "loquesea",
                username = "quien",
                connectTimeoutSeconds = 3,
            },
            password = "da-igual",
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

        var message = (await response.ReadJsonAsync()).GetProperty("message").GetString();

        Assert.False(string.IsNullOrWhiteSpace(message));
        Assert.NotEqual("Se produjo un error inesperado.", message);
    }
}
