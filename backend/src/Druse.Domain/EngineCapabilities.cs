namespace Druse.Domain;

/// <summary>
/// Lo que un motor sabe hacer, dicho por el propio motor.
///
/// Existe para que ninguna capa de arriba vuelva a preguntar «¿y si es MySQL?».
/// El precedente es <see cref="IndexCapabilities"/>, que ya dibuja el formulario
/// de índices sin que ningún componente sepa contra qué está conectado: aquí se
/// hace lo mismo con el resto de diferencias que se habían quedado repartidas en
/// condicionales por el validador, el traductor de tipos y el diálogo de
/// conexión.
///
/// **Lo que no se declara, no compila.** Las propiedades con valor por omisión
/// describen al motor corriente —un servidor con host, puerto y usuario—; las
/// que no lo tienen son <c>required</c> a propósito, porque una respuesta por
/// omisión sería una mentira plausible: un motor nuevo que heredase «lo conserva
/// todo» haría que el asistente de traslado prometiera una traducción exacta que
/// pierde datos, y nadie se enteraría hasta después de copiarlos.
///
/// Aquí **no** está cómo se escribe el SQL de cada motor —comillas, límite de
/// filas, truncado de fechas—. Eso vive donde se escribe el SQL: en el
/// diseñador de cada proveedor y, para el generador visual de consultas, en la
/// tabla de dialectos del navegador. Traer expresiones de SQL por la API sería
/// mandar plantillas de texto para que las rellene otro.
/// </summary>
public sealed record EngineCapabilities
{
    // --- Forma del perfil de conexión ---------------------------------------

    /// <summary>
    /// Hay un servidor al que apuntar.
    ///
    /// Falso en los motores que son un archivo. No es un detalle del formulario:
    /// decide si «el servidor es obligatorio» es un error útil o un sinsentido
    /// para quien solo tenía que elegir una ruta.
    /// </summary>
    public bool RequiresHost { get; init; } = true;

    /// <summary>Hay una identidad que escribir. Falso en los motores sin usuarios.</summary>
    public bool RequiresUsername { get; init; } = true;

    /// <summary>
    /// Hay que decir a qué base se va, y no vale dejarlo en blanco.
    ///
    /// En un servidor, una base vacía significa «la primera a la que tenga
    /// acceso»: quien conecta a un servidor ajeno rara vez se sabe de memoria el
    /// nombre de su base, y exigírselo antes de dejarle entrar es pedirle el dato
    /// que venía a buscar. **En un motor que es un archivo no hay tal cosa**: sin
    /// la ruta no hay nada que abrir.
    /// </summary>
    public bool RequiresDatabase { get; init; }

    /// <summary>
    /// La base de datos **es un archivo del disco**, y lo que el perfil guarda en
    /// su lugar es una ruta.
    ///
    /// Cambia el formulario entero: donde había un nombre que escribir hay un
    /// archivo que elegir, y las palabras dejan de hablar de servidores. No es
    /// una preferencia estética: decirle «el servidor es obligatorio» a quien
    /// solo tenía que buscar un `.db` no le dice nada.
    /// </summary>
    public bool UsesFilePath { get; init; }

    /// <summary>
    /// Druse sabe crear una base de este motor desde el formulario de conexión.
    ///
    /// Hoy solo los que son un archivo: crear uno vacío es una operación cerrada
    /// y sin decisiones —no hay codificación, ni espacio de tablas, ni cotejo que
    /// preguntar— y **es la única forma de empezar**, porque un archivo que no
    /// existe no se puede abrir.
    ///
    /// En un servidor no está, y no por falta de ganas: `CREATE DATABASE` lleva
    /// detrás media docena de decisiones que cambian según el motor, y ofrecerlo
    /// como un botón sin ellas crearía bases que después hay que rehacer. Es una
    /// función por derecho propio, no un añadido de este formulario.
    /// </summary>
    public bool CanCreateDatabase { get; init; }

    /// <summary>
    /// Hace falta el nombre del servidor lógico, aparte del de la máquina.
    ///
    /// Hoy solo Informix por SQLI, donde es el alias del <c>sqlhosts</c> y sin él
    /// el driver no sabe con cuál de las instancias del servidor quiere hablar.
    /// </summary>
    public bool RequiresLogicalServer { get; init; }

    /// <summary>
    /// El motor acepta la identidad de la sesión del sistema en lugar de una
    /// contraseña. Hoy solo SQL Server.
    /// </summary>
    public bool SupportsIntegratedSecurity { get; init; }

    /// <summary>
    /// Se puede llegar por un servidor intermedio.
    ///
    /// Un motor que es un archivo local no tiene puerto que reenviar, y ofrecer
    /// el túnel sería ofrecer un camino a ninguna parte.
    /// </summary>
    public bool SupportsSshTunnel { get; init; } = true;

    /// <summary>
    /// Hay un transporte que cifrar. Falso cuando no se sale de la máquina.
    /// </summary>
    public bool SupportsTransportEncryption { get; init; } = true;

    // --- Lo que promete una sesión ------------------------------------------

    /// <summary>
    /// El motor tiene sesiones de solo lectura de verdad.
    ///
    /// Cuando es cierto, el servidor rechaza cualquier escritura venga por donde
    /// venga —una función con efectos laterales, un <c>SELECT INTO</c>—. Cuando
    /// no, lo único que hay es el aviso del analizador, **que no es una
    /// frontera**. Se declara para poder decir la verdad en la interfaz: enseñar
    /// el mismo candado en todos los motores sería prometer lo que solo algunos
    /// cumplen.
    ///
    /// Es la misma distinción que <c>IDatabaseSession.ReadOnlyEnforcedByEngine</c>,
    /// pero contestada **antes de conectar**, que es cuando el formulario tiene
    /// que explicar qué significa marcar la casilla.
    /// </summary>
    public bool EnforcesReadOnlySessions { get; init; }

    // --- Qué guarda tal cual ------------------------------------------------

    /// <summary>
    /// Familias de datos que este motor guarda con un tipo propio.
    ///
    /// Es la mitad que le toca a cada motor de traducir tipos entre motores: la
    /// otra —clasificar lo que se lee— la hace <see cref="ColumnValueParser"/>.
    /// Con esto no hace falta una tabla de todos contra todos, que con seis
    /// motores serían treinta direcciones y crece al cuadrado.
    ///
    /// **Es obligatoria.** Una familia que falta significa que el destino no
    /// tiene dónde meterla sin perder algo, y ese aviso es el producto del
    /// asistente de traslado: acertar con el nombre del tipo es fácil, y lo que
    /// hace falta saber antes de copiar es qué deja de ser cierto en el destino.
    /// </summary>
    public required IReadOnlyList<ColumnFamily> NativeFamilies { get; init; }

    /// <summary>
    /// Hay un tipo que comprueba que lo que entra es JSON y sabe consultarlo por
    /// sus campos. Sin él, el JSON viaja entero pero pasa a ser texto.
    /// </summary>
    public bool StoresJson { get; init; }

    /// <summary>
    /// Una columna puede guardar varios valores y seguir sabiendo cuántos son.
    ///
    /// Es lo más caro de perder: copiada como texto, «tres etiquetas» se
    /// convierte en la cadena que las representa y nadie vuelve a leerlas como
    /// tres.
    /// </summary>
    public bool StoresArrays { get; init; }

    /// <summary>Si guarda esta familia con un tipo propio.</summary>
    public bool Stores(ColumnFamily family) => NativeFamilies.Contains(family);
}
