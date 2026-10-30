using System.Globalization;
using System.Reflection;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Jdbc;
using Druse.Provider.Informix;

namespace Druse.UnitTests;

/// <summary>El tipo temporal que lee JDBC debe sobrevivir al guion del respaldo.</summary>
public sealed class JdbcTemporalTests
{
    [Theory]
    [InlineData("2026-08-17")]
    [InlineData("2024-02-29")]
    public void UnaFechaSeLeeSinHoraYProduceUnLiteralDeFechaRestaurable(string texto)
    {
        using var lector = Lector(java.sql.Date.valueOf(texto), java.sql.Types.DATE, "DATE");

        var valor = Assert.IsType<DateOnly>(lector.GetValue(0));
        Assert.Equal(DateOnly.ParseExact(texto, "yyyy-MM-dd", CultureInfo.InvariantCulture), valor);
        Assert.Equal(typeof(DateOnly), lector.GetFieldType(0));
        Assert.Equal($"'{texto}'", Literal(valor, "DATE"));
    }

    [Theory]
    [InlineData("2026-08-17 00:00:00")]
    [InlineData("2026-08-17 14:03:11.12345")]
    public void UnTimestampConservaLaHoraYLaFraccionAunqueSeaMedianoche(string texto)
    {
        using var lector = Lector(
            java.sql.Timestamp.valueOf(texto),
            java.sql.Types.TIMESTAMP,
            "DATETIME YEAR TO FRACTION(5)");

        var valor = Assert.IsType<DateTime>(lector.GetValue(0));
        Assert.Equal(DateTime.Parse(texto, CultureInfo.InvariantCulture), valor);
        Assert.Equal(typeof(DateTime), lector.GetFieldType(0));
        Assert.Equal($"'{texto}'", Literal(valor, "DATETIME YEAR TO FRACTION(5)"));
    }

    private static string Literal(object valor, string tipo) =>
        new InformixTableDesigner(DatabaseEngine.InformixSqli).FormatLiteral(
            valor,
            new DatabaseColumn
            {
                Name = "fecha",
                DataType = tipo,
                Ordinal = 1,
                IsNullable = false,
            });

    private static JdbcDataReader Lector(object valor, int tipo, string nombreTipo)
    {
        var meta = Doble<java.sql.ResultSetMetaData>((nombre, _) => nombre switch
        {
            "getColumnCount" => 1,
            "getColumnType" => tipo,
            "getColumnTypeName" => nombreTipo,
            _ => throw new NotSupportedException(nombre),
        });
        var rs = Doble<java.sql.ResultSet>((nombre, _) => nombre switch
        {
            "getMetaData" => meta,
            "getObject" => valor,
            "wasNull" => false,
            "close" => null,
            _ => throw new NotSupportedException(nombre),
        });
        var statement = Doble<java.sql.PreparedStatement>((nombre, _) => nombre switch
        {
            "execute" => true,
            "getResultSet" => rs,
            "close" or "Dispose" => null,
            _ => throw new NotSupportedException(nombre),
        });
        return new JdbcDataReader(["SELECT fecha"], _ => statement, null, () => { }, _ => { });
    }

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
}
