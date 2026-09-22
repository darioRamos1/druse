namespace Druse.Domain;

/// <summary>
/// Las claves de catálogo que el backend manda al frontend.
///
/// Son constantes y no cadenas sueltas por dos razones: el compilador caza las
/// erratas, y `MessageKeysTests` las compara una a una contra
/// `frontend/src/i18n/es.json`. Esa prueba es lo que une los dos lados del
/// repositorio: una clave que se escriba aquí y no exista allí no llega a la
/// rama principal, y el usuario nunca ve una clave cruda en pantalla.
/// </summary>
public static class MessageKeys
{
    /// <summary>Lo que se comprueba de un perfil antes de intentar conectarse.</summary>
    public static class Connection
    {
        public const string Required = "server.connection.required";
        public const string Name = "server.connection.name";
        public const string NameTooLong = "server.connection.nameTooLong";
        public const string Host = "server.connection.host";
        public const string Port = "server.connection.port";
        public const string DatabaseFile = "server.connection.databaseFile";
        public const string Database = "server.connection.database";
        public const string Username = "server.connection.username";
        public const string Authentication = "server.connection.authentication";
        public const string WindowsOnSqlServer = "server.connection.windowsOnSqlServer";
        public const string WindowsOnWindows = "server.connection.windowsOnWindows";
        public const string Engine = "server.connection.engine";
        public const string InformixServer = "server.connection.informixServer";
        public const string Timeout = "server.connection.timeout";
    }

    /// <summary>El servidor intermedio, que es otra máquina y otros errores.</summary>
    public static class Tunnel
    {
        public const string Host = "server.tunnel.host";
        public const string Port = "server.tunnel.port";
        public const string Username = "server.tunnel.username";
        public const string Authentication = "server.tunnel.authentication";
        public const string PrivateKey = "server.tunnel.privateKey";
        public const string Timeout = "server.tunnel.timeout";
    }
}
