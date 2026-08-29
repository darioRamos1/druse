using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

public sealed class LocalCliProviderTests
{
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
            var profile = new AiProviderProfile
            {
                Id = Guid.NewGuid(),
                Name = "ChatGPT",
                Kind = AiProviderKind.LocalCli,
                Command = "codex",
                Model = string.Empty,
            };
            var provider = new LocalCliProvider();

            var models = await provider.ListModelsAsync(
                new AiRequest(profile, null, [], home),
                CancellationToken.None);

            Assert.Equal(["gpt-primero", "gpt-segundo"], models);
        }
        finally
        {
            Directory.Delete(home, recursive: true);
        }
    }
}
