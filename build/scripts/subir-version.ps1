#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Sube la versión de Druse en todos los sitios donde vive.

.DESCRIPTION
    La versión está repetida en el backend, el envoltorio de Tauri, su lock y la
    documentación. Cambiarla a mano en uno y olvidar otro produce un instalador
    que dice una versión y una API que dice otra, así que se cambia aquí.

    No escribe las novedades: eso lo cuenta quien hizo el cambio, en
    `frontend/src/app/core/whats-new/release-notes.ts`. Sin esa entrada,
    `package.ps1` se niega a empaquetar.

.PARAMETER Parte
    `patch` para arreglos y mejoras, `minor` para funciones nuevas, `major` para
    cambios que rompen algo.

.PARAMETER Version
    Una versión exacta, en lugar de calcularla.

.EXAMPLE
    ./build/scripts/subir-version.ps1 -Parte minor
#>
[CmdletBinding()]
param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Parte = 'patch',
    [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tauriConf = Join-Path $repoRoot 'shells/desktop-tauri/tauri.conf.json'

$actual = (Get-Content $tauriConf -Raw | ConvertFrom-Json).version

if (-not $Version) {
    $partes = $actual.Split('.') | ForEach-Object { [int]$_ }
    $Version = switch ($Parte) {
        'major' { "$($partes[0] + 1).0.0" }
        'minor' { "$($partes[0]).$($partes[1] + 1).0" }
        'patch' { "$($partes[0]).$($partes[1]).$($partes[2] + 1)" }
    }
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "«$Version» no es una versión X.Y.Z."
}

$a = [regex]::Escape($actual)

# El expediente fija también los archivos de Cargo. Cambiar solo la versión de
# Druse no cambia sus dependencias; sí cambia esos hashes y debe acompañarlos.
# Si ya no coincidían antes, no damos por revisado un grafo nuevo por accidente.
$rustIndexPath = Join-Path $repoRoot 'docs/terceros/comunidad-rust/indice.json'
$rustIndex = Get-Content -LiteralPath $rustIndexPath -Raw | ConvertFrom-Json
$cargoLockPath = Join-Path $repoRoot 'shells/desktop-tauri/Cargo.lock'
$cargoTomlPath = Join-Path $repoRoot 'shells/desktop-tauri/Cargo.toml'
if ($rustIndex.cargoLockSha256 -cne (Get-FileHash -LiteralPath $cargoLockPath).Hash.ToLowerInvariant() -or
    $rustIndex.cargoTomlSha256 -cne (Get-FileHash -LiteralPath $cargoTomlPath).Hash.ToLowerInvariant()) {
    throw 'El expediente Rust no corresponde al grafo actual. Revisa sus dependencias y avisos antes de subir la versión.'
}

# Cada sustitución tiene que encontrar su texto: si uno cambió de forma, se
# avisa en lugar de dejar esa copia atrás en silencio.
$cambios = @(
    @{ Archivo = 'backend/Directory.Build.props'; Buscar = "<Version>$a</Version>"; Poner = "<Version>$Version</Version>" }
    @{ Archivo = 'shells/desktop-tauri/tauri.conf.json'; Buscar = "`"version`": `"$a`""; Poner = "`"version`": `"$Version`"" }
    @{ Archivo = 'shells/desktop-tauri/Cargo.toml'; Buscar = "(?m)^version = `"$a`""; Poner = "version = `"$Version`"" }
    @{ Archivo = 'shells/desktop-tauri/Cargo.lock'; Buscar = "name = `"druse`"\r?\nversion = `"$a`""; Poner = "name = `"druse`"`nversion = `"$Version`"" }
    @{ Archivo = 'README.md'; Buscar = "Estado: versión $a\."; Poner = "Estado: versión $Version." }
    @{ Archivo = 'SECURITY.md'; Buscar = "Druse está en $a"; Poner = "Druse está en $Version" }
    @{ Archivo = 'docs/distribucion/distribucion-windows-smartscreen.md'; Buscar = "(La versión configurada es |Druse_)$a"; Poner = "`${1}$Version" }
    @{ Archivo = 'docs/distribucion/expediente-signpath.md'; Buscar = "\| Versión actual \| $a,"; Poner = "| Versión actual | $Version," }
    @{ Archivo = '.github/ISSUE_TEMPLATE/compatibilidad.yml'; Buscar = "'$a sin Informix'"; Poner = "'$Version sin Informix'" }
    @{ Archivo = '.github/ISSUE_TEMPLATE/fallo.yml'; Buscar = "'$a completa'"; Poner = "'$Version completa'" }
)

$faltan = @()

foreach ($cambio in $cambios) {
    $ruta = Join-Path $repoRoot $cambio.Archivo
    $texto = [IO.File]::ReadAllText($ruta)

    if ($texto -notmatch $cambio.Buscar) {
        $faltan += $cambio.Archivo
        continue
    }

    [IO.File]::WriteAllText($ruta, ($texto -replace $cambio.Buscar, $cambio.Poner))
}

$rustIndexText = [IO.File]::ReadAllText($rustIndexPath)
foreach ($entry in @(@('cargoLockSha256', $cargoLockPath), @('cargoTomlSha256', $cargoTomlPath))) {
    $key, $file = $entry
    $newHash = (Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()
    $rustIndexText = $rustIndexText.Replace([string]$rustIndex.$key, $newHash)
}
[IO.File]::WriteAllText($rustIndexPath, $rustIndexText)

Write-Host "Versión: $actual -> $Version" -ForegroundColor Cyan

if ($faltan) {
    Write-Warning "No se encontró la versión $actual en: $($faltan -join ', '). Revísalos a mano."
}

$notas = Join-Path $repoRoot 'frontend/src/app/core/whats-new/release-notes.ts'
if (-not (Select-String -Path $notas -SimpleMatch "version: '$Version'" -Quiet)) {
    Write-Host "Falta la entrada de novedades de $Version en $notas." -ForegroundColor Yellow
}
