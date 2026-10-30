using System.Data;
using System.Reflection;
using Druse.Jdbc;

namespace Druse.UnitTests;

/// <summary>El driver puede bloquear también al cancelar y cerrar sus recursos.</summary>
public sealed class JdbcCancellationTests
{
    [Fact]
    public async Task CancelarDevuelveElControlAunqueElPropioCancelSeQuedeBloqueado()
    {
        using var trabajoLibre = new ManualResetEventSlim();
        using var cancelLibre = new ManualResetEventSlim();
        using var cancelacion = new CancellationTokenSource();
        var trabajoIniciado = NuevaSenal();
        var cancelIniciado = NuevaSenal();
        var resultadoCerrado = NuevaSenal();
        Task? pendiente = null;

        var operacion = JdbcCancellation.RunAsync(
            () =>
            {
                trabajoIniciado.SetResult();
                trabajoLibre.Wait();
                return new ResultadoTardio(resultadoCerrado);
            },
            () =>
            {
                cancelIniciado.SetResult();
                cancelLibre.Wait();
            },
            cancelacion.Token,
            tarea => pendiente = tarea);

        try
        {
            await trabajoIniciado.Task.WaitAsync(TimeSpan.FromSeconds(5));
            cancelacion.Cancel();

            // Las compuertas siguen cerradas: un resultado no puede deberse a
            // que el doble terminó pronto o a una carrera con un temporizador.
            await Assert.ThrowsAnyAsync<OperationCanceledException>(
                () => operacion.WaitAsync(TimeSpan.FromSeconds(5)));
            await cancelIniciado.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.NotNull(pendiente);
            Assert.False(pendiente.IsCompleted);
            Assert.False(resultadoCerrado.Task.IsCompleted);
        }
        finally
        {
            trabajoLibre.Set();
            cancelLibre.Set();
            await resultadoCerrado.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }

        await pendiente.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task UnResultadoNormalSigueSiendoPropiedadDeQuienLoPide()
    {
        var resultadoCerrado = NuevaSenal();
        var resultado = new ResultadoTardio(resultadoCerrado);
        var intentos = 0;

        var recibido = await JdbcCancellation.RunAsync(
            () => resultado,
            () => intentos++,
            CancellationToken.None);

        Assert.Same(resultado, recibido);
        Assert.Equal(0, intentos);
        Assert.False(resultadoCerrado.Task.IsCompleted);
        recibido.Dispose();
        Assert.True(resultadoCerrado.Task.IsCompleted);
    }

    [Fact]
    public async Task SoltarUnResultadoQueYaLlegoNoEsperaASuDisposeBloqueante()
    {
        using var cierreLibre = new ManualResetEventSlim();
        var cierreIniciado = NuevaSenal();
        var cierreProgramado = new TaskCompletionSource<Task>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var resultado = new CierreBloqueante(cierreLibre, cierreIniciado);
        var programacion = Task.Run(() =>
        {
            cierreProgramado.SetResult(JdbcCancellation.Soltar(Task.FromResult(resultado)));
        });
        Task? cierre = null;

        try
        {
            cierre = await cierreProgramado.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await cierreIniciado.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(cierre.IsCompleted);
        }
        finally
        {
            cierreLibre.Set();
            await programacion.WaitAsync(TimeSpan.FromSeconds(5));
            if (cierre is not null)
            {
                await cierre.WaitAsync(TimeSpan.FromSeconds(5));
            }
        }
    }

    [Fact]
    public async Task CerrarUnaConexionCanceladaNoEsperaAlDriverYLaCierraAlLiberarse()
    {
        var fin = NuevaSenal();
        var cerrada = NuevaSenal();
        var cierres = 0;
        var java = Doble<java.sql.Connection>((nombre, _) => nombre switch
        {
            "isClosed" => false,
            "close" => Cerrar(),
            _ => throw new NotSupportedException(nombre),
        });
        using var conexion = new JdbcConnection(java);
        Assert.Equal(ConnectionState.Open, conexion.State);

        conexion.Abandonar(fin.Task);
        conexion.Close();
        conexion.Dispose();

        Assert.Equal(ConnectionState.Closed, conexion.State);
        Assert.Equal(0, cierres);
        Assert.Throws<InvalidOperationException>(conexion.Open);

        fin.SetResult();
        await cerrada.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(1, cierres);

        object? Cerrar()
        {
            Interlocked.Increment(ref cierres);
            cerrada.SetResult();
            return null;
        }
    }

    [Fact]
    public void UnErrorLeyendoLosMetadatosCierraLaConexionQueAcababaDeAbrirse()
    {
        var cierres = 0;
        var java = Doble<java.sql.Connection>((nombre, _) => nombre switch
        {
            "getMetaData" => throw new java.sql.SQLException("No se pudo leer la versión"),
            "close" => Cerrar(),
            _ => throw new NotSupportedException(nombre),
        });
        using var conexion = new JdbcConnection(_ => java);

        Assert.Throws<JdbcException>(conexion.Open);
        Assert.Equal(ConnectionState.Closed, conexion.State);
        Assert.Equal(1, cierres);

        object? Cerrar()
        {
            cierres++;
            return null;
        }
    }

    [Fact]
    public async Task UnaAperturaQueLlegaTrasCancelarNoReapareceAbiertaNiPierdeSuCierre()
    {
        using var aperturaLibre = new ManualResetEventSlim();
        using var cancelacion = new CancellationTokenSource();
        var aperturaIniciada = NuevaSenal();
        var cerrada = NuevaSenal();
        var meta = Doble<java.sql.DatabaseMetaData>((nombre, _) => nombre switch
        {
            "getDatabaseProductVersion" => "15.0",
            _ => throw new NotSupportedException(nombre),
        });
        var java = Doble<java.sql.Connection>((nombre, _) => nombre switch
        {
            "getMetaData" => meta,
            "getCatalog" => "druse_test",
            "close" => Cerrar(),
            _ => throw new NotSupportedException(nombre),
        });
        using var conexion = new JdbcConnection(_ =>
        {
            aperturaIniciada.SetResult();
            aperturaLibre.Wait();
            return java;
        });

        try
        {
            var apertura = conexion.OpenAsync(cancelacion.Token);
            await aperturaIniciada.Task.WaitAsync(TimeSpan.FromSeconds(5));
            cancelacion.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(
                () => apertura.WaitAsync(TimeSpan.FromSeconds(5)));
            conexion.Dispose();
            Assert.Equal(ConnectionState.Closed, conexion.State);
            Assert.False(cerrada.Task.IsCompleted);
        }
        finally
        {
            aperturaLibre.Set();
            await cerrada.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }

        Assert.Equal(ConnectionState.Closed, conexion.State);

        object? Cerrar()
        {
            cerrada.SetResult();
            return null;
        }
    }

    [Fact]
    public async Task DesecharUnLectorCanceladoDifiereSuCierreHastaQueTerminaNext()
    {
        using var lecturaLibre = new ManualResetEventSlim();
        using var cancelLibre = new ManualResetEventSlim();
        using var cancelacion = new CancellationTokenSource();
        var lecturaIniciada = NuevaSenal();
        var lectorCerrado = NuevaSenal();
        Task? pendiente = null;
        var meta = Doble<java.sql.ResultSetMetaData>((nombre, _) => nombre switch
        {
            "getColumnCount" => 1,
            _ => throw new NotSupportedException(nombre),
        });
        var rs = Doble<java.sql.ResultSet>((nombre, _) => nombre switch
        {
            "getMetaData" => meta,
            "next" => Leer(),
            "close" => Cerrar(),
            _ => throw new NotSupportedException(nombre),
        });
        var statement = Doble<java.sql.PreparedStatement>((nombre, _) => nombre switch
        {
            "execute" => true,
            "getResultSet" => rs,
            "close" or "Dispose" => null,
            _ => throw new NotSupportedException(nombre),
        });
        using var lector = new JdbcDataReader(
            ["SELECT lento"],
            _ => statement,
            null,
            () => cancelLibre.Wait(),
            tarea => pendiente = tarea);

        try
        {
            var lectura = lector.ReadAsync(cancelacion.Token);
            await lecturaIniciada.Task.WaitAsync(TimeSpan.FromSeconds(5));
            cancelacion.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(
                () => lectura.WaitAsync(TimeSpan.FromSeconds(5)));
            lector.Dispose();

            Assert.True(lector.IsClosed);
            Assert.False(lectorCerrado.Task.IsCompleted);
            Assert.NotNull(pendiente);
        }
        finally
        {
            lecturaLibre.Set();
            cancelLibre.Set();
            await lectorCerrado.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }

        await pendiente.WaitAsync(TimeSpan.FromSeconds(5));

        bool Leer()
        {
            lecturaIniciada.SetResult();
            lecturaLibre.Wait();
            return true;
        }

        object? Cerrar()
        {
            lectorCerrado.SetResult();
            return null;
        }
    }

    private static TaskCompletionSource NuevaSenal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static T Doble<T>(Func<string, object?[]?, object?> llamada) where T : class
    {
        var doble = DispatchProxy.Create<T, InterceptorJdbc>();
        ((InterceptorJdbc)(object)doble).Llamada = llamada;
        return doble;
    }

    public class InterceptorJdbc : DispatchProxy
    {
        public Func<string, object?[]?, object?> Llamada { get; set; } = null!;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) =>
            Llamada(targetMethod!.Name, args);
    }

    private sealed class ResultadoTardio(TaskCompletionSource cerrada) : IDisposable
    {
        public void Dispose() => cerrada.TrySetResult();
    }

    private sealed class CierreBloqueante(
        ManualResetEventSlim libre,
        TaskCompletionSource iniciado) : IDisposable
    {
        public void Dispose()
        {
            iniciado.SetResult();
            libre.Wait();
        }
    }
}
