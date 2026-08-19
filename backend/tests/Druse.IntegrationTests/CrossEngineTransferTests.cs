using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Trasladar de PostgreSQL a SQL Server: dos motores de verdad, por HTTP.
///
/// Es la única forma de comprobar lo que la fase de traducción promete. Que un
/// `uuid` se llame `uniqueidentifier` al otro lado se puede comprobar sin
/// servidor —y se hace, en `TypeTranslationTests`—; que el valor **llegue y se
/// lea igual** no, porque ahí entran el driver, la intercalación y cómo escribe
/// cada motor lo que devuelve.
/// </summary>
public sealed class CrossEngineTransferTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    /// <summary>
    /// Una tabla con un tipo de cada familia que da problemas al cruzar.
    ///
    /// No son tipos elegidos por raros: son los que tiene cualquier tabla de
    /// verdad y los que peor viajan —un identificador único, un JSON, un texto sin
    /// límite, una marca de tiempo con zona y un booleano—.
    /// </summary>
    private const string Columnas =
        "id int PRIMARY KEY, " +
        "clave uuid, " +
        "datos jsonb, " +
        "notas text, " +
        "creado timestamptz, " +
        "activo boolean, " +
        "saldo numeric(12,3), " +
        "codigo varchar(20)";

    [RequiresTwoEnginesFact]
    public async Task CreaLaTablaEnElOtroMotorYCopiaLasFilas()
    {
        var client = _factory.CreateAuthenticatedClient();
        var origen = await OpenAsync(client, TestDatabase.ConnectRequest());
        var destino = await OpenAsync(client, TestSqlServer.ConnectRequest());
        var tabla = $"druse_x_{Guid.NewGuid().ToString("N")[..8]}";

        try
        {
            await RunAsync(client, origen, $"CREATE TABLE {tabla} ({Columnas})");
            // Dos dólares en la plantilla: el JSON lleva llaves, y con uno solo
            // serían interpolaciones.
            await RunAsync(
                client,
                origen,
                $$"""
                  INSERT INTO {{tabla}} VALUES
                    (1, '11111111-1111-1111-1111-111111111111', '{"a": 1}', 'nota larga',
                     '2026-08-19 10:00:00+00', true, 12.345, 'AB-1'),
                    (2, '22222222-2222-2222-2222-222222222222', '{"b": 2}', 'otra',
                     '2026-08-19 11:00:00+00', false, -7.5, 'CD-2')
                  """);

            var request = Request(origen, destino, tabla);

            // --- 1. Qué dice que va a pasar --------------------------------
            // Se pregunta **antes** de crear la tabla, que es cuando sirve de algo:
            // la vista previa del traslado compara dos tablas que ya existen.
            var translations = await TranslateAsync(client, request);

            Assert.Equal("uniqueidentifier", translations["clave"].GetProperty("targetType").GetString());
            Assert.Equal("nvarchar(max)", translations["notas"].GetProperty("targetType").GetString());
            Assert.Equal("datetimeoffset", translations["creado"].GetProperty("targetType").GetString());
            Assert.Equal("bit", translations["activo"].GetProperty("targetType").GetString());
            Assert.Equal("decimal(12,3)", translations["saldo"].GetProperty("targetType").GetString());
            Assert.Equal("nvarchar(20)", translations["codigo"].GetProperty("targetType").GetString());

            // Y el JSON avisa: llega entero, pero deja de ser JSON para el motor.
            Assert.Equal("Approximate", translations["datos"].GetProperty("fidelity").GetString());
            Assert.Contains(
                "deja de comprobar",
                translations["datos"].GetProperty("note").GetString()!,
                StringComparison.Ordinal);

            // --- 2. La tabla se crea al otro lado ---------------------------
            var created = await client.PostAsJsonAsync("/api/transfers/target", request);

            created.EnsureSuccessStatusCode();

            // --- 3. Y las filas llegan --------------------------------------
            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(2, progress.GetProperty("rowsCopied").GetInt64());

            // Lo que importa no es el recuento: es que los valores se lean igual.
            var filas = await LeerAsync(
                client,
                destino,
                $"SELECT CAST(clave AS varchar(40)), notas, codigo FROM {tabla} ORDER BY id");

            Assert.Equal(
                ["11111111-1111-1111-1111-111111111111|nota larga|AB-1",
                 "22222222-2222-2222-2222-222222222222|otra|CD-2"],
                filas);
        }
        finally
        {
            await RunAsync(client, origen, $"DROP TABLE IF EXISTS {tabla}");
            await RunAsync(client, destino, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    /// <summary>
    /// El tipo que escribe el usuario manda sobre el que propone la traducción.
    ///
    /// Quien lo escribe sabe algo que el traductor no: que ese texto sin límite
    /// en realidad son cuatro letras.
    /// </summary>
    [RequiresTwoEnginesFact]
    public async Task ElTipoEscritoAManoGanaAlPropuesto()
    {
        var client = _factory.CreateAuthenticatedClient();
        var origen = await OpenAsync(client, TestDatabase.ConnectRequest());
        var destino = await OpenAsync(client, TestSqlServer.ConnectRequest());
        var tabla = $"druse_x_{Guid.NewGuid().ToString("N")[..8]}";

        try
        {
            await RunAsync(client, origen, $"CREATE TABLE {tabla} (id int PRIMARY KEY, notas text)");
            await RunAsync(client, origen, $"INSERT INTO {tabla} VALUES (1, 'hola')");

            var request = Request(origen, destino, tabla) with
            {
                TypeOverrides = new Dictionary<string, string> { ["notas"] = "nvarchar(50)" },
            };

            var notas = (await TranslateAsync(client, request))["notas"];

            Assert.Equal("nvarchar(50)", notas.GetProperty("targetType").GetString());
            Assert.Equal("Exact", notas.GetProperty("fidelity").GetString());

            var created = await client.PostAsJsonAsync("/api/transfers/target", request);

            created.EnsureSuccessStatusCode();

            var tipo = await LeerAsync(
                client,
                destino,
                $"""
                 SELECT CONCAT(DATA_TYPE, '(', CHARACTER_MAXIMUM_LENGTH, ')')
                 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_NAME = '{tabla}' AND COLUMN_NAME = 'notas'
                 """);

            Assert.Equal(["nvarchar(50)"], tipo);
        }
        finally
        {
            await RunAsync(client, origen, $"DROP TABLE IF EXISTS {tabla}");
            await RunAsync(client, destino, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    /// <summary>
    /// Una columna que no tiene dónde ir impide crear la tabla, y lo dice.
    ///
    /// Crearla sin esa columna dejaría un traslado que parece completo y no lo es:
    /// es justo el silencio que esta función existe para evitar.
    /// </summary>
    [RequiresTwoEnginesFact]
    public async Task UnaColumnaSinEquivalenteImpideCrearLaTabla()
    {
        var client = _factory.CreateAuthenticatedClient();
        var origen = await OpenAsync(client, TestDatabase.ConnectRequest());
        var destino = await OpenAsync(client, TestSqlServer.ConnectRequest());
        var tabla = $"druse_x_{Guid.NewGuid().ToString("N")[..8]}";

        try
        {
            await RunAsync(client, origen, $"CREATE TABLE {tabla} (id int PRIMARY KEY, etiquetas text[])");

            var response = await client.PostAsJsonAsync(
                "/api/transfers/target",
                Request(origen, destino, tabla));

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();

            Assert.Contains("etiquetas", body.GetProperty("message").GetString()!, StringComparison.Ordinal);
        }
        finally
        {
            await RunAsync(client, origen, $"DROP TABLE IF EXISTS {tabla}");
            client.Dispose();
        }
    }

    // -----------------------------------------------------------------------
    // Andamiaje
    // -----------------------------------------------------------------------

    private sealed record TableBody
    {
        public required string Id { get; init; }

        public required string Name { get; init; }

        public string? Database { get; init; }

        public string? Schema { get; init; }
    }

    private sealed record TransferBody
    {
        public required Guid SourceSessionId { get; init; }

        public required TableBody Source { get; init; }

        public required Guid TargetSessionId { get; init; }

        public required TableBody Target { get; init; }

        public IReadOnlyDictionary<string, string> TypeOverrides { get; init; } =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public bool Confirmed { get; init; } = true;
    }

    private static TransferBody Request(Guid origen, Guid destino, string tabla) => new()
    {
        SourceSessionId = origen,
        Source = new TableBody
        {
            Id = $"Table:public.{tabla}",
            Name = tabla,
            Database = TestDatabase.Database,
            Schema = "public",
        },
        TargetSessionId = destino,
        Target = new TableBody
        {
            Id = $"Table:dbo.{tabla}",
            Name = tabla,
            Database = TestSqlServer.Database,
            Schema = "dbo",
        },
    };

    private static async Task<Guid> OpenAsync(HttpClient client, object request)
    {
        var response = await client.PostAsJsonAsync("/api/sessions", request);

        response.EnsureSuccessStatusCode();

        return (await response.ReadJsonAsync()).GetProperty("sessionId").GetGuid();
    }

    /// <summary>Qué tipo tendría cada columna al otro lado, por nombre de columna.</summary>
    private static async Task<Dictionary<string, JsonElement>> TranslateAsync(
        HttpClient client,
        TransferBody request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers/translation", request);

        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return body.GetProperty("translations")
            .EnumerateArray()
            .ToDictionary(item => item.GetProperty("column").GetString()!);
    }

    private static async Task<JsonElement> TransferAsync(HttpClient client, TransferBody request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers", request);

        response.EnsureSuccessStatusCode();

        var id = (await response.ReadJsonAsync()).GetProperty("id").GetGuid();

        for (var intento = 0; intento < 200; intento++)
        {
            var status = await client.GetAsync($"/api/transfers/{id}/status");

            status.EnsureSuccessStatusCode();

            var body = await status.ReadJsonAsync();

            if (body.GetProperty("outcome").GetString() != "Running")
            {
                return body;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"El traslado {id} no terminó en diez segundos.");
    }

    private static async Task RunAsync(HttpClient client, Guid sessionId, string sql)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql,
            maxRows = 1,
            timeoutSeconds = 30,
            confirmDestructive = true,
        });

        response.EnsureSuccessStatusCode();
    }

    private static async Task<List<string>> LeerAsync(HttpClient client, Guid sessionId, string sql)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql,
            maxRows = 100,
            timeoutSeconds = 30,
        });

        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return
        [
            .. body.GetProperty("resultSets")[0].GetProperty("rows")
                .EnumerateArray()
                .Select(row => string.Join(
                    "|",
                    row.EnumerateArray().Select(cell => cell.GetString() ?? string.Empty))),
        ];
    }
}
