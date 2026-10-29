using Druse.Domain;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

public sealed class AiBusinessNoteStoreTests
{
    [Fact]
    public async Task LasNotasSobrevivenAlReinicioYLaMigracionSinPerderAmbitoNiFecha()
    {
        using var paths = new TemporaryPaths();
        var database = new DruseDatabase(paths);
        await database.MigrateAsync(CancellationToken.None);
        var store = new SqliteAiBusinessNoteStore(database);
        var note = new AiBusinessNote(Guid.NewGuid(), Guid.NewGuid(), "ventas", "Sin IVA", true,
            new AiNoteReference("t1", "public", "facturas", "table", "importe"), DateTimeOffset.UtcNow);
        await store.SaveAsync(note, CancellationToken.None);
        await store.SaveAsync(note with { Id = Guid.NewGuid(), Reference = null, Enabled = false }, CancellationToken.None);
        var reopened = new DruseDatabase(paths);
        await reopened.MigrateAsync(CancellationToken.None);
        var recovered = new SqliteAiBusinessNoteStore(reopened);
        var notes = await recovered.GetAllAsync(CancellationToken.None);
        Assert.Equal(2, notes.Count);
        Assert.Contains(note, notes);
        await recovered.SaveAsync(note with { Text = "Con IVA" }, CancellationToken.None);
        Assert.Equal(2, (await recovered.GetAllAsync(CancellationToken.None)).Count);
        Assert.True(await recovered.DeleteAsync(note.Id, CancellationToken.None));
        Assert.Single(await recovered.GetAllAsync(CancellationToken.None));
    }

    [Fact]
    public async Task LaMigracionDeProveedoresExistentesNoAutorizaCompartirNotas()
    {
        using var paths = new TemporaryPaths();
        var database = new DruseDatabase(paths);
        await database.MigrateAsync(CancellationToken.None);
        var store = new SqliteAiProviderStore(database);
        var profile = new AiProviderProfile { Id = Guid.NewGuid(), Name = "Prueba", Model = "modelo", Kind = AiProviderKind.OpenAiCompatible };
        await store.SaveAsync(profile, CancellationToken.None);
        await using (var connection = await database.OpenAsync(CancellationToken.None))
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "ALTER TABLE ai_providers DROP COLUMN share_business_notes; PRAGMA user_version = 9;";
            await command.ExecuteNonQueryAsync();
        }
        await database.MigrateAsync(CancellationToken.None);
        Assert.False((await store.FindAsync(profile.Id, CancellationToken.None))!.ShareBusinessNotes);
        await store.SaveAsync(profile with { ShareBusinessNotes = true }, CancellationToken.None);
        Assert.True((await new SqliteAiProviderStore(new DruseDatabase(paths)).FindAsync(profile.Id, CancellationToken.None))!.ShareBusinessNotes);
    }
}
