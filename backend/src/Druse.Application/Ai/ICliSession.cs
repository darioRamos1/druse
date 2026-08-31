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
/// Qué pasó al intentar abrir la consola del inicio de sesión.
/// </summary>
/// <param name="Started">La ventana existe y el programa está pidiendo la cuenta.</param>
/// <param name="Manual">
/// La orden equivalente, para teclearla a mano.
///
/// Va siempre, no solo cuando falla. Abrir una ventana de terminal es lo único
/// de todo esto que depende del escritorio que haya delante —hay Linux sin
/// ninguno instalado—, y ahí la diferencia entre una función rota y una que se
/// puede terminar a mano es esta línea. Lleva dentro la variable de entorno,
/// que es lo que nadie adivinaría.
/// </param>
public readonly record struct CliLaunch(bool Started, string Manual);

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
    /// <param name="sessionDirectory">
    /// Carpeta de credenciales del perfil que quiere su propia cuenta, o `null`
    /// para mirar la sesión que comparte todo el equipo. Son dos preguntas
    /// distintas: la misma máquina puede tener sesión en una y no en la otra.
    /// La compone <see cref="AiSessionDirectory"/>, que es quien sabe dónde van.
    /// </param>
    Task<CliSessionState> InspectAsync(
        string command,
        string? sessionDirectory,
        CancellationToken cancellationToken);

    /// <summary>
    /// Abre una consola donde el programa pide las credenciales.
    ///
    /// Devuelve en cuanto la ventana existe: lo que pase dentro —el navegador
    /// que se abre, el código que se pega— es cosa del programa y de su dueño.
    /// </summary>
    Task<CliLaunch> StartLoginAsync(
        string command,
        string? sessionDirectory,
        CancellationToken cancellationToken);
}
