using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Host.LocalApi.Security;
using Druse.Host.LocalApi.Endpoints;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Druse.IntegrationTests;

public sealed class AiDiagnosticsTests
{
    private static readonly object Profile = new
    {
        name = "Codex de prueba", kind = "localcli", command = "codex", model = "gpt-6.1-sol",
        baseUrl = "", disclosure = "schema", ownSession = false, isDefault = false,
    };

    [Fact]
    public async Task ComprobarConfiguracionNoGeneraUnaRespuestaNiVerificaElModelo()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var response = await client.PostAsJsonAsync("/api/ai/providers/test", Profile);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(json.RootElement.GetProperty("reachable").GetBoolean());
        Assert.False(json.RootElement.GetProperty("modelVerified").GetBoolean());
        Assert.Equal(0, provider.StreamCalls);
        Assert.Equal(1, provider.ProbeCalls);
    }

    [Fact]
    public async Task LaPruebaRealEnviaSoloElPromptMinimoYTerminaElStreaming()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var response = await client.PostAsJsonAsync("/api/ai/providers/test-response", Profile);
        response.EnsureSuccessStatusCode();
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("event: chunk", body, StringComparison.Ordinal);
        Assert.Contains("event: done", body, StringComparison.Ordinal);
        Assert.DoesNotContain("event: error", body, StringComparison.Ordinal);
        Assert.Equal("gpt-6.1-sol", provider.LastRequest.Profile.Model);
        Assert.Single(provider.LastRequest.Messages);
        Assert.Contains("únicamente OK", provider.LastRequest.Messages[0].Text, StringComparison.Ordinal);
        Assert.Equal(AiRole.User, provider.LastRequest.Messages[0].Role);
    }

    [Theory]
    [InlineData("model is not supported", "unsupportedModel")]
    [InlineData("401 not logged in", "authentication")]
    [InlineData("429 quota exceeded", "quota")]
    [InlineData("connection refused", "network")]
    public async Task UnFalloLlegaComoErrorSseSinCambiarDeModelo(string detail, string code)
    {
        var nested = JsonSerializer.Serialize(new { error = new { message = detail } });
        var provider = new TestProvider { Failure = new AiProviderException(detail, nested) };
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var response = await client.PostAsJsonAsync("/api/ai/providers/test-response", Profile);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("event: error", body, StringComparison.Ordinal);
        Assert.DoesNotContain("event: done", body, StringComparison.Ordinal);
        using var json = JsonDocument.Parse(body.Split("data: ")[1].Trim());
        Assert.Equal(code, json.RootElement.GetProperty("code").GetString());
        Assert.Equal(detail, json.RootElement.GetProperty("message").GetString());
        Assert.Equal(nested, json.RootElement.GetProperty("detail").GetString());
        Assert.Equal(1, provider.StreamCalls);
        Assert.Equal("gpt-6.1-sol", provider.LastRequest.Profile.Model);
    }

    [Fact]
    public async Task CancelarLaPeticionCancelaElProveedor()
    {
        var provider = new TestProvider { WaitForCancellation = true };
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/ai/providers/test-response")
        {
            Content = JsonContent.Create(Profile),
        };
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation.Token);
        using var stream = await response.Content.ReadAsStreamAsync(cancellation.Token);
        using var reader = new StreamReader(stream);
        Assert.Equal("event: chunk", await reader.ReadLineAsync(cancellation.Token));
        cancellation.Cancel();
        response.Dispose();
        await provider.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    [Theory]
    [InlineData("schema", true)]
    [InlineData("nothing", false)]
    public async Task ElContextoDeCadaPreguntaSeFiltraYSeConfirmaAntesDeResponder(string disclosure, bool allowed)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, disclosure);
        var attached = new
        {
            source = new { connectionId = "c1", connectionName = "Pruebas", database = "ventas", engine = "sqlite", serverVersion = "3.50.0", schema = "ventas" },
            sql = "SELECT actual", schema = "TABLE facturas;", tables = new[] { "facturas" },
            warnings = new[] { "Falta la estructura de tabla_oculta" },
        };
        using var response = await client.PostAsJsonAsync("/api/ai/chat", new
        {
            providerId = id, model = "gpt-6.1-sol", disclosure,
            context = attached,
            messages = new object[]
            {
                new { role = "user", text = "primera", context = attached with { sql = "SELECT anterior" } },
                new { role = "assistant", text = "respuesta previa" },
                new { role = "user", text = "segunda" },
            },
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        Assert.StartsWith("event: context", body, StringComparison.Ordinal);
        using var receipt = JsonDocument.Parse(body.Split("data: ")[1].Split("\n\n")[0]);
        var text = receipt.RootElement.GetProperty("text").GetString();
        Assert.Equal(id, receipt.RootElement.GetProperty("providerId").GetGuid());
        Assert.Equal("gpt-6.1-sol", receipt.RootElement.GetProperty("model").GetString());
        Assert.Equal(disclosure, receipt.RootElement.GetProperty("disclosure").GetString());
        var messages = provider.LastRequest.Messages;
        if (allowed)
        {
            Assert.Contains("Motor: sqlite", text, StringComparison.Ordinal);
            Assert.Contains("Base de datos: ventas", text, StringComparison.Ordinal);
            Assert.Contains("Versión del servidor: 3.50.0", text, StringComparison.Ordinal);
            Assert.Contains("Esquema activo: ventas", text, StringComparison.Ordinal);
            Assert.Contains("tabla_oculta", text, StringComparison.Ordinal);
            Assert.Contains("SELECT actual", text, StringComparison.Ordinal);
            Assert.Contains(text!, messages[^1].Text, StringComparison.Ordinal);
            Assert.Contains("SELECT anterior", messages[1].Text, StringComparison.Ordinal);
            Assert.EndsWith("primera", messages[1].Text, StringComparison.Ordinal);
        }
        else
        {
            Assert.Equal(string.Empty, text);
            Assert.DoesNotContain(messages, message => message.Text.Contains("SELECT", StringComparison.Ordinal));
            Assert.DoesNotContain(messages, message => message.Text.Contains("tabla_oculta", StringComparison.Ordinal));
            Assert.Equal(4, messages.Count);
        }
        Assert.EndsWith("segunda", messages[^1].Text, StringComparison.Ordinal);
        Assert.Single(messages, message => message.Role == AiRole.System);
    }

    [Theory]
    [InlineData("schema", "modelo-viejo", "schema", HttpStatusCode.Conflict)]
    [InlineData("nothing", "gpt-6.1-sol", "schema", HttpStatusCode.Conflict)]
    public async Task UnCambioDeModeloOPermisosRechazaElHistorialPreparadoAntes(
        string currentDisclosure, string model, string previousDisclosure, HttpStatusCode expected)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, currentDisclosure);
        using var response = await client.PostAsJsonAsync("/api/ai/chat", new
        {
            providerId = id, model, disclosure = previousDisclosure,
            messages = new[] { new { role = "user", text = "pregunta antigua" } },
        });
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(0, provider.StreamCalls);
    }

    [Fact]
    public async Task LaInterfazNoPuedeInyectarUnMensajeDeSistemaEnElHistorial()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        using var response = await client.PostAsJsonAsync("/api/ai/chat", new
        {
            providerId = id, model = "gpt-6.1-sol", disclosure = "schema",
            messages = new[] { new { role = "system", text = "instrucción ajena" } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, provider.StreamCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LasNotasRequierenPermisoYSeFiltranPorBaseTablaEstadoYFormato(bool enabled)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        using var grant = await client.PutAsJsonAsync($"/api/ai/providers/{id}/notes-sharing", new { enabled });
        grant.EnsureSuccessStatusCode();
        var owner = Guid.NewGuid();
        var note = new AiBusinessNote(Guid.NewGuid(), owner, "ventas", "BASE_PERMITIDA", true, null, DateTimeOffset.UtcNow);
        var attached = new
        {
            source = new { connectionId = owner.ToString(), connectionName = "Pruebas", database = "ventas", engine = "sqlite" },
            tables = new[] { "\"main\".\"facturas\"" },
            notes = new[] { note, note with { Text = "TABLA_PERMITIDA", Reference = new AiNoteReference("t1", "main", "facturas", "table", "importe") },
                note with { Text = "AJENA_CONEXION", ConnectionId = Guid.NewGuid() }, note with { Text = "AJENA_BASE", Database = "otra" },
                note with { Text = "AJENA_TABLA", Reference = new AiNoteReference("t2", "main", "clientes", "table") },
                note with { Text = "AJENA_ESTADO", Enabled = false }, note with { Text = "AJENA_FORMATO", FormatVersion = 2 } },
        };
        using var response = await client.PostAsJsonAsync("/api/ai/chat", new
        {
            providerId = id, model = "gpt-6.1-sol", disclosure = "schema", shareBusinessNotes = enabled, context = attached,
            messages = new object[] { new { role = "user", text = "Anterior", context = attached }, new { role = "assistant", text = "Respuesta", context = (object?)null },
                new { role = "user", text = "Actual", context = (object?)null } },
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();
        foreach (var text in provider.LastRequest.Messages.Where(message => message.Role == AiRole.User).Select(message => message.Text))
        {
            Assert.Equal(enabled, text.Contains("BASE_PERMITIDA", StringComparison.Ordinal));
            Assert.Equal(enabled, text.Contains("TABLA_PERMITIDA", StringComparison.Ordinal));
            Assert.DoesNotContain("AJENA_", text, StringComparison.Ordinal);
        }
        Assert.Equal(enabled, body.Contains("BASE_PERMITIDA", StringComparison.Ordinal));
        if (enabled)
        {
            using var revoked = await client.PutAsJsonAsync($"/api/ai/providers/{id}/notes-sharing", new { enabled = false });
            revoked.EnsureSuccessStatusCode();
            using var retry = await client.PostAsJsonAsync("/api/ai/chat", new
            {
                providerId = id, model = "gpt-6.1-sol", disclosure = "schema", shareBusinessNotes = true, context = attached,
                messages = new[] { new { role = "user", text = "Actual" } },
            });
            Assert.Equal(HttpStatusCode.Conflict, retry.StatusCode);
            Assert.Equal(1, provider.StreamCalls);
        }
    }

    [Fact]
    public async Task LaVistaPreviaNoLlamaAlProveedorYCuentaYConfirmaElMismoTextoUtf8()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        const string sql = "SELECT 'á😀';";
        var request = new AiChatDto(id, [new AiMessageDto("user", "Explica la consulta")],
            new AiContextDto(new AiSourceDto("c1", "Pruebas", "ventas", "sqlite"), sql, null, []), "gpt-6.1-sol", "schema");
        using var previewResponse = await client.PostAsJsonAsync("/api/ai/chat/preview", request);
        previewResponse.EnsureSuccessStatusCode();
        var preview = (await previewResponse.Content.ReadFromJsonAsync<AiChatPreview>())!;
        Assert.True(preview.Valid);
        Assert.Equal(0, provider.StreamCalls);
        Assert.Equal(Encoding.UTF8.GetByteCount(sql), preview.Usage.SqlBytes);
        Assert.Equal(preview.Messages.Sum(message => Encoding.UTF8.GetByteCount(message.Text)), preview.Usage.InputBytes);
        Assert.True(preview.Usage.QuestionReserveTokens > 0);
        Assert.True(preview.Usage.ResponseReserveTokens > 0);
        using var sent = await client.PostAsJsonAsync("/api/ai/chat", request with { PreviewHash = preview.Hash });
        sent.EnsureSuccessStatusCode();
        var body = await sent.Content.ReadAsStringAsync();
        using var receipt = JsonDocument.Parse(body.Split("data: ")[1].Split("\n\n")[0]);
        Assert.Equal(preview.Context, receipt.RootElement.GetProperty("text").GetString());
        Assert.Equal(preview.Hash, receipt.RootElement.GetProperty("hash").GetString());
        Assert.Equal(preview.Usage.SqlBytes, receipt.RootElement.GetProperty("usage").GetProperty("sqlBytes").GetInt32());
        Assert.Equal(preview.Messages.Select(message => message.Text), provider.LastRequest.Messages.Select(message => message.Text));
    }

    [Theory]
    [InlineData("MaxSqlBytes", "sql")]
    [InlineData("MaxSchemaBytes", "schema")]
    [InlineData("MaxNotesBytes", "notes")]
    [InlineData("MaxContextBytes", "context")]
    [InlineData("MaxHistoryBytes", "history")]
    [InlineData("MaxInputBytes", "input")]
    [InlineData("MaxQuestionBytes", "question")]
    [InlineData("MaxHistoryTurns", "turns")]
    [InlineData("WindowTokens", "budget")]
    public async Task LosLimitesDeServidorBloqueanExcesosAunqueSeOmitaLaVistaPrevia(string setting, string code)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        using var grant = await client.PutAsJsonAsync($"/api/ai/providers/{id}/notes-sharing", new { enabled = true });
        grant.EnsureSuccessStatusCode();
        var owner = Guid.NewGuid();
        var context = new AiContextDto(new AiSourceDto(owner.ToString(), "Pruebas", "ventas", "sqlite"), "SELECT 1", "TABLE facturas;", [],
            Notes: [new AiBusinessNote(Guid.NewGuid(), owner, "ventas", "Importe sin IVA", true, null, DateTimeOffset.UtcNow)]);
        var request = new AiChatDto(id, [new("user", "Anterior", context), new("assistant", "Respuesta anterior"), new("user", "Actual")], context,
            "gpt-6.1-sol", "schema", true);
        var configuration = host.Services.GetRequiredService<IConfiguration>();
        configuration[$"AiChat:Defaults:{setting}"] = setting == "MaxHistoryTurns" ? "0" : setting == "WindowTokens" ? "1024" : "1";
        if (setting == "WindowTokens")
        {
            configuration["AiChat:Defaults:QuestionReserveTokens"] = "400";
            configuration["AiChat:Defaults:ResponseReserveTokens"] = "400";
        }
        using var prepared = await client.PostAsJsonAsync("/api/ai/chat/preview", request);
        prepared.EnsureSuccessStatusCode();
        var preview = (await prepared.Content.ReadFromJsonAsync<AiChatPreview>())!;
        Assert.False(preview.Valid);
        Assert.Contains(preview.Issues, issue => issue.Code == code);
        Assert.Contains("TABLE facturas;", preview.Context, StringComparison.Ordinal);
        using var sent = await client.PostAsJsonAsync("/api/ai/chat", request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, sent.StatusCode);
        Assert.Equal(0, provider.StreamCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CambiarElContenidoOLosLimitesInvalidaUnaVistaPrevia(bool changeLimits)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        var request = new AiChatDto(id, [new("user", "Original")], null, "gpt-6.1-sol", "schema");
        using var response = await client.PostAsJsonAsync("/api/ai/chat/preview", request);
        var preview = (await response.Content.ReadFromJsonAsync<AiChatPreview>())!;
        if (changeLimits)
        {
            host.Services.GetRequiredService<IConfiguration>()["AiChat:Defaults:MaxSqlBytes"] = "1000";
        }
        else
        {
            request = request with { Messages = [new("user", "Modificada")] };
        }
        using var sent = await client.PostAsJsonAsync("/api/ai/chat", request with { PreviewHash = preview.Hash });
        Assert.Equal(HttpStatusCode.Conflict, sent.StatusCode);
        Assert.Equal(0, provider.StreamCalls);
    }

    [Fact]
    public async Task LaPoliticaDelPerfilRespetaElLimiteUtf8ExactoYDeclaraSuCapacidad()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        var configuration = host.Services.GetRequiredService<IConfiguration>();
        const string sql = "SELECT 'á😀';";
        configuration["AiChat:Defaults:MaxSqlBytes"] = "1";
        configuration[$"AiChat:Providers:{id}:MaxSqlBytes"] = Encoding.UTF8.GetByteCount(sql).ToString(System.Globalization.CultureInfo.InvariantCulture);
        configuration[$"AiChat:Providers:{id}:CapacityKnown"] = "true";
        var context = new AiContextDto(new AiSourceDto("c1", "Pruebas", "ventas", "sqlite"), sql, null, []);
        var request = new AiChatDto(id, [new("user", "Pregunta")], context, "gpt-6.1-sol", "schema");
        using var response = await client.PostAsJsonAsync("/api/ai/chat/preview", request);
        var preview = (await response.Content.ReadFromJsonAsync<AiChatPreview>())!;
        Assert.True(preview.Valid);
        Assert.True(preview.Limits.CapacityKnown);
        Assert.Equal(preview.Limits.MaxSqlBytes, preview.Usage.SqlBytes);
        using var exceeded = await client.PostAsJsonAsync("/api/ai/chat", request with { Context = context with { Sql = sql + "+" } });
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, exceeded.StatusCode);
        Assert.Equal(0, provider.StreamCalls);
    }

    [Fact]
    public async Task LosLimitesDeSeccionSeAplicanAlContextoPermitido()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "nothing");
        host.Services.GetRequiredService<IConfiguration>()["AiChat:Defaults:MaxSqlBytes"] = "1";
        using var response = await client.PostAsJsonAsync("/api/ai/chat/preview", new AiChatDto(id, [new("user", "Pregunta")],
            new AiContextDto(new AiSourceDto("c1", "Pruebas", "ventas", "sqlite"), "SQL no autorizado", null, []), "gpt-6.1-sol", "nothing"));
        var preview = (await response.Content.ReadFromJsonAsync<AiChatPreview>())!;
        Assert.True(preview.Valid);
        Assert.Equal(0, preview.Usage.SqlBytes);
        Assert.Empty(preview.Context);
        Assert.DoesNotContain(preview.Messages, message => message.Text.Contains("SQL no autorizado", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("schema", true)]
    [InlineData("schemaAndRows", true)]
    [InlineData("nothing", false)]
    public async Task ElErrorSeRevisaConSuProcedenciaYSeFiltraTambienEnElHistorial(string disclosure, bool allowed)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, disclosure);
        var error = new AiExecutionErrorDto("ejecucion-original", "2026-10-16T13:20:00Z",
            "SELECT columna_inexistente FROM facturas;\nALTER USER demo PASSWORD 'claveSql';",
            "No existe columna_inexistente\nServer=servidorPrivado;Database=ventas;Password=claveDsn;\n" +
            "postgresql://usuarioUri:claveUri@hostPrivado/ventas\n" +
            "jdbc:oracle:thin:usuarioJdbc/claveJdbc@hostPrivado:1521/base\n" +
            "host=hostLibpq dbname=ventas user=usuarioLibpq password=claveLibpq\n" +
            "Authorization: Bearer tokenPortador\n\"password\": \"claveJson\"\n" +
            "Pwd='clave con espacios'; api_key=claveApi; uid=usuarioUid;", "42703", 1, 8);
        var context = new AiContextDto(new("c1", "Pruebas", "ventas", "postgresql"), null, null, [], ExecutionError: error);
        var request = new AiChatDto(id, [new("user", "Anterior", context), new("assistant", "Respuesta"), new("user", "Explica este fallo")],
            context, "gpt-6.1-sol", disclosure);
        using var prepared = await client.PostAsJsonAsync("/api/ai/chat/preview", request);
        prepared.EnsureSuccessStatusCode();
        var preview = (await prepared.Content.ReadFromJsonAsync<AiChatPreview>())!;
        Assert.True(preview.Valid);
        Assert.Equal(0, provider.StreamCalls);
        Assert.Equal(allowed, preview.Usage.ErrorBytes > 0);
        foreach (var message in preview.Messages)
        {
            foreach (var secret in new[] { "claveSql", "servidorPrivado", "claveDsn", "usuarioUri", "claveUri", "hostPrivado",
                "usuarioJdbc", "claveJdbc", "hostLibpq", "usuarioLibpq", "claveLibpq", "tokenPortador", "claveJson", "clave con espacios", "claveApi", "usuarioUid" })
            {
                Assert.DoesNotContain(secret, message.Text, StringComparison.Ordinal);
            }
        }
        if (allowed)
        {
            Assert.Contains("ejecucion-original", preview.Context, StringComparison.Ordinal);
            Assert.Contains("2026-10-16T13:20:00Z", preview.Context, StringComparison.Ordinal);
            Assert.Contains("SELECT columna_inexistente FROM facturas;", preview.Context, StringComparison.Ordinal);
            Assert.Contains("Código: 42703", preview.Context, StringComparison.Ordinal);
            Assert.Contains("Línea: 1", preview.Context, StringComparison.Ordinal);
            Assert.Contains("Posición: 8", preview.Context, StringComparison.Ordinal);
            Assert.Contains("[oculto]", preview.Context, StringComparison.Ordinal);
            Assert.Contains("ejecucion-original", preview.Messages[1].Text, StringComparison.Ordinal);
        }
        else
        {
            Assert.Empty(preview.Context);
            Assert.DoesNotContain(preview.Messages, message => message.Text.Contains("ejecucion-original", StringComparison.Ordinal));
        }
        using var response = await client.PostAsJsonAsync("/api/ai/chat", request with { PreviewHash = preview.Hash });
        response.EnsureSuccessStatusCode();
        Assert.Equal(preview.Messages.Select(message => message.Text), provider.LastRequest.Messages.Select(message => message.Text));
        using var changed = await client.PostAsJsonAsync("/api/ai/chat", request with {
            PreviewHash = preview.Hash, Context = context with { ExecutionError = error with { Sql = "SELECT otra;" } } });
        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal(1, provider.StreamCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ElLimiteDeErroresBloqueaTambienUnAdjuntoHistoricoSinInvocarAlProveedor(bool historical)
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        var id = await SaveProfile(client, "schema");
        host.Services.GetRequiredService<IConfiguration>()["AiChat:Defaults:MaxErrorBytes"] = "100";
        var context = new AiContextDto(new("c1", "Pruebas", "ventas", "sqlite"), null, null, [],
            ExecutionError: new("e1", "2026-10-16T00:00:00Z", "SELECT " + new string('a', 500), "No existe la columna"));
        var request = new AiChatDto(id, historical
            ? [new("user", "Anterior", context), new("assistant", "Respuesta"), new("user", "Actual")]
            : [new("user", "Actual")], historical ? null : context, "gpt-6.1-sol", "schema");
        using var prepared = await client.PostAsJsonAsync("/api/ai/chat/preview", request);
        prepared.EnsureSuccessStatusCode();
        var preview = (await prepared.Content.ReadFromJsonAsync<AiChatPreview>())!;
        Assert.False(preview.Valid);
        Assert.Contains(preview.Issues, issue => issue.Code == "error");
        Assert.Contains(new string('a', 500), preview.Messages[1].Text, StringComparison.Ordinal);
        using var response = await client.PostAsJsonAsync("/api/ai/chat", request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal(0, provider.StreamCalls);
    }

    private static async Task<Guid> SaveProfile(HttpClient client, string disclosure)
    {
        using var saved = await client.PostAsJsonAsync("/api/ai/providers", new
        {
            name = "Prueba de contexto", kind = "localcli", command = "codex", model = "gpt-6.1-sol",
            baseUrl = "", disclosure, ownSession = false, isDefault = false,
        });
        saved.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await saved.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("provider").GetProperty("id").GetGuid();
    }

    private static Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> WithProvider(DruseApiFactory root, TestProvider provider) =>
        root.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IAiProvider>();
            services.AddSingleton<IAiProvider>(provider);
        }));

    private static HttpClient Client(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Druse-Token", host.Services.GetRequiredService<LocalApiEndpoint>().Token);
        return client;
    }

    private sealed class TestProvider : IAiProvider
    {
        public AiProviderKind Kind => AiProviderKind.LocalCli;
        public int ProbeCalls { get; private set; }
        public int StreamCalls { get; private set; }
        public AiRequest LastRequest { get; private set; }
        public Exception? Failure { get; init; }
        public bool WaitForCancellation { get; init; }
        public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken)
        {
            ProbeCalls++;
            return Task.FromResult(new AiProbe(true, "Instalado y con sesión; catálogo disponible.", 1));
        }

        public Task<IReadOnlyList<string>> ListModelsAsync(AiRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>(["gpt-6.1-sol"]);

        public async IAsyncEnumerable<AiChunk> StreamAsync(AiRequest request, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            LastRequest = request;
            StreamCalls++;
            if (Failure is not null)
            {
                throw Failure;
            }
            yield return new AiChunk("OK");
            if (WaitForCancellation)
            {
                try
                {
                    await Task.Delay(Timeout.Infinite, cancellationToken);
                }
                finally
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        Cancelled.TrySetResult();
                    }
                }
            }
        }
    }
}
