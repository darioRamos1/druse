using System.Buffers.Binary;
using System.Text;
using Druse.Application.Reports;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

public sealed class ReportIdentityTests
{
    /// <summary>La cabecera de un PNG: firma e IHDR con ancho y alto. Basta para leerlo.</summary>
    internal static byte[] Png(int width, int height, int padding = 0)
    {
        var data = new byte[33 + padding];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(data, 0);
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(8), 13);
        "IHDR"u8.CopyTo(data.AsSpan(12));
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(16), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(20), (uint)height);
        return data;
    }

    /// <summary>Un JPEG con un APP0 delante del SOF0, como los de verdad.</summary>
    private static byte[] Jpeg(int width, int height)
    {
        var data = new List<byte> { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10 };
        data.AddRange(new byte[14]);
        data.AddRange([0xFF, 0xC0, 0x00, 0x11, 0x08, (byte)(height >> 8), (byte)height, (byte)(width >> 8), (byte)width]);
        data.AddRange(new byte[12]);
        return [.. data];
    }

    private static byte[] Webp(string chunk, int width, int height)
    {
        var data = new byte[40];
        "RIFF"u8.CopyTo(data);
        "WEBP"u8.CopyTo(data.AsSpan(8));
        Encoding.ASCII.GetBytes(chunk).CopyTo(data, 12);

        if (chunk == "VP8X")
        {
            WriteUInt24(data.AsSpan(24), width - 1);
            WriteUInt24(data.AsSpan(27), height - 1);
        }
        else
        {
            data[20] = 0x2F;
            BinaryPrimitives.WriteUInt32LittleEndian(data.AsSpan(21), (uint)((width - 1) | ((height - 1) << 14)));
        }

        return data;
    }

    private static void WriteUInt24(Span<byte> target, int value)
    {
        target[0] = (byte)value;
        target[1] = (byte)(value >> 8);
        target[2] = (byte)(value >> 16);
    }

    [Fact]
    public void AceptaUnaIdentidadCompleta()
    {
        Assert.Null(ReportIdentityRules.Validate(
            "Comercial Andina S.A.S.", "Informe mensual", ["NIT 900.123.456-7", "Cra. 7 # 12-34"], "Confidencial", "#0A6CBF"));
    }

    [Theory]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("Empresa", "azul")]
    [InlineData("Empresa", "#0A6CB")]
    [InlineData("Empresa", "0A6CBF")]
    public void RechazaNombreVacioOColorQueNoEsHexadecimal(string name, string? color)
    {
        Assert.NotNull(ReportIdentityRules.Validate(name, null, [], null, color));
    }

    [Fact]
    public void LimitaLasLineasDeDatosYSuLargo()
    {
        Assert.Contains("3", ReportIdentityRules.Validate("Empresa", null, ["a", "b", "c", "d"], null, null)?.Text,
            StringComparison.Ordinal);
        Assert.NotNull(ReportIdentityRules.Validate("Empresa", new string('x', 161), [], null, null));
        Assert.NotNull(ReportIdentityRules.Validate("Empresa", null, [new string('x', 161)], null, null));
        Assert.NotNull(ReportIdentityRules.Validate("Empresa", null, [], new string('x', 161), null));
    }

    [Fact]
    public void LeeTipoYDimensionesDePngJpegYWebp()
    {
        Assert.Equal(new LogoImageInfo("image/png", 640, 200), LogoImage.Read(Png(640, 200)));
        Assert.Equal(new LogoImageInfo("image/jpeg", 800, 300), LogoImage.Read(Jpeg(800, 300)));
        Assert.Equal(new LogoImageInfo("image/webp", 1000, 250), LogoImage.Read(Webp("VP8X", 1000, 250)));
        Assert.Equal(new LogoImageInfo("image/webp", 320, 90), LogoImage.Read(Webp("VP8L", 320, 90)));
    }

    [Fact]
    public void NoSeFiaDeLaExtensionNiAceptaSvg()
    {
        var svg = Encoding.UTF8.GetBytes("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
        var texto = Encoding.UTF8.GetBytes("esto se llamaba logo.png");

        Assert.Null(LogoImage.Read(svg));
        Assert.NotNull(ReportIdentityRules.ValidateLogo(svg, out _));
        Assert.NotNull(ReportIdentityRules.ValidateLogo(texto, out _));
        Assert.NotNull(ReportIdentityRules.ValidateLogo([], out _));
    }

    [Fact]
    public void RechazaUnLogoDemasiadoGrandeODemasiadoPesado()
    {
        Assert.Contains("1200 × 400", ReportIdentityRules.ValidateLogo(Png(1201, 100), out _)?.Text, StringComparison.Ordinal);
        Assert.NotNull(ReportIdentityRules.ValidateLogo(Png(100, 401), out _));
        Assert.Contains("512 KiB",
            ReportIdentityRules.ValidateLogo(Png(100, 100, ReportIdentityRules.MaxLogoBytes), out _)?.Text,
            StringComparison.Ordinal);

        Assert.Null(ReportIdentityRules.ValidateLogo(Png(1200, 400), out var info));
        Assert.Equal("image/png", info?.ContentType);
    }

    [Fact]
    public async Task GuardaLosDatosSinPerderElLogoYBorraTodo()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var store = new SqliteReportIdentityStore(paths, TimeProvider.System);
        var id = Guid.NewGuid();

        await store.SaveAsync(new ReportIdentity
        {
            Id = id,
            Name = " Comercial Andina ",
            Subtitle = "  ",
            Details = ["NIT 900", " ", " Bogotá "],
            BrandColor = "#0a6cbf",
        }, CancellationToken.None);
        Assert.True(await store.SetLogoAsync(id, new ReportIdentityLogo("image/png", Png(10, 10)), CancellationToken.None));

        // Cambiar los datos no se lleva el logo.
        var saved = await store.SaveAsync(new ReportIdentity
        {
            Id = id, Name = "Comercial Andina", Details = ["NIT 900"], LogoOnWhite = true,
        }, CancellationToken.None);
        Assert.NotNull(saved.LogoUpdatedAtUtc);

        var listed = Assert.Single(await new SqliteReportIdentityStore(paths, TimeProvider.System).GetAllAsync(CancellationToken.None));
        Assert.Equal("Comercial Andina", listed.Name);
        Assert.True(listed.LogoOnWhite);
        Assert.Null(listed.BrandColor);
        Assert.Equal(["NIT 900"], listed.Details);
        Assert.Equal(Png(10, 10), (await store.GetLogoAsync(id, CancellationToken.None))?.Data);

        Assert.True(await store.SetLogoAsync(id, null, CancellationToken.None));
        Assert.Null(await store.GetLogoAsync(id, CancellationToken.None));
        Assert.Null(Assert.Single(await store.GetAllAsync(CancellationToken.None)).LogoUpdatedAtUtc);

        await store.DeleteAsync(id, CancellationToken.None);
        Assert.Empty(await store.GetAllAsync(CancellationToken.None));
        Assert.False(await store.SetLogoAsync(id, new ReportIdentityLogo("image/png", Png(1, 1)), CancellationToken.None));
    }

    [Fact]
    public async Task LimpiaLosDatosAlGuardar()
    {
        using var paths = new TemporaryPaths();
        paths.EnsureCreated();
        var store = new SqliteReportIdentityStore(paths, TimeProvider.System);

        var saved = await store.SaveAsync(new ReportIdentity
        {
            Id = Guid.NewGuid(), Name = " Andina ", Subtitle = " Ventas ", Details = [" a ", "", "b"], BrandColor = "#0a6cbf",
        }, CancellationToken.None);

        Assert.Equal("Andina", saved.Name);
        Assert.Equal("Ventas", saved.Subtitle);
        Assert.Equal(["a", "b"], saved.Details);
        Assert.Equal("#0A6CBF", saved.BrandColor);
    }
}
