using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Lo que se mandó no pasa la validación, y se dice **qué** no pasa.
///
/// Hasta ahora esto era un <see cref="ArgumentException"/> con los motivos
/// pegados en una cadena: el frontend recibía una frase en español y no tenía
/// forma de escribirla en otro idioma ni de señalar el campo. Con los mensajes
/// enteros —clave, texto y parámetros— puede hacer las dos cosas.
///
/// Sigue siendo un <see cref="ArgumentException"/> para que nada de lo que ya
/// lo capturaba deje de hacerlo mientras el resto de la migración avanza.
/// </summary>
public sealed class InvalidProfileException : ArgumentException
{
    public InvalidProfileException(IReadOnlyList<UserMessage> messages, string? paramName = null)
        : base(string.Join(" ", messages.Select(message => message.Text)), paramName)
    {
        Messages = messages;
    }

    /// <summary>Cada motivo, con su clave del catálogo.</summary>
    public IReadOnlyList<UserMessage> Messages { get; }
}
