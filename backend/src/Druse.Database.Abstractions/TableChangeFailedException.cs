using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// El motor rechazó una instrucción del diseñador, **y hay que decir qué quedó
/// hecho**.
///
/// Un cambio de tabla no es una instrucción sino varias —renombrar, cambiar el
/// tipo, rehacer un índice— y no todos los motores las deshacen si una falla a
/// mitad: MySQL confirma cada `ALTER` por su cuenta. Ahí, «no se pudo aplicar el
/// cambio» sería una media verdad peligrosa: la tabla ya no es la que era, y quien
/// vuelva a intentarlo desde el diseñador estará partiendo de otra cosa.
///
/// Por eso lleva las instrucciones que sí entraron y si se deshicieron o no.
/// </summary>
public sealed class TableChangeFailedException(
    QueryError error,
    string statement,
    IReadOnlyList<string> applied,
    bool reverted)
    : InvalidOperationException(Describe(error, applied, reverted))
{
    /// <summary>El error del motor, ya normalizado por su proveedor.</summary>
    public QueryError Error { get; } = error;

    /// <summary>La instrucción que el motor rechazó.</summary>
    public string Statement { get; } = statement;

    /// <summary>Las que se ejecutaron antes, en orden.</summary>
    public IReadOnlyList<string> Applied { get; } = applied;

    /// <summary>
    /// Si lo aplicado se deshizo.
    ///
    /// Falso solo donde el motor no sabe deshacer DDL. Es la diferencia entre
    /// «no pasó nada» y «la tabla cambió a medias».
    /// </summary>
    public bool Reverted { get; } = reverted;

    private static string Describe(QueryError error, IReadOnlyList<string> applied, bool reverted)
    {
        ArgumentNullException.ThrowIfNull(error);
        ArgumentNullException.ThrowIfNull(applied);

        if (reverted || applied.Count == 0)
        {
            return error.Message;
        }

        // El número va delante del mensaje del motor porque es lo que cambia la
        // siguiente decisión: repetir el cambio entero o retomarlo desde aquí.
        return $"{error.Message} Este motor no deshace los cambios de estructura, " +
            $"así que las {applied.Count} instrucciones anteriores ya están aplicadas.";
    }
}
