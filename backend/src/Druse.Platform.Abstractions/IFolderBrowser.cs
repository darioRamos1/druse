namespace Druse.Platform.Abstractions;

/// <summary>Qué clase de sitio es una entrada del explorador.</summary>
public enum FolderKind
{
    /// <summary>Una carpeta cualquiera.</summary>
    Folder = 0,

    /// <summary>Una unidad: `C:\` en Windows, `/` en el resto.</summary>
    Drive = 1,

    /// <summary>Un sitio conocido del usuario: Escritorio, Documentos, Descargas.</summary>
    Known = 2,
}

/// <summary>Una carpeta, tal y como se enseña para elegir dónde guardar.</summary>
public sealed record FolderEntry
{
    /// <summary>Nombre a mostrar. En una unidad es la letra con su etiqueta.</summary>
    public required string Name { get; init; }

    /// <summary>Ruta completa, que es lo que se devuelve al elegirla.</summary>
    public required string Path { get; init; }

    public FolderKind Kind { get; init; }

    /// <summary>
    /// La carpeta lleva dentro el archivo que se pidió como señal.
    ///
    /// Es lo que distingue «una carpeta cualquiera» de «un respaldo»: un respaldo
    /// por carpetas se elige entero, y sin marcarlo habría que entrar en cada una
    /// a ver si dentro está el manifiesto.
    /// </summary>
    public bool Marked { get; init; }
}

/// <summary>Un archivo que se puede elegir para abrirlo.</summary>
public sealed record FileEntry
{
    public required string Name { get; init; }

    public required string Path { get; init; }

    /// <summary>Tamaño en bytes. Es lo que distingue un respaldo de su borrador.</summary>
    public long Size { get; init; }

    public DateTimeOffset ModifiedUtc { get; init; }
}

/// <summary>Qué se quiere ver al listar una carpeta.</summary>
public sealed record FolderQuery
{
    /// <summary>
    /// Extensiones de archivo que se enumeran, sin el punto.
    ///
    /// Vacío es lo normal —para guardar no hacen falta los archivos— y con algo
    /// dentro se está eligiendo qué abrir.
    /// </summary>
    public IReadOnlyList<string> Extensions { get; init; } = [];

    /// <summary>Archivo cuya presencia marca una subcarpeta, si se quiere marcar.</summary>
    public string? Marker { get; init; }
}

/// <summary>
/// Lo que hay dentro de una carpeta y por dónde se sale de ella.
///
/// Trae también el motivo cuando no se puede entrar: una carpeta del sistema sin
/// permisos es lo más común al navegar, y devolver una lista vacía haría pensar
/// que está vacía.
/// </summary>
public sealed record FolderListing
{
    /// <summary>Carpeta que se está mirando. Vacío en el nivel de las unidades.</summary>
    public string Path { get; init; } = string.Empty;

    /// <summary>La carpeta de arriba, o `null` si esta ya es una raíz.</summary>
    public string? Parent { get; init; }

    public IReadOnlyList<FolderEntry> Folders { get; init; } = [];

    /// <summary>Los archivos que se pidieron, si es que se pidió alguno.</summary>
    public IReadOnlyList<FileEntry> Files { get; init; } = [];

    /// <summary>Si se puede escribir aquí. Es lo que decide si se puede elegir.</summary>
    public bool CanWrite { get; init; }

    /// <summary>Por qué no se pudo leer, cuando no se pudo.</summary>
    public string? Error { get; init; }
}

/// <summary>Si un destino se puede usar, y qué pasaría si se usa.</summary>
public sealed record FolderTarget
{
    /// <summary>Ruta completa que resultaría de unir la carpeta y el nombre.</summary>
    public required string Path { get; init; }

    /// <summary>Si tal cual está se puede escribir.</summary>
    public bool CanWrite { get; init; }

    /// <summary>Ya hay algo con ese nombre: se sobrescribiría.</summary>
    public bool Exists { get; init; }

    /// <summary>Qué impide usarlo, en una frase.</summary>
    public string? Problem { get; init; }
}

/// <summary>
/// Enseña las carpetas del equipo para poder elegir una sin escribirla a mano.
///
/// Existe porque **el navegador no puede**: una página no ve el sistema de
/// archivos, y la aplicación de escritorio sí tiene el diálogo nativo. Sin esto,
/// en el navegador la única forma de decir dónde va un respaldo es teclear la
/// ruta entera y acertar.
///
/// Por omisión enumera **solo carpetas**: para elegir dónde guardar los archivos
/// no hacen falta, y no enseñar lo que no se necesita es la forma barata de no
/// enseñar de más. Los archivos se piden aparte y **por extensión**, que es el
/// otro caso: elegir el respaldo que se va a restaurar. La API que lo publica
/// escucha en loopback y exige token, igual que todo lo demás.
/// </summary>
public interface IFolderBrowser
{
    /// <summary>Separador de rutas de este sistema, para poder componer nombres.</summary>
    char Separator { get; }

    /// <summary>
    /// Por dónde se empieza: los sitios conocidos del usuario y las unidades.
    ///
    /// Los conocidos van primero porque son donde la gente guarda de verdad; las
    /// unidades están para todo lo demás.
    /// </summary>
    FolderListing Roots();

    /// <summary>
    /// Lo que hay en una ruta.
    ///
    /// Por omisión solo las carpetas, que es lo que hace falta para guardar. Con
    /// una consulta se piden además los archivos de ciertas extensiones —para
    /// elegir cuál abrir— y que se marquen las carpetas que llevan dentro un
    /// archivo concreto.
    /// </summary>
    FolderListing List(string path, FolderQuery? query = null);

    /// <summary>Crea una carpeta dentro de otra y devuelve dónde quedó.</summary>
    FolderTarget Create(string parent, string name);

    /// <summary>Une carpeta y nombre, y dice si eso se puede escribir.</summary>
    FolderTarget Resolve(string folder, string name);
}
