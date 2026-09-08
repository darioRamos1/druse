using Druse.Platform.Abstractions;

namespace Druse.Application.Secrets;

/// <summary>
/// Escrituras al almacén del sistema que no tumban lo que ya se guardó en SQLite.
///
/// Un perfil se guarda en dos sitios a propósito: los datos en la base local y el
/// secreto en el llavero del sistema (plan §12). Son dos escrituras, no hay
/// transacción que las una, y la segunda puede fallar sola: el llavero bloqueado,
/// una sesión sin escritorio, una política de empresa que lo prohíbe. Sin nada que
/// lo trate, esa mitad fallida sube como excepción, el cliente recibe un 500 y
/// **el perfil se ha guardado igual**; el usuario cree que no se guardó nada y
/// vuelve a crearlo.
///
/// La compensación no es deshacer el perfil, sino dejar el conjunto en el estado
/// que Druse ya sabe tratar: **perfil guardado, sin secreto, y dicho en voz
/// alta**. Es lo mismo que ocurre en una máquina sin almacén
/// (<see cref="NullSecretStore"/>), que aquí es un estado de primera clase: se
/// pide el secreto cada vez. Borrar el perfil sería peor —se perdería el
/// formulario entero por un fallo del llavero— y no arregla nada que no arregle
/// esto.
///
/// De ahí las tres reglas:
///
/// - **Si no se pudo escribir, no queda nada escrito.** Se intenta retirar lo que
///   hubiera: dejar el secreto anterior es peor que no tener ninguno, porque la
///   conexión fallaría con una contraseña que el usuario acaba de cambiar y nadie
///   entendería por qué.
/// - **Si no se pudo retirar, se dice.** Es el aviso que más importa: el usuario
///   pidió dejar de recordar algo y sigue en su llavero.
/// - **Un fallo al consultar no es un fallo.** Se responde «no hay», que lleva a
///   pedirlo, y se avisa.
///
/// Lo que no entra aquí es la cancelación: si quien pidió guardar se fue, no hay a
/// quién avisar ni nada que compensar.
///
/// Se crea uno por operación, porque acumula los avisos de esa operación.
/// </summary>
public sealed class SecretWriter(ISecretStore secrets)
{
    private readonly ISecretStore _secrets = secrets;
    private readonly List<string> _warnings = [];

    /// <summary>
    /// Lo que hay que contarle al usuario, o `null` si no hubo nada que contar.
    ///
    /// Va en el resultado de guardar, no en un registro: quien acaba de pulsar
    /// «Guardar» es el único que puede hacer algo al respecto.
    /// </summary>
    public string? Warning => _warnings.Count == 0 ? null : string.Join(" ", _warnings);

    /// <summary>
    /// Guarda un secreto. Devuelve si quedó guardado.
    ///
    /// <paramref name="what"/> se mete en el aviso tal cual, así que se escribe
    /// como frase nominal en minúscula: «la contraseña», «el secreto del túnel».
    /// </summary>
    public async Task<bool> StoreAsync(
        string key,
        string secret,
        string what,
        CancellationToken cancellationToken)
    {
        try
        {
            await _secrets.SetAsync(key, secret, cancellationToken);

            return true;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            _warnings.Add(
                $"No se pudo guardar {what} en {_secrets.Description}; se pedirá cuando haga falta.");

            await TryDeleteAsync(
                key,
                $"Además, {what} de antes sigue en {_secrets.Description}: conviene quitar esa " +
                "entrada a mano.",
                cancellationToken);

            return false;
        }
    }

    /// <summary>Retira un secreto que ya no debe conservarse.</summary>
    public Task ForgetAsync(string key, string what, CancellationToken cancellationToken) =>
        TryDeleteAsync(
            key,
            $"Atención: no se pudo retirar {what} de {_secrets.Description} y sigue ahí. " +
            "Conviene quitar esa entrada a mano.",
            cancellationToken);

    /// <summary>Si hay un secreto guardado con esa clave.</summary>
    public async Task<bool> ExistsAsync(string key, string what, CancellationToken cancellationToken)
    {
        try
        {
            return await _secrets.GetAsync(key, cancellationToken) is not null;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            _warnings.Add(
                $"No se pudo consultar {what} en {_secrets.Description}; se pedirá cuando haga falta.");

            return false;
        }
    }

    /// <summary>
    /// Borra sin quejarse, y si no puede lo apunta con el aviso que corresponda.
    ///
    /// El mensaje del sistema no se propaga al usuario: dice cosas como «the stub
    /// received bad data» que no ayudan a nadie, y hacerlo llegar a la interfaz
    /// sería abrir un camino por donde algún día pasaría algo que no debe salir.
    /// </summary>
    private async Task TryDeleteAsync(string key, string warning, CancellationToken cancellationToken)
    {
        try
        {
            await _secrets.DeleteAsync(key, cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Si no había nada que retirar, el fallo no le cambia nada al usuario
            // y contárselo sería ruido: casi todos los perfiles no tienen túnel,
            // así que con el llavero roto cada guardado avisaría de secretos que
            // nunca existieron.
            if (await StillThereAsync(key, cancellationToken))
            {
                _warnings.Add(warning);
            }
        }
    }

    /// <summary>
    /// Si el secreto sigue guardado.
    ///
    /// Ante la duda, sí: callar un secreto que se quedó es peor que un aviso de
    /// más.
    /// </summary>
    private async Task<bool> StillThereAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            return await _secrets.GetAsync(key, cancellationToken) is not null;
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return true;
        }
    }
}
