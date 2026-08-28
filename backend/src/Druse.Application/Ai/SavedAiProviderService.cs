using Druse.Application.Abstractions;
using Druse.Domain;
using Druse.Platform.Abstractions;

namespace Druse.Application.Ai;

/// <summary>Resultado de guardar un proveedor, con lo que el usuario debe saber sobre su clave.</summary>
/// <param name="Profile">Perfil ya persistido.</param>
/// <param name="KeyStored">La clave quedó en el almacén del sistema.</param>
/// <param name="StoreDescription">Dónde quedó, o por qué no se pudo guardar.</param>
public readonly record struct SaveAiProviderResult(
    AiProviderProfile Profile,
    bool KeyStored,
    string StoreDescription);

/// <summary>
/// Proveedores guardados y sus claves.
///
/// Reparte el trabajo entre dos almacenes distintos, igual que las conexiones:
/// el perfil a SQLite, donde se lee y se edita, y la clave al almacén del
/// sistema operativo, que la cifra con la sesión del usuario. Nunca se juntan
/// (plan §12).
/// </summary>
public sealed class SavedAiProviderService(
    IAiProviderStore providers,
    ISecretStore secrets)
{
    /// <summary>Prefijo de la clave con la que se guarda cada secreto.</summary>
    private const string SecretPrefix = "Druse:ai:";

    private readonly IAiProviderStore _providers = providers;
    private readonly ISecretStore _secrets = secrets;

    /// <summary>Dónde se guardan las claves en esta máquina.</summary>
    public string SecretStoreDescription => _secrets.Description;

    public bool CanStoreKeys => _secrets.IsAvailable;

    public Task<IReadOnlyList<AiProviderProfile>> GetAllAsync(CancellationToken cancellationToken) =>
        _providers.GetAllAsync(cancellationToken);

    public Task<AiProviderProfile?> FindAsync(Guid id, CancellationToken cancellationToken) =>
        _providers.FindAsync(id, cancellationToken);

    /// <summary>
    /// Guarda el perfil y, si viene y hay dónde, también la clave.
    ///
    /// **`null` y cadena vacía no significan lo mismo**, por la misma razón que
    /// en las conexiones: al editar un proveedor el formulario no puede mostrar
    /// la clave guardada —nadie la lee del almacén, ni debe— así que llega vacía
    /// aunque exista una. `null` quiere decir «no la toques»; la cadena vacía la
    /// retira. Sin esa distinción, cambiar el modelo de un proveedor le borraría
    /// la clave.
    /// </summary>
    public async Task<SaveAiProviderResult> SaveAsync(
        AiProviderProfile profile,
        string? apiKey,
        CancellationToken cancellationToken)
    {
        var validation = AiProviderValidator.Validate(profile);

        if (!validation.IsValid)
        {
            throw new ArgumentException(string.Join(" ", validation.Errors), nameof(profile));
        }

        await _providers.SaveAsync(profile, cancellationToken);

        // Solo uno puede ser el de por omisión: si este lo reclama, se lo quita a
        // quien lo tuviera. Hacerlo aquí y no en el almacén deja la regla a la
        // vista de quien lea la aplicación, en vez de escondida en un UPDATE.
        if (profile.IsDefault)
        {
            await ClearOtherDefaultsAsync(profile.Id, cancellationToken);
        }

        var stored = await SaveKeyAsync(profile, apiKey, cancellationToken);

        return new SaveAiProviderResult(profile, stored, _secrets.Description);
    }

    /// <summary>Recupera la clave guardada, o `null` si no hay ninguna.</summary>
    public Task<string?> GetKeyAsync(Guid id, CancellationToken cancellationToken) =>
        _secrets.GetAsync(SecretPrefix + id.ToString("N"), cancellationToken);

    /// <summary>Borra el perfil y, con él, su clave.</summary>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        // El secreto se borra pase lo que pase con el perfil: si el perfil ya no
        // estaba, una clave suelta en el almacén no le sirve a nadie y solo puede
        // sobrevivir a quien la puso.
        await _secrets.DeleteAsync(SecretPrefix + id.ToString("N"), cancellationToken);

        return await _providers.DeleteAsync(id, cancellationToken);
    }

    private async Task<bool> SaveKeyAsync(
        AiProviderProfile profile,
        string? apiKey,
        CancellationToken cancellationToken)
    {
        if (apiKey is null)
        {
            return false;
        }

        var key = SecretPrefix + profile.Id.ToString("N");

        if (apiKey.Length == 0)
        {
            await _secrets.DeleteAsync(key, cancellationToken);

            return false;
        }

        if (!_secrets.IsAvailable)
        {
            return false;
        }

        await _secrets.SetAsync(key, apiKey, cancellationToken);

        return true;
    }

    private async Task ClearOtherDefaultsAsync(Guid keep, CancellationToken cancellationToken)
    {
        var all = await _providers.GetAllAsync(cancellationToken);

        foreach (var other in all)
        {
            if (other.Id != keep && other.IsDefault)
            {
                await _providers.SaveAsync(other with { IsDefault = false }, cancellationToken);
            }
        }
    }
}
