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

    private static bool Required =>
        Environment.GetEnvironmentVariable("DRUSE_REQUIRE_ENGINES") == "1";

    /// <summary>PostgreSQL, para lo que no depende del motor y no hay por qué repetir.</summary>
    private static RestoreEngine Postgres => RestoreEngines.Of(RestoreEngines.PostgreSql);

    /// <summary>
    /// Si un nombre del artefacto habla de esta tabla.
    ///
    /// El artefacto la nombra como toque en su motor: con esquema donde el
    /// esquema es un objeto de la base, y **a secas en MySQL**, donde el esquema
    /// es la base y por eso no viaja con el respaldo. Exigir aquí el nombre
    /// completo sería exigir que el respaldo se atara a la base de origen, que es
    /// justo lo que no debe hacer.
    /// </summary>
    private static bool Names(string announced, string table) =>
        string.Equals(announced, table, StringComparison.OrdinalIgnoreCase) ||
        announced.EndsWith($".{table}", StringComparison.OrdinalIgnoreCase);

    private sealed record SessionDto(Guid SessionId);

    /// <summary>Abre una sesión contra la base pedida, o nulo si no hay motor.</summary>
    private static async Task<Guid?> OpenAsync(
        HttpClient client,
        RestoreEngine engine,
        string database)
    {
        var request = new
        {
            profile = new
            {
                name = "Restauración",
                engine = engine.Id,
                host = engine.Host,
                port = engine.Port,
                database,
                username = engine.Username,
                connectTimeoutSeconds = 5,
            },
            password = engine.Password,
        };

        using var response = await client.PostAsJsonAsync("/api/sessions", request);

        if (!response.IsSuccessStatusCode)
        {
            Assert.False(Required, $"Se exigían los motores y {engine.Name} no respondió.");

            return null;
        }

        return (await response.Content.ReadFromJsonAsync<SessionDto>())?.SessionId;
    }

    /// <summary>
    /// Cierra una sesión.
    ///
    /// No es cortesía: mientras quede una conexión abierta contra una base,
    /// `DROP DATABASE` falla en PostgreSQL, en SQL Server y en Informix. Sin esto
    /// la limpieza se traga el error y cada ejecución deja una base más en el
    /// servidor —así aparecieron las `druse_nueva_*` del contenedor de pruebas—.
    /// </summary>
    private static async Task CloseAsync(HttpClient client, Guid session)
    {
        using var response = await client.DeleteAsync($"/api/sessions/{session}");
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
    /// <summary>
    /// Restaura y espera al final, poniendo la huella si quien llama no la puso.
    ///
    /// La huella la exige el proceso local: sale de inspeccionar el artefacto y es
    /// lo que le dice «aplica esto, lo que acabo de mirar». Aquí se hace lo mismo
    /// que hace la interfaz —inspeccionar y devolverla— para que cada prueba no
    /// tenga que repetirlo; las que comprueban **la exigencia** la pasan a mano.
    /// </summary>
    private static async Task<JsonElement> RestoreAsync(HttpClient client, object request)
    {
        var body = await WithFingerprintAsync(client, request);

        using var started = await client.PostAsJsonAsync("/api/restore/run", body);

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

    /// <summary>
    /// Completa la petición con la huella del artefacto, si no la trae.
    ///
    /// Se pasa por JSON y vuelta porque las pruebas construyen objetos anónimos
    /// de formas distintas: así vale para todas sin repetir sus campos.
    /// </summary>
    private static async Task<Dictionary<string, JsonElement>> WithFingerprintAsync(
        HttpClient client,
        object request)
    {
        var body = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
            JsonSerializer.Serialize(request))!;

        if (body.ContainsKey("fingerprint"))
        {
            return body;
        }

        var inspection = await InspectAsync(
            client,
            body["sessionId"].GetGuid(),
            body["path"].GetString()!);

        body["fingerprint"] = inspection.GetProperty("fingerprint");

        return body;
    }

    private static async Task<JsonElement> InspectAsync(HttpClient client, Guid session, string path)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/restore/inspect",
            new { sessionId = session, path });

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    /// <summary>
    /// Por qué un respaldo o una restauración no terminaron limpios.
    ///
    /// Sin esto, un artefacto con avisos o una instrucción que revienta hacen
    /// caer el ciclo entero con un «se esperaba Completed» y ni una palabra del
    /// motivo, que es justo lo que hay que leer para saber si el problema es del
    /// motor, del guion o de la prueba. Con cuatro motores en juego, esa
    /// diferencia son horas.
    /// </summary>
    private static string Describe(JsonElement progress)
    {
        var warnings = progress.TryGetProperty("warnings", out var list)
            ? list.EnumerateArray()
                .Select(warning =>
                    $"  · {warning.GetProperty("subject").GetString()}: " +
                    warning.GetProperty("message").GetString())
                .ToList()
            : [];

        var failure = string.Empty;

        if (progress.TryGetProperty("failure", out var error)
            && error.ValueKind is not JsonValueKind.Null)
        {
            failure = $"\nFallo: {error.GetProperty("message").GetString()}";

            // La restauración además dice en qué instrucción se paró, que es lo
            // primero que se mira cuando el guion no se puede aplicar.
            if (error.TryGetProperty("statement", out var statement)
                && statement.ValueKind is not JsonValueKind.Null)
            {
                failure += $"\nInstrucción: {statement.GetString()}";
            }
        }

        return $"Terminó como «{progress.GetProperty("outcome").GetString()}».{failure}" +
            (warnings.Count > 0 ? $"\nAvisos:\n{string.Join("\n", warnings)}" : string.Empty);
    }

    /// <summary>Respalda las tablas indicadas a un `.sql` y devuelve su ruta.</summary>
    private static async Task<string> BackupAsync(
        HttpClient client,
        RestoreEngine engine,
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
                tables = tables.Select(table => new
                {
                    id = table,
                    name = table,
                    schema = engine.Schema,
                }),
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
                Assert.True(progress.GetProperty("outcome").GetString() == "Completed", Describe(progress));

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
    ///
    /// Se recorren **los cuatro motores**. Las contractuales ya cubrían a los
    /// cuatro por debajo, pero el ciclo entero solo se había ejercitado en
    /// PostgreSQL: entre el dominio y la pantalla hay un contrato HTTP donde el
    /// motor es un identificador y el esquema significa cosas distintas.
    /// </summary>
    [Theory]
    [InlineData(RestoreEngines.PostgreSql)]
    [InlineData(RestoreEngines.SqlServer)]
    [InlineData(RestoreEngines.MySql)]
    [InlineData(RestoreEngines.Informix)]
    public async Task RespaldaUnaBaseYLaRestauraEnOtra(string id)
    {
        var engine = RestoreEngines.Of(id);

        using var client = _factory.CreateAuthenticatedClient();

        var origin = await OpenAsync(client, engine, engine.Database);

        if (origin is null) { return; }

        var target = await OpenAsync(client, engine, engine.SecondaryDatabase);

        Assert.NotNull(target);

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var padre = $"druse_res_pad_{suffix}";
        var hijo = $"druse_res_hij_{suffix}";
        var root = Path.Combine(Path.GetTempPath(), $"druse-restore-{id}-{suffix}");

        Directory.CreateDirectory(root);

        try
        {
            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {padre} (id {engine.NumberType} PRIMARY KEY, nombre {engine.TextType} NOT NULL)
                """);

            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {hijo} (
                    id       {engine.NumberType} PRIMARY KEY,
                    padre_id {engine.NumberType} REFERENCES {padre} (id),
                    nota     {engine.TextType}
                )
                """);

            // Una fila por instrucción: Informix no admite varias tuplas en un
            // mismo `VALUES`, y lo que se prueba aquí no es el `INSERT`.
            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {padre} (id, nombre) VALUES (1, 'Ana')
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {padre} (id, nombre) VALUES (2, 'O''Donnell; 12')
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {hijo} (id, padre_id, nota) VALUES (1, 1, 'una')
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {hijo} (id, padre_id, nota) VALUES (2, 2, 'otra')
                """);

            var path = await BackupAsync(client, engine, origin.Value, root, padre, hijo);

            // --- Mirar antes de tocar -----------------------------------------
            var inspection = await InspectAsync(client, target.Value, path);

            Assert.True(inspection.GetProperty("canRestore").GetBoolean());
            Assert.Equal(engine.Id, inspection.GetProperty("manifest").GetProperty("engine").GetString());
            Assert.True(inspection.GetProperty("statements").GetInt32() > 0);

            var announced = inspection.GetProperty("tables")
                .EnumerateArray()
                .Select(table => table.GetString())
                .ToList();

            Assert.Contains(announced, name => Names(name!, padre));

            // La base destino está limpia: no hay nada que sobrescribir todavía.
            Assert.Empty(inspection.GetProperty("collisions").EnumerateArray());

            // --- Aplicar -------------------------------------------------------
            var result = await RestoreAsync(client, new
            {
                sessionId = target.Value,
                path,
            });

            Assert.True(result.GetProperty("outcome").GetString() == "Completed", Describe(result));
            Assert.True(result.GetProperty("applied").GetInt32() > 0);

            // --- Y lo restaurado es lo que había -------------------------------
            var rows = await RunSqlAsync(client, target.Value, $"""
                SELECT nombre FROM {padre} ORDER BY id
                """);

            var values = rows.GetProperty("resultSets")[0]
                .GetProperty("rows")
                .EnumerateArray()
                .Select(row => row[0].GetString())
                .ToList();

            // El literal con comilla y punto y coma es el que rompe a quien parta
            // el guion a lo bruto: si llega entero, el lector hizo su trabajo.
            Assert.Equal(["Ana", "O'Donnell; 12"], values);

            var hijos = await RunSqlAsync(client, target.Value, $"SELECT count(*) FROM {hijo}");

            Assert.Equal("2", hijos.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString());

            // --- Y ahora sí avisa de que se sobrescribiría ---------------------
            var second = await InspectAsync(client, target.Value, path);
            var collisions = second.GetProperty("collisions")
                .EnumerateArray()
                .Select(collision => collision.GetProperty("table").GetString())
                .ToList();

            Assert.Contains(collisions, name => Names(name!, padre));
            Assert.Contains(collisions, name => Names(name!, hijo));
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

    /// <summary>
    /// Traerse el respaldo a una base **que no existe todavía**.
    ///
    /// Es cómo se copia una base entera sin tocar la que hay abierta: Druse la
    /// crea y aplica dentro el artefacto. Lo que se comprueba es que la base
    /// aparece, que lo restaurado está en ella y que **la de origen no se toca**.
    /// </summary>
    [Theory]
    [InlineData(RestoreEngines.PostgreSql)]
    [InlineData(RestoreEngines.SqlServer)]
    [InlineData(RestoreEngines.MySql)]
    [InlineData(RestoreEngines.Informix)]
    public async Task CreaLaBaseNuevaYRestauraDentro(string id)
    {
        var engine = RestoreEngines.Of(id);

        using var client = _factory.CreateAuthenticatedClient();

        var origin = await OpenAsync(client, engine, engine.Database);

        if (origin is null) { return; }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var tabla = $"druse_copia_{suffix}";
        var nueva = $"druse_nueva_{suffix}";
        var root = Path.Combine(Path.GetTempPath(), $"druse-restore-nueva-{id}-{suffix}");

        Directory.CreateDirectory(root);

        Guid? target = null;

        try
        {
            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {tabla} (id {engine.NumberType} PRIMARY KEY, nombre {engine.TextType} NOT NULL)
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {tabla} (id, nombre) VALUES (1, 'Ana')
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {tabla} (id, nombre) VALUES (2, 'Luis')
                """);

            var path = await BackupAsync(client, engine, origin.Value, root, tabla);

            // La inspección propone el nombre de la base de la que salió y dice
            // cuáles hay ya, que es con lo que la pantalla avisa antes de lanzar.
            var inspection = await InspectAsync(client, origin.Value, path);

            Assert.Equal(engine.Database, inspection.GetProperty("sourceDatabase").GetString());
            Assert.Contains(
                engine.Database,
                inspection.GetProperty("databases").EnumerateArray().Select(name => name.GetString()));

            var result = await RestoreAsync(client, new
            {
                sessionId = origin.Value,
                path,
                newDatabase = nueva,
            });

            Assert.True(result.GetProperty("outcome").GetString() == "Completed", Describe(result));

            // Y lo restaurado está en la base nueva, no en la de origen.
            target = await OpenAsync(client, engine, nueva);

            Assert.NotNull(target);

            var rows = await RunSqlAsync(client, target.Value, $"SELECT count(*) FROM {tabla}");

            Assert.Equal("2", rows.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString());
        }
        finally
        {
            await CleanAsync(client, origin.Value, $"DROP TABLE IF EXISTS {tabla}");

            // Primero se suelta la conexión a la base nueva: con ella abierta,
            // el `DROP DATABASE` no llega a ejecutarse en tres de los cuatro.
            if (target is not null)
            {
                await CloseAsync(client, target.Value);
            }

            await CleanAsync(client, origin.Value, engine.DropDatabase(nueva));

            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    /// <summary>
    /// Y no se restaura dentro de una base que ya existe: quien pide «tráemela a
    /// una base nueva» está copiando, y escribir encima de otra cosa no es un
    /// matiz. Se para **antes** de tocar nada.
    /// </summary>
    [Theory]
    [InlineData(RestoreEngines.PostgreSql)]
    [InlineData(RestoreEngines.SqlServer)]
    [InlineData(RestoreEngines.MySql)]
    [InlineData(RestoreEngines.Informix)]
    public async Task SeNiegaACrearUnaBaseQueYaExiste(string id)
    {
        var engine = RestoreEngines.Of(id);

        using var client = _factory.CreateAuthenticatedClient();

        var origin = await OpenAsync(client, engine, engine.Database);

        if (origin is null) { return; }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var tabla = $"druse_choque_{suffix}";
        var root = Path.Combine(Path.GetTempPath(), $"druse-restore-choque-{id}-{suffix}");

        Directory.CreateDirectory(root);

        try
        {
            await RunSqlAsync(client, origin.Value, $"CREATE TABLE {tabla} (id {engine.NumberType} PRIMARY KEY)");

            var path = await BackupAsync(client, engine, origin.Value, root, tabla);

            var result = await RestoreAsync(client, new
            {
                sessionId = origin.Value,
                path,
                newDatabase = engine.SecondaryDatabase,
            });

            Assert.Equal("Failed", result.GetProperty("outcome").GetString());

            var failure = result.GetProperty("failure");

            Assert.Contains(
                engine.SecondaryDatabase,
                failure.GetProperty("message").GetString(),
                StringComparison.Ordinal);

            // Nada aplicado: se para antes de abrir el artefacto siquiera.
            Assert.Equal(0, result.GetProperty("statementsDone").GetInt32());
        }
        finally
        {
            await CleanAsync(client, origin.Value, $"DROP TABLE IF EXISTS {tabla}");

            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    /// <summary>
    /// Una tabla con un índice **sobre una expresión** se respalda y se restaura.
    ///
    /// El catálogo no da columnas para esos índices, y el guion salía con
    /// `USING btree ()`: la restauración se paraba en él con «syntax error at or
    /// near ")"», después de haber aplicado todo lo anterior. Aquí se comprueba lo
    /// que importa —que la vuelta entera funcione— y de paso que el índice llegue
    /// al destino, en vez de perderse en silencio.
    /// </summary>
    [Fact]
    public async Task UnIndiceSobreUnaExpresionSobreviveALaVuelta()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var origin = await OpenAsync(client, Postgres, Postgres.Database);

        if (origin is null) { return; }

        var target = await OpenAsync(client, Postgres, Postgres.SecondaryDatabase);

        Assert.NotNull(target);

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var tabla = $"druse_expr_{suffix}";
        var indice = $"ix_{tabla}_nit";
        var root = Path.Combine(Path.GetTempPath(), $"druse-restore-expr-{suffix}");

        Directory.CreateDirectory(root);

        try
        {
            await RunSqlAsync(client, origin.Value, $"""
                CREATE TABLE {tabla} (id integer PRIMARY KEY, nit text NOT NULL);
                """);

            await RunSqlAsync(client, origin.Value, $"""
                CREATE INDEX {indice} ON {tabla} (lower(nit));
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {tabla} (id, nit) VALUES (1, '900.123-4');
                """);

            var path = await BackupAsync(client, Postgres, origin.Value, root, tabla);

            var result = await RestoreAsync(client, new { sessionId = target.Value, path });

            Assert.True(result.GetProperty("outcome").GetString() == "Completed", Describe(result));

            var indices = await RunSqlAsync(client, target.Value, $"""
                SELECT indexdef FROM pg_indexes WHERE indexname = '{indice}';
                """);

            var definicion = indices.GetProperty("resultSets")[0]
                .GetProperty("rows")
                .EnumerateArray()
                .Select(row => row[0].GetString())
                .SingleOrDefault();

            Assert.NotNull(definicion);
            Assert.Contains("lower(nit)", definicion, StringComparison.Ordinal);
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

    /// <summary>Respalda a una carpeta con los datos en CSV y devuelve su ruta.</summary>
    private static async Task<string> BackupToCsvAsync(
        HttpClient client,
        RestoreEngine engine,
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
                tables = tables.Select(table => new
                {
                    id = table,
                    name = table,
                    schema = engine.Schema,
                }),
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
                Assert.True(progress.GetProperty("outcome").GetString() == "Completed", Describe(progress));

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

        var origin = await OpenAsync(client, Postgres, Postgres.Database);

        if (origin is null) { return; }

        var target = await OpenAsync(client, Postgres, Postgres.SecondaryDatabase);

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
                    nota   text,
                    total  numeric(10,2),
                    alta   date
                );
                """);

            await RunSqlAsync(client, origin.Value, $"""
                INSERT INTO {tabla} (id, nombre, nota, total, alta) VALUES
                    (1, 'con, coma',        '',     10.50, DATE '2026-01-31'),
                    (2, 'con "comillas"',   NULL,   NULL,  NULL),
                    (3, E'con\nsalto',      'algo', 0.00,  DATE '2026-08-18');
                """);

            var path = await BackupToCsvAsync(client, Postgres, origin.Value, root, tabla);

            // Los datos están en su archivo, no dentro del guion, y el archivo lleva
            // el esquema en el nombre: dos tablas homónimas de esquemas distintos
            // no pueden compartirlo.
            Assert.True(File.Exists(Path.Combine(path, "datos", $"public.{tabla}.csv")));

            var inspection = await InspectAsync(client, target.Value, path);

            Assert.True(inspection.GetProperty("canRestore").GetBoolean());

            // Desde el formato 2 no hay nada que avisar de los CSV: el nulo y la
            // cadena vacía se escriben distintos y vuelven distintos. Un aviso que
            // no advierte de nada enseña a no leerlos.
            var warnings = inspection.GetProperty("warnings")
                .EnumerateArray()
                .Select(warning => warning.GetProperty("message").GetString() ?? string.Empty)
                .ToList();

            Assert.DoesNotContain(warnings, message => message.Contains("CSV", StringComparison.Ordinal));

            var result = await RestoreAsync(client, new { sessionId = target.Value, path });

            Assert.True(result.GetProperty("outcome").GetString() == "Completed", Describe(result));
            Assert.Equal(3, result.GetProperty("rowsWritten").GetInt64());

            var rows = await RunSqlAsync(client, target.Value, $"""
                SELECT
                    nombre,
                    CASE WHEN nota IS NULL THEN '(nulo)' ELSE '[' || nota || ']' END,
                    coalesce(total::text, '·'),
                    coalesce(alta::text, '·')
                FROM {tabla}
                ORDER BY id;
                """);

            var restored = rows.GetProperty("resultSets")[0]
                .GetProperty("rows")
                .EnumerateArray()
                .Select(row => row.EnumerateArray().Select(cell => cell.GetString()).ToList())
                .ToList();

            // La cadena vacía vuelve vacía y el nulo vuelve nulo, que es lo que el
            // formato 1 no sabía hacer: los escribía igual y los dos entraban como
            // cadena vacía, dejando sin nulos una columna que los tenía.
            Assert.Equal(["con, coma", "[]", "10.50", "2026-01-31"], restored[0]);
            Assert.Equal(["con \"comillas\"", "(nulo)", "·", "·"], restored[1]);
            Assert.Equal(["con\nsalto", "[algo]", "0.00", "2026-08-18"], restored[2]);
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
    /// Entre mirar el artefacto y aceptar restaurarlo cabe cualquier cosa: que el
    /// archivo se sobrescriba, que alguien deje otro respaldo en esa ruta. Lo que
    /// se aplicaría entonces sería algo que nadie aprobó, sobre una base de
    /// verdad.
    ///
    /// Por eso la inspección devuelve una huella y la restauración la exige. Aquí
    /// se comprueban los dos casos que importan: que sin ella no se restaura, y
    /// que con una de antes del cambio tampoco.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ElArtefactoQueCambioDespuesDeInspeccionarlo_NoSeAplica()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var session = await OpenAsync(client, Postgres, Postgres.Database);

        if (session is null) { return; }

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var tabla = $"druse_fp_{suffix}";
        var root = Path.Combine(Path.GetTempPath(), $"druse-fp-{suffix}");
        var path = Path.Combine(root, "respaldo.sql");

        Directory.CreateDirectory(root);

        try
        {
            await File.WriteAllTextAsync(
                path,
                $"CREATE TABLE {tabla} (id integer PRIMARY KEY);\n" +
                "-- Respaldo generado por Druse\n" +
                "-- Motor: PostgreSql 18.0\n");

            var inspection = await InspectAsync(client, session.Value, path);
            var huella = inspection.GetProperty("fingerprint").GetString();

            Assert.False(string.IsNullOrWhiteSpace(huella));

            // --- Sin huella no se restaura ----------------------------------
            using (var sinHuella = await client.PostAsJsonAsync(
                "/api/restore/run",
                new { sessionId = session.Value, path, fingerprint = string.Empty }))
            {
                var estado = await WaitOrRejectAsync(client, sinHuella);

                Assert.Contains("huella", estado, StringComparison.OrdinalIgnoreCase);
            }

            // --- Y con una de antes del cambio, tampoco ---------------------
            // Se espera un instante para que la fecha de modificación cambie de
            // verdad: en Windows tiene grano suficiente, pero no infinito.
            await Task.Delay(1100);

            await File.AppendAllTextAsync(path, $"DROP TABLE {tabla};\n");

            using (var conHuellaVieja = await client.PostAsJsonAsync(
                "/api/restore/run",
                new { sessionId = session.Value, path, fingerprint = huella }))
            {
                var estado = await WaitOrRejectAsync(client, conHuellaVieja);

                Assert.Contains("cambió", estado, StringComparison.OrdinalIgnoreCase);
            }

            // Y no llegó a tocarse la base: la tabla del artefacto no existe.
            var existe = await RunSqlAsync(
                client,
                session.Value,
                $"SELECT to_regclass('{tabla}') IS NULL AS ausente");

            Assert.Equal(
                "True",
                existe.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString(),
                ignoreCase: true);
        }
        finally
        {
            await CleanAsync(client, session.Value, $"DROP TABLE IF EXISTS {tabla}");

            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    /// <summary>
    /// El motivo del rechazo, venga como respuesta o como estado final.
    ///
    /// Una restauración que ni siquiera arranca contesta 400; una que arranca y se
    /// planta lo cuenta en su estado. Las dos son «no se aplicó», y lo que la
    /// prueba quiere leer es el porqué.
    /// </summary>
    private static async Task<string> WaitOrRejectAsync(
        HttpClient client,
        HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            return body;
        }

        var id = JsonSerializer.Deserialize<JsonElement>(body).GetProperty("id").GetGuid();

        for (var attempt = 0; attempt < 200; attempt++)
        {
            using var status = await client.GetAsync($"/api/restore/{id}/status");

            var progress = await status.Content.ReadFromJsonAsync<JsonElement>();

            if (progress.GetProperty("outcome").GetString() != "Running")
            {
                return progress.ToString();
            }

            await Task.Delay(50);
        }

        return "no terminó a tiempo";
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

        var session = await OpenAsync(client, Postgres, Postgres.Database);

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

        var session = await OpenAsync(client, Postgres, Postgres.Database);

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

        var session = await OpenAsync(client, Postgres, Postgres.Database);

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

            Assert.True(resumed.GetProperty("outcome").GetString() == "Completed", Describe(resumed));

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

        var session = await OpenAsync(client, Postgres, Postgres.Database);

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
