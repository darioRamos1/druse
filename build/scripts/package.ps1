#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Empaqueta Druse como aplicación de escritorio.

.DESCRIPTION
    Publica la API .NET de forma autocontenida, la coloca junto al envoltorio de
    Tauri y construye el instalador.

    Autocontenida quiere decir que el usuario final **no necesita instalar el SDK
    de .NET ni Node.js**: todo viaja dentro del paquete (criterio de salida de la
    Fase 7).

.PARAMETER Runtime
    Runtime Identifier de destino. Por defecto, el de esta máquina.

.PARAMETER SkipInstaller
    Publica y prepara todo, pero no llama a Tauri. Útil para revisar el contenido
    antes de construir el instalador, que es la parte lenta.

.PARAMETER Portable
    Genera además un ZIP que se ejecuta sin instalar.

    En ese modo la aplicación sigue guardando sus datos en el directorio del
    usuario, no junto al ejecutable, y **no puede recordar contraseñas** si el
    sistema no ofrece un almacén seguro (ADR 0004).

.EXAMPLE
    ./build/scripts/package.ps1

.EXAMPLE
    ./build/scripts/package.ps1 -Runtime linux-x64 -SkipInstaller
#>
[CmdletBinding()]
param(
    [string]$Runtime = '',
    [switch]$SkipInstaller,
    [switch]$Portable
)

$ErrorActionPreference = 'Stop'

# En Windows hay que cargar el entorno de MSVC antes de compilar: sin sus
# variables, Rust puede encontrar un enlazador sin las librerías del SDK y
# fallar con un mensaje que no explica la causa.
. (Join-Path $PSScriptRoot 'msvc-env.ps1')

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$apiProject = Join-Path $repoRoot 'backend/src/Druse.Host.LocalApi'
$tauriDir = Join-Path $repoRoot 'shells/desktop-tauri'
$apiOutput = Join-Path $tauriDir 'api'

if (-not $Runtime) {
    $Runtime = if ($IsWindows) { 'win-x64' } elseif ($IsMacOS) { 'osx-arm64' } else { 'linux-x64' }
}

Write-Host "Empaquetando Druse para $Runtime" -ForegroundColor Cyan
Write-Host ''

# --- 1. API autocontenida ---------------------------------------------------
Write-Host '[1/3] Publicando la API local...' -ForegroundColor Cyan

# El directorio se vacía primero: restos de una publicación anterior con otro
# runtime acabarían dentro del instalador.
if (Test-Path $apiOutput) {
    Remove-Item $apiOutput -Recurse -Force
}

dotnet publish $apiProject `
    --configuration Release `
    --runtime $Runtime `
    --self-contained true `
    --output $apiOutput `
    -p:PublishSingleFile=false `
    -p:DebugType=none

if ($LASTEXITCODE -ne 0) {
    throw 'Falló la publicación de la API.'
}

$size = (Get-ChildItem $apiOutput -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("      API publicada: {0:N0} MB" -f $size) -ForegroundColor Green

# --- 2. Frontend ------------------------------------------------------------
Write-Host '[2/3] Compilando el frontend...' -ForegroundColor Cyan

Push-Location (Join-Path $repoRoot 'frontend')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación del frontend.' }
}
finally {
    Pop-Location
}

Write-Host '      Frontend compilado.' -ForegroundColor Green

# --- 3. Instalador ----------------------------------------------------------
if ($SkipInstaller) {
    Write-Host '[3/3] Instalador omitido (-SkipInstaller).' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "Contenido preparado en: $apiOutput" -ForegroundColor DarkGray
    return
}

Write-Host '[3/3] Construyendo el instalador con Tauri...' -ForegroundColor Cyan

Push-Location $tauriDir
try {
    # `--no-bundle` no: aquí queremos precisamente el instalador.
    cargo tauri build
    if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción del instalador.' }
}
finally {
    Pop-Location
}

$bundleDir = Join-Path $tauriDir "target/$Runtime/release/bundle"

if (-not (Test-Path $bundleDir)) {
    $bundleDir = Join-Path $tauriDir 'target/release/bundle'
}

Write-Host ''
Write-Host 'Artefactos generados:' -ForegroundColor Green

Get-ChildItem $bundleDir -Recurse -Include '*.exe', '*.msi', '*.deb', '*.AppImage', '*.dmg' -ErrorAction SilentlyContinue |
    ForEach-Object { "  {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB) }

# --- 4. Distribución portable ------------------------------------------------
if ($Portable) {
    Write-Host ''
    Write-Host '[4/4] Creando la distribución portable...' -ForegroundColor Cyan

    $releaseDir = Join-Path $tauriDir 'target/release'
    $appName = if ($IsWindows) { 'druse.exe' } else { 'druse' }
    $appPath = Join-Path $releaseDir $appName

    if (-not (Test-Path $appPath)) {
        throw "No se encontró el ejecutable en $appPath"
    }

    $staging = Join-Path $tauriDir "target/portable/Druse-$Runtime"

    if (Test-Path $staging) {
        Remove-Item $staging -Recurse -Force
    }

    New-Item -ItemType Directory -Force $staging | Out-Null

    Copy-Item $appPath $staging
    Copy-Item $apiOutput (Join-Path $staging 'api') -Recurse

    # Se avisa dentro del propio paquete: en modo portable el comportamiento de
    # las contraseñas cambia, y descubrirlo por sorpresa sería peor.
    @'
Druse — distribución portable

Ejecuta druse.exe. No hace falta instalar nada: la API viaja dentro y no
necesitas .NET ni Node.js.

Dónde se guardan tus datos
--------------------------
Las conexiones, el historial y las preferencias van al directorio de datos de
tu usuario (%APPDATA%\Druse), no junto a este ejecutable. Copiar esta carpeta a
otro equipo no lleva tus conexiones con ella.

Contraseñas
-----------
Se guardan en el almacén de credenciales del sistema, igual que en la versión
instalada. Si el equipo no ofrece uno, Druse pedirá la contraseña en cada
conexión y te lo indicará en la interfaz.
'@ | Set-Content (Join-Path $staging 'LEEME.txt') -Encoding UTF8

    $zip = Join-Path $tauriDir "target/portable/Druse-0.1.0-$Runtime-portable.zip"
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path "$staging\*" -DestinationPath $zip -CompressionLevel Optimal

    "  {0}  ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)
}
