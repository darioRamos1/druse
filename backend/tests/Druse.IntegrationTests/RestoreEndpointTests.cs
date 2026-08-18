using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// El ciclo que cierra la función: se respalda, se restaura en otra base y lo
/// restaurado coincide.
///
/// **Es el criterio de salida de la Fase F**, y entra por HTTP porque es por
/// donde entrará la interfaz: mirar el artefacto y aplicarlo son dos llamadas
/// distintas, y entre ellas está la única oportunidad de ver qué se sobrescribe.
///
/// La segunda mitad de la fase también se prueba aquí: una restauración que falla
/// a mitad **dice en qué instrucción**, y se puede reanudar desde ahí sin repetir
/// lo ya aplicado.
/// </summary>
public sealed class RestoreEndpointTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    private static string Port =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_PG_PORT") ?? "55440";

    private static bool Required =>
        Environment.GetEnvironmentVariable("DRUSE_REQUIRE_ENGINES") == "1";

    private sealed record SessionDto(Guid SessionId);

    /// <summary>Abre una sesión contra la base pedida, o nulo si no hay motor.</summary>
    private static async Task<Guid?> OpenAsync(HttpClient client, string database)
    {
        var request = new
        {
            profile = new
            {
                name = "Restauración",
                engine = "PostgreSql",
                host = "127.0.0.1",
                port = int.Parse(Port, CultureInfo.InvariantCulture),
                database,
                username = "postgres",
                connectTimeoutSeconds = 5,
            },
            password = "druse_dev_only",
        };

        using var response = await client.PostAsJsonAsync("/api/sessions", request);

        if (!response.IsSuccessStatusCode)
        {
            Assert.False(Required, "Se exigían los motores y PostgreSQL no respondió.");

            return null;
        }

        return (await response.Content.ReadFromJsonAsync<SessionDto>())?.SessionId;
    }

    private static async Task<JsonElement> RunSqlAsync(HttpClient client, Guid session, string sql)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/queries",
            new
            {
                sessionId = session,
                sql,
                maxRows = 100,
                timeoutSeconds = 30,
                confirmDestructive = true,
            });

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task CleanAsync(HttpClient client, Guid session, string sql)
    {
        try
        {
            await RunSqlAsync(client, session, sql);
        }
        catch (HttpRequestException)
        {
            // Si la prueba ya falló, su fallo es el que importa.
        }
    }

    /// <summary>Lanza la restauración y espera a que termine.</summary>
    private static async Task<JsonElement> RestoreAsync(HttpClient client, object request)
    {
        using var started = await client.PostAsJsonAsync("/api/restore/run", request);

        started.EnsureSuccessStatusCode();

        var id = (await started.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id")
            .GetGuid();

        for (var attempt = 0; attempt < 200; attempt++)
        {
            using var status = await client.GetAsync($"/api/restore/{id}/status");

            status.EnsureSuccessStatusCode();

            var progress = await status.Content.ReadFromJsonAsync<JsonElement>();

            if (progress.GetProperty("outcome").GetString() != "Running")
            {
                return progress;
            }

            await Task.Delay(50);
        }

        Assert.Fail("La restauración no terminó a tiempo.");

        return default;
    }

    private static async Task<JsonElement> InspectAsync(HttpClient client, Guid session, string path)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/restore/inspect",
            new { sessionId = session, path });

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>Respalda las tablas indicadas a un `.sql` y devuelve su ruta.</summary>
    private static async Task<string> BackupAsync(
        HttpClient client,
        Guid session,
        string root,
        params string[] tables)
    {
        var destination = Path.Combine(root, "respaldo.sql");

        using var started = await client.PostAsJsonAsync(
            "/api/backup/run",
            new
            {
                sessionId = session,
                tables = tables.Select(table => new { id = table, name = table, schema = "public" }),
                dataMode = "StructureAndData",
                layout = "SingleFile",
                dataFormat = "Inserts",
                compress = false,
                destination,
            });

        started.EnsureSuccessStatusCode();

        var id = (await started.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id")
            .GetGuid();

        for (var attempt = 0; attempt < 200; attempt++)
        {
            using var status = await client.GetAsync($"/api/backup/{id}/status");

            var progress = await status.Content.ReadFromJsonAsync<JsonElement>();

            if (progress.GetProperty("outcome").GetString() != "Running")
            {
                Assert.Equal("Completed", progress.GetProperty("outcome").GetString());

                return destination;
            }

            await Task.Delay(50);
        }

        Assert.Fail("El respaldo no terminó a tiempo.");

        return destination;
    }

    /// <summary>
    /// El criterio de salida: respaldar, restaurar en otra base y comprobar que
    /// lo restaurado es lo que había.
    /// </summary>
    [Fact]
    public async Task RespaldaUnaBaseYLaRestauraEnOtra()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var origin = await OpenAsync(client, "druse_test");

        if (origin is null) { return; }

        var target = await OpenAsync(client, "druse_test_secondary");

        Assert.NotNull(target);

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var padre = $"druse_res_pad_{suffix}";
        var hijo = $"druse_res_hij_{suffix}";
        var root = Path.Combine(Path.GetTempPath(), $"druse-restore-{suffix}");

        Directory.CreateDirectory(root);

        try
        {
            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {padre} (id integer PRIMARY KEY, nombre text NOT NULL);
                """);

            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {hijo} (
                    id       integer PRIMARY KEY,
                    padre_id integer REFERENCES {padre} (id),
                    nota     text
                );
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {padre} (id, nombre) VALUES (1, 'Ana'), (2, 'O''Donnell; 12');
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {hijo} (id, padre_id, nota) VALUES (1, 1, 'una'), (2, 2, 'otra');
                """);

            var path = await BackupAsync(client, origin.Value, root, padre, hijo);

            // --- Mirar antes de tocar -----------------------------------------
            var inspection = await InspectAsync(client, target.Value, path);

            Assert.True(inspection.GetProperty("canRestore").GetBoolean());
            Assert.Equal("PostgreSql", inspection.GetProperty("manifest").GetProperty("engine").GetString());
            Assert.True(inspection.GetProperty("statements").GetInt32() > 0);

            var announced = inspection.GetProperty("tables")
                .EnumerateArray()
                .Select(table => table.GetString())
                .ToList();

            Assert.Contains($"public.{padre}", announced);

            // La base destino está limpia: no hay nada que sobrescribir todavía.
            Assert.Empty(inspection.GetProperty("collisions").EnumerateArray());

            // --- Aplicar -------------------------------------------------------
            var result = await RestoreAsync(client, new
            {
                sessionId = target.Value,
                path,
            });

            Assert.Equal("Completed", result.GetProperty("outcome").GetString());
            Assert.True(result.GetProperty("applied").GetInt32() > 0);

            // --- Y lo restaurado es lo que había -------------------------------
            var rows = await RunSqlAsync(client, target.Value, $"""
                SELECT nombre FROM {padre} ORDER BY id;
                """);

            var values = rows.GetProperty("resultSets")[0]
                .GetProperty("rows")
                .EnumerateArray()
                .Select(row => row[0].GetString())
                .ToList();

            // El literal con comilla y punto y coma es el que rompe a quien parta
            // el guion a lo bruto: si llega entero, el lector hizo su trabajo.
            Assert.Equal(["Ana", "O'Donnell; 12"], values);

            var hijos = await RunSqlAsync(client, target.Value, $"SELECT count(*) FROM {hijo};");

            Assert.Equal("2", hijos.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString());

            // --- Y ahora sí avisa de que se sobrescribiría ---------------------
            var second = await InspectAsync(client, target.Value, path);
            var collisions = second.GetProperty("collisions")
                .EnumerateArray()
                .Select(collision => collision.GetProperty("table").GetString())
                .ToList();

            Assert.Contains($"public.{padre}", collisions);
            Assert.Contains($"public.{hijo}", collisions);
        }
        finally
        {
            await CleanAsync(client, origin.Value, $"DROP TABLE IF EXISTS {hijo}");
            await CleanAsync(client, origin.Value, $"DROP TABLE IF EXISTS {padre}");

            if (target is not null)
            {
                await CleanAsync(client, target.Value, $"DROP TABLE IF EXISTS {hijo}");
                await CleanAsync(client, target.Value, $"DROP TABLE IF EXISTS {padre}");
            }

            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    /// <summary>Respalda a una carpeta con los datos en CSV y devuelve su ruta.</summary>
    private static async Task<string> BackupToCsvAsync(
        HttpClient client,
        Guid session,
        string root,
        params string[] tables)
    {
        var destination = Path.Combine(root, "carpeta");

        using var started = await client.PostAsJsonAsync(
            "/api/backup/run",
            new
            {
                sessionId = session,
                tables = tables.Select(table => new { id = table, name = table, schema = "public" }),
                dataMode = "StructureAndData",
                layout = "FolderByKind",
                dataFormat = "Csv",
                compress = false,
                destination,
            });

        started.EnsureSuccessStatusCode();

        var id = (await started.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("id")
            .GetGuid();

        for (var attempt = 0; attempt < 200; attempt++)
        {
            using var status = await client.GetAsync($"/api/backup/{id}/status");

            var progress = await status.Content.ReadFromJsonAsync<JsonElement>();

            if (progress.GetProperty("outcome").GetString() != "Running")
            {
                Assert.Equal("Completed", progress.GetProperty("outcome").GetString());

                return destination;
            }

            await Task.Delay(50);
        }

        Assert.Fail("El respaldo no terminó a tiempo.");

        return destination;
    }

    /// <summary>
    /// El mismo ciclo, pero con las filas en CSV en vez de en `INSERT`.
    ///
    /// Es la otra forma de guardar los datos y hasta ahora se podía escribir pero
    /// no aplicar. Lo que se comprueba es lo que el formato pone en juego: la
    /// coma, las comillas y el salto de línea dentro de un campo tienen que
    /// llegar al destino siendo dato y no separadores.
    /// </summary>
    [Fact]
    public async Task RespaldaLosDatosEnCsvYLosVuelveAMeter()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var origin = await OpenAsync(client, "druse_test");

        if (origin is null) { return; }

        var target = await OpenAsync(client, "druse_test_secondary");

        Assert.NotNull(target);

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var tabla = $"druse_csv_{suffix}";
        var root = Path.Combine(Path.GetTempPath(), $"druse-restore-csv-{suffix}");

        Directory.CreateDirectory(root);

        try
        {
            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {tabla} (
                    id     integer PRIMARY KEY,
                    nombre text NOT NULL,
                    total  numeric(10,2),
                    alta   date
                );
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {tabla} (id, nombre, total, alta) VALUES
                    (1, 'con, coma',        10.50, DATE '2026-01-31'),
                    (2, 'con "comillas"',   NULL,  NULL),
                    (3, E'con\nsalto',      0.00,  DATE '2026-08-18');
                """);

            var path = await BackupToCsvAsync(client, origin.Value, root, tabla);

            // Los datos están en su archivo, no dentro del guion.
            Assert.True(File.Exists(Path.Combine(path, "datos", $"{tabla}.csv")));

            var inspection = await InspectAsync(client, target.Value, path);

            Assert.True(inspection.GetProperty("canRestore").GetBoolean());

            // Se avisa de lo que el formato no sabe conservar antes de aplicarlo.
            var warnings = inspection.GetProperty("warnings")
                .EnumerateArray()
                .Select(warning => warning.GetProperty("message").GetString() ?? string.Empty)
                .ToList();

            Assert.Contains(warnings, message => message.Contains("CSV", StringComparison.Ordinal));

            var result = await RestoreAsync(client, new { sessionId = target.Value, path });

            Assert.Equal("Completed", result.GetProperty("outcome").GetString());
            Assert.Equal(3, result.GetProperty("rowsWritten").GetInt64());

            var rows = await RunSqlAsync(client, target.Value, $"""
                SELECT nombre, coalesce(total::text, '·'), coalesce(alta::text, '·')
                FROM {tabla}
                ORDER BY id;
                """);

            var restored = rows.GetProperty("resultSets")[0]
                .GetProperty("rows")
                .EnumerateArray()
                .Select(row => row.EnumerateArray().Select(cell => cell.GetString()).ToList())
                .ToList();

            Assert.Equal(["con, coma", "10.50", "2026-01-31"], restored[0]);

            // El nulo de una columna que no es texto sí se conserva: una celda
            // vacía en una fecha o en un número solo puede querer decir nulo.
            Assert.Equal(["con \"comillas\"", "·", "·"], restored[1]);
            Assert.Equal(["con\nsalto", "0.00", "2026-08-18"], restored[2]);
        }
        finally
        {
            await CleanAsync(client, origin.Value, $"DROP TABLE IF EXISTS {tabla}");

            if (target is not null)
            {
                await CleanAsync(client, target.Value, $"DROP TABLE IF EXISTS {tabla}");
            }

            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    /// <summary>
    /// Un respaldo de otro motor no se intenta siquiera.
    ///
    /// Se comprueba con un artefacto escrito a mano porque lo que se prueba es la
    /// comprobación, no SQL Server: basta con que el manifiesto diga que viene de
    /// otro sitio.
    /// </summary>
    [Fact]
    public async Task UnRespaldoDeOtroMotorSeRechazaConSuMotivo()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client, "druse_test");

        if (session is null) { return; }

        var path = Path.Combine(Path.GetTempPath(), $"druse-ajeno-{Guid.NewGuid():N}.sql");

        await File.WriteAllTextAsync(path, """
            CREATE TABLE ajena (id int);

            -- Respaldo generado por Druse
            -- Formato: 1
            -- Fecha: 2026-08-18 00:00:00Z
            -- Motor: SqlServer 16.0
            -- Origen: 127.0.0.1/otra
            -- Resultado: Completed
            """);

        try
        {
            var inspection = await InspectAsync(client, session.Value, path);

            Assert.False(inspection.GetProperty("canRestore").GetBoolean());

            var rejection = Assert.Single(inspection.GetProperty("rejections").EnumerateArray());

            Assert.Equal("DifferentEngine", rejection.GetProperty("reason").GetString());

            // Y no basta con avisar: lanzarlo tiene que negarse también, porque
            // entre mirar y aceptar el cliente pudo no hacer caso.
            using var response = await client.PostAsJsonAsync(
                "/api/restore/run",
                new { sessionId = session.Value, path });

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        finally
        {
            File.Delete(path);
        }
    }

    /// <summary>Un formato más nuevo que el que se sabe leer se dice, no se intenta.</summary>
    [Fact]
    public async Task UnFormatoDesconocidoSeRechazaEnVezDeIntentarlo()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client, "druse_test");

        if (session is null) { return; }

        var path = Path.Combine(Path.GetTempPath(), $"druse-futuro-{Guid.NewGuid():N}.sql");

        await File.WriteAllTextAsync(path, """
            CREATE TABLE futura (id int);

            -- Respaldo generado por Druse
            -- Formato: 99
            -- Fecha: 2026-08-18 00:00:00Z
            -- Motor: PostgreSql 18.4
            -- Origen: 127.0.0.1/druse_test
            -- Resultado: Completed
            """);

        try
        {
            var inspection = await InspectAsync(client, session.Value, path);

            var rejection = Assert.Single(inspection.GetProperty("rejections").EnumerateArray());

            Assert.Equal("UnknownFormat", rejection.GetProperty("reason").GetString());
            Assert.Contains("99", rejection.GetProperty("message").GetString()!, StringComparison.Ordinal);
        }
        finally
        {
            File.Delete(path);
        }
    }

    /// <summary>
    /// La otra mitad del criterio: si falla a mitad, se sabe dónde y se reanuda.
    ///
    /// El artefacto se escribe a mano con un error en medio a propósito —un
    /// `INSERT` sobre una tabla que no existe—, que es lo que pasa de verdad
    /// cuando el respaldo se hizo con una selección incompleta.
    /// </summary>
    [Fact]
    public async Task UnaRestauraciónQueFallaDiceDóndeYSeReanudaDesdeAhí()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client, "druse_test");

        if (session is null) { return; }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var primera = $"druse_res_uno_{suffix}";
        var tercera = $"druse_res_tres_{suffix}";
        var path = Path.Combine(Path.GetTempPath(), $"druse-parcial-{suffix}.sql");

        await File.WriteAllTextAsync(path, $"""
            CREATE TABLE {primera} (id integer PRIMARY KEY);
            INSERT INTO tabla_que_no_existe_{suffix} (id) VALUES (1);
            CREATE TABLE {tercera} (id integer PRIMARY KEY);

            -- Respaldo generado por Druse
            -- Formato: 1
            -- Fecha: 2026-08-18 00:00:00Z
            -- Motor: PostgreSql 18.4
            -- Origen: 127.0.0.1/druse_test
            -- Resultado: Completed
            """);

        try
        {
            var failed = await RestoreAsync(client, new { sessionId = session.Value, path });

            Assert.Equal("Failed", failed.GetProperty("outcome").GetString());

            var failure = failed.GetProperty("failure");

            // La segunda instrucción, contando desde uno: es lo que permite
            // reanudar sin repetir la primera.
            Assert.Equal(2, failure.GetProperty("index").GetInt32());
            Assert.Contains(
                "tabla_que_no_existe",
                failure.GetProperty("statement").GetString()!,
                StringComparison.Ordinal);
            Assert.Equal(1, failed.GetProperty("applied").GetInt32());

            // La primera entró y la tercera no: eso es lo que hay que poder decir.
            await RunSqlAsync(client, session.Value, $"SELECT count(*) FROM {primera};");

            // --- Reanudar saltándose la que falló ------------------------------
            var resumed = await RestoreAsync(client, new
            {
                sessionId = session.Value,
                path,
                resumeFrom = 2,
            });

            Assert.Equal("Completed", resumed.GetProperty("outcome").GetString());

            // La tercera se aplicó, y la primera no se repitió: si se hubiera
            // repetido, el `CREATE TABLE` habría fallado y no habría «Completed».
            await RunSqlAsync(client, session.Value, $"SELECT count(*) FROM {tercera};");
        }
        finally
        {
            await CleanAsync(client, session.Value, $"DROP TABLE IF EXISTS {primera}");
            await CleanAsync(client, session.Value, $"DROP TABLE IF EXISTS {tercera}");

            File.Delete(path);
        }
    }

    [Fact]
    public async Task UnArtefactoQueNoExisteSeDiceSinReventar()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client, "druse_test");

        if (session is null) { return; }

        var inspection = await InspectAsync(
            client,
            session.Value,
            Path.Combine(Path.GetTempPath(), $"no-existe-{Guid.NewGuid():N}.sql"));

        Assert.False(inspection.GetProperty("canRestore").GetBoolean());

        var rejection = Assert.Single(inspection.GetProperty("rejections").EnumerateArray());

        Assert.Equal("Unreadable", rejection.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task ElEstadoDeUnaRestauraciónQueNadieConoce_DevuelveNoEncontrado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        using var response = await client.GetAsync($"/api/restore/{Guid.NewGuid()}/status");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
