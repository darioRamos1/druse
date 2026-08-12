using System.Reflection;
using Druse.Application.Abstractions;
using Druse.Host.LocalApi;
using Druse.Host.LocalApi.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// La API local escucha exclusivamente en la interfaz de loopback y nunca en 0.0.0.0.
// Ver PLAN_TRABAJO_DRUSE.md §2 (Decisión de implementación) y §12 (Seguridad desde el inicio).
// El puerto será dinámico cuando Tauri administre el proceso auxiliar (Fase 7).
const int DefaultPort = 5177;
int port = builder.Configuration.GetValue("LocalApi:Port", DefaultPort);
builder.WebHost.ConfigureKestrel(options => options.ListenLocalhost(port));

builder.Services.AddOpenApi();
builder.Services.AddDruse();

// Origen del servidor de desarrollo de Angular. En producción el frontend se sirve
// desde el propio host y no hace falta CORS.
const string DevelopmentCorsPolicy = "druse-dev";
builder.Services.AddCors(options => options.AddPolicy(DevelopmentCorsPolicy, policy =>
    policy.WithOrigins("http://localhost:4200", "http://127.0.0.1:4200")
          .AllowAnyHeader()
          .AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseCors(DevelopmentCorsPolicy);
}

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
    catch (Exception exception)
    {
        // El detalle va al log del servidor; al cliente solo un mensaje genérico.
        app.Logger.LogError(exception, "Error no controlado atendiendo {Path}", context.Request.Path);

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new { message = "Se produjo un error inesperado." });
    }
});

// Verifica que el proceso local está activo.
app.MapGet("/api/health", () => new HealthResponse(
    Status: "ok",
    Product: "Druse",
    Version: Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0",
    Environment: app.Environment.EnvironmentName,
    TimestampUtc: DateTimeOffset.UtcNow))
   .WithName("GetHealth");

app.MapDatabaseEndpoints();

// Ninguna conexión ni transacción debe quedar viva al cerrar (plan §12).
app.Lifetime.ApplicationStopping.Register(() =>
{
    var sessions = app.Services.GetRequiredService<ISessionRegistry>();
    sessions.CloseAllAsync().GetAwaiter().GetResult();
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
