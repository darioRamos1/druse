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
public sealed record UserMessage(
    string Key,
    string Text,
    IReadOnlyDictionary<string, string>? Args = null)
{
    /// <summary>Un mensaje con un solo parámetro, que es el caso corriente.</summary>
    public static UserMessage With(string key, string text, string name, string value) =>
        new(key, text, new Dictionary<string, string> { [name] = value });
}
