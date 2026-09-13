#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Construye, verifica y publica una versión actualizable de Druse.

.DESCRIPTION
    Tres etapas separadas, y separadas por un motivo: **entre construir y
    publicar puede haber una firma que no ocurre en esta máquina**. Un servicio
    como SignPath recibe el artefacto, lo firma y lo devuelve; cuando eso pase,
    la verificación y la publicación tienen que poder ejecutarse solas, sin
    reconstruir nada. Reconstruir produciría bytes distintos de los que se
    firmaron, que es justo el error que esto persigue.

    - `construir`: empaqueta las dos variantes, reúne los artefactos con sus
      firmas del actualizador, genera `latest.json` y el instalador selector.
    - `verificar`: comprueba que lo que hay en el directorio de la release se
      puede publicar. No construye nada.
    - `publicar`: exige integración continua verde para ese commit exacto, vuelve
      a verificar y crea la GitHub Release. Guarda la evidencia.

    La etapa `todo` las encadena, que es lo que se usa hoy.

.PARAMETER Etapa
    `todo` (por omisión), `construir`, `verificar` o `publicar`.

.PARAMETER Publish
    Con `-Etapa todo`, publica al terminar. `-Etapa publicar` ya publica por sí
    sola.

.PARAMETER SinComprobarCI
    Publica aunque la integración continua no esté verde para ese commit.

    **Queda anotado en la evidencia de la release**, y por eso existe: hoy las
    ejecuciones de Actions terminan en fallo por facturación sin ejecutar un
    paso, así que bloquear sin salida convertiría el guion en inservible. Lo que
    no puede pasar es que una publicación sin comprobar parezca comprobada.

.EXAMPLE
    ./build/scripts/release.ps1

.EXAMPLE
    ./build/scripts/release.ps1 -Etapa verificar

.EXAMPLE
    ./build/scripts/release.ps1 -Etapa publicar
#>
[CmdletBinding()]
param(
    [ValidateSet('todo', 'construir', 'verificar', 'publicar')]
    [string]$Etapa = 'todo',
    [switch]$Publish,
    [switch]$SinComprobarCI,
    [string]$Repository = 'darioRamos1/druse'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'verificacion-release.ps1')

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tauriDir = Join-Path $repoRoot 'shells/desktop-tauri'
$config = Get-Content (Join-Path $tauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json
$cargo = Get-Content (Join-Path $tauriDir 'Cargo.toml') -Raw
$version = [string]$config.version

$publicando = $Etapa -eq 'publicar' -or ($Etapa -eq 'todo' -and $Publish)

if ($publicando) {
    $dirty = git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) {
        throw 'Para publicar, el árbol de Git debe estar limpio y corresponder exactamente a los binarios.'
    }
}

if ($cargo -notmatch "(?m)^version = `"$([regex]::Escape($version))`"$") {
    throw 'La versión de tauri.conf.json no coincide con Cargo.toml.'
}

$releaseDir = Join-Path $repoRoot "artifacts/releases/$version"
$tag = "v$version"
$baseUrl = "https://github.com/$Repository/releases/download/$tag"
$completeName = "Druse-$version-windows-x86_64-completo-setup.exe"
$liteName = "Druse-$version-windows-x86_64-sin-informix-setup.exe"
$complete = Join-Path $releaseDir $completeName
$lite = Join-Path $releaseDir $liteName
$selector = Join-Path $releaseDir "Druse-$version-installer.exe"
$latest = Join-Path $releaseDir 'latest.json'
$evidencia = Join-Path $releaseDir 'evidencia.json'

$notesFile = Join-Path $repoRoot "docs/release-notes/$version.md"

if (-not (Test-Path $notesFile)) {
    $notesFile = Join-Path $repoRoot "docs/release-notes/$version-beta.md"
}

$notes = if (Test-Path $notesFile) { Get-Content $notesFile -Raw } else { "Druse $version" }

# --- Etapa 1: construir ------------------------------------------------------

function Invoke-DruseConstruccion {
    if (Test-Path $releaseDir) {
        Remove-Item $releaseDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

    & (Join-Path $PSScriptRoot 'package.ps1') -RequireUpdaterSignature
    if ($LASTEXITCODE -ne 0) { throw 'Falló el paquete completo.' }

    & (Join-Path $PSScriptRoot 'package.ps1') -WithoutInformix -RequireUpdaterSignature
    if ($LASTEXITCODE -ne 0) { throw 'Falló el paquete sin Informix.' }

    $bundleRoot = Join-Path $tauriDir 'target/release/bundle/nsis'
    $completeSource = Get-ChildItem $bundleRoot -Filter '*-completo.exe' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    $liteSource = Get-ChildItem $bundleRoot -Filter '*-sin-informix.exe' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $completeSource -or -not $liteSource) {
        throw 'No se encontraron los dos instaladores NSIS.'
    }

    Copy-Item $completeSource.FullName $complete
    Copy-Item $liteSource.FullName $lite
    Copy-Item "$($completeSource.FullName).sig" "$complete.sig"
    Copy-Item "$($liteSource.FullName).sig" "$lite.sig"

    $manifest = [ordered]@{
        version   = $version
        notes     = $notes
        pub_date  = (Get-Date).ToUniversalTime().ToString('o')
        platforms = [ordered]@{
            'windows-x86_64-completo'     = [ordered]@{
                url       = "$baseUrl/$completeName"
                signature = (Get-Content "$complete.sig" -Raw).Trim()
            }
            'windows-x86_64-sin-informix' = [ordered]@{
                url       = "$baseUrl/$liteName"
                signature = (Get-Content "$lite.sig" -Raw).Trim()
            }
        }
    }

    $manifest | ConvertTo-Json -Depth 6 | Set-Content $latest -Encoding UTF8

    $makensis = Get-Command 'makensis.exe' -ErrorAction SilentlyContinue
    $makensisPath = if ($makensis) { $makensis.Source } else { $null }

    if (-not $makensis) {
        $cachedNsis = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
        if (Test-Path $cachedNsis) { $makensisPath = $cachedNsis }
    }

    if (-not $makensisPath) {
        throw 'No se encontró makensis.exe. Ejecuta antes un empaquetado de Tauri o instala NSIS.'
    }

    # El selector lleva dentro los hashes de los dos instaladores, así que se
    # construye después de copiarlos y nunca antes: son los bytes que se van a
    # publicar los que tiene que reconocer.
    & $makensisPath `
        "/DDRUSE_VERSION=$version" `
        "/DCOMPLETE_URL=$baseUrl/$completeName" `
        "/DLITE_URL=$baseUrl/$liteName" `
        "/DCOMPLETE_SHA256=$((Get-FileHash $complete -Algorithm SHA256).Hash)" `
        "/DLITE_SHA256=$((Get-FileHash $lite -Algorithm SHA256).Hash)" `
        "/DOUTPUT_FILE=$selector" `
        (Join-Path $repoRoot 'build/installer/selector.nsi')

    if ($LASTEXITCODE -ne 0) { throw 'Falló la construcción del instalador selector.' }

    if ($env:DRUSE_SIGN_THUMBPRINT -or $env:DRUSE_SIGN_COMMAND) {
        . (Join-Path $PSScriptRoot 'signing.ps1')
        Invoke-DruseSigning `
            -Path @($selector) `
            -Thumbprint $env:DRUSE_SIGN_THUMBPRINT `
            -TimestampUrl $(if ($env:DRUSE_SIGN_TIMESTAMP_URL) { $env:DRUSE_SIGN_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }) `
            -Command $env:DRUSE_SIGN_COMMAND
    }
}

# --- Etapa 3: publicar -------------------------------------------------------

<#
.SYNOPSIS
    Estado de la integración continua para un commit exacto.

.DESCRIPTION
    No vale «la rama está verde»: lo que se publica es un commit, y es el suyo el
    que tiene que estar comprobado. Se consulta con `gh`; si no hay ninguna
    comprobación registrada, eso **no** cuenta como verde.
#>
function Invoke-DrusePublicacion([object]$verificacion) {
    $commit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo determinar el commit que se ha construido.' }

    $ci = Get-DruseEstadoCI -Commit $commit -Repository $Repository

    if ($ci.verde) {
        Write-Host "  OK   integración continua verde para $($commit.Substring(0, 8)): $($ci.detalle)" -ForegroundColor Green
    }
    elseif ($SinComprobarCI) {
        Write-Host "  ---  se publica SIN integración continua verde: $($ci.detalle)" -ForegroundColor Yellow
        Write-Host '       queda anotado en evidencia.json' -ForegroundColor Yellow
    }
    else {
        throw "La integración continua no está verde para $commit ($($ci.detalle)). " +
        'Resuélvelo, o repite con -SinComprobarCI para publicar dejándolo anotado en la evidencia.'
    }

    $remoteTags = @(git ls-remote "https://github.com/$Repository.git" "refs/tags/$tag" "refs/tags/$tag^{}")
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la etiqueta en el repositorio remoto.' }

    $peeled = $remoteTags | Where-Object { $_ -match '\^\{\}$' } | Select-Object -First 1
    $remoteTag = if ($peeled) { $peeled } else { $remoteTags | Select-Object -First 1 }
    $tagCommit = if ($remoteTag) { ($remoteTag -split '\s+')[0] } else { $null }

    if ($tagCommit -and $tagCommit -ne $commit) {
        throw "La etiqueta $tag pertenece a otro commit. No se publicará un binario que no corresponda a su código."
    }

    # La evidencia se escribe **antes** de publicar: si `gh` falla a mitad, queda
    # el registro de qué se comprobó y sobre qué bytes, que es lo que haría falta
    # para entender qué llegó a subirse.
    $registro = [ordered]@{
        version      = $version
        etiqueta     = $tag
        commit       = $commit
        repositorio  = $Repository
        publicado    = (Get-Date).ToUniversalTime().ToString('o')
        ci           = [ordered]@{
            verde   = $ci.verde
            detalle = $ci.detalle
            omitida = [bool]$SinComprobarCI
            workflow = 'ci.yml'
            run_id   = $ci.run_id
            url      = $ci.url
        }
        verificacion = $verificacion
    }

    $registro | ConvertTo-Json -Depth 6 | Set-Content $evidencia -Encoding UTF8

    $assets = @($selector, $complete, "$complete.sig", $lite, "$lite.sig", $latest)
    $tagArgs = if ($tagCommit) { @('--verify-tag') } else { @('--target', $commit) }

    if (Test-Path $notesFile) {
        gh release create $tag @assets @tagArgs --repo $Repository --title "Druse $version" --notes-file $notesFile
    }
    else {
        gh release create $tag @assets @tagArgs --repo $Repository --title "Druse $version" --notes $notes
    }

    if ($LASTEXITCODE -ne 0) { throw 'GitHub no pudo crear la publicación.' }
}

# --- Orquestación ------------------------------------------------------------

if ($Etapa -in @('todo', 'construir')) {
    Invoke-DruseConstruccion
}

$verificacion = $null

if ($Etapa -in @('todo', 'verificar', 'publicar')) {
    $verificacion = Invoke-DruseReleaseVerificacion `
        -ReleaseDir $releaseDir `
        -Version $version `
        -PublicKey ([string]$config.plugins.updater.pubkey) `
        -ManifestDir (Join-Path $repoRoot 'artifacts/paquete')
}

if ($publicando) {
    Invoke-DrusePublicacion $verificacion
}

Write-Host ''

if ($Etapa -eq 'verificar') {
    Write-Host "Release verificada en: $releaseDir" -ForegroundColor Green
}
else {
    Write-Host "Publicación preparada en: $releaseDir" -ForegroundColor Green
    Get-ChildItem $releaseDir | ForEach-Object { Write-Host "  $($_.FullName)" }
}
