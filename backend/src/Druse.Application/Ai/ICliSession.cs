namespace Druse.Application.Ai;

/// <summary>
/// Qué se sabe de la sesión de un programa de consola.
/// </summary>
/// <param name="Installed">El programa existe en este equipo.</param>
/// <param name="LoggedIn">
/// Hay sesión iniciada. **`null` significa que no se pudo averiguar**, que no es
/// lo mismo que «no»: algunos programas no tienen forma de preguntárselo, y
/// enseñar «sin sesión» cuando quizá la haya manda a la gente a iniciar una que
/// ya tenía.
/// </param>
/// <param name="Account">Con qué cuenta, cuando el programa lo dice.</param>
/// <param name="Plan">Qué suscripción, cuando el programa lo dice.</param>
/// <param name="Detail">Lo que haya que contarle a quien mire la pantalla.</param>
public readonly record struct CliSessionState(
    bool Installed,
    bool? LoggedIn,
    string? Account,
    string? Plan,
    string Detail);

/// <summary>
/// Mira y arranca la sesión de los programas de consola.
///
/// **El inicio de sesión ocurre en el programa, nunca en Druse.** No hay forma
/// de que una aplicación de terceros autentique una cuenta de Claude o de
/// ChatGPT, y un formulario aquí que pidiera usuario y contraseña tendría la
/// forma exacta de una estafa —además de no funcionar, por el segundo factor—.
/// Lo que Druse puede hacer es lo que hace esto: comprobar si ya hay sesión y
/// abrir la ventana donde el propio programa la pide.
/// </summary>
public interface ICliSession
{
    /// <summary>
    /// Averigua qué sabe el programa de su propia sesión.
    /// </summary>
    /// <param name="profileId">
    /// Perfil que quiere su propia cuenta, o `null` para mirar la sesión que
    /// comparte todo el equipo. Son dos preguntas distintas: la misma máquina
    /// puede tener sesión en una y no en la otra.
    /// </param>
    Task<CliSessionState> InspectAsync(
        string command,
        Guid? profileId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Abre una consola donde el programa pide las credenciales.
    ///
    /// Devuelve en cuanto la ventana existe: lo que pase dentro —el navegador
    /// que se abre, el código que se pega— es cosa del programa y de su dueño.
    /// </summary>
    Task<bool> StartLoginAsync(
        string command,
        Guid? profileId,
        CancellationToken cancellationToken);
}
