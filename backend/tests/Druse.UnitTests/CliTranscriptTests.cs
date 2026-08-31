using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

/// <summary>
/// Lo que Druse entiende de lo que escriben `claude` y `codex`.
///
/// Las líneas de estas pruebas son las que **escriben los programas de verdad**,
/// copiadas de su salida: `codex-cli 0.150.1` con `exec --json` y `claude` con
/// `--output-format stream-json`. Inventarlas no serviría de nada, porque lo que
/// se comprueba es precisamente que se entiende su formato.
/// </summary>
public sealed class CliTranscriptTests
{
    [Fact]
    public void CodexEntregaElMensajeDelAsistente()
    {
        var transcript = new CliTranscript("codex");

        Assert.Equal(
            (string.Empty, null),
            transcript.Read("""{"type":"thread.started","thread_id":"01a058ba"}"""));

        var (text, error) = transcript.Read(
            """{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hola mundo"}}""");

        Assert.Equal("hola mundo", text);
        Assert.Null(error);
    }

    /// <summary>
    /// Un mensaje que llega a medias y luego entero se escribe una sola vez.
    ///
    /// Hoy Codex solo manda el `item.completed`, pero su programa conoce el
    /// evento parcial: el día que lo emita, sumar los dos sin más pintaría la
    /// respuesta duplicada en la pantalla.
    /// </summary>
    [Fact]
    public void UnMensajeQueLlegaDosVecesNoSeEscribeDosVeces()
    {
        var transcript = new CliTranscript("codex");

        var (parcial, _) = transcript.Read(
            """{"type":"item.updated","item":{"id":"item_0","type":"agent_message","text":"hola"}}""");
        var (resto, _) = transcript.Read(
            """{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hola mundo"}}""");

        Assert.Equal("hola", parcial);
        Assert.Equal(" mundo", resto);
    }

    /// <summary>Dos mensajes distintos no se recortan el uno al otro.</summary>
    [Fact]
    public void CadaMensajeLlevaSuPropiaCuenta()
    {
        var transcript = new CliTranscript("codex");

        transcript.Read(
            """{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"primero"}}""");

        var (text, _) = transcript.Read(
            """{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"segundo"}}""");

        Assert.Equal("segundo", text);
    }

    /// <summary>
    /// El fallo de Codex viene anidado, y es el que hay que enseñar.
    ///
    /// Esta línea es la que devuelve el programa al pedirle su modelo
    /// predeterminado con una cuenta de ChatGPT.
    /// </summary>
    [Fact]
    public void CodexDiceQuePasoCuandoElTurnoFalla()
    {
        var transcript = new CliTranscript("codex");

        var (text, error) = transcript.Read(
            """{"type":"turn.failed","error":{"message":"The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."}}""");

        Assert.Empty(text);
        Assert.Contains("not supported", error);
    }

    [Fact]
    public void ClaudeEntregaLosTrozosSegunLlegan()
    {
        var transcript = new CliTranscript("claude");

        var (hola, _) = transcript.Read(
            """{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"hola"}}}""");
        var (mundo, _) = transcript.Read(
            """{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":" mundo"}}}""");

        Assert.Equal("hola", hola);
        Assert.Equal(" mundo", mundo);
    }

    /// <summary>
    /// Los trozos de Claude se concatenan tal cual, sin recortarse entre ellos.
    ///
    /// Cada uno es texto nuevo, no el mensaje acumulado: si la cuenta que lleva
    /// Codex se aplicara también aquí, una respuesta que repite una palabra
    /// perdería la segunda.
    /// </summary>
    [Fact]
    public void ClaudeRepiteLoQueElModeloRepite()
    {
        var transcript = new CliTranscript("claude");

        transcript.Read(
            """{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"sí"}}}""");

        var (otra, _) = transcript.Read(
            """{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"sí"}}}""");

        Assert.Equal("sí", otra);
    }

    [Fact]
    public void ClaudeDiceQuePasoCuandoTerminaMal()
    {
        var transcript = new CliTranscript("claude");

        var (text, error) = transcript.Read(
            """{"type":"result","is_error":true,"result":"Credit balance is too low"}""");

        Assert.Empty(text);
        Assert.Equal("Credit balance is too low", error);
    }

    /// <summary>Una línea rota no puede llevarse por delante lo ya escrito.</summary>
    [Fact]
    public void UnaLineaQueNoSeEntiendeSeIgnora()
    {
        var transcript = new CliTranscript("codex");

        Assert.Equal((string.Empty, null), transcript.Read("{ esto no es json"));
        Assert.Equal((string.Empty, null), transcript.Read("Warning: could not create symlink"));
        Assert.Equal((string.Empty, null), transcript.Read(string.Empty));
    }
}
