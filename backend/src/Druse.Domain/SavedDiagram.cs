namespace Druse.Domain;

/// <summary>
/// Un diagrama guardado.
///
/// **No lleva ni una columna ni un tipo, y es la decisión que lo gobierna todo.**
/// Lo que se guarda son las decisiones de quien lo armó —qué tablas entran, dónde
/// las puso, qué sugerencias descartó—; el esquema se relee del catálogo cada vez
/// que se abre. Guardarlo produciría un dibujo que sigue enseñando una columna
/// borrada hace seis meses, y un diagrama en el que no se puede confiar no se
/// mira.
///
/// `Model` viaja como JSON a propósito: su forma la decide la interfaz que lo
/// dibuja y cambiará con ella —posiciones, plegados, colores—, mientras que lo
/// que la base necesita saber para listarlo y borrarlo son las cuatro columnas
/// de al lado. Partirlo en tablas obligaría a migrar el esquema cada vez que el
/// lienzo gane una opción.
/// </summary>
public sealed record SavedDiagram
{
    public required Guid Id { get; init; }

    /// <summary>
    /// Conexión a la que pertenece.
    ///
    /// Un diagrama es de una conexión y no se comparte entre ellas: dibujar una
    /// relación entre dos servidores sería inventar algo que ningún motor
    /// comprueba.
    /// </summary>
    public required Guid ConnectionId { get; init; }

    /// <summary>Cómo se llama en la lista. Lo pone quien lo guarda.</summary>
    public required string Name { get; init; }

    /// <summary>Lo que la interfaz necesita para volver a dibujarlo, en JSON.</summary>
    public required string Model { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}
