using Druse.Domain;
using Druse.Infrastructure.Backups;
using Druse.Infrastructure.Transfers;

namespace Druse.UnitTests;

/// <summary>
/// Lo último que se sabe de un trabajo largo, cuando los avisos llegan
/// desordenados.
///
/// No es un caso raro: los avisos viajan por `Progress&lt;T&gt;`, que los entrega
/// en el grupo de hilos **sin garantizar el orden**, así que el «terminado» puede
/// adelantar al último «en marcha». Guardando a ciegas el que llegue, el estado se
/// queda en marcha para siempre: la barra no acaba nunca y el resumen no aparece,
/// aunque el trabajo esté hecho.
///
/// Costó encontrarlo porque desde fuera parece lentitud —la prueba se cansa de
/// esperar— y porque solo pasa cuando la máquina va cargada.
/// </summary>
public sealed class ProgressTrackerTests
{
    private static readonly Guid Id = Guid.NewGuid();

    /// <summary>Un aviso viejo no puede devolver a «en marcha» lo que ya terminó.</summary>
    [Fact]
    public void ElTrasladoTerminadoNoVuelveAEstarEnMarcha()
    {
        var tracker = new TransferTracker();

        tracker.Report(Transfer(TransferOutcome.Running, rows: 3, milliseconds: 20));
        tracker.Report(Transfer(TransferOutcome.Completed, rows: 3, milliseconds: 25));

        // El que se quedó por el camino llega después de que todo acabara.
        tracker.Report(Transfer(TransferOutcome.Running, rows: 3, milliseconds: 22));

        Assert.Equal(TransferOutcome.Completed, tracker.Find(Id)!.Outcome);
    }

    /// <summary>Y entre dos avisos en marcha, el recuento no va hacia atrás.</summary>
    [Fact]
    public void ElRecuentoDeUnTrasladoNoRetrocede()
    {
        var tracker = new TransferTracker();

        tracker.Report(Transfer(TransferOutcome.Running, rows: 900, milliseconds: 80));
        tracker.Report(Transfer(TransferOutcome.Running, rows: 300, milliseconds: 40));

        Assert.Equal(900, tracker.Find(Id)!.RowsCopied);
    }

    /// <summary>Un fallo sí puede sustituir a otro estado terminal.</summary>
    [Fact]
    public void UnEstadoTerminalSiPuedeSustituirAOtro()
    {
        var tracker = new TransferTracker();

        tracker.Report(Transfer(TransferOutcome.Completed, rows: 3, milliseconds: 25));
        tracker.Report(Transfer(TransferOutcome.Failed, rows: 3, milliseconds: 30));

        Assert.Equal(TransferOutcome.Failed, tracker.Find(Id)!.Outcome);
    }

    /// <summary>El respaldo tiene el mismo registro, y la misma regla.</summary>
    [Fact]
    public void ElRespaldoTerminadoNoVuelveAEstarEnMarcha()
    {
        var tracker = new BackupTracker();

        tracker.Report(Backup(BackupOutcome.Running, milliseconds: 20));
        tracker.Report(Backup(BackupOutcome.Completed, milliseconds: 25));
        tracker.Report(Backup(BackupOutcome.Running, milliseconds: 22));

        Assert.Equal(BackupOutcome.Completed, tracker.Find(Id)!.Outcome);
    }

    /// <summary>Y la restauración también.</summary>
    [Fact]
    public void LaRestauracionTerminadaNoVuelveAEstarEnMarcha()
    {
        var tracker = new RestoreTracker();

        tracker.Report(Restore(RestoreOutcome.Running, milliseconds: 20));
        tracker.Report(Restore(RestoreOutcome.Completed, milliseconds: 25));
        tracker.Report(Restore(RestoreOutcome.Running, milliseconds: 22));

        Assert.Equal(RestoreOutcome.Completed, tracker.Find(Id)!.Outcome);
    }

    private static TransferProgress Transfer(TransferOutcome outcome, long rows, int milliseconds) =>
        new()
        {
            Id = Id,
            Step = outcome == TransferOutcome.Running ? TransferStep.CopyingRows : TransferStep.Done,
            Outcome = outcome,
            RowsCopied = rows,
            TableRowsCopied = rows,
            Elapsed = TimeSpan.FromMilliseconds(milliseconds),
        };

    private static BackupProgress Backup(BackupOutcome outcome, int milliseconds) =>
        new()
        {
            Id = Id,
            Outcome = outcome,
            Elapsed = TimeSpan.FromMilliseconds(milliseconds),
        };

    private static RestoreProgress Restore(RestoreOutcome outcome, int milliseconds) =>
        new()
        {
            Id = Id,
            Outcome = outcome,
            Elapsed = TimeSpan.FromMilliseconds(milliseconds),
        };
}
