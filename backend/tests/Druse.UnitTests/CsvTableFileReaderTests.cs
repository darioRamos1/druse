using System.Text;
using Druse.Application.Abstractions;
using Druse.Infrastructure.Importing;

namespace Druse.UnitTests;

/// <summary>
/// Leer un CSV, que es la mitad silenciosa de importar.
///
/// Un lector que se equivoque no falla: mete el valor en la columna de al lado
/// y nadie se entera hasta mucho después. Por eso las pruebas van a los cuatro
/// sitios donde un CSV mal leído se rompe —comillas, comillas dentro de
/// comillas, separador dentro del campo y salto de línea dentro del campo— más
/// lo que distingue un nulo de una cadena vacía.
/// </summary>
public sealed class CsvTableFileReaderTests
{
    private static async Task<TableFile> LeerAsync(string csv, ImportOptions? options = null)
    {
        var reader = new CsvTableFileReader();
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(csv));

        return await reader.ReadAsync(stream, options ?? new ImportOptions(), 1000, CancellationToken.None);
    }

    [Fact]
    public async Task LeeCabecerasYFilas()
    {
        var file = await LeerAsync("id,nombre\n1,Ana\n2,Bea\n");

        Assert.Equal(["id", "nombre"], file.Columns);
        Assert.Equal(2, file.Rows.Count);
        Assert.Equal(["1", "Ana"], file.Rows[0]);
    }

    [Fact]
    public async Task RespetaElSeparadorDentroDeComillas()
    {
        var file = await LeerAsync("id,direccion\n1,\"Madrid, España\"\n");

        // Partir por comas a secas dejaría «Madrid» y «España» en columnas
        // distintas, y la dirección acabaría desplazando todo lo demás.
        Assert.Equal(["1", "Madrid, España"], file.Rows[0]);
    }

    [Fact]
    public async Task RespetaLasComillasDobladas()
    {
        var file = await LeerAsync("id,frase\n1,\"Dijo \"\"hola\"\"\"\n");

        Assert.Equal(["1", "Dijo \"hola\""], file.Rows[0]);
    }

    [Fact]
    public async Task RespetaElSaltoDeLineaDentroDeUnCampo()
    {
        var file = await LeerAsync("id,nota\n1,\"primera\nsegunda\"\n2,suelta\n");

        Assert.Equal(2, file.Rows.Count);
        Assert.Equal("primera\nsegunda", file.Rows[0][1]);
        Assert.Equal("suelta", file.Rows[1][1]);
    }

    [Fact]
    public async Task LaUltimaFilaSinSaltoTambienCuenta()
    {
        var file = await LeerAsync("id,nombre\n1,Ana");

        Assert.Single(file.Rows);
    }

    [Fact]
    public async Task UnaCadenaVaciaNoEsUnNulo()
    {
        var file = await LeerAsync("id,nombre\n1,\n");

        // Son cosas distintas y la tabla de destino las distingue: convertir una
        // en la otra al leer sería decidir por el usuario.
        Assert.Equal(string.Empty, file.Rows[0][1]);
    }

    [Fact]
    public async Task ElTextoDeNuloSeRespetaCuandoSeIndica()
    {
        var file = await LeerAsync("id,nombre\n1,NULL\n", new ImportOptions { NullText = "NULL" });

        Assert.Null(file.Rows[0][1]);
    }

    [Fact]
    public async Task SinCabecerasLasColumnasSeNumeran()
    {
        var file = await LeerAsync("1,Ana\n2,Bea\n", new ImportOptions { HasHeaders = false });

        Assert.Equal(["Columna 1", "Columna 2"], file.Columns);
        Assert.Equal(2, file.Rows.Count);
    }

    [Fact]
    public async Task UnaFilaCortaSeCompletaEnVezDeDesplazarse()
    {
        var file = await LeerAsync("id,nombre,email\n1,Ana\n");

        // Lo que no viene es nulo; lo que no puede pasar es que «Ana» acabe en
        // la columna del correo.
        Assert.Equal(["1", "Ana", null], file.Rows[0]);
    }

    [Fact]
    public async Task AdmiteOtroSeparador()
    {
        var file = await LeerAsync("id;nombre\n1;Ana\n", new ImportOptions { Delimiter = ';' });

        Assert.Equal(["id", "nombre"], file.Columns);
        Assert.Equal(["1", "Ana"], file.Rows[0]);
    }

    [Fact]
    public async Task LeeLoQueEscribeElPropioExportador()
    {
        // Con BOM y saltos CRLF, que es como sale de Druse: exportar e importar
        // tienen que ser reversibles.
        var csv = "﻿id,titulo\r\n1,\"Documento 1 — revisión\"\r\n";
        var file = await LeerAsync(csv);

        Assert.Equal(["id", "titulo"], file.Columns);
        Assert.Equal("Documento 1 — revisión", file.Rows[0][1]);
    }
}
