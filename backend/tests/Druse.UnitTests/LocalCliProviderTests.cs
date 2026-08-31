using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

public sealed class LocalCliProviderTests
{
    /// <summary>
    /// Una sesión de mentira, para no depender de que haya un `codex` instalado.
    ///
    /// Lo que se prueba aquí es qué contesta Druse ante cada estado posible del
    /// programa, y esos estados no se pueden provocar en la máquina que corre
    /// las pruebas: la del equipo de integración no tiene sesión, y la de quien
    /// programa sí.
    /// </summary>
    private sealed class FakeSession(CliSessionState state) : ICliSession
    {
        public Task<CliSessionState> InspectAsync(
            string command,
            string? sessionDirectory,
            CancellationToken cancellationToken) => Task.FromResult(state);

        public Task<CliLaunch> StartLoginAsync(
            string command,
            string? sessionDirectory,
            CancellationToken cancellationToken) =>
            Task.FromResult(new CliLaunch(false, string.Empty));
    }

    private static AiProviderProfile Codex(string model = "") => new()
    {
        Id = Guid.NewGuid(),
        Name = "ChatGPT",
        Kind = AiProviderKind.LocalCli,
        Command = "codex",
        Model = model,
    };

    /// <summary>Deja un catálogo como el que Codex guarda para su cuenta.</summary>
    private static async Task<string> CatalogAsync(params string[] slugs)
    {
        var home = Path.Combine(Path.GetTempPath(), $"druse-codex-{Guid.NewGuid():N}");

        Directory.CreateDirectory(home);

        await File.WriteAllTextAsync(
            Path.Combine(home, "models_cache.json"),
            JsonSerializer.Serialize(new
            {
                models = slugs
                    .Select((slug, index) => new { slug, visibility = "list", priority = index })
                    .ToArray(),
            }));

        return home;
    }

    [Fact]
    public async Task CodexEnumeraLosModelosVisiblesDeLaCuentaPorPrioridad()
    {
        var home = Path.Combine(Path.GetTempPath(), $"druse-codex-{Guid.NewGuid():N}");
        Directory.CreateDirectory(home);

        try
        {
            await File.WriteAllTextAsync(
                Path.Combine(home, "models_cache.json"),
                JsonSerializer.Serialize(new
                {
                    models = new object[]
                    {
                        new { slug = "oculto", visibility = "hide", priority = 0 },
                        new { slug = "gpt-segundo", visibility = "list", priority = 2 },
                        new { slug = "gpt-primero", visibility = "list", priority = 1 },
                    },
                }));
            var provider = new LocalCliProvider(new FakeSession(default));

            var models = await provider.ListModelsAsync(
                new AiRequest(Codex(), null, [], home),
                CancellationToken.None);

            Assert.Equal(["gpt-primero", "gpt-segundo"], models);
        }
        finally
        {
            Directory.Delete(home, recursive: true);
        }
    }

    /// <summary>
    /// Probar un programa instalado pero sin sesión tiene que decir que no.
    ///
    /// Antes decía que sí —solo miraba que el binario existiera—, y el usuario
    /// se enteraba al mandar su primera pregunta.
    /// </summary>
    [Fact]
    public async Task ProbarAvisaCuandoElProgramaEstaPeroNoHaySesion()
    {
        var sessions = new FakeSession(
            new CliSessionState(true, false, null, null, "Está instalado, pero sin sesión."));
        var provider = new LocalCliProvider(sessions);

        var probe = await provider.ProbeAsync(
            new AiRequest(Codex(), null, []),
            CancellationToken.None);

        Assert.False(probe.Reachable);
        Assert.Contains("sin sesión", probe.Detail, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProbarAvisaCuandoElProgramaNoEstaInstalado()
    {
        var sessions = new FakeSession(
            new CliSessionState(false, false, null, null, "No se encontró «codex»."));
        var provider = new LocalCliProvider(sessions);

        var probe = await provider.ProbeAsync(
            new AiRequest(Codex(), null, []),
            CancellationToken.None);

        Assert.False(probe.Reachable);
    }

    /// <summary>
    /// Con sesión y sin modelo elegido, se dice cuál va a usarse.
    ///
    /// El predeterminado de Codex no vale con una cuenta de ChatGPT, así que el
    /// nombre concreto es justo lo que hay que enseñar antes de preguntar.
    /// </summary>
    [Fact]
    public async Task ProbarDiceConQueModeloVaAHablarCuandoElCampoEstaVacio()
    {
        var home = await CatalogAsync("gpt-elegido", "gpt-otro");

        try
        {
            var sessions = new FakeSession(
                new CliSessionState(true, true, null, "ChatGPT", "Sesión iniciada."));
            var provider = new LocalCliProvider(sessions);

            var probe = await provider.ProbeAsync(
                new AiRequest(Codex(), null, [], home),
                CancellationToken.None);

            Assert.True(probe.Reachable);
            Assert.Contains("gpt-elegido", probe.Detail, StringComparison.Ordinal);
        }
        finally
        {
            Directory.Delete(home, recursive: true);
        }
    }

    /// <summary>Sin catálogo se avisa, en lugar de prometer que funcionará.</summary>
    [Fact]
    public async Task ProbarAvisaCuandoCodexNoTieneCatalogoQueLeer()
    {
        var home = Path.Combine(Path.GetTempPath(), $"druse-codex-{Guid.NewGuid():N}");
        var sessions = new FakeSession(
            new CliSessionState(true, true, null, "ChatGPT", "Sesión iniciada."));
        var provider = new LocalCliProvider(sessions);

        var probe = await provider.ProbeAsync(
            new AiRequest(Codex(), null, [], home),
            CancellationToken.None);

        Assert.True(probe.Reachable);
        Assert.Contains("ChatGPT", probe.Detail, StringComparison.Ordinal);
    }

    /// <summary>
    /// Una sesión que no se pudo averiguar no bloquea el intento.
    ///
    /// Decir que no la hay mandaría a repetir un inicio de sesión que quizá esté
    /// hecho, que es justo lo que el resto del código evita.
    /// </summary>
    [Fact]
    public async Task ProbarDejaPasarCuandoNoSePudoAveriguarLaSesion()
    {
        var sessions = new FakeSession(
            new CliSessionState(true, null, null, null, "No dijo su estado."));
        var provider = new LocalCliProvider(sessions);

        var probe = await provider.ProbeAsync(
            new AiRequest(Codex("gpt-fijo"), null, []),
            CancellationToken.None);

        Assert.True(probe.Reachable);
        Assert.Contains("gpt-fijo", probe.Detail, StringComparison.Ordinal);
    }
}
