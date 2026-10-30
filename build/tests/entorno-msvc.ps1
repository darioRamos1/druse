#!/usr/bin/env pwsh
# La publicación construye tres ediciones en una sesión. Esta regresión prueba
# ese orden real: repetir la preparación no debe hacer desaparecer las
# herramientas del frontend al heredar un PATH cada vez más largo.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Esta comprobación necesita las herramientas MSVC de Windows.' }
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$loader = Join-Path $repoRoot 'build/scripts/msvc-env.ps1'
# Los ejecutores de Windows traen más herramientas en PATH que una instalación
# local sencilla. Esta longitud reproduce la pérdida de Angular en la tercera
# carga del entorno anterior, sin cambiar qué programas se pueden resolver.
$paddingDirectory = Join-Path $env:WINDIR 'System32'
while ($env:PATH.Length -lt 3400) { $env:PATH += ";$paddingDirectory" }
$paths = @()
foreach ($edition in @('completo', 'sin-informix', 'comunidad')) {
    . $loader
    $paths += $env:PATH
    if (-not (Get-Command cl.exe -CommandType Application -ErrorAction SilentlyContinue) -or
        -not (Get-Command link.exe -CommandType Application -ErrorAction SilentlyContinue)) {
        throw "La edición $edition perdió las herramientas de MSVC."
    }
}
if ($paths[0] -cne $paths[1] -or $paths[0] -cne $paths[2]) {
    throw 'Preparar las tres ediciones modifica de nuevo el PATH de compilación.'
}
Push-Location (Join-Path $repoRoot 'frontend')
try {
    npm exec --no -- ng version
    if ($LASTEXITCODE -ne 0) { throw 'Angular dejó de estar disponible tras preparar las tres ediciones.' }
} finally {
    Pop-Location
}
Write-Host "OK: tres ediciones conservan MSVC, Angular y el mismo PATH ($($paths[0].Length) caracteres)."
