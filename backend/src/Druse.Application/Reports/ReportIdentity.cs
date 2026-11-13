using System.Buffers.Binary;
using System.Text.RegularExpressions;
using Druse.Domain;

namespace Druse.Application.Reports;

/// <summary>
/// La identidad de una empresa para sus tableros: nombre, datos, logo y color.
///
/// Es reutilizable: un tablero guarda solo su id, así que cambiar el logo de la
/// empresa cambia todos sus tableros, y quien prepara informes para varios
/// clientes tiene una identidad por cliente. El logo se guarda aparte —ver
/// <see cref="ReportIdentityLogo"/>— y aquí solo se dice si lo hay.
/// </summary>
public sealed record ReportIdentity
{
    public required Guid Id { get; init; }

    /// <summary>Obligatorio: es también el texto alternativo del logo.</summary>
    public required string Name { get; init; }

    public string? Subtitle { get; init; }

    /// <summary>Hasta tres líneas libres: NIT, dirección, teléfono, web.</summary>
    public IReadOnlyList<string> Details { get; init; } = [];

    /// <summary>Texto del pie de página del PDF: «Confidencial», «Uso interno»…</summary>
    public string? Footer { get; init; }

    /// <summary>`#RRGGBB`, o `null` para seguir con los colores de Druse.</summary>
    public string? BrandColor { get; init; }

    /// <summary>Poner fondo blanco al logo en el tema oscuro, para los que son negros sin fondo.</summary>
    public bool LogoOnWhite { get; init; }

    /// <summary>Cuándo cambió el logo, o `null` si no tiene. Sirve para no pintar uno viejo.</summary>
    public DateTimeOffset? LogoUpdatedAtUtc { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}

/// <summary>El logo de una identidad, ya comprobado.</summary>
public sealed record ReportIdentityLogo(string ContentType, byte[] Data);

/// <summary>Lo que se lee de la cabecera de una imagen, sin decodificarla.</summary>
public sealed record LogoImageInfo(string ContentType, int Width, int Height);

/// <summary>
/// Lo que el servidor exige a una identidad y a su logo antes de guardarlos.
///
/// La interfaz ya reduce el logo y comprueba el color, pero este es el último
/// sitio antes del disco: aquí se mira el tipo por sus primeros bytes —no por la
/// extensión ni por lo que diga la petición— y las dimensiones.
/// </summary>
public static partial class ReportIdentityRules
{
    public const int MaxNameLength = 120;

    public const int MaxLineLength = 160;

    public const int MaxDetails = 3;

    /// <summary>Un logo reducido a 1.200 × 400 cabe de sobra en medio MiB.</summary>
    public const int MaxLogoBytes = 512 * 1024;

    public const int MaxLogoWidth = 1200;

    public const int MaxLogoHeight = 400;

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();

    /// <summary>`null` si se puede guardar; si no, el motivo para quien la envía.</summary>
    public static UserMessage? Validate(
        string? name,
        string? subtitle,
        IReadOnlyList<string>? details,
        string? footer,
        string? brandColor)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0 || trimmed.Length > MaxNameLength)
        {
            return ReportMessages.IdentityName(MaxNameLength);
        }

        var lines = details ?? [];
        if (lines.Count > MaxDetails)
        {
            return ReportMessages.IdentityDetails(MaxDetails);
        }

        if (subtitle is { Length: > MaxLineLength }
            || footer is { Length: > MaxLineLength }
            || lines.Any(line => line is null || line.Length > MaxLineLength))
        {
            return ReportMessages.IdentityLine(MaxLineLength);
        }

        if (!string.IsNullOrEmpty(brandColor) && !HexColor().IsMatch(brandColor))
        {
            return ReportMessages.IdentityColor();
        }

        return null;
    }

    /// <summary>
    /// Comprueba un logo: tipo por sus bytes, tamaño y dimensiones.
    ///
    /// SVG no se acepta aquí: puede llevar código, y guardarlo obligaría a
    /// sanearlo en cada sitio donde se pinte. La interfaz lo convierte a PNG
    /// antes de enviarlo.
    /// </summary>
    public static UserMessage? ValidateLogo(byte[]? data, out LogoImageInfo? info)
    {
        info = null;

        if (data is null || data.Length == 0)
        {
            return ReportMessages.IdentityLogoType();
        }

        if (data.Length > MaxLogoBytes)
        {
            return ReportMessages.IdentityLogoSize(MaxLogoBytes / 1024);
        }

        info = LogoImage.Read(data);
        if (info is null)
        {
            return ReportMessages.IdentityLogoType();
        }

        if (info.Width <= 0 || info.Height <= 0 || info.Width > MaxLogoWidth || info.Height > MaxLogoHeight)
        {
            return ReportMessages.IdentityLogoDimensions(MaxLogoWidth, MaxLogoHeight);
        }

        return null;
    }
}

/// <summary>
/// Lee tipo y dimensiones de PNG, JPEG y WebP mirando solo su cabecera.
///
/// No decodifica la imagen: basta con saber qué es y cuánto mide para decidir si
/// se guarda. Lo que no se reconozca como uno de los tres se rechaza, aunque se
/// llame `logo.png`.
/// </summary>
public static class LogoImage
{
    public static LogoImageInfo? Read(ReadOnlySpan<byte> data) =>
        ReadPng(data) ?? ReadJpeg(data) ?? ReadWebp(data);

    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private static LogoImageInfo? ReadPng(ReadOnlySpan<byte> data)
    {
        // Firma, y luego el primer bloque, que siempre es IHDR con ancho y alto.
        if (data.Length < 24 || !data[..8].SequenceEqual(PngSignature) || !data.Slice(12, 4).SequenceEqual("IHDR"u8))
        {
            return null;
        }

        return new LogoImageInfo(
            "image/png",
            (int)BinaryPrimitives.ReadUInt32BigEndian(data.Slice(16, 4)),
            (int)BinaryPrimitives.ReadUInt32BigEndian(data.Slice(20, 4)));
    }

    private static LogoImageInfo? ReadJpeg(ReadOnlySpan<byte> data)
    {
        if (data.Length < 4 || data[0] != 0xFF || data[1] != 0xD8)
        {
            return null;
        }

        // Se recorren los segmentos hasta el primer SOF, que lleva las dimensiones.
        var i = 2;
        while (i + 9 < data.Length)
        {
            if (data[i] != 0xFF)
            {
                return null;
            }

            var marker = data[i + 1];

            if (marker == 0xFF)
            {
                i++;
                continue;
            }

            var length = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(i + 2, 2));
            var isFrame = marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC;

            if (isFrame)
            {
                return new LogoImageInfo(
                    "image/jpeg",
                    BinaryPrimitives.ReadUInt16BigEndian(data.Slice(i + 7, 2)),
                    BinaryPrimitives.ReadUInt16BigEndian(data.Slice(i + 5, 2)));
            }

            if (length < 2)
            {
                return null;
            }

            i += 2 + length;
        }

        return null;
    }

    private static LogoImageInfo? ReadWebp(ReadOnlySpan<byte> data)
    {
        if (data.Length < 30 || !data[..4].SequenceEqual("RIFF"u8) || !data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return null;
        }

        var chunk = data.Slice(12, 4);

        if (chunk.SequenceEqual("VP8X"u8))
        {
            // Ancho y alto menos uno, en 24 bits.
            var width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
            var height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
            return new LogoImageInfo("image/webp", width, height);
        }

        if (chunk.SequenceEqual("VP8L"u8) && data[20] == 0x2F)
        {
            var bits = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(21, 4));
            return new LogoImageInfo("image/webp", (int)(bits & 0x3FFF) + 1, (int)((bits >> 14) & 0x3FFF) + 1);
        }

        if (chunk.SequenceEqual("VP8 "u8) && data[23] == 0x9D && data[24] == 0x01 && data[25] == 0x2A)
        {
            return new LogoImageInfo(
                "image/webp",
                BinaryPrimitives.ReadUInt16LittleEndian(data.Slice(26, 2)) & 0x3FFF,
                BinaryPrimitives.ReadUInt16LittleEndian(data.Slice(28, 2)) & 0x3FFF);
        }

        return null;
    }
}
