using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text;
using Druse.Platform.Abstractions;

namespace Druse.Platform.Native.Secrets;

/// <summary>
/// Almacén sobre el Llavero de macOS, usando la herramienta `security`.
///
/// Se invoca el ejecutable del sistema en lugar de enlazar con Security.framework
/// porque hacerlo por P/Invoke exige mantener estructuras de Core Foundation y
/// su gestión de memoria, y aquí solo hacen falta tres operaciones.
///
/// La contraseña se pasa por argumento, que en macOS es visible en la lista de
/// procesos durante un instante. Es el mismo compromiso que aceptan otras
/// herramientas de desarrollo; la alternativa sería enlazar el framework, y queda
/// anotado como mejora pendiente.
/// </summary>
[SupportedOSPlatform("macos")]
internal sealed class MacOsSecretStore : ISecretStore
{
    private const string Service = "Druse";

    public bool IsAvailable => File.Exists("/usr/bin/security");

    public string Description => "Llavero de macOS";

    public async Task SetAsync(string key, string secret, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        // `-U` actualiza si ya existe, en lugar de fallar.
        var result = await ProcessRunner.RunAsync(
            "/usr/bin/security",
            ["add-generic-password", "-a", key, "-s", Service, "-w", MacOsSecretCodec.Encode(secret), "-U"],
            cancellationToken);

        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException("No se pudo guardar la credencial en el Llavero.");
        }
    }

    public async Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        var result = await ProcessRunner.RunAsync(
            "/usr/bin/security",
            ["find-generic-password", "-a", key, "-s", Service, "-w"],
            cancellationToken);

        // Código 44: no existe. No es un error.
        return result.ExitCode == 0
            ? MacOsSecretCodec.Decode(result.StandardOutput.TrimEnd('\r', '\n'))
            : null;
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        await ProcessRunner.RunAsync(
            "/usr/bin/security",
            ["delete-generic-password", "-a", key, "-s", Service],
            cancellationToken);
    }
}

internal static class MacOsSecretCodec
{
    private const string Prefix = "druse:v1:";

    internal static string Encode(string secret) =>
        Prefix + Convert.ToBase64String(Encoding.UTF8.GetBytes(secret));

    internal static string Decode(string stored) => stored.StartsWith(Prefix, StringComparison.Ordinal)
        ? Encoding.UTF8.GetString(Convert.FromBase64String(stored[Prefix.Length..]))
        : stored;
}

/// <summary>
/// Almacén sobre el Secret Service de Linux, usando `secret-tool` de libsecret.
///
/// No todos los escritorios lo traen: si falta, el registro de plataforma
/// devuelve <see cref="NullSecretStore"/> y la aplicación pide la contraseña cada
/// vez, en lugar de inventarse un almacén propio.
/// </summary>
[SupportedOSPlatform("linux")]
internal sealed class LinuxSecretStore : ISecretStore
{
    private const string Application = "druse";

    private readonly string? _executable = FindSecretTool();

    public bool IsAvailable => _executable is not null;

    public string Description => "Secret Service (libsecret)";

    public async Task SetAsync(string key, string secret, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        EnsureAvailable();

        // `secret-tool store` lee el secreto por la entrada estándar, así que no
        // aparece en la lista de procesos.
        var result = await ProcessRunner.RunAsync(
            _executable!,
            ["store", "--label", $"Druse: {key}", "application", Application, "key", key],
            cancellationToken,
            standardInput: secret);

        if (result.ExitCode != 0)
        {
            throw new InvalidOperationException("No se pudo guardar la credencial en el Secret Service.");
        }
    }

    public async Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        if (!IsAvailable)
        {
            return null;
        }

        var result = await ProcessRunner.RunAsync(
            _executable!,
            ["lookup", "application", Application, "key", key],
            cancellationToken);

        return result.ExitCode == 0 && result.StandardOutput.Length > 0
            ? result.StandardOutput.TrimEnd('\n')
            : null;
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        if (!IsAvailable)
        {
            return;
        }

        await ProcessRunner.RunAsync(
            _executable!,
            ["clear", "application", Application, "key", key],
            cancellationToken);
    }

    private void EnsureAvailable()
    {
        if (!IsAvailable)
        {
            throw new InvalidOperationException(
                "No hay Secret Service disponible. Instala libsecret-tools para guardar contraseñas.");
        }
    }

    private static string? FindSecretTool()
    {
        string[] candidates = ["/usr/bin/secret-tool", "/bin/secret-tool", "/usr/local/bin/secret-tool"];

        return candidates.FirstOrDefault(File.Exists);
    }
}

/// <summary>Ejecuta una herramienta del sistema y recoge su salida.</summary>
internal static class ProcessRunner
{
    public readonly record struct Result(int ExitCode, string StandardOutput, string StandardError);

    public static async Task<Result> RunAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken,
        string? standardInput = null)
    {
        var info = new ProcessStartInfo
        {
            FileName = fileName,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = standardInput is not null,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        foreach (var argument in arguments)
        {
            info.ArgumentList.Add(argument);
        }

        using var process = Process.Start(info)
            ?? throw new InvalidOperationException($"No se pudo ejecutar '{fileName}'.");

        if (standardInput is not null)
        {
            await process.StandardInput.WriteAsync(standardInput);
            process.StandardInput.Close();
        }

        var output = await process.StandardOutput.ReadToEndAsync(cancellationToken);
        var error = await process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken);

        return new Result(process.ExitCode, output, error);
    }
}
