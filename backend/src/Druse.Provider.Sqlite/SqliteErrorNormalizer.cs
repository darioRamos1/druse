using System.Globalization;
using Druse.Domain;
using Microsoft.Data.Sqlite;

namespace Druse.Provider.Sqlite;

/// <summary>
/// Convierte excepciones de Microsoft.Data.Sqlite en <see cref="QueryError"/>.
///
/// El resto del sistema no debe conocer los tipos del driver, igual que en los
/// otros cinco proveedores. Lo que aquí cambia es que **el motor casi no
/// explica**: sus mensajes son de una línea y en inglés, y hay dos que se leen
/// mal si se dejan pasar tal cual.
/// </summary>
internal static class SqliteErrorNormalizer
{
    /// <summary>El archivo no está donde dice el perfil.</summary>
    internal const int CannotOpen = 14;

    /// <summary>Otro está escribiendo. SQLite admite un solo escritor.</summary>
    internal const int Busy = 5;

    /// <summary>La base se abrió en solo lectura y algo intentó escribir.</summary>
    internal const int ReadOnly = 8;

    public static QueryError Normalize(Exception exception) => exception switch
    {
        SqliteException sqlite => new QueryError
        {
            Message = Text(sqlite),
            // El código primario de SQLite, que es un número pequeño y estable
            // —1 error de SQL, 14 no se puede abrir— y el que sale en su
            // documentación. Se transporta como texto, igual que en los demás.
            Code = sqlite.SqliteErrorCode.ToString(CultureInfo.InvariantCulture),
        },

        TimeoutException => new QueryError
        {
            Message = "La operación superó el tiempo de espera.",
        },

        OperationCanceledException => new QueryError
        {
            Message = "La operación se canceló.",
        },

        _ => new QueryError
        {
            Message = exception.Message,
        },
    };

    /// <summary>
    /// El mensaje, con dos casos traducidos porque los suyos no se entienden.
    ///
    /// «unable to open database file» es lo que dice SQLite tanto si la ruta no
    /// existe como si el directorio no deja escribir, y no menciona la ruta: quien
    /// lo lee no sabe si se equivocó al escribirla o si le falta un permiso.
    ///
    /// «attempt to write a readonly database» es correcto pero suena a fallo,
    /// cuando es exactamente lo que el usuario pidió al marcar la casilla.
    /// </summary>
    private static string Text(SqliteException exception) => exception.SqliteErrorCode switch
    {
        CannotOpen =>
            "No se pudo abrir el archivo de la base de datos. Comprueba que la ruta existe " +
            "y que tienes permiso para leerla; Druse no crea el archivo por su cuenta.",

        ReadOnly =>
            "La conexión está en solo lectura y el motor rechazó la escritura. " +
            "Desmarca «Solo lectura» en el perfil para poder escribir.",

        Busy =>
            "La base está ocupada por otra escritura. SQLite admite un solo escritor a la " +
            "vez; vuelve a intentarlo cuando la otra termine.",

        _ => exception.Message,
    };
}
