using Druse.Application.Abstractions;
using Druse.Application.Secrets;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Platform.Abstractions;

namespace Druse.Application.Connections;

/// <summary>Resultado de guardar un perfil, con lo que el usuario debe saber sobre su contraseña.</summary>
/// <param name="Profile">Perfil ya persistido.</param>
/// <param name="PasswordStored">La contraseña quedó en el almacén del sistema.</param>
/// <param name="StoreDescription">Dónde quedó, o por qué no se pudo guardar.</param>
/// <param name="SshSecretStored">El secreto del túnel quedó en el almacén del sistema.</param>
/// <param name="SecretWarning">
/// Qué salió mal con el almacén del sistema, si algo salió mal. El perfil está
/// guardado igual: ver <see cref="SecretWriter"/>.
/// </param>
public readonly record struct SaveConnectionResult(
    ConnectionProfile Profile,
    bool PasswordStored,
    string StoreDescription,
    bool SshSecretStored = false,
    string? SecretWarning = null);

/// <summary>
/// Perfiles guardados y sus contraseñas.
///
/// Reparte el trabajo entre dos almacenes distintos a propósito: los datos del
/// perfil van a SQLite, donde se pueden leer y editar, y la contraseña al almacén
/// del sistema operativo, que la cifra y la protege con la sesión del usuario.
/// Nunca se juntan en el mismo sitio (plan §12).
///
/// Que sean dos almacenes significa que son dos escrituras sin transacción común,
/// y que una puede fallar sin la otra. Lo que se hace entonces está en
/// <see cref="SecretWriter"/>, y el orden de las dos operaciones —qué va primero
/// al guardar y qué al borrar— es parte de esa decisión, no una casualidad.
/// </summary>
public sealed class SavedConnectionService(
    IConnectionProfileStore profiles,
    ISecretStore secrets,
    IProviderRegistry providers)
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
    private readonly IProviderRegistry _providers = providers;

    /// <summary>
    /// Lo que el motor del perfil dice de sí mismo, o `null` si en esta
    /// compilación no hay quien lo implemente.
    ///
    /// Se pregunta **antes** de validar, así que hay que contemplar el motor sin
    /// proveedor: un perfil pudo guardarse con una compilación que sí lo traía.
    /// Ese caso no lo arregla el validador —lo dirá <c>GetProvider</c> un momento
    /// después, con su propio mensaje—; aquí basta con no reventar antes de
    /// llegar.
    /// </summary>
    private EngineCapabilities? Capabilities(ConnectionProfile? profile) =>
        profile is not null && _providers.SupportedEngines.Contains(profile.Engine)
            ? _providers.GetProvider(profile.Engine).Capabilities
            : null;

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
    ///
    /// **El perfil se guarda primero.** Es la mitad que el usuario ve y puede
    /// corregir; si después falla el llavero, el perfil se queda y el resultado lo
    /// cuenta en <see cref="SaveConnectionResult.SecretWarning"/> en vez de
    /// reventar la petición. Al revés —el secreto primero— un fallo del perfil
    /// dejaría en el llavero el secreto de una conexión que no existe, y nadie
    /// volvería a saber su clave para retirarlo.
    /// </summary>
    public async Task<SaveConnectionResult> SaveAsync(
        ConnectionProfile profile,
        string? password,
        bool storePassword,
        CancellationToken cancellationToken,
        string? sshSecret = null,
        bool storeSshSecret = false)
    {
        var validation = ConnectionProfileValidator.Validate(profile, Capabilities(profile));

        if (!validation.IsValid)
        {
            throw new InvalidProfileException(validation.Messages, nameof(profile));
        }

        await _profiles.SaveAsync(profile, cancellationToken);

        // De aquí en adelante el perfil ya está en la base: lo que falle en el
        // llavero se cuenta, no se lanza.
        var writer = new SecretWriter(_secrets);

        var sshStored = await SaveSshSecretAsync(
            profile,
            sshSecret,
            storeSshSecret,
            writer,
            cancellationToken);

        var passwordStored = await SavePasswordAsync(
            profile,
            password,
            storePassword,
            writer,
            cancellationToken);

        return new SaveConnectionResult(
            profile,
            passwordStored,
            _secrets.Description,
            sshStored,
            writer.Warning);
    }

    /// <summary>
    /// Borra el perfil y sus secretos, si los tenía.
    ///
    /// **Los secretos van primero, y si no se pueden borrar el perfil se queda.**
    /// Es al revés que al guardar, y por la misma razón: la clave del secreto se
    /// deriva del identificador del perfil, así que borrar el perfil antes de
    /// tiempo dejaría en el llavero del usuario una contraseña que ya nadie sabe
    /// nombrar. Un perfil que no se dejó borrar se vuelve a borrar; un secreto
    /// huérfano se queda ahí para siempre.
    /// </summary>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        // Se borran aunque el perfil ya no esté: dejarlos huérfanos en el llavero
        // del usuario sería ensuciar su sistema.
        await _secrets.DeleteAsync(SecretKey(id), cancellationToken);
        await _secrets.DeleteAsync(SshSecretKey(id), cancellationToken);

        return await _profiles.DeleteAsync(id, cancellationToken);
    }

    /// <summary>Guarda la contraseña de la base, la conserva o la retira.</summary>
    private async Task<bool> SavePasswordAsync(
        ConnectionProfile profile,
        string? password,
        bool store,
        SecretWriter writer,
        CancellationToken cancellationToken)
    {
        // Una conexión integrada no tiene contraseña que recordar; guardar la que
        // llegase dejaría un secreto que nadie va a volver a usar.
        if (profile.UsesIntegratedSecurity || !store || password is "")
        {
            // Si antes había una guardada y ahora se pide no guardarla, hay que
            // retirarla: dejarla ahí contradiría lo que el usuario acaba de elegir.
            await writer.ForgetAsync(SecretKey(profile.Id), "la contraseña", cancellationToken);

            return false;
        }

        if (password is null)
        {
            // Se pidió seguir recordándola sin decir cuál: es una edición que no
            // tocó la contraseña, así que la que hubiera se queda como estaba.
            return await writer.ExistsAsync(
                SecretKey(profile.Id),
                "la contraseña",
                cancellationToken);
        }

        if (!_secrets.IsAvailable)
        {
            return false;
        }

        return await writer.StoreAsync(
            SecretKey(profile.Id),
            password,
            "la contraseña",
            cancellationToken);
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
        SecretWriter writer,
        CancellationToken cancellationToken)
    {
        if (!profile.UsesSshTunnel || !store || secret is "")
        {
            await writer.ForgetAsync(
                SshSecretKey(profile.Id),
                "el secreto del túnel",
                cancellationToken);

            return false;
        }

        // Mismo trato que la contraseña de la base: `null` es «no lo toques».
        if (secret is null)
        {
            return await writer.ExistsAsync(
                SshSecretKey(profile.Id),
                "el secreto del túnel",
                cancellationToken);
        }

        if (!_secrets.IsAvailable)
        {
            return false;
        }

        return await writer.StoreAsync(
            SshSecretKey(profile.Id),
            secret,
            "el secreto del túnel",
            cancellationToken);
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
