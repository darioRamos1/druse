using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Platform.Abstractions;

namespace Druse.Application.Connections;

/// <summary>Resultado de guardar un perfil, con lo que el usuario debe saber sobre su contraseña.</summary>
/// <param name="Profile">Perfil ya persistido.</param>
/// <param name="PasswordStored">La contraseña quedó en el almacén del sistema.</param>
/// <param name="StoreDescription">Dónde quedó, o por qué no se pudo guardar.</param>
/// <param name="SshSecretStored">El secreto del túnel quedó en el almacén del sistema.</param>
public readonly record struct SaveConnectionResult(
    ConnectionProfile Profile,
    bool PasswordStored,
    string StoreDescription,
    bool SshSecretStored = false);

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

    /// <summary>
    /// Prefijo del secreto del túnel.
    ///
    /// Va por separado del de la base porque son dos secretos de dos máquinas
    /// distintas: cambiar la contraseña de una no debe tocar la de la otra.
    /// </summary>
    private const string SshSecretPrefix = "Druse:ssh:";

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
    ///
    /// **`null` y cadena vacía no significan lo mismo** en las contraseñas. Al
    /// editar un perfil, el formulario no puede mostrar la contraseña guardada
    /// —nadie la lee del almacén, ni debe— así que llega vacío aunque exista una.
    /// Por eso `null` con <paramref name="storePassword"/> activo quiere decir «no
    /// la toques», y solo la cadena vacía o desactivar el guardado la retiran. Sin
    /// esta distinción, cambiar el nombre de una conexión le borraría la
    /// contraseña.
    /// </summary>
    public async Task<SaveConnectionResult> SaveAsync(
        ConnectionProfile profile,
        string? password,
        bool storePassword,
        CancellationToken cancellationToken,
        string? sshSecret = null,
        bool storeSshSecret = false)
    {
        var validation = ConnectionProfileValidator.Validate(profile);

        if (!validation.IsValid)
        {
            throw new ArgumentException(string.Join(" ", validation.Errors), nameof(profile));
        }

        await _profiles.SaveAsync(profile, cancellationToken);

        var sshStored = await SaveSshSecretAsync(
            profile,
            sshSecret,
            storeSshSecret,
            cancellationToken);

        // Una conexión integrada no tiene contraseña que recordar; guardar la que
        // llegase dejaría un secreto que nadie va a volver a usar.
        if (profile.UsesIntegratedSecurity || !storePassword || password is "")
        {
            // Si antes había una guardada y ahora se pide no guardarla, hay que
            // retirarla: dejarla ahí contradiría lo que el usuario acaba de elegir.
            await _secrets.DeleteAsync(SecretKey(profile.Id), cancellationToken);

            return new SaveConnectionResult(profile, false, _secrets.Description, sshStored);
        }

        if (password is null)
        {
            // Se pidió seguir recordándola sin decir cuál: es una edición que no
            // tocó la contraseña, así que la que hubiera se queda como estaba.
            var kept = await HasStoredPasswordAsync(profile.Id, cancellationToken);

            return new SaveConnectionResult(profile, kept, _secrets.Description, sshStored);
        }

        if (!_secrets.IsAvailable)
        {
            return new SaveConnectionResult(profile, false, _secrets.Description, sshStored);
        }

        await _secrets.SetAsync(SecretKey(profile.Id), password, cancellationToken);

        return new SaveConnectionResult(profile, true, _secrets.Description, sshStored);
    }

    /// <summary>Borra el perfil y sus secretos, si los tenía.</summary>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        // Los secretos se borran siempre, aunque el perfil ya no esté: dejarlos
        // huérfanos en el llavero del usuario sería ensuciar su sistema.
        await _secrets.DeleteAsync(SecretKey(id), cancellationToken);
        await _secrets.DeleteAsync(SshSecretKey(id), cancellationToken);

        return await _profiles.DeleteAsync(id, cancellationToken);
    }

    /// <summary>
    /// Guarda el secreto del túnel, o lo retira.
    ///
    /// Un perfil que deja de usar túnel pierde también su secreto: conservarlo
    /// dejaría en el llavero una contraseña de un servidor al que ya no se entra.
    /// </summary>
    private async Task<bool> SaveSshSecretAsync(
        ConnectionProfile profile,
        string? secret,
        bool store,
        CancellationToken cancellationToken)
    {
        if (!profile.UsesSshTunnel || !store || secret is "")
        {
            await _secrets.DeleteAsync(SshSecretKey(profile.Id), cancellationToken);
            return false;
        }

        // Mismo trato que la contraseña de la base: `null` es «no lo toques».
        if (secret is null)
        {
            return await HasStoredSshSecretAsync(profile.Id, cancellationToken);
        }

        if (!_secrets.IsAvailable)
        {
            return false;
        }

        await _secrets.SetAsync(SshSecretKey(profile.Id), secret, cancellationToken);

        return true;
    }

    /// <summary>Secreto del túnel: contraseña del usuario SSH o passphrase de su clave.</summary>
    public async Task<SshCredentials> GetSshCredentialsAsync(
        Guid profileId,
        CancellationToken cancellationToken)
    {
        var secret = await _secrets.GetAsync(SshSecretKey(profileId), cancellationToken);

        // El código de un solo uso nunca se guarda; si hace falta, lo aporta quien
        // está conectando en ese momento.
        return new SshCredentials(secret, null);
    }

    public async Task<bool> HasStoredSshSecretAsync(Guid profileId, CancellationToken cancellationToken) =>
        await _secrets.GetAsync(SshSecretKey(profileId), cancellationToken) is not null;

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

    private static string SshSecretKey(Guid profileId) => $"{SshSecretPrefix}{profileId:D}";
}
