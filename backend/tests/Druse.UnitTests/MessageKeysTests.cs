using System.Reflection;
using System.Text.Json;

using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// Las claves que manda el backend existen en el catálogo del frontend.
///
/// Es la única prueba que cruza los dos lados del repositorio, y está aquí por
/// una razón concreta: una clave que el backend manda y el catálogo no tiene se
/// enseña **cruda** en la ventana —`server.connection.name` en mitad de un
/// formulario—, y eso no lo ve ninguna prueba del backend ni ninguna del
/// frontend. Se ve juntándolos.
/// </summary>
public sealed class MessageKeysTests
{
    [Fact]
    public void CadaClaveDelBackendEstaEnElCatalogoFuente()
    {
        var catalogo = LeerCatalogo("es.json");
        var faltan = TodasLasClaves().Where(clave => !catalogo.ContainsKey(clave)).ToList();

        Assert.True(
            faltan.Count == 0,
            $"Estas claves las manda el backend y no están en frontend/src/i18n/es.json: {string.Join(", ", faltan)}.");
    }

    /// <summary>
    /// Y también en inglés, que es el respaldo de los demás idiomas.
    ///
    /// Sin esto, un idioma a medias caería al inglés y allí tampoco estaría: se
    /// vería la clave cruda igual, solo que más tarde.
    /// </summary>
    [Fact]
    public void CadaClaveDelBackendEstaTraducidaAlIngles()
    {
        var catalogo = LeerCatalogo("en.json");
        var faltan = TodasLasClaves().Where(clave => !catalogo.ContainsKey(clave)).ToList();

        Assert.True(
            faltan.Count == 0,
            $"Estas claves no están traducidas en frontend/src/i18n/en.json: {string.Join(", ", faltan)}.");
    }

    /// <summary>Las constantes de <see cref="MessageKeys"/>, incluidas las de sus clases anidadas.</summary>
    private static IEnumerable<string> TodasLasClaves()
    {
        var pendientes = new Stack<Type>([typeof(MessageKeys)]);

        while (pendientes.Count > 0)
        {
            var tipo = pendientes.Pop();

            foreach (var anidado in tipo.GetNestedTypes(BindingFlags.Public))
            {
                pendientes.Push(anidado);
            }

            var constantes = tipo
                .GetFields(BindingFlags.Public | BindingFlags.Static)
                .Where(field => field is { IsLiteral: true, IsInitOnly: false })
                .Select(field => (string)field.GetRawConstantValue()!);

            foreach (var constante in constantes)
            {
                yield return constante;
            }
        }
    }

    private static Dictionary<string, string> LeerCatalogo(string archivo)
    {
        var ruta = Path.Combine(RaizDelRepositorio(), "frontend", "src", "i18n", archivo);

        Assert.True(File.Exists(ruta), $"No se encontró el catálogo '{ruta}'.");

        return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(ruta))
            ?? throw new InvalidOperationException($"El catálogo '{archivo}' no se pudo leer.");
    }

    /// <summary>Sube desde la salida de la prueba hasta la carpeta que tiene `frontend`.</summary>
    private static string RaizDelRepositorio()
    {
        var directorio = new DirectoryInfo(AppContext.BaseDirectory);

        while (directorio is not null)
        {
            if (directorio.EnumerateDirectories("frontend").Any())
            {
                return directorio.FullName;
            }

            directorio = directorio.Parent;
        }

        throw new InvalidOperationException(
            $"No se encontró la raíz del repositorio partiendo de '{AppContext.BaseDirectory}'.");
    }
}
