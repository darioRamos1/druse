namespace Druse.Domain;

/// <summary>
/// Algo que hay que contarle a una persona, en el idioma que ella eligió.
///
/// El backend no sabe en qué idioma está la ventana —ni debe: la misma API
/// atiende a la aplicación y a quien la llame desde una consola—, así que manda
/// **la clave y sus parámetros** y el texto lo pone el frontend con su catálogo.
///
/// <see cref="Text"/> no sobra: es lo que se escribe en los registros, lo que ve
/// quien llame a la API sin catálogo, y lo que se enseña mientras un mensaje aún
/// no tenga clave. Así la migración se puede hacer mensaje a mensaje sin que en
/// ningún momento se vea un hueco vacío.
/// </summary>
/// <param name="Key">La clave del catálogo, como <c>connection.error.name</c>.</param>
/// <param name="Text">El texto en español, que es el idioma fuente.</param>
/// <param name="Args">
/// Los parámetros del mensaje, **sin formatear**: los números y las fechas van en
/// formato invariante y es el frontend quien los escribe como toque en cada
/// idioma.
/// </param>
/// <param name="KeyArgs">
/// Los parámetros que **también** son claves del catálogo.
///
/// Hay frases que se arman con una palabra del propio programa: «El nombre de la
/// columna es obligatorio» es la misma frase que «El nombre del índice es
/// obligatorio», y la única diferencia es el nombre de la cosa. Mandarlas como
/// veintiuna claves parecidas obliga a traducir veintiuna veces lo mismo; pegar
/// la palabra en español dentro del texto impide traducirla. Así que la palabra
/// viaja como clave —<c>server.thing.column</c>— y el frontend la traduce antes
/// de meterla en la frase.
/// </param>
public sealed record UserMessage(
    string Key,
    string Text,
    IReadOnlyDictionary<string, string>? Args = null,
    IReadOnlyDictionary<string, string>? KeyArgs = null)
{
    /// <summary>Un mensaje con un solo parámetro, que es el caso corriente.</summary>
    public static UserMessage With(string key, string text, string name, string value) =>
        new(key, text, new Dictionary<string, string> { [name] = value });

    /// <summary>Un mensaje cuyo único parámetro es otra clave del catálogo.</summary>
    public static UserMessage WithTerm(string key, string text, string name, string term) =>
        new(key, text, null, new Dictionary<string, string> { [name] = term });
}
