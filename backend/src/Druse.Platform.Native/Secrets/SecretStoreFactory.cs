using Druse.Platform.Abstractions;

namespace Druse.Platform.Native.Secrets;

/// <summary>
/// Elige el almacén que corresponde al sistema en ejecución.
///
/// Es el único sitio donde se ramifica por sistema operativo. Si ninguno sirve,
/// devuelve <see cref="NullSecretStore"/>: es preferible pedir la contraseña cada
/// vez y decirlo, a guardarla de una forma que parezca segura sin serlo.
/// </summary>
public static class SecretStoreFactory
{
    public static ISecretStore Create()
    {
        ISecretStore store = OperatingSystem.IsWindows()
            ? new WindowsSecretStore()
            : OperatingSystem.IsMacOS()
                ? new MacOsSecretStore()
                : OperatingSystem.IsLinux()
                    ? new LinuxSecretStore()
                    : new NullSecretStore();

        // Que exista la implementación no basta: en Linux puede faltar la
        // herramienta, y en ese caso vale más admitirlo desde el principio.
        return store.IsAvailable ? store : new NullSecretStore();
    }
}
