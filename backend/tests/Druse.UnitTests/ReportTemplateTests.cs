using Druse.Application.Reports;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

public sealed class ReportTemplateTests
{
    private const string Diseño = """{"format":"druse.report-template","version":1,"fields":[{"id":"ventas","kind":"number"}]}""";

    [Fact]
    public void AceptaUnDiseñoSinDatos()
    {
        Assert.Null(ReportTemplateRules.Validate("Ventas contra meta", "Indicador y barras", Diseño));
    }

    [Theory]
    [InlineData("""{"reports":[{"settings":{"sql":"SELECT 1"}}]}""", "sql")]
    [InlineData("""{"slots":[{"connectionId":"abc"}]}""", "connectionId")]
    [InlineData("""{"data":{"ROWS":[[1,2]]}}""", "ROWS")]
    public void RechazaSqlConexionesYFilasAunqueVenganAnidados(string model, string property)
    {
        var problem = ReportTemplateRules.Validate("Plantilla", null, model);

        Assert.NotNull(problem);
        Assert.Contains($"«{property}»", problem, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("", Diseño)]
    [InlineData("Plantilla", "{roto")]
    [InlineData("Plantilla", "[1,2]")]
    [InlineData("Plantilla", "")]
    public void RechazaNombreVacioODiseñoQueNoEsUnObjeto(string name, string model)
    {
        Assert.NotNull(ReportTemplateRules.Validate(name, null, model));
    }

    [Fact]
    public void RechazaUnDiseñoDemasiadoGrande()
    {
        var model = $$"""{"description":"{{new string('a', ReportTemplateRules.MaxModelBytes)}}"}""";

        Assert.Contains("512 KiB", ReportTemplateRules.Validate("Plantilla", null, model), StringComparison.Ordinal);
    }

    [Fact]
    public async Task GuardaReabreYBorraSinTocarLaFechaDeCreacion()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var clock = new MutableClock(new DateTimeOffset(2026, 11, 11, 10, 0, 0, TimeSpan.Zero));
        var store = new SqliteReportTemplateStore(paths, clock);
        var id = Guid.NewGuid();

        await store.SaveAsync(new ReportTemplate
        {
            Id = id, Name = " Ventas ", Description = "  ", Scope = ReportTemplateScope.Dashboard, Model = Diseño,
        }, CancellationToken.None);
        clock.Now = clock.Now.AddHours(1);
        await store.SaveAsync(new ReportTemplate
        {
            Id = id, Name = "Ventas 2", Description = "Dos páginas", Scope = ReportTemplateScope.Dashboard, Model = Diseño,
        }, CancellationToken.None);

        var saved = Assert.Single(await new SqliteReportTemplateStore(paths, clock).GetAllAsync(CancellationToken.None));
        Assert.Equal("Ventas 2", saved.Name);
        Assert.Equal("Dos páginas", saved.Description);
        Assert.Equal(ReportTemplateScope.Dashboard, saved.Scope);
        Assert.Equal(Diseño, saved.Model);
        Assert.Equal(saved.CreatedAtUtc.AddHours(1), saved.UpdatedAtUtc);

        await store.DeleteAsync(id, CancellationToken.None);
        Assert.Empty(await store.GetAllAsync(CancellationToken.None));
    }

    private sealed class MutableClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
