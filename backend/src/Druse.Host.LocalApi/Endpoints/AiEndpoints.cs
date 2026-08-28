using System.Text;
using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Platform.Abstractions;

namespace Druse.Host.LocalApi.Endpoints;

/// <summary>Un proveedor tal y como viaja a la interfaz. **Nunca lleva la clave.**</summary>
public sealed record AiProviderDto(
    Guid Id,
    string Name,
    string Kind,
    string BaseUrl,
    string Model,
    string Command,
    string Disclosure,
    bool OwnSession,
    bool IsDefault,
    bool HasStoredKey);

/// <summary>Lo que manda el diálogo al guardar.</summary>
/// <param name="ApiKey">
/// `null` significa «no la toques», y la cadena vacía «retírala». La distinción
/// existe porque el formulario no puede mostrar la clave guardada y llega vacío
/// aunque exista una.
/// </param>
public sealed record SaveAiProviderDto(
    Guid? Id,
    string Name,
    string Kind,
    string BaseUrl,
    string Model,
    string Command,
    string Disclosure,
    bool OwnSession,
    bool IsDefault,
    string? ApiKey);

/// <summary>Un turno de la conversación tal y como llega de la interfaz.</summary>
public sealed record AiMessageDto(string Role, string Text);

/// <summary>Lo que se le pide al asistente.</summary>
/// <param name="Context">
/// Estructura de las tablas en juego, ya compuesta por la interfaz. Va aparte de
/// los mensajes para que el backend pueda **negarse a enviarla** cuando el
/// proveedor no tiene permiso para verla.
/// </param>
public sealed record AiChatDto(
    Guid ProviderId,
    IReadOnlyList<AiMessageDto> Messages,
    string? Context);

/// <summary>
/// El asistente: sus proveedores y la conversación.
///
/// **La conversación va en streaming y no en una respuesta normal.** Un modelo
/// tarda segundos en escribir su respuesta entera, y una petición que no
/// devuelve nada durante ese rato es indistinguible de una colgada. Se usa
/// `text/event-stream` porque es lo que ya habla el proveedor por debajo: cada
/// trozo que llega se reenvía tal cual, sin acumular.
/// </summary>
internal static class AiEndpoints
{
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/ai/providers", async (
            SavedAiProviderService providers,
            CancellationToken cancellationToken) =>
        {
            var saved = await providers.GetAllAsync(cancellationToken);
            var dtos = new List<AiProviderDto>(saved.Count);

            foreach (var profile in saved)
            {
                var key = await providers.GetKeyAsync(profile.Id, cancellationToken);

                dtos.Add(ToDto(profile, key is not null));
            }

            return Results.Ok(new
            {
                providers = dtos,
                canStoreKeys = providers.CanStoreKeys,
                storeDescription = providers.SecretStoreDescription,
            });
        });

        app.MapPost("/api/ai/providers", async (
            SaveAiProviderDto request,
            SavedAiProviderService providers,
            CancellationToken cancellationToken) =>
        {
            var profile = ToDomain(request);
            var validation = AiProviderValidator.Validate(profile);

            if (!validation.IsValid)
            {
                return Results.Json(
                    new { message = string.Join(" ", validation.Errors) },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var result = await providers.SaveAsync(profile, request.ApiKey, cancellationToken);

            return Results.Ok(new
            {
                provider = ToDto(result.Profile, result.KeyStored),
                keyStored = result.KeyStored,
                storeDescription = result.StoreDescription,
            });
        });

        app.MapDelete("/api/ai/providers/{id:guid}", async (
            Guid id,
            SavedAiProviderService providers,
            CancellationToken cancellationToken) =>
            await providers.DeleteAsync(id, cancellationToken)
                ? Results.NoContent()
                : Results.NotFound());

        /*
         * Probar antes de guardar.
         *
         * Acepta el perfil entero y no un identificador porque se llama **desde
         * el diálogo**, con lo que hay escrito en pantalla y todavía sin guardar:
         * exigir guardar primero obligaría a dejar en la lista un proveedor que
         * quizá no funciona.
         */
        app.MapPost("/api/ai/providers/test", async (
            SaveAiProviderDto request,
            SavedAiProviderService providers,
            IEnumerable<IAiProvider> known,
            CancellationToken cancellationToken) =>
        {
            var profile = ToDomain(request);
            var validation = AiProviderValidator.Validate(profile);

            if (!validation.IsValid)
            {
                return Results.Json(
                    new { reachable = false, detail = string.Join(" ", validation.Errors) },
                    statusCode: StatusCodes.Status400BadRequest);
            }

            // La clave escrita gana; si el diálogo no la manda —porque no se
            // tocó— se usa la guardada, que es lo que el usuario espera al
            // probar un proveedor que ya existía.
            var key = request.ApiKey;

            if (key is null && request.Id is { } id)
            {
                key = await providers.GetKeyAsync(id, cancellationToken);
            }

            var probe = await For(known, profile).ProbeAsync(
                new AiRequest(profile, key, [new AiMessage(AiRole.User, "ping")]),
                cancellationToken);

            return Results.Ok(new
            {
                reachable = probe.Reachable,
                detail = probe.Detail,
                elapsedMs = probe.ElapsedMilliseconds,
            });
        });

        /*
         * Los modelos que ese proveedor tiene desplegados.
         *
         * Acepta el perfil escrito y sin guardar, como «probar», porque se usa
         * en el mismo momento: al terminar de pegar la URL y la clave, antes de
         * saber cómo se llama el modelo.
         */
        app.MapPost("/api/ai/providers/models", async (
            SaveAiProviderDto request,
            SavedAiProviderService providers,
            IEnumerable<IAiProvider> known,
            CancellationToken cancellationToken) =>
        {
            var profile = ToDomain(request);
            var key = request.ApiKey;

            if (key is null && request.Id is { } id)
            {
                key = await providers.GetKeyAsync(id, cancellationToken);
            }

            try
            {
                var models = await For(known, profile).ListModelsAsync(
                    new AiRequest(profile, key, []),
                    cancellationToken);

                return Results.Ok(new { models });
            }
            catch (Exception error) when (error is InvalidOperationException or HttpRequestException)
            {
                // No poder enumerarlos no impide configurar el proveedor: el
                // campo admite texto escrito a mano, así que esto es un aviso.
                return Results.Ok(new { models = Array.Empty<string>(), detail = error.Message });
            }
        });

        /*
         * La sesión de un programa de consola: si la hay y de quién.
         *
         * **El inicio de sesión no ocurre aquí.** No existe forma de que Druse
         * autentique una cuenta de Claude o de ChatGPT, y un formulario propio
         * pidiendo esas credenciales tendría la forma de una estafa. Lo que se
         * puede hacer es mirar si ya hay sesión y abrir la ventana del programa.
         */
        app.MapGet("/api/ai/cli/{command}", async (
            string command,
            Guid? profileId,
            ICliSession sessions,
            CancellationToken cancellationToken) =>
        {
            if (!Known(command))
            {
                return Results.NotFound(new { message = "Ese programa no lo conoce Druse." });
            }

            var state = await sessions.InspectAsync(command, profileId, cancellationToken);

            return Results.Ok(new
            {
                installed = state.Installed,
                loggedIn = state.LoggedIn,
                account = state.Account,
                plan = state.Plan,
                detail = state.Detail,
            });
        });

        app.MapPost("/api/ai/cli/{command}/login", async (
            string command,
            Guid? profileId,
            ICliSession sessions,
            CancellationToken cancellationToken) =>
        {
            if (!Known(command))
            {
                return Results.NotFound(new { message = "Ese programa no lo conoce Druse." });
            }

            return await sessions.StartLoginAsync(command, profileId, cancellationToken)
                ? Results.Ok(new { started = true })
                : Results.Ok(new
                {
                    started = false,
                    message = $"No se encontró «{command}» en este equipo.",
                });
        });

        app.MapPost("/api/ai/chat", async (
            AiChatDto request,
            SavedAiProviderService providers,
            IEnumerable<IAiProvider> known,
            IAppPaths paths,
            HttpContext context,
            CancellationToken cancellationToken) =>
        {
            var profile = await providers.FindAsync(request.ProviderId, cancellationToken);

            if (profile is null)
            {
                return Results.NotFound(new { message = "Ese proveedor ya no existe." });
            }

            var key = await providers.GetKeyAsync(profile.Id, cancellationToken);
            var messages = Compose(profile, request);

            context.Response.Headers.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-cache";

            await StreamAsync(
                For(known, profile),
                new AiRequest(profile, key, messages, SessionDirectoryFor(profile, paths)),
                context,
                cancellationToken);

            return Results.Empty;
        });
    }

    /// <summary>
    /// Dónde busca sus credenciales el programa de este perfil.
    ///
    /// `null` cuando comparte la sesión del equipo, que es lo normal: quien ya
    /// tiene sesión iniciada no debería volver a entrar para usar el asistente.
    /// </summary>
    private static string? SessionDirectoryFor(AiProviderProfile profile, IAppPaths paths) =>
        profile.Kind == AiProviderKind.LocalCli && profile.OwnSession
            ? Path.Combine(paths.DataDirectory, "ai-sessions", profile.Id.ToString("N"))
            : null;

    /// <summary>
    /// Los programas que Druse sabe lanzar.
    ///
    /// Lista cerrada y no un nombre libre: esta ruta arranca un proceso, y
    /// aceptar cualquier texto sería dejar que la pantalla eligiera qué se
    /// ejecuta en el equipo.
    /// </summary>
    private static bool Known(string command) =>
        command is "claude" or "codex";

    /// <summary>
    /// Elige quién sabe hablar con este perfil.
    ///
    /// Cada implementación cubre una forma de hablar, y el perfil dice cuál. Si
    /// llega uno de una clase que nadie atiende —porque se guardó con una versión
    /// que la traía y esta no—, se dice en lugar de fallar con una excepción de
    /// inyección que no significa nada para quien pregunta.
    /// </summary>
    private static IAiProvider For(IEnumerable<IAiProvider> known, AiProviderProfile profile) =>
        known.FirstOrDefault(provider => provider.Kind == profile.Kind)
        ?? throw new InvalidOperationException(
            "Esta versión de Druse no sabe hablar con esa clase de proveedor.");

    /// <summary>
    /// Reenvía la respuesta trozo a trozo, y también los fallos.
    ///
    /// El error se manda **dentro del flujo** y no como código HTTP porque para
    /// cuando falla ya se han enviado las cabeceras: cambiar el estado entonces
    /// es imposible, y cortar sin más dejaría la pantalla esperando para siempre.
    /// </summary>
    private static async Task StreamAsync(
        IAiProvider provider,
        AiRequest request,
        HttpContext context,
        CancellationToken cancellationToken)
    {
        try
        {
            await foreach (var chunk in provider.StreamAsync(request, cancellationToken))
            {
                await WriteEventAsync(context, "chunk", new { text = chunk.Text }, cancellationToken);
            }

            await WriteEventAsync(context, "done", new { }, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Lo canceló el usuario. No hay nada que contarle que no sepa ya, y
            // el socket puede estar cerrado.
        }
        catch (Exception error) when (error is InvalidOperationException or HttpRequestException)
        {
            await WriteEventAsync(
                context,
                "error",
                new { message = error.Message },
                CancellationToken.None);
        }
    }

    private static async Task WriteEventAsync(
        HttpContext context,
        string name,
        object payload,
        CancellationToken cancellationToken)
    {
        var texto = $"event: {name}\ndata: {JsonSerializer.Serialize(payload)}\n\n";

        await context.Response.WriteAsync(texto, Encoding.UTF8, cancellationToken);
        await context.Response.Body.FlushAsync(cancellationToken);
    }

    /// <summary>
    /// Arma la conversación que se le manda al modelo.
    ///
    /// Aquí se decide **qué sale de este equipo**, y por eso la decisión vive en
    /// el backend y no en la pantalla: el nivel de divulgación es un dato del
    /// perfil, y un proveedor que no puede ver el esquema no lo ve aunque la
    /// interfaz lo mande.
    /// </summary>
    private static List<AiMessage> Compose(AiProviderProfile profile, AiChatDto request)
    {
        var messages = new List<AiMessage>
        {
            new(AiRole.System, SystemPrompt),
        };

        if (profile.Disclosure != AiDisclosure.NothingButThePrompt
            && !string.IsNullOrWhiteSpace(request.Context))
        {
            messages.Add(new AiMessage(
                AiRole.System,
                $"Estructura de las tablas en juego:\n\n{request.Context}"));
        }

        foreach (var message in request.Messages)
        {
            messages.Add(new AiMessage(ParseRole(message.Role), message.Text));
        }

        return messages;
    }

    /// <summary>
    /// Lo que el asistente sabe de sí mismo.
    ///
    /// Las dos últimas frases no son cortesía: el modelo no ejecuta nada, y decir
    /// que inventa una columna es más útil que inventarla.
    /// </summary>
    private const string SystemPrompt =
        "Eres el asistente de Druse, un cliente de bases de datos. Ayudas a escribir, " +
        "entender y corregir SQL. Responde en español, breve y al grano. " +
        "Cuando propongas SQL, ponlo en un bloque ```sql. " +
        "No puedes ejecutar nada: lo que escribas lo revisa una persona antes de correrlo. " +
        "Si te falta una tabla o una columna para responder, dilo en lugar de suponerla.";

    private static AiRole ParseRole(string role) => role switch
    {
        "assistant" => AiRole.Assistant,
        "system" => AiRole.System,
        _ => AiRole.User,
    };

    private static AiProviderDto ToDto(AiProviderProfile profile, bool hasKey) => new(
        profile.Id,
        profile.Name,
        profile.Kind switch
        {
            AiProviderKind.Anthropic => "anthropic",
            AiProviderKind.LocalCli => "localcli",
            _ => "openaicompatible",
        },
        profile.BaseUrl,
        profile.Model,
        profile.Command,
        profile.Disclosure switch
        {
            AiDisclosure.NothingButThePrompt => "nothing",
            AiDisclosure.SchemaAndRows => "schemaAndRows",
            _ => "schema",
        },
        profile.OwnSession,
        profile.IsDefault,
        hasKey);

    private static AiProviderProfile ToDomain(SaveAiProviderDto request) => new()
    {
        Id = request.Id ?? Guid.NewGuid(),
        Name = request.Name?.Trim() ?? string.Empty,
        Kind = request.Kind switch
        {
            "anthropic" => AiProviderKind.Anthropic,
            "localcli" => AiProviderKind.LocalCli,
            _ => AiProviderKind.OpenAiCompatible,
        },
        BaseUrl = request.BaseUrl?.Trim() ?? string.Empty,
        Model = request.Model?.Trim() ?? string.Empty,
        Command = request.Command?.Trim() ?? string.Empty,
        Disclosure = request.Disclosure switch
        {
            "nothing" => AiDisclosure.NothingButThePrompt,
            "schemaAndRows" => AiDisclosure.SchemaAndRows,
            _ => AiDisclosure.Schema,
        },
        OwnSession = request.OwnSession,
        IsDefault = request.IsDefault,
    };
}
