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
}
