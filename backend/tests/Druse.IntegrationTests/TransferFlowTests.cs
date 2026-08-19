using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Druse.IntegrationTests;

/// <summary>
/// Trasladar datos de una tabla a otra, por HTTP y contra un motor de verdad.
///
/// Lo que se comprueba aquí no se puede comprobar sin servidor: que las filas
/// **llegan** al otro lado, que llegan una sola vez, que la vista previa no
/// escribe y que vaciar-y-cargar vacía antes de cargar. Un traslado que se
/// equivoque en esto no da un error: deja el destino con datos de más o de menos,
/// y eso solo se ve contándolos.
/// </summary>
public sealed class TransferFlowTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    // -----------------------------------------------------------------------
    // Lo que copia
    // -----------------------------------------------------------------------

    /// <summary>El caso de todos los días: la tabla entera a otra tabla.</summary>
    [RequiresPostgreSqlFact]
    public async Task TrasladaLasFilasDeUnaTablaAOtra()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 3);
            await RunAsync(client, sessionId, $"CREATE TABLE {destino} (id int, nombre text, saldo numeric(10,2))");

            var progress = await TransferAsync(client, Request(sessionId, origen, destino));

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(3, progress.GetProperty("rowsCopied").GetInt64());
            Assert.Equal(3, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// De un esquema a otro dentro de la misma conexión.
    ///
    /// Es el caso que obliga a leer por una conexión y escribir por otra: ningún
    /// motor de estos admite un lector abierto y un `INSERT` a la vez por el
    /// mismo cable, así que sin esa segunda conexión esto se quedaría colgado.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task TrasladaEntreDosEsquemasDeLaMismaConexion()
    {
        var (client, sessionId) = await ConnectAsync();
        var esquema = $"druse_esq_{Guid.NewGuid():N}";
        var origen = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 2);
            await RunAsync(client, sessionId, $"CREATE SCHEMA {esquema}");
            await RunAsync(
                client,
                sessionId,
                $"CREATE TABLE {esquema}.{origen} (id int, nombre text, saldo numeric(10,2))");

            var request = Request(sessionId, origen, origen);
            request = request with { Target = request.Target with { Schema = esquema } };

            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(2, await ContarAsync(client, sessionId, $"{esquema}.{origen}"));
        }
        finally
        {
            await RunAsync(client, sessionId, $"DROP SCHEMA IF EXISTS {esquema} CASCADE");
            await LimpiarAsync(client, sessionId, origen);
        }
    }

    /// <summary>
    /// De una conexión a otra: es el caso de dev a prod.
    ///
    /// Aquí las dos apuntan al mismo servidor porque lo que se comprueba es que el
    /// traslado sabe manejar **dos sesiones**, no que sepa cruzar la red.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task TrasladaDeUnaConexionAOtra()
    {
        var (client, origenSession) = await ConnectAsync();
        var (_, destinoSession) = await ConnectAsync(client);
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, origenSession, origen, filas: 4);
            await RunAsync(client, destinoSession, $"CREATE TABLE {destino} (id int, nombre text, saldo numeric(10,2))");

            var request = Request(origenSession, origen, destino) with
            {
                TargetSessionId = destinoSession,
            };

            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(4, await ContarAsync(client, destinoSession, destino));
        }
        finally
        {
            await LimpiarAsync(client, origenSession, origen, destino);
        }
    }

    /// <summary>Con condición se lleva solo lo que la cumple.</summary>
    [RequiresPostgreSqlFact]
    public async Task ElFiltroLimitaLasFilasQueViajan()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 5);
            await RunAsync(client, sessionId, $"CREATE TABLE {destino} (id int, nombre text, saldo numeric(10,2))");

            var request = Request(sessionId, origen, destino) with
            {
                Filter = new FilterBody { Where = "id <= 2" },
            };

            var progress = await TransferAsync(client, request);

            Assert.Equal(2, progress.GetProperty("rowsCopied").GetInt64());
            Assert.Equal(2, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>Columnas con otro nombre al otro lado: para eso está el mapeo.</summary>
    [RequiresPostgreSqlFact]
    public async Task LasColumnasPuedenLlamarseDistintoAlOtroLado()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 2);
            await RunAsync(client, sessionId, $"CREATE TABLE {destino} (clave int, titulo text)");

            var request = Request(sessionId, origen, destino) with
            {
                Mappings =
                [
                    new MappingBody { Source = "id", Target = "clave" },
                    new MappingBody { Source = "nombre", Target = "titulo" },
                    new MappingBody { Source = "saldo", Target = null },
                ],
            };

            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());

            var nombres = await LeerAsync(client, sessionId, $"SELECT titulo FROM {destino} ORDER BY clave");

            Assert.Equal(["fila 1", "fila 2"], nombres);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// Un lote pequeño copia lo mismo que uno grande.
    ///
    /// Es la prueba de que el troceado no pierde ni repite filas en los bordes,
    /// que es justo donde fallaría: con 5 filas y lotes de 2, el último lote va
    /// incompleto.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ElTroceadoEnLotesNoPierdeNiRepiteFilas()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 5);
            await RunAsync(client, sessionId, $"CREATE TABLE {destino} (id int, nombre text, saldo numeric(10,2))");

            var progress = await TransferAsync(
                client,
                Request(sessionId, origen, destino) with { BatchSize = 2 });

            Assert.Equal(5, progress.GetProperty("rowsCopied").GetInt64());
            Assert.Equal(3, progress.GetProperty("batchesDone").GetInt32());
            Assert.Equal(5, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>Vaciar y cargar deja el destino con las filas del origen y nada más.</summary>
    [RequiresPostgreSqlFact]
    public async Task VaciarYCargarDejaSoloLoDelOrigen()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 2);
            await CrearAsync(client, sessionId, destino, filas: 7);

            var request = Request(sessionId, origen, destino) with
            {
                Mode = "Replace",
                ReplaceConfirmation = destino,
            };

            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(2, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// «Todo o nada» confirma una sola vez al final.
    ///
    /// Lo que se comprueba es que la transacción que abarca todos los lotes se
    /// confirma de verdad: si se quedara sin confirmar, el destino acabaría vacío
    /// y el traslado diría que fue bien.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task TodoONadaConfirmaAlFinal()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 4);
            await RunAsync(client, sessionId, $"CREATE TABLE {destino} (id int, nombre text, saldo numeric(10,2))");

            var progress = await TransferAsync(
                client,
                Request(sessionId, origen, destino) with { Atomic = true, BatchSize = 2 });

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(4, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    // -----------------------------------------------------------------------
    // Lo que ya está en el destino
    // -----------------------------------------------------------------------

    /// <summary>
    /// Actualizar lo que ya está: la fila cambia y la nueva entra.
    ///
    /// Es el modo que hace repetible un traslado, y lo que se comprueba es que no
    /// duplica: cuatro filas antes, cuatro después.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task ActualizarLoQueYaEstaCambiaSinDuplicar()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearConClaveAsync(client, sessionId, origen, filas: 4);
            await CrearConClaveAsync(client, sessionId, destino, filas: 2);

            // Las dos primeras filas del origen ya están en el destino, pero con
            // otro nombre: es lo que tiene que quedar reescrito.
            await RunAsync(client, sessionId, $"UPDATE {destino} SET nombre = 'viejo'");

            var progress = await TransferAsync(
                client,
                Request(sessionId, origen, destino) with { Mode = "Upsert" });

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(4, progress.GetProperty("rowsCopied").GetInt64());
            Assert.Equal(4, await ContarAsync(client, sessionId, destino));

            var nombres = await LeerAsync(client, sessionId, $"SELECT nombre FROM {destino} ORDER BY id");

            Assert.Equal(["fila 1", "fila 2", "fila 3", "fila 4"], nombres);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// Omitir lo que ya está: entra lo que falta y lo demás se cuenta aparte.
    ///
    /// El recuento de saltadas es la mitad del valor del modo: sin él, «entraron
    /// 2 de 4» parece que se perdieron dos filas por el camino.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task OmitirLoQueYaEstaCuentaLasQueSeSaltan()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearConClaveAsync(client, sessionId, origen, filas: 4);
            await CrearConClaveAsync(client, sessionId, destino, filas: 2);
            await RunAsync(client, sessionId, $"UPDATE {destino} SET nombre = 'viejo'");

            var progress = await TransferAsync(
                client,
                Request(sessionId, origen, destino) with { Mode = "SkipExisting" });

            Assert.Equal(2, progress.GetProperty("rowsCopied").GetInt64());
            Assert.Equal(2, progress.GetProperty("rowsSkipped").GetInt64());
            Assert.Equal(4, await ContarAsync(client, sessionId, destino));

            // Y lo que ya estaba **no se tocó**, que es lo que distingue este modo.
            var nombres = await LeerAsync(client, sessionId, $"SELECT nombre FROM {destino} ORDER BY id");

            Assert.Equal(["viejo", "viejo", "fila 3", "fila 4"], nombres);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// Repetir el mismo traslado no cambia nada la segunda vez.
    ///
    /// Es la propiedad que permite reanudar una copia que se cortó sin mirar por
    /// dónde iba.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task RepetirUnTrasladoQueActualizaEsInofensivo()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearConClaveAsync(client, sessionId, origen, filas: 3);
            await CrearConClaveAsync(client, sessionId, destino, filas: 0);

            var request = Request(sessionId, origen, destino) with { Mode = "Upsert" };

            await TransferAsync(client, request);
            await TransferAsync(client, request);

            Assert.Equal(3, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// Se puede reconocer la fila por otras columnas, no solo por la clave
    /// primaria.
    ///
    /// Es lo que se quiere al sincronizar dos entornos por una clave de negocio:
    /// los identificadores los generó cada base por su cuenta y no coinciden.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task SePuedeReconocerLaFilaPorUnaClaveDeNegocio()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            foreach (var tabla in new[] { origen, destino })
            {
                await RunAsync(
                    client,
                    sessionId,
                    $"CREATE TABLE {tabla} (id serial PRIMARY KEY, codigo text UNIQUE, nombre text)");
            }

            await RunAsync(client, sessionId, $"INSERT INTO {origen} (codigo, nombre) VALUES ('A', 'Ana'), ('B', 'Bea')");
            await RunAsync(client, sessionId, $"INSERT INTO {destino} (codigo, nombre) VALUES ('A', 'vieja')");

            var request = Request(sessionId, origen, destino) with
            {
                Mode = "Upsert",
                KeyColumns = ["codigo"],
                // El identificador no viaja: lo genera cada base por su cuenta.
                Mappings =
                [
                    new MappingBody { Source = "id", Target = null },
                    new MappingBody { Source = "codigo", Target = "codigo" },
                    new MappingBody { Source = "nombre", Target = "nombre" },
                ],
            };

            var progress = await TransferAsync(client, request);

            Assert.Equal("Completed", progress.GetProperty("outcome").GetString());
            Assert.Equal(2, await ContarAsync(client, sessionId, destino));

            var nombres = await LeerAsync(client, sessionId, $"SELECT nombre FROM {destino} ORDER BY codigo");

            Assert.Equal(["Ana", "Bea"], nombres);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>
    /// Reconocer la fila por columnas que se pueden repetir se rechaza.
    ///
    /// Sin unicidad, «actualiza la que ya está» toca todas las que coinciden: no
    /// falla, no avisa, y deja el destino con filas que nadie pidió cambiar.
    /// </summary>
    [RequiresPostgreSqlFact]
    public async Task UnaClaveQueSePuedeRepetirSeRechaza()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();

        try
        {
            await CrearConClaveAsync(client, sessionId, origen, filas: 1);

            var request = Request(sessionId, origen, origen) with
            {
                Mode = "Upsert",
                KeyColumns = ["nombre"],
            };

            var response = await client.PostAsJsonAsync("/api/transfers/preview", request);

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();

            Assert.Contains(
                "no hay nada que garantice",
                body.GetProperty("message").GetString()!,
                StringComparison.Ordinal);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen);
        }
    }

    /// <summary>Sin clave primaria y sin columnas elegidas, no hay nada que reconocer.</summary>
    [RequiresPostgreSqlFact]
    public async Task SinClavePrimariaNoSePuedeActualizarLoQueYaEsta()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();

        try
        {
            // Sin clave: es la tabla que crea `CrearAsync`.
            await CrearAsync(client, sessionId, origen, filas: 1);

            var response = await client.PostAsJsonAsync(
                "/api/transfers/preview",
                Request(sessionId, origen, origen) with { Mode = "Upsert" });

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();

            Assert.Equal("noprimarykey", body.GetProperty("reason").GetString());
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen);
        }
    }

    // -----------------------------------------------------------------------
    // Lo que no hace
    // -----------------------------------------------------------------------

    /// <summary>La vista previa dice lo que pasaría sin que pase nada.</summary>
    [RequiresPostgreSqlFact]
    public async Task LaVistaPreviaNoEscribeNada()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();
        var destino = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 3);
            await RunAsync(client, sessionId, $"CREATE TABLE {destino} (id int, nombre text, saldo numeric(10,2))");

            var response = await client.PostAsJsonAsync(
                "/api/transfers/preview",
                Request(sessionId, origen, destino));

            response.EnsureSuccessStatusCode();

            var body = await response.ReadJsonAsync();

            Assert.Equal(3, body.GetProperty("mappings").GetArrayLength());
            Assert.Contains("SELECT", body.GetProperty("select").GetString()!, StringComparison.Ordinal);
            Assert.NotEmpty(body.GetProperty("statements").EnumerateArray());

            // Y el destino sigue vacío.
            Assert.Equal(0, await ContarAsync(client, sessionId, destino));
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen, destino);
        }
    }

    /// <summary>Una conexión de solo lectura no recibe filas por esta puerta tampoco.</summary>
    [RequiresPostgreSqlFact]
    public async Task UnDestinoDeSoloLecturaSeRechaza()
    {
        var client = _factory.CreateAuthenticatedClient();
        var origenSession = await OpenAsync(client, readOnly: false);
        var destinoSession = await OpenAsync(client, readOnly: true);
        var origen = Nombre();

        try
        {
            await CrearAsync(client, origenSession, origen, filas: 1);

            var request = Request(origenSession, origen, origen) with
            {
                TargetSessionId = destinoSession,
            };

            var response = await client.PostAsJsonAsync("/api/transfers/preview", request);

            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);

            var body = await response.ReadJsonAsync();

            Assert.Equal("readonlyconnection", body.GetProperty("reason").GetString());
        }
        finally
        {
            await LimpiarAsync(client, origenSession, origen);
        }
    }

    /// <summary>Vaciar sin escribir el nombre de la tabla no se admite.</summary>
    [RequiresPostgreSqlFact]
    public async Task VaciarSinEscribirElNombreSeRechaza()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 1);

            var request = Request(sessionId, origen, origen) with { Mode = "Replace" };

            var response = await client.PostAsJsonAsync("/api/transfers", request);

            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);

            var progress = await WaitAsync(client, (await response.ReadJsonAsync()).GetProperty("id").GetGuid());

            Assert.Equal("Failed", progress.GetProperty("outcome").GetString());
            Assert.Contains(
                "escribir el nombre",
                progress.GetProperty("failure").GetProperty("message").GetString()!,
                StringComparison.Ordinal);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen);
        }
    }

    /// <summary>Un modo que no existe no cae en el de por omisión.</summary>
    [RequiresPostgreSqlFact]
    public async Task UnModoDesconocidoSeRechazaEnLugarDeInsertar()
    {
        var (client, sessionId) = await ConnectAsync();
        var origen = Nombre();

        try
        {
            await CrearAsync(client, sessionId, origen, filas: 1);

            var response = await client.PostAsJsonAsync(
                "/api/transfers",
                Request(sessionId, origen, origen) with { Mode = "Sustituir" });

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        finally
        {
            await LimpiarAsync(client, sessionId, origen);
        }
    }

    /// <summary>Preguntar por un traslado que no existe no inventa un estado.</summary>
    [RequiresPostgreSqlFact]
    public async Task ElEstadoDeUnTrasladoDesconocidoEsUnCuatrocientosCuatro()
    {
        var client = _factory.CreateAuthenticatedClient();

        var response = await client.GetAsync($"/api/transfers/{Guid.NewGuid()}/status");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        client.Dispose();
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

    private sealed record MappingBody
    {
        public required string Source { get; init; }

        public string? Target { get; init; }
    }

    private sealed record FilterBody
    {
        public string? Where { get; init; }

        public int? MaxRows { get; init; }
    }

    private sealed record TransferBody
    {
        public required Guid SourceSessionId { get; init; }

        public required TableBody Source { get; init; }

        public required Guid TargetSessionId { get; init; }

        public required TableBody Target { get; init; }

        public FilterBody? Filter { get; init; }

        public IReadOnlyList<MappingBody> Mappings { get; init; } = [];

        public string Mode { get; init; } = "Insert";

        public IReadOnlyList<string> KeyColumns { get; init; } = [];

        public bool Atomic { get; init; }

        public int BatchSize { get; init; } = 1000;

        public bool KeepIdentity { get; init; } = true;

        public bool Confirmed { get; init; } = true;

        public string? ReplaceConfirmation { get; init; }
    }

    private static TransferBody Request(Guid sessionId, string origen, string destino) => new()
    {
        SourceSessionId = sessionId,
        Source = Table(origen),
        TargetSessionId = sessionId,
        Target = Table(destino),
    };

    private static TableBody Table(string name) => new()
    {
        Id = $"Table:public.{name}",
        Name = name,
        Database = TestDatabase.Database,
        Schema = "public",
    };

    private static string Nombre() => $"druse_tr_{Guid.NewGuid():N}";

    private async Task<(HttpClient Client, Guid SessionId)> ConnectAsync(HttpClient? client = null)
    {
        client ??= _factory.CreateAuthenticatedClient();

        return (client, await OpenAsync(client, readOnly: false));
    }

    private static async Task<Guid> OpenAsync(HttpClient client, bool readOnly)
    {
        var response = await client.PostAsJsonAsync("/api/sessions", TestDatabase.ConnectRequest(readOnly));
        response.EnsureSuccessStatusCode();

        return (await response.ReadJsonAsync()).GetProperty("sessionId").GetGuid();
    }

    /// <summary>Lanza el traslado y espera a que termine.</summary>
    private static async Task<JsonElement> TransferAsync(HttpClient client, TransferBody request)
    {
        var response = await client.PostAsJsonAsync("/api/transfers", request);

        response.EnsureSuccessStatusCode();

        return await WaitAsync(client, (await response.ReadJsonAsync()).GetProperty("id").GetGuid());
    }

    /// <summary>
    /// Pregunta por el estado hasta que deja de estar en marcha.
    ///
    /// Con un tope: si algo se queda colgado, la prueba tiene que fallar diciendo
    /// que se colgó, no quedarse esperando para siempre.
    ///
    /// **El mensaje lleva el último estado**, y no es adorno: así se encontró el
    /// fallo que ponía roja esta suite de vez en cuando. Decía «copiando» con
    /// todas las filas ya copiadas y el reloj parado, que es lo que delató que el
    /// aviso de «terminado» se había perdido en el registro del progreso en lugar
    /// de que el traslado fuera lento. Sin el estado, «no terminó en diez
    /// segundos» no dice si se quedó leyendo, copiando o cerrando.
    /// </summary>
    private static async Task<JsonElement> WaitAsync(HttpClient client, Guid id)
    {
        for (var intento = 0; intento < 200; intento++)
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

        var ultimo = await (await client.GetAsync($"/api/transfers/{id}/status")).Content.ReadAsStringAsync();

        throw new TimeoutException($"El traslado {id} no terminó en diez segundos. Último estado: {ultimo}");
    }

    private static async Task CrearAsync(HttpClient client, Guid sessionId, string tabla, int filas)
    {
        await RunAsync(client, sessionId, $"CREATE TABLE {tabla} (id int, nombre text, saldo numeric(10,2))");

        for (var fila = 1; fila <= filas; fila++)
        {
            await RunAsync(
                client,
                sessionId,
                $"INSERT INTO {tabla} VALUES ({fila}, 'fila {fila}', {fila}.50)");
        }
    }

    /// <summary>
    /// Como <see cref="CrearAsync"/> pero con clave primaria.
    ///
    /// Va aparte para que las pruebas de los modos que reconocen filas digan en su
    /// primera línea que la tabla tiene con qué reconocerlas.
    /// </summary>
    private static async Task CrearConClaveAsync(
        HttpClient client,
        Guid sessionId,
        string tabla,
        int filas)
    {
        await RunAsync(
            client,
            sessionId,
            $"CREATE TABLE {tabla} (id int PRIMARY KEY, nombre text, saldo numeric(10,2))");

        for (var fila = 1; fila <= filas; fila++)
        {
            await RunAsync(
                client,
                sessionId,
                $"INSERT INTO {tabla} VALUES ({fila}, 'fila {fila}', {fila}.50)");
        }
    }

    private static async Task LimpiarAsync(HttpClient client, Guid sessionId, params string[] tablas)
    {
        foreach (var tabla in tablas)
        {
            await RunAsync(client, sessionId, $"DROP TABLE IF EXISTS {tabla}");
        }

        client.Dispose();
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
        var valores = await LeerAsync(client, sessionId, $"SELECT COUNT(*) FROM {tabla}");

        return int.Parse(valores[0], CultureInfo.InvariantCulture);
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
                .Select(row => row[0].GetString() ?? string.Empty),
        ];
    }
}
