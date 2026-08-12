using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Druse.Platform.Abstractions;

namespace Druse.Platform.Native.Secrets;

/// <summary>
/// Almacén sobre el Administrador de credenciales de Windows.
///
/// Se llama directamente a `advapi32` en lugar de usar un paquete: son tres
/// funciones, y una dependencia externa para esto tendría que justificarse
/// (plan §13).
///
/// Las credenciales se guardan con persistencia local: no viajan con un perfil
/// móvil a otras máquinas.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed unsafe partial class WindowsSecretStore : ISecretStore
{
    private const uint CredTypeGeneric = 1;
    private const uint CredPersistLocalMachine = 2;
    private const int ErrorNotFound = 1168;

    public bool IsAvailable => true;

    public string Description => "Administrador de credenciales de Windows";

    public Task SetAsync(string key, string secret, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        ArgumentNullException.ThrowIfNull(secret);

        var blob = Encoding.UTF8.GetBytes(secret);

        fixed (byte* blobPointer = blob)
        fixed (char* targetPointer = key)
        fixed (char* userPointer = "Druse")
        {
            var credential = new Credential
            {
                Type = CredTypeGeneric,
                TargetName = targetPointer,
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = blobPointer,
                Persist = CredPersistLocalMachine,
                UserName = userPointer,
            };

            if (!CredWriteW(&credential, 0))
            {
                throw new InvalidOperationException(
                    $"No se pudo guardar la credencial (código {Marshal.GetLastWin32Error()}).");
            }
        }

        // El secreto ya está en el almacén; no debe quedar en memoria administrada
        // más de lo necesario.
        Array.Clear(blob);

        return Task.CompletedTask;
    }

    public Task<string?> GetAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        Credential* credential = null;

        try
        {
            if (!CredReadW(key, CredTypeGeneric, 0, &credential))
            {
                var error = Marshal.GetLastWin32Error();

                if (error == ErrorNotFound)
                {
                    return Task.FromResult<string?>(null);
                }

                throw new InvalidOperationException(
                    $"No se pudo leer la credencial (código {error}).");
            }

            if (credential->CredentialBlob is null || credential->CredentialBlobSize == 0)
            {
                return Task.FromResult<string?>(null);
            }

            var secret = Encoding.UTF8.GetString(
                credential->CredentialBlob,
                (int)credential->CredentialBlobSize);

            return Task.FromResult<string?>(secret);
        }
        finally
        {
            if (credential is not null)
            {
                CredFree(credential);
            }
        }
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);

        // Que no exista no es un error: borrar debe poder llamarse siempre.
        if (!CredDeleteW(key, CredTypeGeneric, 0))
        {
            var error = Marshal.GetLastWin32Error();

            if (error != ErrorNotFound)
            {
                throw new InvalidOperationException(
                    $"No se pudo borrar la credencial (código {error}).");
            }
        }

        return Task.CompletedTask;
    }

    /// <summary>Disposición de CREDENTIALW. El orden de los campos es el del sistema.</summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public char* TargetName;
        public char* Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public byte* CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public nint Attributes;
        public char* TargetAlias;
        public char* UserName;
    }

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CredWriteW(Credential* credential, uint flags);

    [LibraryImport("advapi32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CredReadW(string targetName, uint type, uint flags, Credential** credential);

    [LibraryImport("advapi32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CredDeleteW(string targetName, uint type, uint flags);

    [LibraryImport("advapi32.dll")]
    private static partial void CredFree(void* buffer);
}
