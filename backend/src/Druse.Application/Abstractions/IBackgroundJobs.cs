namespace Druse.Application.Abstractions;

/// <summary>
/// Qué clase de trabajo largo es.
///
/// **Y qué se puede hacer con uno que quedó a medias**, que es distinto en cada
/// una:
///
/// - Un <see cref="Backup"/> se repite desde cero. Lo que quedó escrito no sirve
///   —le falta el manifiesto, o lo lleva marcado como incompleto— y rehacerlo no
///   toca nada del origen: es solo tiempo.
/// - Una <see cref="Restore"/> **sí se reanuda**, y por eso existe `ResumeFrom`:
///   repetirla desde el principio fallaría en el primer `CREATE TABLE` y
///   duplicaría filas en los `INSERT`. Se sigue desde la instrucción en la que se
///   quedó, que es la que dice su estado.
/// - Un <see cref="Transfer"/> depende de cómo se pidió. «Todo o nada» se repite
///   entero: la transacción se deshizo y en el destino no quedó nada. Sin él, lo
///   que entró está confirmado, así que repetirlo duplicaría salvo que el modo
///   sea actualizar u omitir lo existente —los que hacen el traslado repetible—.
///
/// Nada de esto se hace solo: lo que Druse sabe es **decir qué quedó a medias**,
/// y quien decide es la persona que mira su base.
/// </summary>
public enum JobKind
{
    Backup = 0,
    Restore = 1,
    Transfer = 2,
}

/// <summary>
/// Un trabajo largo listo para ejecutarse fuera de la petición que lo pidió.
///
/// Lleva **qué hacer**, no los servicios con los que hacerlo: quien lo ejecuta le
/// entrega un proveedor con su propio scope. Es toda la diferencia con el
/// `Task.Run` que había antes, que se llevaba los servicios del scope de la
/// petición HTTP y seguía usándolos después de que ese scope se cerrara.
/// </summary>
public sealed record QueuedJob
{
    public required Guid Id { get; init; }

    public required JobKind Kind { get; init; }

    /// <summary>
    /// Sobre qué trabaja, para poder decirlo después.
    ///
    /// La base de datos en un traslado, el destino en un respaldo, el artefacto
    /// en una restauración. Es lo único que se guarda del contenido: ni
    /// credenciales, ni SQL, ni filas.
    /// </summary>
    public string? Subject { get; init; }

    /// <summary>
    /// El token con el que se cancela desde fuera, que es el del registro de
    /// trabajos de su clase.
    /// </summary>
    public required CancellationToken Token { get; init; }

    /// <summary>
    /// Lo que hay que hacer, con los servicios que le den. Devuelve cómo acabó.
    ///
    /// El resultado se devuelve en vez de deducirlo desde fuera porque solo el
    /// propio trabajo lo sabe: si terminó con avisos, si lo cancelaron o si se
    /// rompió. Es lo que queda escrito para la próxima vez que se abra Druse.
    /// </summary>
    public required Func<IServiceProvider, CancellationToken, Task<string>> RunAsync { get; init; }
}

/// <summary>En qué estado quedó un trabajo largo, según lo que se guardó de él.</summary>
public enum JobState
{
    /// <summary>Está corriendo, o lo estaba cuando se escribió esto.</summary>
    Running = 0,

    /// <summary>Terminó, bien o mal: <see cref="JobRecord.Outcome"/> lo dice.</summary>
    Finished = 1,

    /// <summary>
    /// Estaba en marcha cuando Druse se cerró.
    ///
    /// No es un fallo ni una cancelación: **nadie llegó a saber cómo acabó**. Lo
    /// que dejó a medias sigue donde esté —un archivo, unas filas— y quien lo
    /// mire tiene que decidir qué hacer con ello.
    /// </summary>
    Interrupted = 2,
}

/// <summary>
/// Lo que se recuerda de un trabajo largo entre una sesión de Druse y la
/// siguiente.
///
/// **No se guarda qué hacía**, solo qué era y cómo acabó: ni credenciales, ni
/// SQL, ni filas. Con eso basta para lo que existe: que al volver a abrir Druse
/// se pueda saber que aquel respaldo de anoche no llegó a terminar.
/// </summary>
public sealed record JobRecord
{
    public required Guid Id { get; init; }

    public required JobKind Kind { get; init; }

    /// <summary>Sobre qué trabajaba: el destino, el artefacto, la tabla.</summary>
    public string? Subject { get; init; }

    public required JobState State { get; init; }

    /// <summary>Cómo acabó, con las palabras de su propia operación.</summary>
    public string? Outcome { get; init; }

    public required DateTimeOffset StartedAtUtc { get; init; }

    public DateTimeOffset? FinishedAtUtc { get; init; }
}

/// <summary>
/// Los trabajos largos que hubo, para poder decir qué quedó a medias.
///
/// Vive fuera del proceso —en SQLite— porque esa es toda su razón de ser: los
/// registros en memoria se van con Druse, y justo entonces es cuando hace falta
/// saber qué estaba corriendo.
/// </summary>
public interface IJobStore
{
    /// <summary>Anota un trabajo que empieza.</summary>
    Task StartedAsync(JobRecord record, CancellationToken cancellationToken);

    /// <summary>Anota cómo acabó.</summary>
    Task FinishedAsync(Guid id, string outcome, CancellationToken cancellationToken);

    /// <summary>
    /// Marca como interrumpido lo que quedara en marcha, y dice cuántos eran.
    ///
    /// Se llama al arrancar: si algo figura «en marcha» en un proceso que acaba
    /// de nacer, es que el anterior se lo llevó por delante.
    /// </summary>
    Task<int> InterruptRunningAsync(CancellationToken cancellationToken);

    /// <summary>Los últimos trabajos, del más reciente al más viejo.</summary>
    Task<IReadOnlyList<JobRecord>> RecentAsync(int limit, CancellationToken cancellationToken);
}

/// <summary>
/// Donde se dejan los trabajos largos para que alguien los ejecute.
///
/// No se llama `IJobQueue` porque un nombre terminado en `Queue` promete ser una
/// colección —y el analizador lo exige—: esto solo admite trabajos, no se
/// recorre ni se consulta.
///
/// Existe porque **la petición que los lanza termina enseguida**: devuelve un
/// identificador y se va, y el trabajo dura minutos u horas. Antes eso era un
/// `Task.Run` suelto por endpoint, sin nadie que supiera qué había en marcha ni
/// esperara a que terminase al apagar.
/// </summary>
public interface IBackgroundJobs
{
    /// <summary>Deja el trabajo en la cola. Vuelve en el acto.</summary>
    void Enqueue(QueuedJob job);
}
