#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Genera `icons/icon.ico` a partir de `icons/icon.png`.

.DESCRIPTION
    El icono del ejecutable de Windows sale del `.ico`, y un `.ico` no es una
    imagen: es un contenedor con una imagen por cada tamaño que el sistema pide.
    El Explorador usa 16, 32 y 48 px; la barra de tareas y Alt+Tab, tamaños
    mayores; el cuadro de propiedades, el de 256.

    El que traía el proyecto tenía **una sola imagen de 256x256 a 4 bits** —16
    colores y sin canal alfa—, así que el degradado de la marca se veía como un
    gris plano y en los tamaños pequeños no se veía nada. Este script escribe las
    siete medidas habituales a 32 bits: las de hasta 128 como DIB, que entiende
    cualquier versión de Windows, y la de 256 como PNG, que es como se hace desde
    Vista para que el archivo no se dispare de tamaño.

    Solo hay que ejecutarlo cuando cambie la marca. El resultado se versiona con
    el resto de los iconos.

.EXAMPLE
    ./build/scripts/iconos.ps1

.EXAMPLE
    ./build/scripts/iconos.ps1 -Origen otra-marca.png -Destino otra-marca.ico
#>
[CmdletBinding()]
param(
    [string] $Origen = (Join-Path $PSScriptRoot '../../shells/desktop-tauri/icons/icon.png'),
    [string] $Destino = (Join-Path $PSScriptRoot '../../shells/desktop-tauri/icons/icon.ico')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) {
    throw 'Este script usa System.Drawing y solo se ha probado en Windows.'
}

Add-Type -AssemblyName System.Drawing

$tamanos = @(16, 24, 32, 48, 64, 128, 256)

$fuente = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Origen))

if ($fuente.Width -ne $fuente.Height) {
    throw "La imagen de origen debe ser cuadrada; es de $($fuente.Width)x$($fuente.Height)."
}

if ($fuente.Width -lt 256) {
    throw "La imagen de origen debe medir al menos 256 px; mide $($fuente.Width)."
}

function Redimensionar([System.Drawing.Bitmap] $imagen, [int] $lado) {
    $destino = New-Object System.Drawing.Bitmap $lado, $lado, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $lienzo = [System.Drawing.Graphics]::FromImage($destino)

    # `SourceCopy` y no la mezcla de siempre: los bordes de la marca son
    # transparentes, y mezclarlos contra el negro del lienzo los ensuciaría.
    $lienzo.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $lienzo.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $lienzo.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $lienzo.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $lienzo.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $lienzo.DrawImage($imagen, (New-Object System.Drawing.Rectangle 0, 0, $lado, $lado))
    $lienzo.Dispose()

    return $destino
}

$imagenes = @()

foreach ($lado in $tamanos) {
    $bitmap = Redimensionar $fuente $lado

    if ($lado -eq 256) {
        $memoria = New-Object System.IO.MemoryStream
        $bitmap.Save($memoria, [System.Drawing.Imaging.ImageFormat]::Png)
        $datos = $memoria.ToArray()
        $memoria.Dispose()
    }
    else {
        $rect = New-Object System.Drawing.Rectangle 0, 0, $lado, $lado
        $bits = $bitmap.LockBits(
            $rect,
            [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

        $pixeles = New-Object byte[] ($bits.Stride * $lado)
        [System.Runtime.InteropServices.Marshal]::Copy($bits.Scan0, $pixeles, 0, $pixeles.Length)
        $bitmap.UnlockBits($bits)

        $flujo = New-Object System.IO.MemoryStream
        $escritor = New-Object System.IO.BinaryWriter $flujo

        # BITMAPINFOHEADER. El alto va doble porque el DIB de un icono lleva
        # pegada debajo la máscara de transparencia; con 32 bits el canal alfa
        # la hace inútil, pero sin ella Windows no reconoce la imagen.
        $escritor.Write([uint32] 40)
        $escritor.Write([int32] $lado)
        $escritor.Write([int32] ($lado * 2))
        $escritor.Write([uint16] 1)
        $escritor.Write([uint16] 32)
        $escritor.Write([uint32] 0)
        $escritor.Write([uint32] ($lado * $lado * 4))
        $escritor.Write([int32] 0)
        $escritor.Write([int32] 0)
        $escritor.Write([uint32] 0)
        $escritor.Write([uint32] 0)

        # Un DIB se guarda de abajo arriba.
        for ($y = $lado - 1; $y -ge 0; $y--) {
            $escritor.Write($pixeles, $y * $bits.Stride, $lado * 4)
        }

        # Máscara a ceros —todo opaco— para que decida el canal alfa. Las filas
        # van alineadas a cuatro bytes, como en cualquier mapa de bits.
        $bytesFila = [math]::Ceiling($lado / 32.0) * 4
        $escritor.Write((New-Object byte[] ($bytesFila * $lado)), 0, $bytesFila * $lado)

        $escritor.Flush()
        $datos = $flujo.ToArray()
        $escritor.Dispose()
        $flujo.Dispose()
    }

    $bitmap.Dispose()
    $imagenes += [pscustomobject]@{ Lado = $lado; Datos = $datos }
}

$fuente.Dispose()

$salida = New-Object System.IO.MemoryStream
$escritor = New-Object System.IO.BinaryWriter $salida

# ICONDIR: reservado, tipo 1 (icono) y cuántas imágenes vienen detrás.
$escritor.Write([uint16] 0)
$escritor.Write([uint16] 1)
$escritor.Write([uint16] $imagenes.Count)

$desplazamiento = 6 + (16 * $imagenes.Count)

foreach ($imagen in $imagenes) {
    # El lado ocupa un solo byte, así que 256 se escribe como 0.
    $lado = if ($imagen.Lado -eq 256) { 0 } else { $imagen.Lado }

    $escritor.Write([byte] $lado)
    $escritor.Write([byte] $lado)
    $escritor.Write([byte] 0)
    $escritor.Write([byte] 0)
    $escritor.Write([uint16] 1)
    $escritor.Write([uint16] 32)
    $escritor.Write([uint32] $imagen.Datos.Length)
    $escritor.Write([uint32] $desplazamiento)

    $desplazamiento += $imagen.Datos.Length
}

foreach ($imagen in $imagenes) {
    $escritor.Write($imagen.Datos, 0, $imagen.Datos.Length)
}

$escritor.Flush()
[System.IO.File]::WriteAllBytes($Destino, $salida.ToArray())
$escritor.Dispose()
$salida.Dispose()

"{0}: {1} tamaños, {2:N0} bytes" -f (Split-Path $Destino -Leaf), $imagenes.Count, (Get-Item $Destino).Length
