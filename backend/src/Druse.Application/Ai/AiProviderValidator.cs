using System.Globalization;

using Druse.Application.Connections;
using Druse.Domain;

namespace Druse.Application.Ai;

/// <summary>
/// Comprueba que un proveedor tiene sentido antes de preguntarle nada.
///
/// Lo que se caza aquí son los errores que, de pasar, salen como un fallo de red
/// o un 404 del proveedor: una URL que apunta al sitio equivocado, un modelo sin
/// nombre. Ninguno de esos mensajes le dice a nadie qué escribió mal.
/// </summary>
public static class AiProviderValidator
{
    private const int MaxNameLength = 120;

    public static ValidationResult Validate(AiProviderProfile? profile)
    {
        if (profile is null)
        {
            return new ValidationResult(
                [new UserMessage(MessageKeys.AiProvider.Required, "El proveedor es obligatorio.")]);
        }

        var errors = new List<UserMessage>();

        if (string.IsNullOrWhiteSpace(profile.Name))
        {
            errors.Add(new UserMessage(
                MessageKeys.AiProvider.Name,
                "El nombre del proveedor es obligatorio."));
        }
        else if (profile.Name.Length > MaxNameLength)
        {
            errors.Add(UserMessage.With(
                MessageKeys.AiProvider.NameTooLong,
                $"El nombre no puede superar {MaxNameLength} caracteres.",
                "max",
                MaxNameLength.ToString(CultureInfo.InvariantCulture)));
        }

        if (profile.Kind == AiProviderKind.LocalCli)
        {
            if (string.IsNullOrWhiteSpace(profile.Command))
            {
                errors.Add(new UserMessage(
                    MessageKeys.AiProvider.Command,
                    "Falta el programa que atiende a este proveedor."));
            }
            else if (profile.Command is not ("claude" or "codex"))
            {
                errors.Add(new UserMessage(
                    MessageKeys.AiProvider.UnknownCommand,
                    "El programa debe ser claude o codex."));
            }

            return new ValidationResult(errors);
        }

        if (string.IsNullOrWhiteSpace(profile.Model))
        {
            errors.Add(new UserMessage(MessageKeys.AiProvider.Model, "El modelo es obligatorio."));
        }

        ValidateBaseUrl(profile, errors);

        return new ValidationResult(errors);
    }

    private static void ValidateBaseUrl(AiProviderProfile profile, List<UserMessage> errors)
    {
        if (string.IsNullOrWhiteSpace(profile.BaseUrl))
        {
            errors.Add(new UserMessage(MessageKeys.AiProvider.BaseUrl, "La URL base es obligatoria."));

            return;
        }

        if (!Uri.TryCreate(profile.BaseUrl, UriKind.Absolute, out var url)
            || (url.Scheme != Uri.UriSchemeHttp && url.Scheme != Uri.UriSchemeHttps))
        {
            errors.Add(new UserMessage(
                MessageKeys.AiProvider.BaseUrlScheme,
                "La URL base debe empezar por http:// o https://."));

            return;
        }

        /*
         * Pegar la ruta completa es el error que todo el mundo comete.
         *
         * Se copia de la documentación del proveedor —que enseña el `curl`
         * entero— y entonces Druse pide `/v1/chat/completions/chat/completions`,
         * que responde 404. El mensaje del proveedor no dice qué sobra, así que
         * lo dice Druse.
         */
        var forbiddenPath = profile.Kind switch
        {
            AiProviderKind.Anthropic => "/messages",
            AiProviderKind.Gemini => ":generateContent",
            _ => "/chat/completions",
        };

        if (url.AbsolutePath.Contains(forbiddenPath, StringComparison.OrdinalIgnoreCase))
        {
            errors.Add(UserMessage.With(
                MessageKeys.AiProvider.BaseUrlPath,
                $"La URL base termina donde empieza {forbiddenPath}: quita esa parte.",
                "path",
                forbiddenPath));
        }

        /*
         * Sin cifrar **se avisa, no se prohíbe**.
         *
         * Empezó siendo un error, y estaba mal: muchos servidores internos de
         * empresa —un LiteLLM detrás del cortafuegos, un vLLM en la red local—
         * solo hablan `http`, y rechazarlos empujaba a escribir `https` sobre un
         * puerto que no lo atiende. El resultado era un fallo de TLS
         * incomprensible («corrupted frame») en lugar de una conexión que
         * funciona. Quién puede espiar esa red es cosa de quien la administra,
         * no de Druse; el aviso lo da la pantalla.
         */
    }
}
