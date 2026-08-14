using System.Globalization;
using Druse.Application.Abstractions;
using Druse.Domain;
using Renci.SshNet;
using Renci.SshNet.Common;

namespace Druse.Ssh;

/// <summary>
/// Túnel SSH sobre SSH.NET.
///
/// Es el único punto del backend que conoce la librería: el resto de la
/// aplicación solo ve <see cref="ISshTunnel"/> y una dirección local a la que
/// conectarse.
/// </summary>
public sealed class SshTunnelFactory : ISshTunnelFactory
{
    /// <summary>Solo se escucha en bucle local: el túnel es de este equipo.</summary>
    private const string LoopbackHost = "127.0.0.1";

    public async Task<ISshTunnel> OpenAsync(
        SshTunnelSettings settings,
        SshCredentials credentials,
        string remoteHost,
        int remotePort,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentException.ThrowIfNullOrWhiteSpace(remoteHost);

        var client = new SshClient(BuildConnectionInfo(settings, credentials));

        try
        {
            await client.ConnectAsync(cancellationToken);

            // El puerto local lo elige el sistema: fijar uno se toparía tarde o
            // temprano con otro programa que ya lo tuviera cogido.
            var port = new ForwardedPortLocal(LoopbackHost, 0, remoteHost, (uint)remotePort);

            client.AddForwardedPort(port);
            port.Start();

            return new SshTunnel(client, port);
        }
        catch (OperationCanceledException)
        {
            client.Dispose();
            throw;
        }
        catch (Exception exception)
        {
            client.Dispose();

            throw new SshTunnelException(Describe(exception, settings), exception);
        }
    }

    /// <summary>
    /// Prepara la sesión SSH con un único método de autenticación.
    ///
    /// Se ofrece solo el que el usuario eligió: dejar que la librería pruebe
    /// varios haría que un servidor con la cuenta bloqueada acumulara intentos
    /// fallidos por cada conexión.
    /// </summary>
    private static ConnectionInfo BuildConnectionInfo(
        SshTunnelSettings settings,
        SshCredentials credentials)
    {
        AuthenticationMethod method = settings.Authentication switch
        {
            SshAuthenticationMode.PrivateKey => PrivateKey(settings, credentials),
            SshAuthenticationMode.KeyboardInteractive => KeyboardInteractive(credentials),
            _ => new PasswordAuthenticationMethod(settings.Username, credentials.Secret ?? string.Empty),
        };

        return new ConnectionInfo(settings.Host, settings.Port, settings.Username, method)
        {
            Timeout = TimeSpan.FromSeconds(settings.ConnectTimeoutSeconds),
        };
    }

    private static PrivateKeyAuthenticationMethod PrivateKey(
        SshTunnelSettings settings,
        SshCredentials credentials)
    {
        if (!File.Exists(settings.PrivateKeyPath))
        {
            throw new SshTunnelException(
                $"No se encontró el archivo de clave privada '{settings.PrivateKeyPath}'.");
        }

        PrivateKeyFile key;

        try
        {
            key = string.IsNullOrEmpty(credentials.Secret)
                ? new PrivateKeyFile(settings.PrivateKeyPath)
                : new PrivateKeyFile(settings.PrivateKeyPath, credentials.Secret);
        }
        catch (SshPassPhraseNullOrEmptyException)
        {
            throw new SshTunnelException(
                "La clave privada está protegida con una passphrase y no se indicó ninguna.");
        }
        catch (SshException exception)
        {
            // El mensaje de la librería distingue «passphrase incorrecta» de
            // «esto no es una clave», y ambas cosas las arregla el usuario.
            throw new SshTunnelException(
                $"No se pudo leer la clave privada: {exception.Message}",
                exception);
        }

        return new PrivateKeyAuthenticationMethod(settings.Username, key);
    }

    /// <summary>
    /// Responde a lo que el servidor vaya preguntando.
    ///
    /// El orden es el único dato con el que se puede trabajar: los servidores no
    /// etiquetan sus preguntas de forma estándar, así que la primera se responde
    /// con el secreto y la siguiente con el código de un solo uso. Un servidor que
    /// solo pida el código funciona igual, porque entonces la primera pregunta ya
    /// es la del código.
    /// </summary>
    private static KeyboardInteractiveAuthenticationMethod KeyboardInteractive(
        SshCredentials credentials)
    {
        var method = new KeyboardInteractiveAuthenticationMethod(string.Empty);
        var answers = new Queue<string>();

        if (!string.IsNullOrEmpty(credentials.Secret))
        {
            answers.Enqueue(credentials.Secret);
        }

        if (!string.IsNullOrEmpty(credentials.VerificationCode))
        {
            answers.Enqueue(credentials.VerificationCode);
        }

        method.AuthenticationPrompt += (_, args) =>
        {
            foreach (var prompt in args.Prompts)
            {
                prompt.Response = answers.Count > 0 ? answers.Dequeue() : string.Empty;
            }
        };

        return method;
    }

    /// <summary>
    /// Traduce el fallo a algo que el usuario pueda leer.
    ///
    /// El mensaje nombra el servidor y el usuario porque ambos son datos que él
    /// escribió y puede corregir; nunca incluye el secreto.
    /// </summary>
    private static string Describe(Exception exception, SshTunnelSettings settings)
    {
        var target = string.Create(
            CultureInfo.InvariantCulture,
            $"{settings.Username}@{settings.Host}:{settings.Port}");

        return exception switch
        {
            SshTunnelException known => known.Message,

            SshAuthenticationException =>
                $"El servidor SSH {target} rechazó las credenciales.",

            SshOperationTimeoutException =>
                $"El servidor SSH {target} no respondió a tiempo.",

            SshConnectionException =>
                $"No se pudo establecer la sesión SSH con {target}: {exception.Message}",

            System.Net.Sockets.SocketException =>
                $"No se pudo alcanzar el servidor SSH {target}.",

            _ => $"No se pudo abrir el túnel SSH contra {target}: {exception.Message}",
        };
    }
}

/// <summary>
/// Sesión SSH viva con su puerto reenviado.
///
/// Cliente y reenvío se cierran juntos: un puerto abierto sobre una sesión caída
/// aceptaría conexiones que no llegan a ninguna parte.
/// </summary>
internal sealed class SshTunnel(SshClient client, ForwardedPortLocal port) : ISshTunnel
{
    private bool _disposed;

    public string Host => port.BoundHost;

    public int Port => (int)port.BoundPort;

    public bool IsOpen => !_disposed && port.IsStarted && client.IsConnected;

    public ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return ValueTask.CompletedTask;
        }

        _disposed = true;

        // Al cerrar no queda nada que salvar: si el reenvío o la sesión ya se
        // cayeron, lo único que importa es soltar los recursos de ambos.
        try
        {
            if (port.IsStarted)
            {
                port.Stop();
            }
        }
        catch (SshException)
        {
            // La sesión ya no estaba; el puerto muere con ella.
        }

        port.Dispose();
        client.Dispose();

        return ValueTask.CompletedTask;
    }
}
