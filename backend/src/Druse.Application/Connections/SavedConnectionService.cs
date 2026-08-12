using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Platform.Abstractions;

namespace Druse.Application.Connections;

/// <summary>Resultado de guardar un perfil, con lo que el usuario debe saber sobre su contraseña.</summary>
/// <param name="Profile">Perfil ya persistido.</param>
/// <param name="PasswordStored">La contraseña quedó en el almacén del sistema.</param>
/// <param name="StoreDescription">Dónde quedó, o por qué no se pudo guardar.</param>
public readonly record struct SaveConnectionResult(
    ConnectionProfile Profile,
    bool PasswordStored,
    string StoreDescription);

/// <summary>
/// Perfiles guardados y sus contraseñas.
///
/// Reparte el trabajo entre dos almacenes distintos a propósito: los datos del
/// perfil van a SQLite, donde se pueden leer y editar, y la contraseña al almacén
/// del sistema operativo, que la cifra y la protege con la sesión del usuario.
/// Nunca se juntan en el mismo sitio (plan §12).
/// </summary>
public sealed class SavedConnectionService(
    IConnectionProfileStore profiles,
    ISecretStore secrets)
{
    /// <summary>Prefijo de la clave con la que se guarda cada secreto.</summary>
    private const string SecretPrefix = "Druse:connection:";

    private readonly IConnectionProfileStore _profiles = profiles;
    private readonly ISecretStore _secrets = secrets;

    /// <summary>Dónde se guardan las contraseñas en esta máquina.</summary>
    public string SecretStoreDescription => _secrets.Description;

    public bool CanStorePasswords => _secrets.IsAvailable;

    public Task<IReadOnlyList<ConnectionProfile>> GetAllAsync(CancellationToken cancellationToken) =>
        _profiles.GetAllAsync(cancellationToken);

    public Task<ConnectionProfile?> FindAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.FindAsync(id, cancellationToken);

    /// <summary>
    /// Guarda el perfil y, si se pide y hay dónde, también la contraseña.
    ///
    /// Guardar la contraseña es opcional: el usuario puede querer que se la pidan
    /// cada vez, y en máquinas sin almacén no hay alternativa.
    /// </summary>
    public async Task<SaveConnectionResult> SaveAsync(
        ConnectionProfile profile,
        string? password,
        bool storePassword,
        CancellationToken cancellationToken)
    {
        var validation = ConnectionProfileValidator.Validate(profile);

        if (!validation.IsValid)
        {
            throw new ArgumentException(string.Join(" ", validation.Errors), nameof(profile));
        }

        await _profiles.SaveAsync(profile, cancellationToken);

        if (!storePassword || string.IsNullOrEmpty(password))
        {
            // Si antes había una guardada y ahora se pide no guardarla, hay que
            // retirarla: dejarla ahí contradiría lo que el usuario acaba de elegir.
            await _secrets.DeleteAsync(SecretKey(profile.Id), cancellationToken);

            return new SaveConnectionResult(profile, false, _secrets.Description);
        }

        if (!_secrets.IsAvailable)
        {
            return new SaveConnectionResult(profile, false, _secrets.Description);
        }

        await _secrets.SetAsync(SecretKey(profile.Id), password, cancellationToken);

        return new SaveConnectionResult(profile, true, _secrets.Description);
    }

    /// <summary>Borra el perfil y su contraseña, si la tenía.</summary>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        // El secreto se borra siempre, aunque el perfil ya no esté: dejarlo
        // huérfano en el llavero del usuario sería ensuciar su sistema.
        await _secrets.DeleteAsync(SecretKey(id), cancellationToken);

        return await _profiles.DeleteAsync(id, cancellationToken);
    }

    /// <summary>
    /// Recupera las credenciales guardadas de un perfil.
    ///
    /// Devuelve credenciales vacías si no hay nada guardado, para que quien llama
    /// pueda distinguir «sin contraseña» de un fallo y pedirla al usuario.
    /// </summary>
    public async Task<DatabaseCredentials> GetCredentialsAsync(
        Guid profileId,
        CancellationToken cancellationToken)
    {
        var password = await _secrets.GetAsync(SecretKey(profileId), cancellationToken);

        return new DatabaseCredentials(password);
    }

    public async Task<bool> HasStoredPasswordAsync(Guid profileId, CancellationToken cancellationToken) =>
        await _secrets.GetAsync(SecretKey(profileId), cancellationToken) is not null;

    private static string SecretKey(Guid profileId) => $"{SecretPrefix}{profileId:D}";
}
