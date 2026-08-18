using Druse.Platform.Abstractions;
using Druse.Platform.Native;

namespace Druse.UnitTests;

/// <summary>
/// El explorador de carpetas que sustituye al diálogo del sistema cuando Druse
/// corre en el navegador.
///
/// Lo que se comprueba aquí es lo que separa un selector de un campo de texto:
/// que **el nombre sea un nombre** y no media ruta, que se avise de lo que ya
/// existe antes de sobrescribirlo, y que una carpeta que no se puede leer se
/// cuente en vez de aparecer vacía.
/// </summary>
public sealed class FolderBrowserTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-folders-{Guid.NewGuid():N}");

    private readonly FolderBrowser _browser;

    public FolderBrowserTests()
    {
        Directory.CreateDirectory(_root);

        _browser = new FolderBrowser(new AppPaths());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    [Fact]
    public void SeEmpiezaPorLosSitiosConocidosYLasUnidades()
    {
        var roots = _browser.Roots();

        Assert.Equal(string.Empty, roots.Path);
        Assert.NotEmpty(roots.Folders);

        // Los conocidos van delante: son donde la gente guarda de verdad.
        Assert.Equal(FolderKind.Known, roots.Folders[0].Kind);
        Assert.Contains(roots.Folders, folder => folder.Kind == FolderKind.Drive);
    }

    [Fact]
    public void LasSubcarpetasSalenOrdenadasYConSuPadre()
    {
        Directory.CreateDirectory(Path.Combine(_root, "zeta"));
        Directory.CreateDirectory(Path.Combine(_root, "alfa"));

        var listing = _browser.List(_root);

        Assert.Equal(["alfa", "zeta"], listing.Folders.Select(folder => folder.Name));
        Assert.Equal(Path.GetDirectoryName(_root), listing.Parent);
        Assert.True(listing.CanWrite);
        Assert.Null(listing.Error);
    }

    /// <summary>
    /// Para elegir dónde guardar no hacen falta los archivos, y no enseñar lo que
    /// no se necesita es la forma barata de no enseñar de más.
    /// </summary>
    [Fact]
    public void LosArchivosNoSeEnseñan()
    {
        File.WriteAllText(Path.Combine(_root, "respaldo.sql"), "-- nada");
        Directory.CreateDirectory(Path.Combine(_root, "carpeta"));

        var listing = _browser.List(_root);

        Assert.Equal(["carpeta"], listing.Folders.Select(folder => folder.Name));
    }

    /// <summary>
    /// El otro caso: elegir el respaldo que se va a restaurar. Ahí sí hacen falta
    /// los archivos, pero solo los que pueden serlo.
    /// </summary>
    [Fact]
    public void ConExtensionesSeEnumeranSoloEsosArchivos()
    {
        File.WriteAllText(Path.Combine(_root, "tienda.sql"), "-- respaldo");
        File.WriteAllText(Path.Combine(_root, "tienda.zip"), "PK");
        File.WriteAllText(Path.Combine(_root, "notas.txt"), "nada que ver");

        var listing = _browser.List(_root, new FolderQuery { Extensions = ["sql", "zip"] });

        Assert.Equal(
            ["tienda.sql", "tienda.zip"],
            listing.Files.Select(file => file.Name).Order());
    }

    /// <summary>
    /// El respaldo que se busca casi siempre es el último; por nombre quedaría
    /// escondido entre los de hace seis meses.
    /// </summary>
    [Fact]
    public void LosArchivosSalenDelMasRecienteAlMasViejo()
    {
        var viejo = Path.Combine(_root, "a-enero.sql");
        var nuevo = Path.Combine(_root, "z-agosto.sql");

        File.WriteAllText(viejo, "-- de enero");
        File.WriteAllText(nuevo, "-- de agosto");

        File.SetLastWriteTimeUtc(viejo, new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        File.SetLastWriteTimeUtc(nuevo, new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc));

        var listing = _browser.List(_root, new FolderQuery { Extensions = ["sql"] });

        Assert.Equal(["z-agosto.sql", "a-enero.sql"], listing.Files.Select(file => file.Name));
    }

    /// <summary>
    /// Un respaldo por carpetas se elige entero. Sin marcarlo habría que entrar en
    /// cada carpeta a comprobar si dentro está el manifiesto.
    /// </summary>
    [Fact]
    public void SeMarcaLaCarpetaQueLlevaDentroElArchivoSeñalado()
    {
        var respaldo = Path.Combine(_root, "tienda");
        var cualquiera = Path.Combine(_root, "fotos");

        Directory.CreateDirectory(respaldo);
        Directory.CreateDirectory(cualquiera);
        File.WriteAllText(Path.Combine(respaldo, "manifest.json"), "{}");

        var listing = _browser.List(_root, new FolderQuery { Marker = "manifest.json" });

        Assert.True(listing.Folders.Single(folder => folder.Name == "tienda").Marked);
        Assert.False(listing.Folders.Single(folder => folder.Name == "fotos").Marked);
    }

    [Fact]
    public void UnaCarpetaQueNoExisteSeDice()
    {
        var listing = _browser.List(Path.Combine(_root, "no-esta"));

        Assert.Empty(listing.Folders);
        Assert.NotNull(listing.Error);
    }

    [Fact]
    public void ElDestinoSeComponeConLaCarpetaYElNombre()
    {
        var target = _browser.Resolve(_root, "respaldo.sql");

        Assert.Equal(Path.Combine(_root, "respaldo.sql"), target.Path);
        Assert.True(target.CanWrite);
        Assert.False(target.Exists);
        Assert.Null(target.Problem);
    }

    /// <summary>
    /// Sobrescribir es legítimo —repetir el respaldo de ayer encima lo es— pero
    /// hay que decirlo antes, no después.
    /// </summary>
    [Fact]
    public void SiYaHayAlgoConEseNombreSeAvisaSinImpedirlo()
    {
        File.WriteAllText(Path.Combine(_root, "respaldo.sql"), "-- de ayer");

        var target = _browser.Resolve(_root, "respaldo.sql");

        Assert.True(target.Exists);
        Assert.Null(target.Problem);
    }

    /// <summary>
    /// Un `..` en el nombre escribiría en otro sitio del que la pantalla enseña.
    /// Eso no es una comodidad: es una sorpresa.
    /// </summary>
    [Theory]
    [InlineData("../fuera.sql")]
    [InlineData("sub/respaldo.sql")]
    [InlineData("")]
    public void ElNombreEsUnNombreYNoMediaRuta(string name)
    {
        var target = _browser.Resolve(_root, name);

        Assert.NotNull(target.Problem);
    }

    [Fact]
    public void UnaCarpetaNuevaSeCreaYSePuedeEscribirEnElla()
    {
        var created = _browser.Create(_root, "agosto");

        Assert.Null(created.Problem);
        Assert.True(created.Exists);
        Assert.True(created.CanWrite);
        Assert.True(Directory.Exists(Path.Combine(_root, "agosto")));
    }

    [Fact]
    public void NoSeCreaEncimaDeAlgoQueYaEsta()
    {
        Directory.CreateDirectory(Path.Combine(_root, "agosto"));

        var created = _browser.Create(_root, "agosto");

        Assert.NotNull(created.Problem);
    }
}
