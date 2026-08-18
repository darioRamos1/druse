using Druse.Platform.Abstractions;

namespace Druse.Platform.Native;

/// <summary>
/// El sistema de archivos real, visto solo como carpetas.
///
/// Nada de lo que hay aquí decide nada: enumera, comprueba permisos y compone
/// rutas. Lo que sí hace en todo momento es **no reventar**. Navegar por un disco
/// da errores continuamente —una unidad sin medio, una carpeta del sistema sin
/// permisos, un enlace roto— y ninguno de esos es un fallo de la aplicación: se
/// devuelven como motivo para que la pantalla los cuente.
/// </summary>
public sealed class FolderBrowser(IAppPaths paths) : IFolderBrowser
{
    private readonly IAppPaths _paths = paths;

    public char Separator => Path.DirectorySeparatorChar;

    public FolderListing Roots()
    {
        var folders = new List<FolderEntry>();

        foreach (var (name, path) in KnownPlaces())
        {
            if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
            {
                folders.Add(new FolderEntry { Name = name, Path = path, Kind = FolderKind.Known });
            }
        }

        foreach (var drive in Drives())
        {
            folders.Add(drive);
        }

        return new FolderListing
        {
            Path = string.Empty,
            Parent = null,
            Folders = folders,
            CanWrite = false,
        };
    }

    public FolderListing List(string path, FolderQuery? query = null)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return Roots();
        }

        var full = Absolute(path);

        if (!Directory.Exists(full))
        {
            return new FolderListing
            {
                Path = full,
                Parent = ParentOf(full),
                Error = $"«{full}» ya no existe.",
            };
        }

        try
        {
            var folders = new List<FolderEntry>();

            foreach (var child in Directory.EnumerateDirectories(full))
            {
                // Las ocultas y las del sistema no se enseñan: son ruido para
                // elegir dónde guardar, y en la raíz de Windows son la mayoría.
                if (Hidden(child))
                {
                    continue;
                }

                folders.Add(new FolderEntry
                {
                    Name = Path.GetFileName(child),
                    Path = child,
                    Kind = FolderKind.Folder,
                    Marked = Marked(child, query?.Marker),
                });
            }

            // El orden es el del idioma del usuario y no el de los bytes: esta
            // lista la lee una persona buscando una carpeta por su nombre, y con
            // orden ordinal «Álbumes» acabaría detrás de «Zips».
            folders.Sort((left, right) =>
                StringComparer.CurrentCultureIgnoreCase.Compare(left.Name, right.Name));

            return new FolderListing
            {
                Path = full,
                Parent = ParentOf(full),
                Folders = folders,
                Files = Files(full, query),
                CanWrite = Writable(full),
            };
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException)
        {
            return new FolderListing
            {
                Path = full,
                Parent = ParentOf(full),
                CanWrite = false,
                Error = $"No se puede abrir «{full}»: {error.Message}",
            };
        }
    }

    public FolderTarget Create(string parent, string name)
    {
        var target = Resolve(parent, name);

        if (target.Problem is not null)
        {
            return target;
        }

        if (target.Exists)
        {
            return target with { Problem = $"Ya hay algo llamado «{name}» en esa carpeta." };
        }

        try
        {
            Directory.CreateDirectory(target.Path);

            return target with { Exists = true, CanWrite = Writable(target.Path) };
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException)
        {
            return target with { Problem = $"No se pudo crear la carpeta: {error.Message}" };
        }
    }

    public FolderTarget Resolve(string folder, string name)
    {
        if (string.IsNullOrWhiteSpace(folder))
        {
            return Invalid(string.Empty, "Falta la carpeta donde guardarlo.");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            return Invalid(folder, "Falta el nombre.");
        }

        // El nombre es un nombre, no media ruta. Un `..\..\` escrito ahí acabaría
        // escribiendo en otro sitio del que la pantalla enseña, y eso no es una
        // comodidad: es una sorpresa.
        if (name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 ||
            name.Contains(Path.DirectorySeparatorChar) ||
            name.Contains(Path.AltDirectorySeparatorChar))
        {
            return Invalid(folder, "El nombre no puede llevar carpetas ni caracteres prohibidos.");
        }

        var directory = Absolute(folder);

        if (!Directory.Exists(directory))
        {
            return new FolderTarget
            {
                Path = Path.Combine(directory, name),
                Problem = $"La carpeta «{directory}» no existe.",
            };
        }

        var full = Path.Combine(directory, name);

        return new FolderTarget
        {
            Path = full,
            CanWrite = Writable(directory),
            Exists = File.Exists(full) || Directory.Exists(full),
            Problem = Writable(directory)
                ? null
                : $"No se puede escribir en «{directory}».",
        };
    }

    /// <summary>
    /// Los archivos de las extensiones que se hayan pedido.
    ///
    /// Sin extensiones no se enumera ninguno: quien está eligiendo dónde guardar
    /// no necesita verlos, y una carpeta de descargas con mil archivos dentro
    /// convertiría la lista en un pajar.
    ///
    /// Van **de más reciente a más antiguo**: el respaldo que se busca casi
    /// siempre es el último, y ordenarlos por nombre lo escondería entre los de
    /// hace seis meses.
    /// </summary>
    private static List<FileEntry> Files(string directory, FolderQuery? query)
    {
        if (query is null || query.Extensions.Count == 0)
        {
            return [];
        }

        var wanted = new HashSet<string>(
            query.Extensions.Select(extension => $".{extension.TrimStart('.')}"),
            StringComparer.OrdinalIgnoreCase);

        var files = new List<FileEntry>();

        try
        {
            foreach (var file in Directory.EnumerateFiles(directory))
            {
                if (!wanted.Contains(Path.GetExtension(file)) || Hidden(file))
                {
                    continue;
                }

                var info = new FileInfo(file);

                files.Add(new FileEntry
                {
                    Name = info.Name,
                    Path = info.FullName,
                    Size = info.Length,
                    ModifiedUtc = info.LastWriteTimeUtc,
                });
            }
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException)
        {
            // Las carpetas ya se han leído: quedarse sin los archivos no vacía la
            // lista, solo deja de ofrecer lo que no se puede mirar.
            return files;
        }

        files.Sort((left, right) => right.ModifiedUtc.CompareTo(left.ModifiedUtc));

        return files;
    }

    /// <summary>Si la carpeta lleva dentro el archivo que la señala.</summary>
    private static bool Marked(string directory, string? marker)
    {
        if (string.IsNullOrWhiteSpace(marker))
        {
            return false;
        }

        try
        {
            return File.Exists(Path.Combine(directory, marker));
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or ArgumentException)
        {
            return false;
        }
    }

    private static FolderTarget Invalid(string folder, string problem) => new()
    {
        Path = folder,
        Problem = problem,
    };

    /// <summary>
    /// Los sitios donde la gente guarda de verdad, si existen en este equipo.
    ///
    /// El directorio de datos de Druse va el último: no es donde se guarda un
    /// respaldo normalmente, pero es el único que siempre está y siempre se puede
    /// escribir, así que sirve de red.
    /// </summary>
    private IEnumerable<(string Name, string Path)> KnownPlaces()
    {
        yield return ("Escritorio", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
        yield return ("Documentos", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));

        // No hay `SpecialFolder.Downloads`: se compone desde el perfil, que es
        // donde está en los tres sistemas.
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        if (!string.IsNullOrWhiteSpace(home))
        {
            yield return ("Descargas", Path.Combine(home, "Downloads"));
            yield return ("Carpeta personal", home);
        }

        yield return ("Datos de Druse", _paths.DataDirectory);
    }

    /// <summary>Las unidades con medio dentro, que son las que se pueden abrir.</summary>
    private static IEnumerable<FolderEntry> Drives()
    {
        DriveInfo[] drives;

        try
        {
            drives = DriveInfo.GetDrives();
        }
        catch (IOException)
        {
            yield break;
        }

        foreach (var drive in drives)
        {
            string name;

            try
            {
                if (!drive.IsReady)
                {
                    continue;
                }

                // La etiqueta ayuda a distinguir dos discos externos iguales; si
                // el sistema no la da, con la letra basta.
                name = string.IsNullOrWhiteSpace(drive.VolumeLabel)
                    ? drive.Name
                    : $"{drive.Name} ({drive.VolumeLabel})";
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                continue;
            }

            yield return new FolderEntry
            {
                Name = name,
                Path = drive.RootDirectory.FullName,
                Kind = FolderKind.Drive,
            };
        }
    }

    private static string Absolute(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return path;
        }
    }

    private static string? ParentOf(string path)
    {
        try
        {
            return Path.GetDirectoryName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        }
        catch (Exception error) when (error is ArgumentException or PathTooLongException)
        {
            return null;
        }
    }

    private static bool Hidden(string path)
    {
        try
        {
            var attributes = File.GetAttributes(path);

            return attributes.HasFlag(FileAttributes.Hidden) || attributes.HasFlag(FileAttributes.System);
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException)
        {
            // Si no se puede ni mirar, tampoco se va a poder abrir.
            return true;
        }
    }

    /// <summary>
    /// Si se puede escribir aquí, comprobado escribiendo.
    ///
    /// Los permisos de Windows no se deducen de los atributos —hay listas de
    /// control de acceso, herencia y hasta virtualización—, así que la única
    /// respuesta fiable es intentarlo. Se crea un archivo con nombre único y se
    /// borra en el acto.
    /// </summary>
    private static bool Writable(string directory)
    {
        var probe = Path.Combine(directory, $".druse-{Guid.NewGuid():N}.tmp");

        try
        {
            using (File.Create(probe, 1, FileOptions.DeleteOnClose))
            {
                return true;
            }
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException or NotSupportedException)
        {
            return false;
        }
    }
}
