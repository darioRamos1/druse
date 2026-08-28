using Druse.Domain;

namespace Druse.Application.Ai;

/// <summary>Quién habla en un turno de la conversación.</summary>
public enum AiRole
{
    System = 0,
    User = 1,
    Assistant = 2,
}

/// <param name="Role">Quién lo dijo.</param>
/// <param name="Text">Lo que dijo, ya en texto plano.</param>
public readonly record struct AiMessage(AiRole Role, string Text);

/// <summary>
/// Lo que se le manda al modelo en una vuelta.
/// </summary>
/// <param name="Profile">A quién se le pregunta.</param>
/// <param name="ApiKey">Su clave, recién sacada del almacén. `null` en los que no la usan.</param>
/// <param name="Messages">La conversación entera, en orden.</param>
/// <param name="SessionDirectory">
/// Dónde guarda sus credenciales el programa de consola, cuando este perfil usa
/// una cuenta propia. `null` significa la sesión que comparte el equipo.
/// </param>
public readonly record struct AiRequest(
    AiProviderProfile Profile,
    string? ApiKey,
    IReadOnlyList<AiMessage> Messages,
    string? SessionDirectory = null);

/// <summary>
/// Un trozo de respuesta según llega.
/// </summary>
/// <param name="Text">Lo nuevo, no lo acumulado: quien lo recibe concatena.</param>
public readonly record struct AiChunk(string Text);

/// <summary>Lo que se sabe de un proveedor después de hablarle una vez.</summary>
/// <param name="Reachable">Contestó.</param>
/// <param name="Detail">Qué contestó, o por qué no se le pudo preguntar.</param>
/// <param name="ElapsedMilliseconds">Cuánto tardó en contestar.</param>
public readonly record struct AiProbe(bool Reachable, string Detail, long ElapsedMilliseconds);

/// <summary>
/// Habla con un modelo.
///
/// **Siempre en streaming**, incluso cuando la respuesta es corta: una consulta
/// que tarda veinte segundos en llegar entera parece colgada, y la misma
/// respuesta apareciendo palabra a palabra no.
///
/// Cada implementación cubre una **forma de hablar**, no una marca. La que
/// atiende el formato de OpenAI sirve a la vez para el MaaS de una empresa, para
/// Ollama y para media docena más, y por eso es la que más trabajo ahorra.
/// </summary>
public interface IAiProvider
{
    /// <summary>Qué clase de proveedor atiende esta implementación.</summary>
    AiProviderKind Kind { get; }

    /// <summary>Pregunta y devuelve la respuesta por trozos.</summary>
    IAsyncEnumerable<AiChunk> StreamAsync(AiRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Los modelos que este proveedor dice tener.
    ///
    /// Existe para no obligar a nadie a saberse de memoria el identificador
    /// exacto: `glm-5.2`, `deepseek-v4-pro`, `qwen2.5-coder:7b`. Escribirlo mal
    /// no se nota al guardar —el perfil se guarda igual— sino en la primera
    /// pregunta, con un 404 del proveedor.
    ///
    /// Devuelve la lista vacía cuando el proveedor no sabe enumerarlos, que no
    /// es un fallo: el campo sigue admitiendo texto escrito a mano.
    /// </summary>
    Task<IReadOnlyList<string>> ListModelsAsync(AiRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Comprueba que se puede llegar, sin gastar una respuesta entera.
    ///
    /// Existe por lo mismo que «Probar conexión» en el diálogo de conexión:
    /// descubrir que la clave está mal cuando ya se ha escrito la pregunta es
    /// descubrirlo tarde.
    /// </summary>
    Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken);
}
