using Druse.Application.Backups;

namespace Druse.UnitTests;

/// <summary>
/// La huella que distingue «aplica esto, que lo he mirado» de «aplica lo que haya
/// en esa ruta».
///
/// Lo que tiene que cumplir es corto: **la misma cosa, la misma huella**; y en
/// cuanto el artefacto cambia, otra. Lo primero importa tanto como lo segundo: una
/// huella que cambiara sola haría que ninguna restauración se pudiera aplicar.
/// </summary>
public sealed class ArtifactFingerprintTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-fp-{Guid.NewGuid():N}");

    public ArtifactFingerprintTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private string Write(string relative, string content)
    {
        var path = Path.Combine(_root, relative);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);

        return path;
    }

    [Fact]
    public void ElMismoArchivoSinTocar_DaLaMismaHuella()
    {
        var path = Write("respaldo.sql", "CREATE TABLE t (id int);");

        Assert.Equal(ArtifactFingerprint.Of(path), ArtifactFingerprint.Of(path));
    }

    [Fact]
    public void UnArchivoQueCambia_DaOtraHuella()
    {
        var path = Write("respaldo.sql", "CREATE TABLE t (id int);");
        var antes = ArtifactFingerprint.Of(path);

        File.AppendAllText(path, "DROP TABLE t;");

        Assert.NotEqual(antes, ArtifactFingerprint.Of(path));
    }

    /// <summary>
    /// El caso que motiva todo esto en la salida por carpetas: el artefacto no es
    /// un archivo, sino lo que hay dentro. Añadir uno lo cambia.
    /// </summary>
    [Fact]
    public void UnaCarpetaConUnArchivoDeMas_DaOtraHuella()
    {
        Write("tablas/pedidos.sql", "CREATE TABLE pedidos ();");

        var antes = ArtifactFingerprint.Of(_root);

        Write("tablas/clientes.sql", "CREATE TABLE clientes ();");

        Assert.NotEqual(antes, ArtifactFingerprint.Of(_root));
    }

    /// <summary>
    /// El sistema de archivos no promete ningún orden al enumerar, y dos huellas
    /// distintas de la misma carpeta harían que la restauración se negara a sí
    /// misma. Se comprueba pidiéndola varias veces.
    /// </summary>
    [Fact]
    public void LaHuellaDeUnaCarpetaNoDependeDelOrdenEnQueSeLea()
    {
        for (var index = 0; index < 20; index++)
        {
            Write($"datos/tabla{index}.csv", $"id\r\n{index}\r\n");
        }

        var primera = ArtifactFingerprint.Of(_root);

        Assert.Equal(primera, ArtifactFingerprint.Of(_root));
        Assert.Equal(primera, ArtifactFingerprint.Of(_root));
    }

    /// <summary>
    /// Una ruta que no existe no es un error: quien compara ya tiene que tratar el
    /// caso de «esto no es lo mismo», y una excepción aquí solo cambiaría el
    /// mensaje por uno peor.
    /// </summary>
    [Fact]
    public void UnaRutaQueNoExiste_DaHuellaVacia()
    {
        Assert.Equal(string.Empty, ArtifactFingerprint.Of(Path.Combine(_root, "fantasma.sql")));
        Assert.Equal(string.Empty, ArtifactFingerprint.Of(string.Empty));
    }
}
