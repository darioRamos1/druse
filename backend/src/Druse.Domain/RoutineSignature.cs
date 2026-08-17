namespace Druse.Domain;

/// <summary>
/// Por dónde entra y sale un valor de una rutina.
///
/// Es lo que decide cómo se escribe la llamada: un parámetro de entrada acepta
/// un literal, pero uno de salida necesita una variable donde recoger el valor,
/// y esa variable hay que declararla antes y leerla después.
/// </summary>
public enum RoutineParameterDirection
{
    /// <summary>Solo entra. Es la inmensa mayoría.</summary>
    Input,

    /// <summary>Solo sale.</summary>
    Output,

    /// <summary>Entra y sale por el mismo sitio.</summary>
    InputOutput,

    /// <summary>
    /// El valor que devuelve la rutina, que no es un parámetro con nombre.
    ///
    /// Se representa aquí porque para quien llama se comporta igual que una
    /// salida: hay que recogerlo en algún sitio para poder verlo.
    /// </summary>
    Return,
}

/// <summary>
/// Un parámetro de un procedimiento o función, tal como está en el catálogo.
///
/// El tipo se conserva **como lo escribe el motor** —`varchar(200)`,
/// `numeric(12,2)`— porque es lo que hay que enseñar al lado del campo para que
/// alguien sepa qué escribir, y lo que hace falta para declarar la variable de
/// una salida.
/// </summary>
public sealed record RoutineParameter
{
    /// <summary>
    /// Nombre del parámetro, con el adorno que use el motor: SQL Server los
    /// nombra con `@` y ese `@` forma parte del nombre en la llamada.
    ///
    /// Puede venir vacío: PostgreSQL admite parámetros sin nombre, y entonces
    /// solo se pueden pasar por posición.
    /// </summary>
    public required string Name { get; init; }

    public required string DataType { get; init; }

    public RoutineParameterDirection Direction { get; init; } = RoutineParameterDirection.Input;

    /// <summary>Posición en la firma, empezando por 1.</summary>
    public int Ordinal { get; init; }

    /// <summary>
    /// El parámetro se puede omitir porque el motor pone un valor.
    ///
    /// Importa para la llamada: omitir uno con valor por omisión es válido, y
    /// omitir uno sin él es un error que conviene evitar antes de ejecutar.
    /// </summary>
    public bool HasDefault { get; init; }
}

/// <summary>
/// La firma completa de una rutina: lo que hace falta para poder llamarla.
///
/// Se lee entera de una vez, como <see cref="TableStructure"/> y por el mismo
/// motivo: una conexión no ejecuta dos cosas a la vez, así que pedir los
/// parámetros por partes serían varios turnos seguidos sobre la misma sesión.
/// </summary>
public sealed record RoutineSignature
{
    public required string Name { get; init; }

    public string? Schema { get; init; }

    /// <summary>
    /// Una función devuelve un valor y se llama dentro de un `SELECT`; un
    /// procedimiento se ejecuta por su cuenta. La forma de la llamada cambia por
    /// completo, así que esto no es informativo.
    /// </summary>
    public bool IsFunction { get; init; }

    public IReadOnlyList<RoutineParameter> Parameters { get; init; } = [];

    /// <summary>Tipo que devuelve una función, tal como lo escribe el motor.</summary>
    public string? ReturnType { get; init; }
}
