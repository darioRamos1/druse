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

.PARAMETER WithoutInformix
    Deja el proveedor de Informix fuera del paquete.

    Su driver son 111 MB —el clidriver nativo de IBM— y triplica el tamaño del
    resultado. Con este modificador salen los tres motores restantes y el ZIP
    portable se llama distinto, para que ambas versiones puedan convivir en la
    misma carpeta sin pisarse.

.PARAMETER RequireUpdaterSignature
    Falla si no está disponible la clave privada del actualizador. Las
    publicaciones deben usarlo; una compilación local de prueba puede omitirla.

.PARAMETER CertificateThumbprint
    Huella del certificado de firma de código, ya instalado en el almacén de
    Windows. Si no se indica, se toma de `DRUSE_SIGN_THUMBPRINT`.

    **Sin certificado el empaquetado funciona igual que siempre**, solo que los
    artefactos salen sin firmar y Windows enseñará el aviso de SmartScreen en
    cada equipo donde se abran. Ver `signing.ps1`.

.PARAMETER TimestampUrl
    Servidor de sellado de tiempo. Sin sello, la firma deja de validar cuando el
    certificado caduca, incluso en copias ya repartidas.

.EXAMPLE
    ./build/scripts/package.ps1

.EXAMPLE
    ./build/scripts/package.ps1 -Runtime linux-x64 -SkipInstaller

.EXAMPLE
    ./build/scripts/package.ps1 -Portable -CertificateThumbprint 'a1b2c3...'
#>
[CmdletBinding()]
param(
    [string]$Runtime = '',
    [switch]$SkipInstaller,
    [switch]$Portable,
    [switch]$WithoutInformix,
    [switch]$RequireUpdaterSignature,
    [string]$CertificateThumbprint = $env:DRUSE_SIGN_THUMBPRINT,
    [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'

# En Windows hay que cargar el entorno de MSVC antes de compilar: sin sus
# variables, Rust puede encontrar un enlazador sin las librerías del SDK y
# fallar con un mensaje que no explica la causa.
. (Join-Path $PSScriptRoot 'msvc-env.ps1')
. (Join-Path $PSScriptRoot 'signing.ps1')
. (Join-Path $PSScriptRoot 'manifiesto.ps1')

if ($env:DRUSE_SIGN_TIMESTAMP_URL) {
    $TimestampUrl = $env:DRUSE_SIGN_TIMESTAMP_URL
}

$signCommand = $env:DRUSE_SIGN_COMMAND
$signing = [bool]$CertificateThumbprint -or [bool]$signCommand

# Distingue las dos variantes en el nombre de cada artefacto. La completa lleva
# `-completo` en lugar de nada: si una se quedara sin sufijo, la siguiente
# ejecución sobrescribiría su instalador antes de renombrarlo.
$VariantSuffix = if ($WithoutInformix) { '-sin-informix' } else { '-completo' }
$Variant = if ($WithoutInformix) { 'sin-informix' } else { 'completo' }

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$apiProject = Join-Path $repoRoot 'backend/src/Druse.Host.LocalApi'
$tauriDir = Join-Path $repoRoot 'shells/desktop-tauri'
$apiOutput = Join-Path $tauriDir 'api'

# La versión sale de `tauri.conf.json`, que es la que acaba en el nombre del
# instalador: leerla de otro sitio produciría un manifiesto que dice una versión
# distinta de la que se reparte.
$appVersion = (Get-Content (Join-Path $tauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json).version
$manifestDir = Join-Path $repoRoot 'artifacts/paquete'
$updaterKey = if ($env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
    $env:TAURI_SIGNING_PRIVATE_KEY_PATH
}
else {
    Join-Path $HOME '.tauri/druse-updater.key'
}
$updaterSigning = [bool]$env:TAURI_SIGNING_PRIVATE_KEY -or (Test-Path $updaterKey)

if ($RequireUpdaterSignature -and -not $updaterSigning) {
    throw "No se encontró la clave privada del actualizador en $updaterKey ni en TAURI_SIGNING_PRIVATE_KEY."
}

if (-not $Runtime) {
    $Runtime = if ($IsWindows) { 'win-x64' } elseif ($IsMacOS) { 'osx-arm64' } else { 'linux-x64' }
}

Write-Host "Empaquetando Druse para $Runtime" -ForegroundColor Cyan

if ($signing) {
    Write-Host 'Los artefactos se firmarán.' -ForegroundColor DarkGray
}
else {
    # Se dice al empezar y no al terminar: enterarse de que el paquete sale sin
    # firmar después de cinco minutos de compilación no sirve de nada.
    Write-Host 'Sin certificado: los artefactos saldrán sin firmar y Windows avisará al abrirlos.' -ForegroundColor Yellow
}

if ($updaterSigning) {
    $keySource = if ($env:TAURI_SIGNING_PRIVATE_KEY) { 'TAURI_SIGNING_PRIVATE_KEY' } else { $updaterKey }
    Write-Host "Las actualizaciones se firmarán con: $keySource" -ForegroundColor DarkGray
}
else {
    Write-Host 'Sin clave del actualizador: no se generarán artefactos de actualización.' -ForegroundColor Yellow
}

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
    -p:DebugType=none `
    "-p:IncludeInformix=$(if ($WithoutInformix) { 'false' } else { 'true' })"

if ($LASTEXITCODE -ne 0) {
    throw 'Falló la publicación de la API.'
}

$size = (Get-ChildItem $apiOutput -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("      API publicada: {0:N0} MB" -f $size) -ForegroundColor Green

# Vaciar el directorio se lleva por delante el `.gitkeep`, que está versionado y
# existe por un motivo: sin él, el glob `api/*` de Tauri falla en un clon recién
# hecho, donde la API todavía no se ha publicado. Se repone aquí para que
# empaquetar no deje el árbol de git sucio.
$gitkeep = Join-Path $apiOutput '.gitkeep'

if (-not (Test-Path $gitkeep)) {
    New-Item -ItemType File $gitkeep | Out-Null
}

# --- Contenido del paquete ---------------------------------------------------
# Se comprueba aquí y no al final por tiempo: el frontend y el instalador son
# cinco minutos, y lo que decide si este paquete puede repartirse ya está en el
# disco. Si la variante ligera trae el controlador de IBM, mejor saberlo ahora.
$inventory = @(Get-DrusePackageInventory -Path $apiOutput -Prefix 'api')
$findings = @(Test-DrusePackageContent `
        -Inventory $inventory `
        -Rules (Get-DrusePackageRules -Variant $Variant))

foreach ($finding in $findings) {
    $sample = ($finding.archivos | Select-Object -First 3) -join ', '
    $extra = if ($finding.archivos.Count -gt 3) { " (+$($finding.archivos.Count - 3) más)" } else { '' }

    if ($finding.aplicar) {
        Write-Host "      Excluido pero presente [$($finding.regla)]: $sample$extra" -ForegroundColor Red
    }
    else {
        # Pendiente de decisión: se cuenta y se anota, no detiene nada. Fallar
        # por esto sería aplicar una decisión que todavía no está tomada.
        Write-Host "      Pendiente de decisión [$($finding.regla)]: $($finding.archivos.Count) archivo(s)" -ForegroundColor Yellow
    }
}

$blocking = @($findings | Where-Object { $_.aplicar })

if ($blocking.Count -gt 0) {
    throw "El paquete '$Variant' contiene archivos excluidos por $($blocking.regla -join ', '). Revisa build/paquete-excluidos.json."
}

Write-Host ("      Contenido inventariado: {0:N0} archivos" -f $inventory.Count) -ForegroundColor Green

# La API viaja dentro del paquete y es un ejecutable más, pero Tauri solo firma
# el suyo y los instaladores: esto hay que hacerlo aquí o no lo hace nadie. Un
# instalador firmado que suelta un binario sin firmar es justo lo que hace saltar
# a los antivirus corporativos.
#
# Se firma únicamente lo propio. El runtime de .NET que acompaña a una
# publicación autocontenida ya viene firmado por Microsoft, y volver a firmarlo
# serían cientos de archivos y otras tantas llamadas al servidor de sellado.
if ($signing -and $IsWindows) {
    $ownBinaries = Get-ChildItem $apiOutput -Recurse -Include 'Druse*.exe', 'Druse*.dll' |
        Select-Object -ExpandProperty FullName

    Invoke-DruseSigning `
        -Path $ownBinaries `
        -Thumbprint $CertificateThumbprint `
        -TimestampUrl $TimestampUrl `
        -Command $signCommand

    $apiExe = Join-Path $apiOutput 'Druse.Host.LocalApi.exe'

    if (Test-Path $apiExe) {
        $signature = Test-DruseSignature -Path $apiExe
        Write-Host "      API firmada por: $($signature.SignerCertificate.Subject)" -ForegroundColor Green
    }
}

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

    $manifest = Write-DrusePackageManifest `
        -Inventory $inventory `
        -Variant $Variant `
        -Version $appVersion `
        -Runtime $Runtime `
        -Path (Join-Path $manifestDir "manifiesto-$Variant-$appVersion-$Runtime-sin-instalador.json") `
        -Findings $findings `
        -Signed ($signing -and $IsWindows)

    Write-Host ''
    Write-Host "Contenido preparado en: $apiOutput" -ForegroundColor DarkGray
    Write-Host "Manifiesto: $manifest" -ForegroundColor DarkGray
    return
}

Write-Host '[3/3] Construyendo el instalador con Tauri...' -ForegroundColor Cyan

# Se anota antes de construir para poder distinguir después los artefactos de
# esta ejecución de los que ya estaban en el directorio. Un segundo de margen
# porque la marca de tiempo del sistema de archivos no tiene por qué ser más
# fina que la del reloj.
$buildStartedAt = (Get-Date).AddSeconds(-1)

# La firma no se escribe en `tauri.conf.json`: una huella de certificado es de
# la máquina que compila, no del proyecto, y versionarla obligaría a cada equipo
# a editar el archivo para poder empaquetar. Se pasa como configuración
# adicional, que Tauri combina con la del repositorio.
$tauriOverride = Join-Path $tauriDir 'tauri.packaging.json'
$bundleOverride = @{
    createUpdaterArtifacts = $updaterSigning
}

if ($signing) {
    $windows = @{
        digestAlgorithm = 'sha256'
        timestampUrl    = $TimestampUrl
    }

    if ($signCommand) {
        $windows.signCommand = $signCommand
    }
    else {
        $windows.certificateThumbprint = $CertificateThumbprint
    }

    $bundleOverride.windows = $windows
}

@{ bundle = $bundleOverride } |
    ConvertTo-Json -Depth 5 |
    Set-Content $tauriOverride -Encoding UTF8

# `tauri.conf.json` fija los formatos de Windows, que son los que se reparten.
# Fuera de Windows hay que pedir los de cada plataforma o la construcción no
# produce nada: el script acepta cualquier RID y esto es lo que hace que eso sea
# verdad y no solo una promesa del parámetro.
$bundles = if ($IsWindows) { $null } elseif ($IsMacOS) { 'dmg,app' } else { 'deb,appimage' }

Push-Location $tauriDir
$previousVariant = $env:DRUSE_VARIANT
$previousUpdaterPrivateKey = $env:TAURI_SIGNING_PRIVATE_KEY
try {
    $env:DRUSE_VARIANT = $Variant

    if ($updaterSigning -and -not $env:TAURI_SIGNING_PRIVATE_KEY) {
        # El bundler no lee TAURI_SIGNING_PRIVATE_KEY_PATH: admite una ruta como
        # valor de TAURI_SIGNING_PRIVATE_KEY y carga el contenido por su cuenta.
        $env:TAURI_SIGNING_PRIVATE_KEY = $updaterKey
    }

    # `--no-bundle` no: aquí queremos precisamente el instalador.
    $tauriArgs = @('tauri', 'build', '--ci')

    $tauriArgs += @('--config', $tauriOverride)
    if ($bundles) { $tauriArgs += @('--bundles', $bundles) }

    cargo @tauriArgs

    if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción del instalador.' }
}
finally {
    Pop-Location

    $env:DRUSE_VARIANT = $previousVariant
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousUpdaterPrivateKey

    # El archivo lleva la huella del certificado de quien compiló: se borra
    # aunque la construcción falle, para que no acabe en un commit.
    Remove-Item $tauriOverride -Force -ErrorAction SilentlyContinue
}

$bundleDir = Join-Path $tauriDir "target/$Runtime/release/bundle"

if (-not (Test-Path $bundleDir)) {
    $bundleDir = Join-Path $tauriDir 'target/release/bundle'
}

Write-Host ''
Write-Host 'Artefactos generados:' -ForegroundColor Green

# Solo lo que ha salido de **esta** construcción.
#
# El directorio de bundles conserva lo de ejecuciones anteriores, que ya lleva
# su sufijo, y renombrarlo otra vez produce nombres como
# `...-sin-informix-sin-informix.exe`. Peor que ser feo: deja dos archivos
# parecidos y recientes sin forma de saber cuál es el nuevo.
$bundles = Get-ChildItem $bundleDir -Recurse -Include '*.exe', '*.msi', '*.deb', '*.AppImage', '*.dmg' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $buildStartedAt }

# Tauri nombra sus instaladores igual en las dos variantes, así que **ambas** se
# renombran, no solo la ligera. Poner sufijo a una sola no basta: generar la
# segunda sobrescribe el archivo de la primera antes de que se renombre, y la
# primera desaparece sin previo aviso. Pasó exactamente eso al encadenar las dos
# ejecuciones.
$bundles = $bundles | ForEach-Object {
    $signature = "$($_.FullName).sig"
    $target = Join-Path $_.DirectoryName `
        "$([IO.Path]::GetFileNameWithoutExtension($_.Name))$VariantSuffix$($_.Extension)"

    Move-Item $_.FullName $target -Force

    if (Test-Path $signature) {
        Move-Item $signature "$target.sig" -Force
    }

    Get-Item $target
}

$bundles | ForEach-Object { "  {0}  ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB) }

# Se verifica lo que salió, no lo que se pidió: Tauri puede terminar con éxito y
# dejar un instalador sin firmar si la configuración no llegó a aplicarse, y eso
# se descubriría en el equipo del usuario.
if ($signing -and $IsWindows) {
    Write-Host ''
    Write-Host 'Firma de los artefactos:' -ForegroundColor Cyan
    $invalidSignatures = @()

    foreach ($bundle in $bundles) {
        $status = (Get-AuthenticodeSignature -FilePath $bundle.FullName).Status

        if ($status -eq 'Valid') {
            Write-Host "  OK   $($bundle.Name)" -ForegroundColor Green
        }
        else {
            Write-Host "  ---  $($bundle.Name): $status" -ForegroundColor Red
            $invalidSignatures += $bundle.Name
        }
    }

    if ($invalidSignatures.Count -gt 0) {
        throw "La firma Authenticode no es válida en: $($invalidSignatures -join ', ')"
    }
}

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

    $zip = Join-Path $tauriDir "target/portable/Druse-$appVersion-$Runtime-portable$VariantSuffix.zip"
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Compress-Archive -Path "$staging\*" -DestinationPath $zip -CompressionLevel Optimal

    "  {0}  ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB)
}

# --- Manifiesto --------------------------------------------------------------
# Se escribe al final y con los artefactos ya renombrados y firmados, porque el
# SHA-256 que sirve es el de los bytes que se reparten. Firmar después de
# calcularlo produciría un manifiesto que no corresponde a ningún archivo
# existente, que es el mismo error que invalidaría la `.sig` del actualizador.
$artifactPaths = @(foreach ($bundle in $bundles) { $bundle.FullName; "$($bundle.FullName).sig" })

# El ZIP portable solo existe con -Portable, y `Get-DruseArtifactEntries` ignora
# lo que no está: así el manifiesto lista lo que se generó de verdad en esta
# ejecución, sin una entrada vacía para lo que no se pidió.
if ($Portable) { $artifactPaths += $zip }

$manifest = Write-DrusePackageManifest `
    -Inventory ($inventory + @(Get-DruseArtifactEntries -Path $artifactPaths)) `
    -Variant $Variant `
    -Version $appVersion `
    -Runtime $Runtime `
    -Path (Join-Path $manifestDir "manifiesto-$Variant-$appVersion-$Runtime.json") `
    -Findings $findings `
    -Signed ($signing -and $IsWindows)

Write-Host ''
Write-Host "Manifiesto del paquete: $manifest" -ForegroundColor Green
