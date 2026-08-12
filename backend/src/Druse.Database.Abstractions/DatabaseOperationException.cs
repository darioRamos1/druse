using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// El motor rechazó una operación, y el motivo se puede contar.
///
/// Existe porque «se produjo un error inesperado» es mentira en la mayoría de
/// los casos: que falte un permiso, que el servidor no acepte la contraseña o
/// que una tabla ya no esté **son respuestas normales de una base de datos**, no
/// fallos del programa. Sin esto, el usuario veía un 500 genérico y el motivo se
/// quedaba en el log del servidor, donde no lo iba a leer nadie.
///
/// Lleva un <see cref="QueryError"/> y no la excepción del driver a propósito:
/// ese error ya pasó por el normalizador del proveedor, así que **no contiene la
/// cadena de conexión ni la contraseña** (plan §12).
/// </summary>
public sealed class DatabaseOperationException(QueryError error)
    : InvalidOperationException(error.Message)
{
    public QueryError Error { get; } = error;
}
