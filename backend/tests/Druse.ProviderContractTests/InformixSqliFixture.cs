using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;

namespace Druse.ProviderContractTests;

/// <summary>
/// El mismo Informix, alcanzado por **SQLI** en lugar de DRDA.
///
/// Hereda todo el dialecto porque es el mismo motor: las mismas palabras, los
/// mismos tipos y el mismo catálogo. Lo único que cambia es por dónde se entra,
/// y eso es exactamente lo que este fixture redefine: el puerto, el servidor
/// lógico y el proveedor.
///
/// Que las **mismas veinticuatro pruebas** del contrato pasen por los dos
/// caminos es la única forma de afirmar que el transporte nuevo no es un atajo
/// con menos garantías que el de siempre.
/// </summary>
public sealed class InformixSqliFixture : InformixFixture
{
    private static readonly Lazy<(bool Available, string? Reason)> Probed = new(Probe);

    public override string EngineName => "Informix (SQLI)";

    public override bool IsAvailable => Probed.Value.Available;

    public override string? UnavailableReason => Probed.Value.Reason;

    public override IDatabaseProvider Provider { get; } =
        new InformixDatabaseProvider(DatabaseEngine.InformixSqli);

    // El contrato exige que todos declaren el mismo motor que su proveedor: lo
    // que hacen es idéntico, pero decir «Informix» aquí sería mentir sobre a
    // quién sirven.
    public override IQueryExecutor Executor { get; } =
        new InformixQueryExecutor(DatabaseEngine.InformixSqli);

    public override IDatabaseMetadataReader Metadata { get; } =
        new InformixMetadataReader(DatabaseEngine.InformixSqli);

    public override IRowEditor RowEditor { get; } =
        new InformixRowEditor(DatabaseEngine.InformixSqli);

    private readonly InformixTableDesigner _designer = new(DatabaseEngine.InformixSqli);

    public override ITableDesigner Designer => _designer;

    public override IDatabaseScripter Scripter => _designer;

    public override ConnectionProfile Profile(bool onlyRead = false) => base.Profile(onlyRead) with
    {
        Engine = DatabaseEngine.InformixSqli,

        // El escuchador de SQLI, no el de DRDA. Apuntar al otro no da un error de
        // protocolo: da uno de comunicación que parece de credenciales.
        Port = int.TryParse(
            Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SQLI_PORT"),
            System.Globalization.CultureInfo.InvariantCulture,
            out var puerto)
            ? puerto
            : 9088,

        // Obligatorio en SQLI. En el contenedor de IBM, el alias de `onsoctcp`.
        InformixServer =
            Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SERVER") ?? "informix",
    };

    public override ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid(), Database = database };

    private static (bool, string?) Probe()
    {
        try
        {
            var fixture = new InformixSqliFixture();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));

            var result = fixture.Provider
                .TestConnectionAsync(fixture.Profile(), fixture.Credentials, timeout.Token)
                .GetAwaiter()
                .GetResult();

            return (result.Succeeded, result.Error?.Message);
        }
        catch (Exception exception)
        {
            return (false, exception.Message);
        }
    }
}

/// <summary>Ejecuta el contrato común contra Informix por su protocolo nativo.</summary>
public sealed class InformixSqliContractTests : DatabaseProviderContractTests<InformixSqliFixture>;
