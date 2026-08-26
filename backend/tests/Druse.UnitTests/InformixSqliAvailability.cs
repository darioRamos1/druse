namespace Druse.UnitTests;

/// <summary>
/// Marca una prueba que necesita un Informix escuchando por **SQLI**.
///
/// Va aparte del que usa el resto de Informix porque son puertos distintos: el
/// 9089 atiende DRDA y el 9088 SQLI, y una prueba del puente JDBC contra el
/// primero no fallaría con un error claro, se quedaría esperando.
/// </summary>
public sealed class RequiresInformixSqliFactAttribute : FactAttribute
{
    public RequiresInformixSqliFactAttribute()
    {
        if (!InformixSqliAvailability.IsAvailable.Value)
        {
            Skip = "No hay un Informix de pruebas escuchando SQLI en "
                + $"{InformixSqliAvailability.Host}:{InformixSqliAvailability.Port}. "
                + "Se levanta con `./build/scripts/test-db.ps1 -Engine informix`.";
        }
    }
}

internal static class InformixSqliAvailability
{
    public static string Host =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_HOST") ?? "127.0.0.1";

    public static int Port =>
        int.TryParse(
            Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SQLI_PORT"),
            System.Globalization.CultureInfo.InvariantCulture,
            out var puerto)
            ? puerto
            : 9088;

    public static readonly Lazy<bool> IsAvailable = new(Probe);

    /// <summary>Un socket TCP basta para saber si merece la pena intentarlo.</summary>
    private static bool Probe()
    {
        try
        {
            using var client = new System.Net.Sockets.TcpClient();

            return client.ConnectAsync(Host, Port).Wait(TimeSpan.FromSeconds(3)) && client.Connected;
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            return false;
        }
    }
}
