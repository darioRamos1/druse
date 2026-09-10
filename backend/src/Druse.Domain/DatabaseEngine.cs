namespace Druse.Domain;

/// <summary>Motor de base de datos al que apunta un perfil de conexión.</summary>
public enum DatabaseEngine
{
    PostgreSql = 1,
    SqlServer = 2,
    MySql = 3,

    /// <summary>
    /// IBM Informix, al que se llega por DRDA con el proveedor de DB2.
    ///
    /// El número no se reordena ni se reutiliza nunca: se guarda en la base local
    /// junto a cada perfil, y cambiarlo convertiría las conexiones guardadas de
    /// un usuario en las de otro motor.
    /// </summary>
    Informix = 4,

    /// <summary>
    /// El mismo Informix, pero por **SQLI**, su protocolo nativo.
    ///
    /// Va como motor aparte y no como una opción del perfil porque para quien
    /// conecta son dos cosas distintas: cambian el puerto —9088 frente a 9089—,
    /// hace falta el nombre del servidor lógico, y sobre todo cambia **si se
    /// puede conectar o no**. DRDA exige un escuchador `drsoctcp` que muchas
    /// instalaciones no levantan; SQLI lo atiende cualquier Informix.
    ///
    /// Lo que no cambia es nada más: el SQL, el catálogo y los tipos son los del
    /// mismo motor, y el proveedor los comparte.
    /// </summary>
    InformixSqli = 5,

    /// <summary>
    /// Oracle Database, por su cliente gestionado.
    ///
    /// No hace falta Instant Client ni nada instalado en la máquina del usuario,
    /// que es la promesa de Druse: lo que viaja es IL.
    /// </summary>
    Oracle = 6,
}
