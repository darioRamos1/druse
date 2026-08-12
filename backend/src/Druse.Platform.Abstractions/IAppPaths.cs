namespace Druse.Platform.Abstractions;

/// <summary>
/// Directorios donde la aplicación guarda sus cosas.
///
/// Existe para que ningún otro proyecto construya rutas a mano. Windows, macOS y
/// Linux colocan los datos de usuario en sitios distintos, y una ruta fija sería
/// la primera cosa que impediría compilar para otra plataforma (ADR 0003).
/// </summary>
public interface IAppPaths
{
    /// <summary>Datos que deben sobrevivir a los reinicios: la base local.</summary>
    string DataDirectory { get; }

    /// <summary>Preferencias del usuario.</summary>
    string ConfigDirectory { get; }

    /// <summary>Archivos temporales y de trabajo. Se puede vaciar sin perder nada.</summary>
    string CacheDirectory { get; }

    /// <summary>Registros de la aplicación.</summary>
    string LogDirectory { get; }

    /// <summary>Ruta completa de la base SQLite local.</summary>
    string DatabaseFile { get; }

    /// <summary>
    /// Crea los directorios que falten.
    ///
    /// Es explícito y no automático en el constructor: escribir en disco es un
    /// efecto que debe verse en el código que lo provoca.
    /// </summary>
    void EnsureCreated();
}
