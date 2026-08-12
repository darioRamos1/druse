using System.Reflection;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Host.LocalApi;
using Druse.Host.LocalApi.Endpoints;
using Druse.Host.LocalApi.Security;
using Druse.Persistence.Sqlite;

var builder = WebApplication.CreateBuilder(args);

// La API local escucha exclusivamente en la interfaz de loopback y nunca en 0.0.0.0.
// Ver PLAN_TRABAJO_DRUSE.md §2 (Decisión de implementación) y §12 (Seguridad desde el inicio).
//
// El puerto 0 pide uno libre al sistema, que es lo que usa la aplicación de
// escritorio: un puerto fijo puede estar ocupado por otro programa, o por otra
// instancia de Druse. En desarrollo se mantiene el 5177 para que el proxy de
// Angular sepa a dónde ir sin leer nada.
const int DefaultPort = 5177;
int configuredPort = builder.Configuration.GetValue("LocalApi:Port", DefaultPort);

builder.WebHost.ConfigureKestrel(options =>
{
    if (configuredPort == 0)
    {
        // `ListenLocalhost` no admite puerto dinámico porque abriría dos
        // sockets —IPv4 e IPv6— y cada uno recibiría un puerto distinto. Con la
        // dirección explícita, el sistema asigna uno y sabemos cuál.
        options.Listen(System.Net.IPAddress.Loopback, 0);
    }
    else
    {
        options.ListenLocalhost(configuredPort);
    }
});

builder.Services.AddOpenApi();
builder.Services.AddDruse();

// Origen del servidor de desarrollo de Angular. En producción el frontend se sirve
// desde el propio host y no hace falta CORS.
//
// La política es estricta a propósito: solo estos dos orígenes, y se exige que el
// navegador pueda enviar la cabecera del token (plan §12).
const string DevelopmentCorsPolicy = "druse-dev";
builder.Services.AddCors(options => options.AddPolicy(DevelopmentCorsPolicy, policy =>
    policy.WithOrigins("http://localhost:4200", "http://127.0.0.1:4200")
          .WithHeaders("Content-Type", "X-Druse-Token")
          .WithMethods("GET", "POST", "PUT", "DELETE")));

var app = builder.Build();

// La base local debe existir antes de atender la primera petición.
await app.Services.GetRequiredService<DruseDatabase>().MigrateAsync(CancellationToken.None);

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// CORS también en producción: la política solo admite el origen de la aplicación.
app.UseCors(DevelopmentCorsPolicy);

// Traduce las excepciones conocidas a respuestas HTTP.
//
// Se hace en un middleware y no en cada endpoint para garantizar que **ninguna
// excepción llega al cliente con su traza**: un mensaje del driver puede contener
// la cadena de conexión, y con ella la contraseña (plan §12).
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (SessionNotFoundException exception)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new { message = exception.Message });
    }
    catch (UnsupportedEngineException exception)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { message = exception.Message });
    }
    catch (ArgumentException exception)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { message = exception.Message });
    }
    catch (DatabaseOperationException exception)
    {
        // El motor dijo que no, y dijo por qué.
        //
        // Que falte un permiso o que la contraseña no sea correcta no es un
        // fallo del programa: es una respuesta normal de una base de datos, y el
        // usuario puede hacer algo al respecto **si se la contamos**. El mensaje
        // ya viene saneado por el proveedor, sin cadena de conexión.
        //
        // Se registra como aviso y no como error: no hay nada roto que arreglar
        // aquí, y llenar el log de trazas escondería los fallos de verdad.
        app.Logger.LogWarning(
            "El motor rechazó {Path}: {Message}",
            context.Request.Path,
            exception.Error.Message);

        context.Response.StatusCode = StatusCodes.Status409Conflict;

        // Sin campo `reason`: ese lo usa el cliente para reconocer los avisos que
        // se pueden confirmar, y esto no se confirma, se arregla.
        await context.Response.WriteAsJsonAsync(new
        {
            message = exception.Error.Message,
            code = exception.Error.Code,
        });
    }
    catch (Exception exception)
    {
        // El detalle va al log del servidor; al cliente solo un mensaje genérico.
        // Aquí abajo solo debería quedar lo que de verdad no esperábamos.
        app.Logger.LogError(exception, "Error no controlado atendiendo {Path}", context.Request.Path);

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new { message = "Se produjo un error inesperado." });
    }
});

// Escuchar solo en loopback impide el acceso desde la red, pero no desde la propia
// máquina: sin token, cualquier proceso del usuario podría abrir sesiones contra
// sus bases de datos.
app.UseMiddleware<TokenAuthenticationMiddleware>();

// Verifica que el proceso local está activo. Es la única ruta sin token.
app.MapGet("/api/health", () => new HealthResponse(
    Status: "ok",
    Product: "Druse",
    Version: Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0",
    Environment: app.Environment.EnvironmentName,
    TimestampUtc: DateTimeOffset.UtcNow))
   .WithName("GetHealth");

app.MapDatabaseEndpoints();
app.MapStorageEndpoints();
app.MapExportEndpoints();
app.MapImportEndpoints();

var endpoint = app.Services.GetRequiredService<LocalApiEndpoint>();

// El punto de conexión se publica cuando el servidor ya escucha: con puerto
// dinámico, el número real no existe hasta ese momento.
app.Lifetime.ApplicationStarted.Register(() =>
{
    var addresses = app.Services
        .GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>()
        .Features.Get<Microsoft.AspNetCore.Hosting.Server.Features.IServerAddressesFeature>();

    var address = addresses?.Addresses.FirstOrDefault();
    var listeningPort = address is null ? configuredPort : new Uri(address).Port;

    endpoint.Publish(listeningPort);

    if (app.Logger.IsEnabled(LogLevel.Information))
    {
        app.Logger.LogInformation(
            "Druse escuchando en http://127.0.0.1:{Port}; punto de conexión en {Path}",
            listeningPort,
            endpoint.FilePath);
    }
});

// Ninguna conexión ni transacción debe quedar viva al cerrar, y el punto de
// conexión deja de existir con el proceso (plan §12).
app.Lifetime.ApplicationStopping.Register(() =>
{
    app.Services.GetRequiredService<ISessionRegistry>().CloseAllAsync().GetAwaiter().GetResult();
    endpoint.Dispose();
});

app.Run();

/// <summary>Respuesta de <c>GET /api/health</c>.</summary>
internal sealed record HealthResponse(
    string Status,
    string Product,
    string Version,
    string Environment,
    DateTimeOffset TimestampUtc);

/// <summary>Expuesto para que las pruebas de integración puedan levantar el host.</summary>
public partial class Program;
