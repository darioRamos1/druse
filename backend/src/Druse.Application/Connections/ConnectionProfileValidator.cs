using Druse.Domain;

namespace Druse.Application.Connections;

/// <summary>Resultado de validar un perfil antes de intentar conectarse.</summary>
/// <param name="Errors">Vacío cuando el perfil es válido.</param>
public readonly record struct ValidationResult(IReadOnlyList<string> Errors)
{
    public bool IsValid => Errors.Count == 0;

    public static ValidationResult Valid => new([]);
}

/// <summary>
/// Comprueba que un perfil tiene sentido antes de abrir una conexión.
///
/// Detectar aquí un puerto fuera de rango o un host vacío ahorra al usuario
/// esperar a que expire un intento de conexión para leer un error del driver que
/// no le dice qué escribió mal.
/// </summary>
public static class ConnectionProfileValidator
{
    private const int MaxNameLength = 120;

    public static ValidationResult Validate(ConnectionProfile? profile)
    {
        if (profile is null)
        {
            return new ValidationResult(["El perfil de conexión es obligatorio."]);
        }

        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(profile.Name))
        {
            errors.Add("El nombre de la conexión es obligatorio.");
        }
        else if (profile.Name.Length > MaxNameLength)
        {
            errors.Add($"El nombre no puede superar {MaxNameLength} caracteres.");
        }

        if (string.IsNullOrWhiteSpace(profile.Host))
        {
            errors.Add("El servidor es obligatorio.");
        }

        if (profile.Port is < 1 or > 65535)
        {
            errors.Add("El puerto debe estar entre 1 y 65535.");
        }

        if (string.IsNullOrWhiteSpace(profile.Database))
        {
            errors.Add("La base de datos es obligatoria.");
        }

        if (string.IsNullOrWhiteSpace(profile.Username))
        {
            errors.Add("El usuario es obligatorio.");
        }

        if (!Enum.IsDefined(profile.Engine))
        {
            errors.Add("El motor indicado no es válido.");
        }

        if (profile.ConnectTimeoutSeconds is < 1 or > 300)
        {
            errors.Add("El tiempo de espera de conexión debe estar entre 1 y 300 segundos.");
        }

        return new ValidationResult(errors);
    }
}
