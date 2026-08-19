using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Varias tablas en una pasada, por HTTP y contra un motor de verdad.
///
/// Lo que se comprueba aquí es justo lo que no se puede comprobar sin servidor:
/// que el orden **sirve para algo**. Que la lista salga ordenada se prueba sin
/// motor en `TransferOrderTests`; que copiar en ese orden no lo rechace la clave
/// foránea, y que copiarlo en el otro sí, solo lo dice PostgreSQL.
/// </summary>
public sealed class TransferSetFlowTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    /// <summary>
    /// La padre entra antes que la hija aunque se pidan al revés.
    ///
    /// Es el caso corriente: quien elige tablas en una lista las marca en el orden
    /// en que las ve, no en el que el motor las admite.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task CopiaLaPadreAntesQueLaHijaAunqueSePidanAlReves()
    {
        var (client, sessionId) = await ConnectAsync();
        var tablas = new Tablas();

        try
        {
            await SembrarAsync(client, sessionId, tablas);

            var progress = await TransferAsync(client, new SetBody
            {
                Tables =
                [
                    Request(sessionId, tablas.OrigenHija, tablas.DestinoHija),
                    Request(sessionId, tablas.OrigenPadre, tablas.DestinoPadre),
                ],
            });

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(2, progress.GetProperty("tablesDone").GetInt32());
            Assert.Equal(2, progress.GetProperty("tablesTotal").GetInt32());

            // Cinco filas en total, y el segundo nivel del progreso cuenta solo las
            // de la última tabla.
            Assert.Equal(5, progress.GetProperty("rowsCopied").GetInt64());
            Assert.Equal(3, progress.GetProperty("tableRowsCopied").GetInt64());

            Assert.Equal(2, await ContarAsync(client, sessionId, tablas.DestinoPadre));
            Assert.Equal(3, await ContarAsync(client, sessionId, tablas.DestinoHija));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, tablas);
        }
    }

    /// <summary>
    /// Sin ordenar, el motor rechaza la hija. Es lo que demuestra que ordenar sirve.
    ///
    /// Se puede pedir a propósito —cuando el destino no tiene las foráneas, o
    /// cuando quien migra sabe algo que el catálogo no dice— y entonces esto es
    /// exactamente lo que pasa.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task SinOrdenarLaHijaLlegaAntesDeTiempoYElMotorLaRechaza()
    {
        var (client, sessionId) = await ConnectAsync();
        var tablas = new Tablas();

        try
        {
            await SembrarAsync(client, sessionId, tablas);

            var progress = await TransferAsync(client, new SetBody
            {
                Ordered = false,
                Tables =
                [
                    Request(sessionId, tablas.OrigenHija, tablas.DestinoHija),
                    Request(sessionId, tablas.OrigenPadre, tablas.DestinoPadre),
                ],
            });

            Assert.Equal("Failed", progress.GetProperty("outcome").GetString());
            Assert.Equal(0, progress.GetProperty("tablesDone").GetInt32());

            // Y el destino se queda vacío: la pasada se paró en la primera.
            Assert.Equal(0, await ContarAsync(client, sessionId, tablas.DestinoHija));
            Assert.Equal(0, await ContarAsync(client, sessionId, tablas.DestinoPadre));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, tablas);
        }
    }

    /// <summary>
    /// «Vaciar y cargar» borra de la hija hacia la padre, que es al revés que copiar.
    ///
    /// Una tabla no se deja vaciar mientras otra guarde filas que la apuntan, así
    /// que el vaciado de la pasada entera va antes y en el orden contrario. Sin
    /// eso, este caso —dos tablas relacionadas que se reemplazan— falla siempre.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task VaciarYCargarBorraDeLaHijaHaciaLaPadre()
    {
        var (client, sessionId) = await ConnectAsync();
        var tablas = new Tablas();

        try
        {
            await SembrarAsync(client, sessionId, tablas);

            // El destino ya tiene datos, y los suyos también están relacionados.
            await RunAsync(client, sessionId, $"INSERT INTO {tablas.DestinoPadre} VALUES (9, 'vieja')");
            await RunAsync(client, sessionId, $"INSERT INTO {tablas.DestinoHija} VALUES (99, 9)");

            var progress = await TransferAsync(client, new SetBody
            {
                Tables =
                [
                    Reemplazo(Request(sessionId, tablas.OrigenPadre, tablas.DestinoPadre)),
                    Reemplazo(Request(sessionId, tablas.OrigenHija, tablas.DestinoHija)),
                ],
            });

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());

            // Lo viejo no está, y lo nuevo entró entero.
            Assert.Equal(2, await ContarAsync(client, sessionId, tablas.DestinoPadre));
            Assert.Equal(3, await ContarAsync(client, sessionId, tablas.DestinoHija));
            Assert.Equal(
                0,
                await ContarAsync(client, sessionId, $"{tablas.DestinoPadre} WHERE id = 9"));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, tablas);
        }
    }

    /// <summary>
    /// La pasada se para en la tabla que falla, y lo que ya entró se queda.
    ///
    /// Es la decisión de la fase 4: «todo o nada» sigue siendo por tabla. Lo que el
    /// resumen tiene que decir es cuántas pasaron completas, porque de ahí sale por
    /// dónde se retoma.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task LaPasadaSeParaEnLaTablaQueFallaYDiceCuantasEntraron()
    {
        var (client, sessionId) = await ConnectAsync();
        var buena = Nombre();
        var mala = Nombre();
        var destinoBueno = Nombre();
        var destinoMalo = Nombre();

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {buena} (id int, nombre text)");
            await RunAsync(client, sessionId, $"CREATE TABLE {destinoBueno} (id int, nombre text)");
            await RunAsync(client, sessionId, $"INSERT INTO {buena} VALUES (1, 'Ana'), (2, 'Bea')");

            // La segunda trae un nombre vacío para una columna que no lo admite.
            await RunAsync(client, sessionId, $"CREATE TABLE {mala} (id int, nombre text)");
            await RunAsync(client, sessionId, $"CREATE TABLE {destinoMalo} (id int, nombre text NOT NULL)");
            await RunAsync(client, sessionId, $"INSERT INTO {mala} VALUES (1, NULL)");

            var progress = await TransferAsync(client, new SetBody
            {
                Tables =
                [
                    Request(sessionId, buena, destinoBueno),
                    Request(sessionId, mala, destinoMalo),
                ],
            });

            Assert.Equal("Failed", progress.GetProperty("outcome").GetString());
            Assert.Equal(1, progress.GetProperty("tablesDone").GetInt32());
            Assert.Equal(2, progress.GetProperty("rowsCopied").GetInt64());

            // Lo de la primera tabla sigue en el destino: el resumen no miente.
            Assert.Equal(2, await ContarAsync(client, sessionId, destinoBueno));
            Assert.Equal(0, await ContarAsync(client, sessionId, destinoMalo));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, buena, mala, destinoBueno, destinoMalo);
        }
    }

    /// <summary>
    /// El orden se puede preguntar antes de confirmar nada.
    ///
    /// Quien va a mover doce tablas quiere ver en qué orden van **en la vista
    /// previa**, no enterarse por el aviso de un traslado que ya empezó.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ElOrdenSePreguntaAntesDeConfirmarNada()
    {
        var (client, sessionId) = await ConnectAsync();
        var tablas = new Tablas();

        try
        {
            await SembrarAsync(client, sessionId, tablas);

            var order = await OrderAsync(client, new SetBody
            {
                Tables =
                [
                    Request(sessionId, tablas.OrigenHija, tablas.DestinoHija),
                    Request(sessionId, tablas.OrigenPadre, tablas.DestinoPadre),
                ],
            });

            var nombres = order.GetProperty("tables").EnumerateArray()
                .Select(table => table.GetString())
                .ToList();

            Assert.Equal([$"public.{tablas.DestinoPadre}", $"public.{tablas.DestinoHija}"], nombres);
            Assert.Empty(order.GetProperty("cycles").EnumerateArray());

            // Y preguntar no escribe: el destino sigue vacío.
            Assert.Equal(0, await ContarAsync(client, sessionId, tablas.DestinoPadre));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, tablas);
        }
    }

    /// <summary>
    /// Dos tablas que se apuntan la una a la otra se dicen, no se ordenan.
    ///
    /// Con un ciclo no hay orden que las satisfaga a la vez, y elegir uno callando
    /// sería fingir que sí.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ElCicloSeDiceEnLugarDeInventarUnOrden()
    {
        var (client, sessionId) = await ConnectAsync();
        var una = Nombre();
        var otra = Nombre();

        try
        {
            await RunAsync(client, sessionId, $"CREATE TABLE {una} (id int PRIMARY KEY, otra_id int)");
            await RunAsync(client, sessionId, $"CREATE TABLE {otra} (id int PRIMARY KEY, una_id int)");
            await RunAsync(
                client,
                sessionId,
                $"ALTER TABLE {una} ADD CONSTRAINT fk_una FOREIGN KEY (otra_id) REFERENCES {otra} (id)");
            await RunAsync(
                client,
                sessionId,
                $"ALTER TABLE {otra} ADD CONSTRAINT fk_otra FOREIGN KEY (una_id) REFERENCES {una} (id)");

            var order = await OrderAsync(client, new SetBody
            {
                Tables =
                [
                    Request(sessionId, una, una),
                    Request(sessionId, otra, otra),
                ],
            });

            var ciclos = order.GetProperty("cycles").EnumerateArray()
                .Select(table => table.GetString())
                .ToList();

            Assert.Equal([$"public.{una}", $"public.{otra}"], ciclos);

            // Y aun así salen las dos: avisar no es negarse a copiarlas.
            Assert.Equal(2, order.GetProperty("tables").GetArrayLength());
        }
        finally
        {
            await LimpiarAsync(client, sessionId, una, otra);
        }
    }

    // -----------------------------------------------------------------------
    // Andamiaje
    // -----------------------------------------------------------------------

    /// <summary>Las cuatro tablas del caso: dos de origen y dos de destino con su foránea.</summary>
    private sealed record Tablas
    {
        public string OrigenPadre { get; } = Nombre();

        public string OrigenHija { get; } = Nombre();

        public string DestinoPadre { get; } = Nombre();

        public string DestinoHija { get; } = Nombre();

        public string[] Todas => [OrigenHija, OrigenPadre, DestinoHija, DestinoPadre];
    }

    /// <summary>
    /// Dos clientes y tres pedidos suyos, y en el destino la misma forma **con la
    /// foránea puesta**, que es lo que obliga a ordenar.
    /// </summary>
    private static async Task SembrarAsync(HttpClient client, Guid sessionId, Tablas tablas)
    {
        await RunAsync(client, sessionId, $"CREATE TABLE {tablas.OrigenPadre} (id int PRIMARY KEY, nombre text)");
        await RunAsync(client, sessionId, $"CREATE TABLE {tablas.OrigenHija} (id int PRIMARY KEY, padre_id int)");
        await RunAsync(client, sessionId, $"CREATE TABLE {tablas.DestinoPadre} (id int PRIMARY KEY, nombre text)");
        await RunAsync(
            client,
            sessionId,
            $"""
            CREATE TABLE {tablas.DestinoHija} (
                id int PRIMARY KEY,
                padre_id int REFERENCES {tablas.DestinoPadre} (id))
            """);

        await RunAsync(client, sessionId, $"INSERT INTO {tablas.OrigenPadre} VALUES (1, 'Ana'), (2, 'Bea')");
        await RunAsync(client, sessionId, $"INSERT INTO {tablas.OrigenHija} VALUES (10, 1), (11, 1), (12, 2)");
    }

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

        public string Mode { get; init; } = "Insert";

        public bool Confirmed { get; init; } = true;

        public string? ReplaceConfirmation { get; init; }
    }

    private sealed record SetBody
    {
        public IReadOnlyList<TransferBody> Tables { get; init; } = [];

        public bool Ordered { get; init; } = true;
    }

    private static TransferBody Request(Guid sessionId, string origen, string destino) => new()
    {
        SourceSessionId = sessionId,
        Source = Table(origen),
        TargetSessionId = sessionId,
        Target = Table(destino),
    };

    private static TransferBody Reemplazo(TransferBody request) => request with
    {
        Mode = "Replace",
        ReplaceConfirmation = request.Target.Name,
    };

    private static TableBody Table(string name) => new()
    {
        Id = $"Table:public.{name}",
        Name = name,
        Database = TestDatabase.Database,
        Schema = "public",
    };

    private static string Nombre() => $"druse_ts_{Guid.NewGuid():N}";

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync()
    {
        var client = _factory.CreateAuthenticatedClient();

        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest(readOnly: false));
        response.EnsureSuccessStatusCode();

        return (client, (await response.ReadJsonAsync()).GetProperty("sessionId").GetGuid());
    }

    /// <summary>Lanza la pasada y espera a que termine.</summary>
    private static async Task<JsonElement> TransferAsync(HttpClient client, SetBody request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers/set", request);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

        return await WaitAsync(client, (await response.ReadJsonAsync()).GetProperty("id").GetGuid());
    }

    private static async Task<JsonElement> OrderAsync(HttpClient client, SetBody request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers/set/order", request);

        response.EnsureSuccessStatusCode();

        return await response.ReadJsonAsync();
    }

    /// <summary>
    /// Pregunta por el estado hasta que deja de estar en marcha, con un tope.
    ///
    /// Si algo se cuelga, la prueba tiene que fallar diciendo que se colgó, no
    /// quedarse esperando para siempre.
    /// </summary>
    private static async Task<JsonElement> WaitAsync(HttpClient client, Guid id)
    {
        for (var intento = 0; intento < 400; intento++)
        {
            var response = await client.GetAsync($"/api/transfers/{id}/status");

            response.EnsureSuccessStatusCode();

            var body = await response.ReadJsonAsync();

            if (body.GetProperty("outcome").GetString() != "Running")
            {
                return body;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException($"La pasada {id} no terminó en veinte segundos.");
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

    private static async Task<int> ContarAsync(HttpClient client, Guid sessionId, string tabla)
    {
        var response = await client.PostAsJsonAsync("/api/queries", new
        {
            sessionId,
            executionId = Guid.NewGuid(),
            sql = $"SELECT COUNT(*) FROM {tabla}",
            maxRows = 10,
            timeoutSeconds = 30,
        });

        response.EnsureSuccessStatusCode();

        var body = await response.ReadJsonAsync();

        return int.Parse(
            body.GetProperty("resultSets")[0].GetProperty("rows")[0][0].GetString() ?? "0",
            CultureInfo.InvariantCulture);
    }

    private static async Task LimpiarAsync(HttpClient client, Guid sessionId, Tablas tablas) =>
        await LimpiarAsync(client, sessionId, tablas.Todas);

    private static async Task LimpiarAsync(HttpClient client, Guid sessionId, params string[] tablas)
    {
        foreach (var tabla in tablas)
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla} CASCADE");
        }

        client.Dispose();
    }
}
