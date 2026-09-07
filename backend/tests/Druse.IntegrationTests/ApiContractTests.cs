using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Druse.IntegrationTests;

/// <summary>
/// El contrato HTTP, escrito en el repositorio y comprobado contra el que
/// realmente publica la API.
///
/// **La interfaz no lo genera: lo escribe a mano.** El gateway de Angular llama a
/// rutas literales, así que renombrar una en el backend no rompe ninguna
/// compilación: rompe la aplicación en marcha, y solo cuando alguien pulsa ese
/// botón. Esto es lo que hace que se entere antes el CI.
/// </summary>
public sealed class ApiContractTests(DruseApiFactory factory) : IClassFixture<DruseApiFactory>
{
    private readonly DruseApiFactory _factory = factory;

    /// <summary>Dónde vive la copia versionada del contrato.</summary>
    private static string ContractPath =>
        Path.Combine(RepositoryRoot(), "docs", "api", "openapi.json");

    /// <summary>El gateway que la interfaz escribe a mano contra esas rutas.</summary>
    private static string GatewayPath => Path.Combine(
        RepositoryRoot(),
        "frontend", "src", "app", "core", "application-gateway", "http-application-gateway.ts");

    /// <summary>
    /// El contrato publicado y el guardado tienen que decir lo mismo.
    ///
    /// Cuando esta prueba falla, el contrato cambió: hay que mirar **qué** cambió
    /// y, si es a propósito, actualizar el archivo. Es la diferencia entre
    /// cambiar el contrato y cambiarlo sin enterarse.
    /// </summary>
    [Fact]
    public async Task ElContratoPublicadoEsElQueEstaGuardado()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var publicado = Normalize(await client.GetStringAsync("/openapi/v1.json"));

        if (!File.Exists(ContractPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ContractPath)!);
            await File.WriteAllTextAsync(ContractPath, publicado);

            Assert.Fail(
                $"No había contrato guardado y se ha escrito uno en «{ContractPath}». " +
                "Revísalo y añádelo al repositorio.");
        }

        var guardado = Normalize(await File.ReadAllTextAsync(ContractPath));

        Assert.True(
            string.Equals(publicado, guardado, StringComparison.Ordinal),
            "El contrato HTTP cambió y el archivo del repositorio no. Si el cambio es a " +
            $"propósito, sustituye «{ContractPath}» por lo que devuelve /openapi/v1.json; " +
            "si no lo es, acabas de romper a quien llame a esta API.");
    }

    /// <summary>
    /// Cada ruta que la interfaz llama existe en el contrato.
    ///
    /// Es el caso que se escapa siempre: se renombra una ruta en el backend, el
    /// backend compila, el frontend compila, y la aplicación se rompe cuando
    /// alguien pulsa ese botón concreto.
    /// </summary>
    [Fact]
    public async Task LasRutasQueLlamaLaInterfazExistenEnElContrato()
    {
        using var client = _factory.CreateAuthenticatedClient();

        var document = await client.GetFromJsonAsync<JsonElement>("/openapi/v1.json");

        // Se comparan por su forma, no por el nombre del parámetro: la ruta
        // declarada dice `{sessionId}` y la interfaz escribe `${id}`, y las dos
        // hablan del mismo hueco.
        var declaradas = document
            .GetProperty("paths")
            .EnumerateObject()
            .Select(path => Shape(path.Name))
            .ToHashSet(StringComparer.Ordinal);

        var faltan = GatewayRoutes()
            .Where(route => !declaradas.Any(declarada => Matches(declarada, route)))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        Assert.True(
            faltan.Count == 0,
            "La interfaz llama a rutas que la API no publica: " + string.Join(", ", faltan));
    }

    /// <summary>
    /// Las rutas del gateway, con sus parámetros vueltos a la forma del contrato.
    ///
    /// En TypeScript se escriben interpoladas —`/api/backup/${id}/status`— y en
    /// OpenAPI con el nombre entre llaves, así que se traduce lo primero a lo
    /// segundo mirando **cómo se llama el parámetro en la ruta declarada**: aquí
    /// solo se sabe que hay un hueco, no cómo lo llamó quien escribió el contrato.
    /// </summary>
    private static IEnumerable<string> GatewayRoutes()
    {
        var source = File.ReadAllText(GatewayPath);

        foreach (Match match in Regex.Matches(
            source,
            @"['""`](/api/[^'""`\s]*)['""`]",
            RegexOptions.CultureInvariant))
        {
            var route = match.Groups[1].Value;

            // Una consulta o un fragmento no forman parte de la ruta. Tampoco lo
            // es una interpolación que no ocupa un segmento entero —`/api/history${query}`
            // es la ruta más una consulta ya montada—, así que ahí se corta.
            var cut = route.IndexOfAny(['?', '#']);

            if (cut >= 0)
            {
                route = route[..cut];
            }

            var inline = Regex.Match(route, @"[^/]\$\{", RegexOptions.CultureInvariant);

            if (inline.Success)
            {
                route = route[..(inline.Index + 1)];
            }

            yield return Shape(route);
        }
    }

    /// <summary>
    /// Si una ruta declarada y una del gateway hablan del mismo sitio.
    ///
    /// Segmento a segmento, y un hueco casa con cualquier cosa **por los dos
    /// lados**: el servidor declara `/api/exports/csv` y `/api/exports/xlsx`
    /// mientras el cliente escribe `/api/exports/${format}`, y eso no es un error
    /// de nadie: es un parámetro del cliente contra rutas fijas del servidor.
    /// </summary>
    private static bool Matches(string declarada, string llamada)
    {
        var izquierda = declarada.Split('/');
        var derecha = llamada.Split('/');

        if (izquierda.Length != derecha.Length)
        {
            return false;
        }

        return izquierda.Zip(derecha).All(pair =>
            pair.First == "{}" ||
            pair.Second == "{}" ||
            string.Equals(pair.First, pair.Second, StringComparison.Ordinal));
    }

    /// <summary>
    /// La forma de una ruta: los huecos vacíos y sin barra final.
    ///
    /// Es lo que permite comparar `/api/sessions/{sessionId}/transaction` con
    /// `/api/sessions/${id}/transaction` sin exigir que el nombre coincida, que
    /// aquí no dice nada: quien escribe el gateway no ve el contrato.
    /// </summary>
    private static string Shape(string route) =>
        Regex.Replace(
            Regex.Replace(route, @"\$?\{[^}]*\}", "{}", RegexOptions.CultureInvariant),
            @"/+$",
            string.Empty,
            RegexOptions.CultureInvariant);

    /// <summary>
    /// El JSON con un formato estable, para que la comparación no dependa de cómo
    /// lo serialice cada versión del generador.
    /// </summary>
    private static string Normalize(string json) =>
        JsonSerializer.Serialize(JsonSerializer.Deserialize<JsonElement>(json), Indented);

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    /// <summary>
    /// La raíz del repositorio, subiendo desde donde corre la prueba.
    ///
    /// Se busca por una marca que solo está arriba —el archivo del plan— en lugar
    /// de contar directorios: el número de niveles cambia entre `Debug` y
    /// `Release` y entre plataformas.
    /// </summary>
    private static string RepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "PLAN_TRABAJO_DRUSE.md")))
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException("No se encontró la raíz del repositorio.");
    }
}
