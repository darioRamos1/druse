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
/// Solo enumera **carpetas**, nunca archivos: para elegir dónde guardar no hacen
/// falta, y no enseñar lo que no se necesita es la forma barata de no enseñar de
/// más. La API que lo publica escucha en loopback y exige token, igual que todo
/// lo demás.
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

    /// <summary>Las subcarpetas de una ruta.</summary>
    FolderListing List(string path);

    /// <summary>Crea una carpeta dentro de otra y devuelve dónde quedó.</summary>
    FolderTarget Create(string parent, string name);

    /// <summary>Une carpeta y nombre, y dice si eso se puede escribir.</summary>
    FolderTarget Resolve(string folder, string name);
}
