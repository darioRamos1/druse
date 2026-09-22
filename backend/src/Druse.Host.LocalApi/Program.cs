using System.Reflection;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Host.LocalApi;
using Druse.Host.LocalApi.Diagnostics;
using Druse.Host.LocalApi.Endpoints;
using Druse.Host.LocalApi.Security;
using Druse.Persistence.Sqlite;
using Druse.Platform.Abstractions;
using Druse.Platform.Native;

var builder = WebApplication.CreateBuilder(args);

// La API local escucha exclusivamente en la interfaz de loopback y nunca en 0.0.0.0.
// Ver docs/planes/PLAN_TRABAJO_DRUSE.md §2 (Decisión de implementación) y §12 (Seguridad desde el inicio).
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

// Registro en archivo, porque **la aplicación empaquetada no tiene consola**: el
// envoltorio arranca la API sin ventana —una consola de ASP.NET delante de Druse
// sería peor— y con ella se iba el único sitio donde se veían los registros. Un
// fallo en el equipo de un usuario no dejaba rastro ninguno.
//
// Rota por tamaño y conserva unos pocos archivos: esto vive en el equipo de una
// persona, y unos registros que crecen sin fin son un problema nuevo.
builder.Logging.AddProvider(new FileLoggerProvider(
    new AppPaths(),
    builder.Configuration.GetSection("Logging:File").Get<FileLogOptions>() ?? new FileLogOptions()));

// La API es un proceso auxiliar de la ventana: si quien la arrancó desaparece,
// no tiene a quién servir. Sin esto, una ventana que muere de golpe deja la API
// viva reteniendo su puerto y bloqueando sus propios archivos, hasta el punto de
// impedir que Druse se desinstale.
//
// Solo se vigila si el envoltorio dice a quién: arrancada a mano —en desarrollo,
// o para depurar— no hay padre del que depender.
int parentProcessId = builder.Configuration.GetValue("LocalApi:ParentProcessId", 0);

if (parentProcessId > 0)
{
    builder.Services.AddSingleton<IHostedService>(services => new ParentProcessWatcher(
        services.GetRequiredService<IHostApplicationLifetime>(),
        services.GetRequiredService<ILogger<ParentProcessWatcher>>(),
        parentProcessId));
}

// Origen del servidor de desarrollo de Angular. En producción el frontend se sirve
// desde el propio host y no hace falta CORS.
//
// La política es estricta a propósito: solo estos dos orígenes, y se exige que el
// navegador pueda enviar la cabecera del token (plan §12).
const string DevelopmentCorsPolicy = "druse-dev";

// Cuántos trabajos largos se enseñan. Es una lista para mirar «qué pasó», no un
// historial que nadie va a recorrer entero.
const int JobHistoryLimit = 20;
builder.Services.AddCors(options => options.AddPolicy(DevelopmentCorsPolicy, policy =>
    policy.WithOrigins(
              // Servidor de desarrollo de Angular.
              "http://localhost:4200",
              "http://127.0.0.1:4200",
              // La ventana empaquetada. Tauri sirve la aplicación desde su
              // propio protocolo —`http://tauri.localhost` en Windows y
              // `tauri://localhost` en macOS y Linux—, así que sin estos dos
              // orígenes el navegador incrustado descarta la respuesta y la
              // aplicación instalada no puede hablar con su propia API.
              "http://tauri.localhost",
              "tauri://localhost")
          .WithHeaders("Content-Type", "X-Druse-Token")
          .WithMethods("GET", "POST", "PUT", "DELETE")));

var app = builder.Build();

// La base local debe existir antes de atender la primera petición.
await app.Services.GetRequiredService<DruseDatabase>().MigrateAsync(CancellationToken.None);

// Un trabajo que figure «en marcha» en un proceso que acaba de arrancar es uno
// que el cierre anterior se llevó por delante: nadie llegó a saber cómo acabó, y
// lo que dejó escrito —un archivo a medias, unas filas— sigue donde esté.
//
// Se hace aquí y no en un servicio alojado para que ocurra **antes** de atender
// la primera petición: si no, el primer `GET /api/jobs` podría contestar que hay
// un respaldo corriendo que murió anoche.
using (var scope = app.Services.CreateScope())
{
    var interrupted = await scope.ServiceProvider
        .GetRequiredService<IJobStore>()
        .InterruptRunningAsync(CancellationToken.None);

    if (interrupted > 0)
    {
        app.Logger.LogWarning(
            "{Count} trabajo(s) largo(s) quedaron interrumpidos al cerrarse Druse.",
            interrupted);
    }
}

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
    catch (InvalidProfileException exception)
    {
        // Lo que se mandó no vale, y se dice campo a campo **con su clave**: es
        // lo que permite que la ventana lo escriba en su idioma y señale la
        // casilla. `message` sigue yendo, en español, para quien llame a la API
        // sin catálogo delante.
        context.Response.StatusCode = StatusCodes.Status400BadRequest;

        await context.Response.WriteAsJsonAsync(new
        {
            message = exception.Message,
            messages = exception.Messages.Select(message => new
            {
                key = message.Key,
                text = message.Text,
                args = message.Args,
            }),
        });
    }
    catch (ArgumentException exception)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { message = exception.Message });
    }
    catch (TableChangeFailedException exception)
    {
        // Un cambio de tabla que falla a mitad no es un error del programa, y lo
        // que hay que contar no es solo el motivo: **cuál** instrucción falló y si
        // lo anterior quedó aplicado. Sin eso, en un motor que no deshace el DDL
        // el usuario vuelve al diseñador creyendo que su tabla sigue igual.
        app.Logger.LogWarning(
            "El motor rechazó un cambio de tabla en {Path}: {Message}",
            context.Request.Path,
            exception.Error.Message);

        context.Response.StatusCode = StatusCodes.Status409Conflict;

        await context.Response.WriteAsJsonAsync(new
        {
            message = exception.Message,
            code = exception.Error.Code,
            statement = exception.Statement,
            applied = exception.Applied,
            reverted = exception.Reverted,

            // Y, cuando el motivo son las filas que ya había, la consulta que las
            // enseña: el mensaje dice qué pasa y esto es lo que permite arreglarlo
            // sin salir de Druse.
            diagnostic = exception.Error.Diagnostic,
        });
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
        // se pueden confirmar, y esto no se confirma, se arregla. Y arreglarlo a
        // veces es mirar unas filas, así que va la consulta que las enseña cuando
        // quien rechazó supo escribirla.
        await context.Response.WriteAsJsonAsync(new
        {
            message = exception.Error.Message,
            code = exception.Error.Code,
            diagnostic = exception.Error.Diagnostic,
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

// Apagado ordenado, pedido por el envoltorio al cerrar la ventana.
//
// Antes lo único que había era matar el proceso, y matarlo **se salta
// `ApplicationStopping`**: las sesiones contra las bases del usuario no se
// cierran, se cortan, y una transacción abierta se queda a lo que decida el
// servidor. Con esto se le pide a la API que se apague por su cuenta; quien lo
// pide espera, y solo si no muere lo mata (`api_process.rs`).
//
// Responde antes de apagar porque no puede responder después: el apagado cierra
// el servidor que tendría que enviar la respuesta.
// Todo lo que hace falta para entender un fallo, en un archivo que se puede
// mandar: los registros y un resumen de versión y sistema.
//
// Existe por lo mismo que el registro en archivo —en la aplicación empaquetada no
// hay consola— y porque pedirle a alguien que busque un directorio dentro de su
// perfil es pedirle que no lo haga.
app.MapGet("/api/diagnostics", (IAppPaths paths) =>
    Results.File(
        DiagnosticPackage.Build(paths, app.Environment.EnvironmentName),
        "application/zip",
        DiagnosticPackage.FileName))
.WithName("GetDiagnostics");

// Los trabajos largos que hubo, con los que quedaron a medias entre ellos.
//
// Es la única forma de saberlo después de cerrar Druse: lo que guardan los
// registros de respaldos y traslados vive en memoria y se va con el proceso.
app.MapGet("/api/jobs", async (IJobStore jobs, CancellationToken cancellationToken) =>
    Results.Ok((await jobs.RecentAsync(JobHistoryLimit, cancellationToken))
        .Select(job => job.ToDto())))
.WithName("GetJobs");

app.MapPost("/api/shutdown", (IHostApplicationLifetime lifetime) =>
{
    lifetime.StopApplication();

    return Results.Accepted();
})
.WithName("Shutdown");

app.MapDatabaseEndpoints();
app.MapStorageEndpoints();
app.MapFolderEndpoints();
app.MapExportEndpoints();
app.MapImportEndpoints();
app.MapBackupEndpoints();
app.MapRestoreEndpoints();
app.MapTransferEndpoints();
app.MapAiEndpoints();

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

    // Los túneles se cierran después: mientras haya una conexión despidiéndose,
    // su reenvío todavía hace falta.
    app.Services.GetRequiredService<ISshTunnelRegistry>().CloseAllAsync().GetAwaiter().GetResult();
    endpoint.Dispose();
});

app.Run();

/// <summary>Un trabajo largo tal y como se cuenta por HTTP.</summary>
internal sealed record JobDto
{
    public required Guid Id { get; init; }

    /// <summary>`Backup`, `Restore` o `Transfer`.</summary>
    public required string Kind { get; init; }

    public string? Subject { get; init; }

    /// <summary>`Running`, `Finished` o `Interrupted`.</summary>
    public required string State { get; init; }

    public string? Outcome { get; init; }

    public required DateTimeOffset StartedAtUtc { get; init; }

    public DateTimeOffset? FinishedAtUtc { get; init; }
}

internal static class JobDtoMapper
{
    public static JobDto ToDto(this JobRecord job) => new()
    {
        Id = job.Id,
        Kind = job.Kind.ToString(),
        Subject = job.Subject,
        State = job.State.ToString(),
        Outcome = job.Outcome,
        StartedAtUtc = job.StartedAtUtc,
        FinishedAtUtc = job.FinishedAtUtc,
    };
}

/// <summary>Respuesta de <c>GET /api/health</c>.</summary>
internal sealed record HealthResponse(
    string Status,
    string Product,
    string Version,
    string Environment,
    DateTimeOffset TimestampUtc);

/// <summary>Expuesto para que las pruebas de integración puedan levantar el host.</summary>
public partial class Program;
