using System.Xml.Linq;

namespace Druse.UnitTests;

/// <summary>
/// Reglas automáticas que impiden dependencias inválidas entre proyectos.
/// Ver PLAN_TRABAJO_DRUSE.md §5 (Límites de los módulos) y §10 (dirección de las referencias).
///
/// Se leen los archivos .csproj en lugar de los ensamblados compilados porque lo que
/// se quiere fijar es la dirección declarada de las dependencias, no lo que el
/// compilador terminó incluyendo. Además evita agregar un paquete de análisis nuevo.
/// </summary>
public sealed class ArchitectureRulesTests
{
    /// <summary>
    /// Única fuente de verdad de qué proyecto puede referenciar a cuál.
    /// Toda dependencia apunta hacia el núcleo; los proyectos internos nunca conocen los externos.
    /// </summary>
    private static readonly Dictionary<string, string[]> AllowedProjectReferences = new(StringComparer.Ordinal)
    {
        // Núcleo: no conoce a nadie.
        ["Druse.Domain"] = [],
        ["Druse.Platform.Abstractions"] = [],

        // Contratos: solo conceptos del dominio.
        ["Druse.Database.Abstractions"] = ["Druse.Domain"],

        // Casos de uso: dominio y contratos, jamás implementaciones concretas.
        ["Druse.Application"] =
        [
            "Druse.Domain",
            "Druse.Database.Abstractions",
            "Druse.Platform.Abstractions",
        ],

        // Adaptadores generales y persistencia interna.
        ["Druse.Infrastructure"] = ["Druse.Application"],

        // La persistencia conoce Platform.Abstractions porque necesita IAppPaths
        // para situar el archivo. Sigue sin conocer Platform.Native: dónde está el
        // directorio de datos lo resuelve el host al componer.
        ["Druse.Persistence.Sqlite"] = ["Druse.Application", "Druse.Platform.Abstractions"],

        // El puente ADO.NET sobre JDBC encapsula su driver igual que un proveedor:
        // quien lo use ve `DbConnection`, no `java.sql`.
        ["Druse.Jdbc"] = ["Druse.Database.Abstractions"],

        // Proveedores: sus contratos y su propio driver. Nunca otro proveedor.
        // Informix es el único que tiene dos transportes: DRDA con el driver de
        // IBM y SQLI con el puente JDBC.
        ["Druse.Provider.Informix"] = ["Druse.Database.Abstractions", "Druse.Jdbc"],
        ["Druse.Provider.MySql"] = ["Druse.Database.Abstractions"],
        ["Druse.Provider.Oracle"] = ["Druse.Database.Abstractions"],
        ["Druse.Provider.PostgreSql"] = ["Druse.Database.Abstractions"],
        ["Druse.Provider.SqlServer"] = ["Druse.Database.Abstractions"],

        // Capacidades nativas: solo su abstracción.
        ["Druse.Platform.Native"] = ["Druse.Platform.Abstractions"],

        // El túnel SSH encapsula su librería igual que un proveedor encapsula su
        // driver: la aplicación solo ve la abstracción del túnel.
        ["Druse.Ssh"] = ["Druse.Application"],

        // Composición: único lugar donde se conocen todas las implementaciones.
        ["Druse.Host.LocalApi"] =
        [
            "Druse.Application",
            "Druse.Infrastructure",
            "Druse.Provider.Informix",
            "Druse.Provider.MySql",
            "Druse.Provider.Oracle",
            "Druse.Provider.PostgreSql",
            "Druse.Provider.SqlServer",
            "Druse.Persistence.Sqlite",
            "Druse.Platform.Native",
            "Druse.Ssh",
        ],
    };

    /// <summary>Proyectos que no pueden tocar infraestructura concreta bajo ninguna circunstancia.</summary>
    private static readonly string[] CoreProjects =
    [
        "Druse.Domain",
        "Druse.Database.Abstractions",
        "Druse.Application",
        "Druse.Platform.Abstractions",
    ];

    /// <summary>Drivers, frameworks web y almacenamiento que el núcleo nunca debe conocer.</summary>
    private static readonly string[] ForbiddenCorePackagePrefixes =
    [
        "Npgsql",
        "Microsoft.Data.SqlClient",
        "MySqlConnector",
        "Microsoft.Data.Sqlite",
        "Microsoft.EntityFrameworkCore",
        "Microsoft.AspNetCore",
        "Dapper",

        // El túnel se abre detrás de una abstracción: quien decide cómo hablar
        // SSH es Druse.Ssh, igual que cada proveedor decide su driver.
        "SSH.NET",
        "Renci",
    ];

    [Fact]
    public void CadaProyectoRespetaSusReferenciasPermitidas()
    {
        var violations = new List<string>();

        foreach (var project in EnumerateSourceProjects())
        {
            if (!AllowedProjectReferences.TryGetValue(project.Name, out var allowed))
            {
                continue; // Cubierto por TodoProyectoDeSrcTieneUnaReglaDeclarada.
            }

            foreach (var reference in ReadProjectReferences(project.File))
            {
                if (!allowed.Contains(reference, StringComparer.Ordinal))
                {
                    violations.Add($"{project.Name} no puede referenciar a {reference}.");
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "Se rompió la dirección de dependencias del plan §10:" +
            Environment.NewLine + string.Join(Environment.NewLine, violations));
    }

    [Fact]
    public void ElNucleoNoDependeDeInfraestructuraConcreta()
    {
        var violations = new List<string>();

        foreach (var project in EnumerateSourceProjects())
        {
            if (!CoreProjects.Contains(project.Name, StringComparer.Ordinal))
            {
                continue;
            }

            foreach (var package in ReadPackageReferences(project.File))
            {
                var forbidden = ForbiddenCorePackagePrefixes
                    .FirstOrDefault(prefix => package.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));

                if (forbidden is not null)
                {
                    violations.Add($"{project.Name} referencia el paquete {package}, prohibido en el núcleo.");
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "El núcleo se contaminó con infraestructura concreta (plan §5):" +
            Environment.NewLine + string.Join(Environment.NewLine, violations));
    }

    [Fact]
    public void TodoProyectoDeSrcTieneUnaReglaDeclarada()
    {
        var undeclared = EnumerateSourceProjects()
            .Select(project => project.Name)
            .Where(name => !AllowedProjectReferences.ContainsKey(name))
            .ToList();

        Assert.True(
            undeclared.Count == 0,
            "Hay proyectos sin regla de dependencias declarada en esta prueba: " +
            string.Join(", ", undeclared) +
            ". Agregarlos a AllowedProjectReferences antes de seguir.");
    }

    [Fact]
    public void LosProveedoresNoSeConocenEntreSi()
    {
        var providers = EnumerateSourceProjects()
            .Where(project => project.Name.StartsWith("Druse.Provider.", StringComparison.Ordinal))
            .ToList();

        Assert.NotEmpty(providers);

        foreach (var provider in providers)
        {
            var crossReferences = ReadProjectReferences(provider.File)
                .Where(reference => reference.StartsWith("Druse.Provider.", StringComparison.Ordinal))
                .ToList();

            Assert.True(
                crossReferences.Count == 0,
                $"{provider.Name} referencia a otro proveedor: {string.Join(", ", crossReferences)}. " +
                "Cada proveedor debe encapsular totalmente su driver y su dialecto.");
        }
    }

    private static IEnumerable<(string Name, string File)> EnumerateSourceProjects()
    {
        var sourceDirectory = Path.Combine(FindBackendRoot(), "src");

        return Directory
            .EnumerateFiles(sourceDirectory, "*.csproj", SearchOption.AllDirectories)
            .Select(file => (Name: Path.GetFileNameWithoutExtension(file), File: file))
            .OrderBy(project => project.Name, StringComparer.Ordinal);
    }

    private static IEnumerable<string> ReadProjectReferences(string csprojPath) =>
        XDocument.Load(csprojPath)
            .Descendants("ProjectReference")
            .Select(element => (string?)element.Attribute("Include"))
            .Where(include => !string.IsNullOrWhiteSpace(include))
            .Select(include => Path.GetFileNameWithoutExtension(include!.Replace('\\', Path.DirectorySeparatorChar)));

    private static IEnumerable<string> ReadPackageReferences(string csprojPath) =>
        XDocument.Load(csprojPath)
            .Descendants("PackageReference")
            .Select(element => (string?)element.Attribute("Include"))
            .Where(include => !string.IsNullOrWhiteSpace(include))
            .Select(include => include!);

    /// <summary>Sube desde el directorio de salida de la prueba hasta encontrar la solución.</summary>
    private static string FindBackendRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null)
        {
            if (directory.EnumerateFiles("Druse.slnx").Any() || directory.EnumerateFiles("Druse.sln").Any())
            {
                return directory.FullName;
            }

            directory = directory.Parent;
        }

        throw new InvalidOperationException(
            $"No se encontró la solución de Druse partiendo de '{AppContext.BaseDirectory}'.");
    }
}
