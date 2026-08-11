using System.Reflection;

var builder = WebApplication.CreateBuilder(args);

// La API local escucha exclusivamente en la interfaz de loopback y nunca en 0.0.0.0.
// Ver PLAN_TRABAJO_DRUSE.md §2 (Decisión de implementación) y §12 (Seguridad desde el inicio).
// El puerto será dinámico cuando Tauri administre el proceso auxiliar (Fase 7).
const int DefaultPort = 5177;
int port = builder.Configuration.GetValue("LocalApi:Port", DefaultPort);
builder.WebHost.ConfigureKestrel(options => options.ListenLocalhost(port));

builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Verifica que el proceso local está activo. Es el único endpoint de la Fase 0.
app.MapGet("/api/health", () => new HealthResponse(
    Status: "ok",
    Product: "Druse",
    Version: Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0",
    Environment: app.Environment.EnvironmentName,
    TimestampUtc: DateTimeOffset.UtcNow))
   .WithName("GetHealth");

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
