namespace Druse.Domain;

/// <summary>
/// Por dónde se llega al modelo.
///
/// Son tres formas de hablar, no tres marcas: bajo <see cref="OpenAiCompatible"/>
/// caben el MaaS de una empresa, Ollama en el propio equipo, Azure, OpenRouter y
/// la propia OpenAI, porque todos atienden el mismo formato de petición. Lo que
/// distingue a los otros dos es el mecanismo, no el proveedor.
/// </summary>
public enum AiProviderKind
{
    /// <summary>
    /// `POST {BaseUrl}/chat/completions` con clave en `Authorization: Bearer`.
    ///
    /// Es la forma que más cubre, y por eso la primera que se implementó.
    /// </summary>
    OpenAiCompatible = 0,

    /// <summary>Formato propio de Anthropic, con la clave en `x-api-key`.</summary>
    Anthropic = 1,

    /// <summary>
    /// Un programa de línea de órdenes ya instalado y con sesión iniciada.
    ///
    /// Es lo que permite usar una suscripción personal —Claude Pro por `claude`,
    /// ChatGPT Plus por `codex`— sin pedirle credenciales a nadie: quien responde
    /// es el binario del equipo, que ya sabe quién es su dueño. A cambio, solo
    /// funciona donde ese binario exista.
    /// </summary>
    LocalCli = 2,

    /// <summary>Formato nativo de Google Gemini, con la clave en `x-goog-api-key`.</summary>
    Gemini = 3,
}

/// <summary>
/// Cuánto del trabajo del usuario puede acompañar a la pregunta.
///
/// No es una preferencia de comodidad: decide qué sale de este equipo. Un modelo
/// local puede recibirlo todo porque no va a ninguna parte; uno de fuera recibe
/// lo que su dueño haya autorizado, y por omisión eso son nombres, no datos.
/// </summary>
public enum AiDisclosure
{
    /// <summary>Solo lo que el usuario escriba. Ni esquema ni filas.</summary>
    NothingButThePrompt = 0,

    /// <summary>
    /// Nombres de tablas, columnas y tipos. **Ninguna fila.**
    ///
    /// Es el punto por omisión porque es lo que hace útil al asistente sin
    /// mandar fuera datos de nadie.
    /// </summary>
    Schema = 1,

    /// <summary>Estructura y además filas de resultados. Se elige a conciencia.</summary>
    SchemaAndRows = 2,
}

/// <summary>
/// Cómo se llega a un modelo, sin la clave.
///
/// La clave nunca forma parte de esta entidad, por la misma razón que la
/// contraseña no forma parte de <see cref="ConnectionProfile"/>: vive en el
/// almacén del sistema y se recupera por <see cref="Id"/> en el momento de
/// preguntar (plan §12).
/// </summary>
public sealed record AiProviderProfile
{
    public required Guid Id { get; init; }

    /// <summary>Nombre que ve el usuario. No puede estar vacío.</summary>
    public required string Name { get; init; }

    public required AiProviderKind Kind { get; init; }

    /// <summary>
    /// Raíz de la API, terminada donde empieza `/chat/completions`.
    ///
    /// Vacía en <see cref="AiProviderKind.LocalCli"/>, que no habla por red.
    /// </summary>
    public string BaseUrl { get; init; } = string.Empty;

    /// <summary>
    /// Identificador del modelo tal y como lo nombra el proveedor.
    ///
    /// Se guarda como texto libre y no como enumeración a propósito: cada
    /// proveedor tiene los suyos y aparecen más rápido de lo que se publica una
    /// versión de Druse.
    /// </summary>
    public required string Model { get; init; }

    /// <summary>
    /// Programa a ejecutar cuando <see cref="Kind"/> es <see cref="AiProviderKind.LocalCli"/>.
    ///
    /// Es el nombre del ejecutable —`claude`, `codex`—, no una orden completa:
    /// los argumentos los pone Druse, porque de ellos depende que el asistente no
    /// pueda tocar el disco.
    /// </summary>
    public string Command { get; init; } = string.Empty;

    /// <summary>
    /// Este perfil inicia sesión por su cuenta, aparte de la del equipo.
    ///
    /// Sin esto solo se puede usar **una** cuenta: el programa guarda una sola
    /// sesión por usuario del sistema, y cambiarla obligaría a cerrar la que
    /// usa quien programa con esa misma herramienta. Con esto, cada perfil
    /// puede llevar su propia cuenta —la personal y la del trabajo a la vez— y
    /// ninguna se pisa con la otra.
    ///
    /// Va apagado por omisión: quien ya tiene sesión iniciada en su equipo no
    /// tiene por qué volver a entrar para usar el asistente.
    /// </summary>
    public bool OwnSession { get; init; }

    public AiDisclosure Disclosure { get; init; } = AiDisclosure.Schema;

    /// <summary>El que se usa mientras el usuario no elija otro.</summary>
    public bool IsDefault { get; init; }
}
