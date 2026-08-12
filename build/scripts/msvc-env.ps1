#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Carga en la sesión actual el entorno de compilación de MSVC.

.DESCRIPTION
    En Windows, Rust necesita el enlazador de Microsoft y las librerías del SDK.
    No basta con que `link.exe` exista: hacen falta las variables LIB, INCLUDE y
    PATH que prepara `vcvars64.bat`.

    Sin esto, en máquinas con varias instalaciones de Visual Studio la detección
    automática de Rust puede elegir una que tenga el enlazador pero no las
    librerías, y la compilación falla con «no se puede abrir el archivo
    msvcrt.lib», que no dice nada sobre la causa real.

    Fuera de Windows no hace nada: el resto de plataformas usan sus propias
    herramientas del sistema.

.EXAMPLE
    . ./build/scripts/msvc-env.ps1
    cargo build
#>
[CmdletBinding()]
param()

if (-not $IsWindows) {
    return
}

# Se prefieren las Build Tools: son la instalación pensada para compilar sin
# entorno de desarrollo completo, y es lo que documenta Tauri.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"

if (-not (Test-Path $vswhere)) {
    throw 'No se encontró Visual Studio. Instala Build Tools con el componente de C++.'
}

$installPath = & $vswhere -products Microsoft.VisualStudio.Product.BuildTools `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -property installationPath 2>$null | Select-Object -First 1

if (-not $installPath) {
    # Si no hay Build Tools, sirve cualquier instalación con el componente C++.
    $installPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>$null | Select-Object -First 1
}

if (-not $installPath) {
    throw @'
No hay ninguna instalación de Visual Studio con el componente de C++.

Instálalo con:
  winget install --id Microsoft.VisualStudio.2022.BuildTools
y marca «Desarrollo para el escritorio con C++».
'@
}

$vcvars = Join-Path $installPath 'VC\Auxiliary\Build\vcvars64.bat'

if (-not (Test-Path $vcvars)) {
    throw "No se encontró vcvars64.bat en $installPath"
}

# `vcvars64.bat` solo sabe exportar variables a un `cmd`. Se ejecuta ahí, se
# vuelca el entorno resultante y se copia a esta sesión.
$output = & cmd /c "`"$vcvars`" >nul 2>&1 && set"

foreach ($line in $output) {
    if ($line -match '^([^=]+)=(.*)$') {
        Set-Item -Path "env:$($Matches[1])" -Value $Matches[2] -ErrorAction SilentlyContinue
    }
}

# El propio Rust puede no estar en el PATH si se instaló sin modificarlo.
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'

if ((Test-Path $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) {
    $env:Path = "$env:Path;$cargoBin"
}

Write-Host "Entorno de MSVC cargado desde: $installPath" -ForegroundColor DarkGray
