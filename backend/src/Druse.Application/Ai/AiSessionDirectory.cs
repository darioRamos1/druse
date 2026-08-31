using Druse.Domain;
using Druse.Platform.Abstractions;

namespace Druse.Application.Ai;

/// <summary>
/// Dónde guarda sus credenciales un perfil que usa cuenta propia.
///
/// Vive en un solo sitio a propósito. La ruta la necesitaban tres —el endpoint
/// que pregunta por la sesión, el que abre el inicio de sesión y el proveedor
/// que habla con el programa—, y cada uno la componía por su cuenta: bastaba con
/// que uno la calculara distinto para que «probar» mirase una sesión y el chat
/// otra, sin que nada fallara de forma visible.
/// </summary>
public static class AiSessionDirectory
{
    /// <summary>Carpeta bajo los datos de Druse, o `null` si comparte la del equipo.</summary>
    public static string? Of(Guid? profileId, IAppPaths paths) =>
        profileId is { } id
            ? Path.Combine(paths.DataDirectory, "ai-sessions", id.ToString("N"))
            : null;

    /// <summary>
    /// La que le toca a este perfil.
    ///
    /// `null` —lo normal— es la sesión que ya tiene el equipo: quien inició
    /// sesión para programar con la misma herramienta no debería volver a
    /// entrar para usar el asistente.
    /// </summary>
    public static string? For(AiProviderProfile profile, IAppPaths paths) =>
        profile.Kind == AiProviderKind.LocalCli && profile.OwnSession
            ? Of(profile.Id, paths)
            : null;
}
