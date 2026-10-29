using System.Net;
using System.Net.Http.Json;
using Druse.Application.Abstractions;
using Druse.Domain;
using Microsoft.Extensions.DependencyInjection;

namespace Druse.IntegrationTests;

public sealed class AiBusinessNoteTests
{
    [Fact]
    public async Task BorrarUnaConexionConservaLasNotasYPermiteVincularlasExpresamente()
    {
        using var host = new DruseApiFactory();
        using var client = host.CreateAuthenticatedClient();
        using var scope = host.Services.CreateScope();
        var profiles = scope.ServiceProvider.GetRequiredService<IConnectionProfileStore>();
        var first = new ConnectionProfile { Id = Guid.NewGuid(), Name = "Origen", Engine = DatabaseEngine.Sqlite,
            Host = "", Port = 0, Database = "ventas.db", Username = "" };
        var second = first with { Id = Guid.NewGuid(), Name = "Destino" };
        await profiles.SaveAsync(first, CancellationToken.None);
        await profiles.SaveAsync(second, CancellationToken.None);
        var note = new AiBusinessNote(Guid.NewGuid(), first.Id, "main", "  Regla de negocio  ", true,
            new AiNoteReference("t1", "main", "facturas", "table", "importe"), DateTimeOffset.MinValue);
        using var saved = await client.PutAsJsonAsync($"/api/ai/notes/{note.Id}", note);
        saved.EnsureSuccessStatusCode();
        var stored = (await saved.Content.ReadFromJsonAsync<AiBusinessNote>())!;
        Assert.Equal("Regla de negocio", stored.Text);
        Assert.True(stored.UpdatedAtUtc > DateTimeOffset.MinValue);
        using var deleted = await client.DeleteAsync($"/api/connections/{first.Id}");
        deleted.EnsureSuccessStatusCode();
        Assert.Equal(stored, Assert.Single((await client.GetFromJsonAsync<AiBusinessNote[]>("/api/ai/notes"))!));
        using var edited = await client.PutAsJsonAsync($"/api/ai/notes/{note.Id}", stored with { Enabled = false });
        edited.EnsureSuccessStatusCode();
        using var invalidScope = await client.PutAsJsonAsync($"/api/ai/notes/{note.Id}", stored with { Reference = null });
        Assert.Equal(HttpStatusCode.BadRequest, invalidScope.StatusCode);
        using var rebound = await client.PutAsJsonAsync($"/api/ai/notes/{note.Id}", stored with { ConnectionId = second.Id, Reference = null });
        rebound.EnsureSuccessStatusCode();
        Assert.Equal(second.Id, (await rebound.Content.ReadFromJsonAsync<AiBusinessNote>())!.ConnectionId);
        using var removed = await client.DeleteAsync($"/api/ai/notes/{note.Id}");
        removed.EnsureSuccessStatusCode();
        Assert.Empty((await client.GetFromJsonAsync<AiBusinessNote[]>("/api/ai/notes"))!);
    }

    [Fact]
    public async Task RechazaNotasSinConexionGuardadaYNoSobrescribeFormatosFuturos()
    {
        using var host = new DruseApiFactory();
        using var client = host.CreateAuthenticatedClient();
        using var scope = host.Services.CreateScope();
        var note = new AiBusinessNote(Guid.NewGuid(), Guid.NewGuid(), "main", "Regla", true, null, DateTimeOffset.UtcNow);
        using var missing = await client.PutAsJsonAsync($"/api/ai/notes/{note.Id}", note);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        await scope.ServiceProvider.GetRequiredService<IAiBusinessNoteStore>().SaveAsync(note with { FormatVersion = 2 }, CancellationToken.None);
        using var future = await client.PutAsJsonAsync($"/api/ai/notes/{note.Id}", note);
        Assert.Equal(HttpStatusCode.Conflict, future.StatusCode);
        var recovered = Assert.Single((await client.GetFromJsonAsync<AiBusinessNote[]>("/api/ai/notes"))!);
        Assert.Equal(2, recovered.FormatVersion);
        Assert.Equal(note.Text, recovered.Text);
    }
}
