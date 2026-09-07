using System.Collections.Concurrent;
using System.Globalization;
using System.Text;

using Druse.Platform.Abstractions;

namespace Druse.Host.LocalApi.Diagnostics;

/// <summary>
/// Cuánto se guarda y durante cuánto.
///
/// Los valores por omisión son deliberadamente pequeños: esto vive en el equipo
/// de una persona, y unos registros que crecen sin fin son un problema nuevo, no
/// una ayuda. Se pueden cambiar con `Logging:File:*`.
/// </summary>
public sealed record FileLogOptions
{
    /// <summary>Tamaño al que se cierra el archivo y se abre otro.</summary>
    public long MaxBytes { get; init; } = 2 * 1024 * 1024;

    /// <summary>Cuántos archivos se conservan, contando el que está abierto.</summary>
    public int MaxFiles { get; init; } = 5;

    /// <summary>Por debajo de este nivel no se escribe nada al archivo.</summary>
    public LogLevel MinimumLevel { get; init; } = LogLevel.Information;
}

/// <summary>
/// Registro local en archivo, con rotación por tamaño y retención por número.
///
/// **Existe porque la aplicación empaquetada no tiene consola.** El envoltorio
/// arranca la API con `CREATE_NO_WINDOW` —una ventana negra de ASP.NET delante de
/// Druse sería peor— y con ella se va el único sitio donde se veían los
/// registros: un fallo en el equipo de un usuario no dejaba rastro ninguno.
///
/// Se escribe a mano en vez de traer una biblioteca de registro: son un archivo,
/// un candado y un contador de bytes, y la alternativa es una dependencia más en
/// un proceso que ya viaja dentro del instalador (plan §13).
///
/// **Lo que no entra aquí**: contraseñas, tokens, cadenas de conexión y SQL. De
/// eso se encarga <see cref="LogRedaction"/>, y no como una opción sino como el
/// único camino: un registro con la contraseña del usuario dentro es peor que no
/// tener registro.
/// </summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private readonly object _gate = new();
    private readonly ConcurrentDictionary<string, FileLogger> _loggers = new(StringComparer.Ordinal);
    private readonly FileLogOptions _options;
    private readonly string _directory;
    private readonly string _path;

    private StreamWriter? _writer;
    private long _written;
    private bool _disposed;

    public FileLoggerProvider(IAppPaths paths, FileLogOptions options)
    {
        ArgumentNullException.ThrowIfNull(paths);
        ArgumentNullException.ThrowIfNull(options);

        _options = options;
        _directory = paths.LogDirectory;
        _path = Path.Combine(_directory, "druse.log");
    }

    public ILogger CreateLogger(string categoryName) =>
        _loggers.GetOrAdd(categoryName, name => new FileLogger(this, name));

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _writer?.Flush();
            _writer?.Dispose();
            _writer = null;
        }
    }

    internal bool IsEnabled(LogLevel level) =>
        level >= _options.MinimumLevel && level != LogLevel.None;

    /// <summary>
    /// Escribe una línea, rotando si el archivo ya está lleno.
    ///
    /// Todo bajo un candado: los registros llegan de peticiones HTTP y de
    /// trabajos largos a la vez, y dos escrituras cruzadas dejarían líneas
    /// partidas justo cuando alguien las está leyendo para entender un fallo.
    /// </summary>
    internal void Write(string line)
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            try
            {
                if (_writer is null)
                {
                    Open();
                }

                if (_written >= _options.MaxBytes)
                {
                    Rotate();
                }

                _writer!.WriteLine(line);
                _written += line.Length + Environment.NewLine.Length;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // No poder registrar no puede tumbar lo que se estaba
                // registrando. Se pierde la línea y se sigue.
                _writer = null;
            }
        }
    }

    private void Open()
    {
        Directory.CreateDirectory(_directory);

        _writer = new StreamWriter(
            new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.Read),
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false))
        {
            AutoFlush = true,
        };

        _written = File.Exists(_path) ? new FileInfo(_path).Length : 0;

        Restrict(_path);
    }

    /// <summary>
    /// Cierra el archivo lleno, lo numera y empieza otro.
    ///
    /// Los números van del más nuevo al más viejo —`druse.1.log` es el anterior—
    /// y el que se pasa del tope desaparece. Sin esto, los registros de una
    /// aplicación que alguien deja abierta meses crecerían sin límite.
    /// </summary>
    private void Rotate()
    {
        _writer!.Flush();
        _writer.Dispose();
        _writer = null;

        var oldest = Numbered(_options.MaxFiles - 1);

        if (File.Exists(oldest))
        {
            File.Delete(oldest);
        }

        for (var index = _options.MaxFiles - 2; index >= 1; index--)
        {
            var from = Numbered(index);

            if (File.Exists(from))
            {
                File.Move(from, Numbered(index + 1), overwrite: true);
            }
        }

        File.Move(_path, Numbered(1), overwrite: true);

        Open();
    }

    private string Numbered(int index) => Path.Combine(_directory, $"druse.{index}.log");

    /// <summary>
    /// El registro es del usuario y de nadie más.
    ///
    /// Aunque se saneen los secretos, aquí queda qué bases abre, cuándo y desde
    /// dónde. En Windows el perfil ya está cerrado; en Unix los permisos por
    /// omisión lo dejarían legible para cualquier cuenta de la máquina.
    /// </summary>
    private static void Restrict(string path)
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        try
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Sistemas de archivos que no admiten modos POSIX.
        }
    }
}

/// <summary>Una categoría de registro, escribiendo en el archivo del proveedor.</summary>
internal sealed class FileLogger(FileLoggerProvider provider, string category) : ILogger
{
    private readonly FileLoggerProvider _provider = provider;
    private readonly string _category = category;

    /// <summary>
    /// Los ámbitos se guardan para poder poner el identificador de la petición o
    /// del trabajo en cada línea: sin eso, dos operaciones a la vez producen un
    /// registro que no se puede separar.
    /// </summary>
    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull => LogScope.Push(state);

    public bool IsEnabled(LogLevel logLevel) => _provider.IsEnabled(logLevel);

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);

        if (!IsEnabled(logLevel))
        {
            return;
        }

        var line = new StringBuilder()
            .Append(DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture))
            .Append(' ')
            .Append(Short(logLevel))
            .Append(' ')
            .Append(_category);

        var scope = LogScope.Current;

        if (!string.IsNullOrEmpty(scope))
        {
            line.Append(" [").Append(scope).Append(']');
        }

        line.Append(" · ").Append(LogRedaction.Clean(formatter(state, exception)));

        if (exception is not null)
        {
            // El tipo y el mensaje, no la traza entera: la traza no dice nada que
            // el usuario pueda contar y sí puede llevar rutas y datos dentro.
            line.Append(" | ")
                .Append(exception.GetType().Name)
                .Append(": ")
                .Append(LogRedaction.Clean(exception.Message));
        }

        _provider.Write(line.ToString());
    }

    private static string Short(LogLevel level) => level switch
    {
        LogLevel.Trace => "TRC",
        LogLevel.Debug => "DBG",
        LogLevel.Information => "INF",
        LogLevel.Warning => "WRN",
        LogLevel.Error => "ERR",
        LogLevel.Critical => "CRT",
        _ => "···",
    };
}
