using System.Text.Json;
using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Platform.Abstractions;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Las identidades de empresa, en <c>reports.db</c> como el resto de Reportes BI.
///
/// El logo vive en la misma fila pero se lee aparte: la lista se pide a menudo
/// y no tiene por qué cargar medio MiB por identidad.
/// </summary>
public sealed class SqliteReportIdentityStore(IAppPaths paths, TimeProvider clock) : IReportIdentityStore
{
    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<IReadOnlyList<ReportIdentity>> GetAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, subtitle, details, footer, brand_color, logo_on_white,
                   logo_utc_ticks, created_utc_ticks, updated_utc_ticks
            FROM report_identities
            ORDER BY name COLLATE NOCASE, id;
            """;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var identities = new List<ReportIdentity>();
        while (await reader.ReadAsync(cancellationToken))
        {
            identities.Add(new ReportIdentity
            {
                Id = Guid.Parse(reader.GetString(0)),
                Name = reader.GetString(1),
                Subtitle = reader.IsDBNull(2) ? null : reader.GetString(2),
                Details = ReadDetails(reader.GetString(3)),
                Footer = reader.IsDBNull(4) ? null : reader.GetString(4),
                BrandColor = reader.IsDBNull(5) ? null : reader.GetString(5),
                LogoOnWhite = reader.GetInt64(6) != 0,
                LogoUpdatedAtUtc = reader.IsDBNull(7) ? null : new DateTimeOffset(reader.GetInt64(7), TimeSpan.Zero),
                CreatedAtUtc = new DateTimeOffset(reader.GetInt64(8), TimeSpan.Zero),
                UpdatedAtUtc = new DateTimeOffset(reader.GetInt64(9), TimeSpan.Zero),
            });
        }

        return identities;
    }

    public async Task<ReportIdentity> SaveAsync(ReportIdentity identity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(identity);
        var now = clock.GetUtcNow();
        var clean = identity with
        {
            Name = identity.Name.Trim(),
            Subtitle = Optional(identity.Subtitle),
            Footer = Optional(identity.Footer),
            BrandColor = string.IsNullOrEmpty(identity.BrandColor) ? null : identity.BrandColor.ToUpperInvariant(),
            // Las líneas vacías no son datos: un hueco en medio solo deja un renglón en blanco.
            Details = identity.Details.Select(line => line.Trim()).Where(line => line.Length > 0).ToArray(),
        };

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO report_identities (
                id, name, subtitle, details, footer, brand_color, logo_on_white,
                created_utc_ticks, updated_utc_ticks)
            VALUES ($id, $name, $subtitle, $details, $footer, $color, $white, $now, $now)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                subtitle = excluded.subtitle,
                details = excluded.details,
                footer = excluded.footer,
                brand_color = excluded.brand_color,
                logo_on_white = excluded.logo_on_white,
                updated_utc_ticks = excluded.updated_utc_ticks
            RETURNING created_utc_ticks, logo_utc_ticks;
            """;
        command.Parameters.AddWithValue("$id", clean.Id.ToString());
        command.Parameters.AddWithValue("$name", clean.Name);
        command.Parameters.AddWithValue("$subtitle", (object?)clean.Subtitle ?? DBNull.Value);
        command.Parameters.AddWithValue("$details", JsonSerializer.Serialize(clean.Details));
        command.Parameters.AddWithValue("$footer", (object?)clean.Footer ?? DBNull.Value);
        command.Parameters.AddWithValue("$color", (object?)clean.BrandColor ?? DBNull.Value);
        command.Parameters.AddWithValue("$white", clean.LogoOnWhite ? 1 : 0);
        command.Parameters.AddWithValue("$now", now.UtcTicks);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);

        return clean with
        {
            CreatedAtUtc = new DateTimeOffset(reader.GetInt64(0), TimeSpan.Zero),
            UpdatedAtUtc = now,
            LogoUpdatedAtUtc = reader.IsDBNull(1) ? null : new DateTimeOffset(reader.GetInt64(1), TimeSpan.Zero),
        };
    }

    public async Task<bool> SetLogoAsync(Guid id, ReportIdentityLogo? logo, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return false;
        }

        var now = clock.GetUtcNow();
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE report_identities
            SET logo = $logo, logo_type = $type, logo_utc_ticks = $ticks, updated_utc_ticks = $now
            WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$id", id.ToString());
        command.Parameters.AddWithValue("$logo", (object?)logo?.Data ?? DBNull.Value);
        command.Parameters.AddWithValue("$type", (object?)logo?.ContentType ?? DBNull.Value);
        command.Parameters.AddWithValue("$ticks", logo is null ? DBNull.Value : now.UtcTicks);
        command.Parameters.AddWithValue("$now", now.UtcTicks);

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    public async Task<ReportIdentityLogo?> GetLogoAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return null;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT logo_type, logo FROM report_identities WHERE id = $id AND logo IS NOT NULL;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        return await reader.ReadAsync(cancellationToken)
            ? new ReportIdentityLogo(reader.GetString(0), (byte[])reader.GetValue(1))
            : null;
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM report_identities WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string? Optional(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    /// <summary>Unos datos ilegibles no tumban la lista: la identidad sale sin ellos.</summary>
    private static string[] ReadDetails(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<string[]>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
