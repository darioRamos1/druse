#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Construye y, opcionalmente, publica una versión actualizable de Druse.

.DESCRIPTION
    Genera los instaladores completo y sin Informix, sus firmas de actualización,
    el instalador selector y `latest.json`. Con `-Publish` crea la GitHub Release.

.PARAMETER Publish
    Publica los artefactos mediante `gh`. Sin este modificador solo los deja en
    `artifacts/releases/<version>` para poder probarlos antes.
#>
[CmdletBinding()]
param(
    [switch]$Publish,
    [string]$Repository = 'darioRamos1/druse'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tauriDir = Join-Path $repoRoot 'shells/desktop-tauri'
$config = Get-Content (Join-Path $tauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json
$cargo = Get-Content (Join-Path $tauriDir 'Cargo.toml') -Raw
$version = [string]$config.version

if ($Publish) {
    $dirty = git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) {
        throw 'Para publicar, el árbol de Git debe estar limpio y corresponder exactamente a los binarios.'
    }
}

if ($cargo -notmatch "(?m)^version = `"$([regex]::Escape($version))`"$") {
    throw 'La versión de tauri.conf.json no coincide con Cargo.toml.'
}

$releaseDir = Join-Path $repoRoot "artifacts/releases/$version"

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

$completeName = "Druse-$version-windows-x86_64-completo-setup.exe"
$liteName = "Druse-$version-windows-x86_64-sin-informix-setup.exe"
$complete = Join-Path $releaseDir $completeName
$lite = Join-Path $releaseDir $liteName

Copy-Item $completeSource.FullName $complete
Copy-Item $liteSource.FullName $lite
Copy-Item "$($completeSource.FullName).sig" "$complete.sig"
Copy-Item "$($liteSource.FullName).sig" "$lite.sig"

function Get-MinisignKeyId([string]$encodedDocument) {
    try {
        $document = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedDocument.Trim()))
        $payload = $document -split "`r?`n" |
            Where-Object { $_ -and $_ -notmatch '^(untrusted|trusted) comment:' } |
            Select-Object -First 1
        $bytes = [Convert]::FromBase64String($payload)

        if ($bytes.Length -lt 10) { throw 'Documento Minisign incompleto.' }

        return [Convert]::ToHexString($bytes[2..9])
    }
    catch {
        throw "No se pudo leer una clave o firma Minisign: $_"
    }
}

$publicKeyId = Get-MinisignKeyId ([string]$config.plugins.updater.pubkey)

foreach ($signaturePath in @("$complete.sig", "$lite.sig")) {
    $signatureKeyId = Get-MinisignKeyId (Get-Content $signaturePath -Raw)

    if ($signatureKeyId -ne $publicKeyId) {
        throw "La firma $signaturePath no pertenece a la clave pública configurada. No se publicará."
    }
}

$tag = "v$version"
$baseUrl = "https://github.com/$Repository/releases/download/$tag"
$notesFile = Join-Path $repoRoot "docs/release-notes/$version.md"

if (-not (Test-Path $notesFile)) {
    $notesFile = Join-Path $repoRoot "docs/release-notes/$version-beta.md"
}

$notes = if (Test-Path $notesFile) { Get-Content $notesFile -Raw } else { "Druse $version" }
$manifest = [ordered]@{
    version = $version
    notes = $notes
    pub_date = (Get-Date).ToUniversalTime().ToString('o')
    platforms = [ordered]@{
        'windows-x86_64-completo' = [ordered]@{
            url = "$baseUrl/$completeName"
            signature = (Get-Content "$complete.sig" -Raw).Trim()
        }
        'windows-x86_64-sin-informix' = [ordered]@{
            url = "$baseUrl/$liteName"
            signature = (Get-Content "$lite.sig" -Raw).Trim()
        }
    }
}

$latest = Join-Path $releaseDir 'latest.json'
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

$selector = Join-Path $releaseDir "Druse-$version-installer.exe"
$completeHash = (Get-FileHash $complete -Algorithm SHA256).Hash
$liteHash = (Get-FileHash $lite -Algorithm SHA256).Hash

& $makensisPath `
    "/DDRUSE_VERSION=$version" `
    "/DCOMPLETE_URL=$baseUrl/$completeName" `
    "/DLITE_URL=$baseUrl/$liteName" `
    "/DCOMPLETE_SHA256=$completeHash" `
    "/DLITE_SHA256=$liteHash" `
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

    $selectorSignature = Get-AuthenticodeSignature -LiteralPath $selector
    if ($selectorSignature.Status -ne 'Valid') {
        throw "La firma Authenticode del instalador selector no es válida: $($selectorSignature.Status)"
    }
}

$assets = @($selector, $complete, "$complete.sig", $lite, "$lite.sig", $latest)

if ($Publish) {
    $commit = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo determinar el commit que se ha construido.' }

    $remoteTags = @(git ls-remote "https://github.com/$Repository.git" "refs/tags/$tag" "refs/tags/$tag^{}")
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la etiqueta en el repositorio remoto.' }

    $peeled = $remoteTags | Where-Object { $_ -match '\^\{\}$' } | Select-Object -First 1
    $remoteTag = if ($peeled) { $peeled } else { $remoteTags | Select-Object -First 1 }
    $tagCommit = if ($remoteTag) { ($remoteTag -split '\s+')[0] } else { $null }

    if ($tagCommit -and $tagCommit -ne $commit) {
        throw "La etiqueta $tag pertenece a otro commit. No se publicará un binario que no corresponda a su código."
    }

    $tagArgs = if ($tagCommit) { @('--verify-tag') } else { @('--target', $commit) }

    if (Test-Path $notesFile) {
        gh release create $tag @assets @tagArgs --repo $Repository --title "Druse $version" --notes-file $notesFile
    }
    else {
        gh release create $tag @assets @tagArgs --repo $Repository --title "Druse $version" --notes $notes
    }

    if ($LASTEXITCODE -ne 0) { throw 'GitHub no pudo crear la publicación.' }
}

Write-Host ''
Write-Host "Publicación preparada en: $releaseDir" -ForegroundColor Green
$assets | ForEach-Object { Write-Host "  $_" }
