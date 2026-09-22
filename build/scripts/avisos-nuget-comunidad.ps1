# Copia textos revisables y fijados por versión; no determina compatibilidad legal.
function Copy-DruseCommunityNugetNotices {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$ApiOutput
    )
    $ErrorActionPreference = 'Stop'
    $sourceRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'docs/terceros/comunidad'))
    $indexPath = Join-Path $sourceRoot 'indice.json'
    $index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
    if ($index.esquema -ne 1) { throw 'Esquema de avisos NuGet no admitido.' }
    $depsPath = Join-Path $ApiOutput 'Druse.Host.LocalApi.deps.json'
    $deps = Get-Content -LiteralPath $depsPath -Raw | ConvertFrom-Json -AsHashtable
    $available = @{}
    foreach ($package in $index.paquetes) {
        $key = "$($package.componente)/$($package.version)"
        if ($available.ContainsKey($key)) { throw "Avisos NuGet duplicados: $key" }
        $available[$key] = $package
    }
    $selected = @(foreach ($key in @($deps.libraries.Keys | Sort-Object)) {
        if ($deps.libraries[$key].type -notin @('package', 'runtimepack')) { continue }
        $packageKey = $key -replace '^runtimepack\.', ''
        if (-not $available.ContainsKey($packageKey)) {
            throw "Faltan avisos de la versión exacta $packageKey. Actualiza el expediente de terceros antes de empaquetar Comunidad."
        }
        $record = $available[$packageKey]
        if (-not @($record.documentos).Count) { throw "Sin documentos: $packageKey" }
        $record
    })
    if (-not $selected.Count) { throw 'La API no contiene un grafo de paquetes para comprobar.' }
    $documents = @{}
    $base = $sourceRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($document in @($selected.documentos)) {
        $relative = [string]$document.archivo
        $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relative))
        if ($relative -notmatch '^fuentes/' -or $relative -match '(^|[/\\])\.\.([/\\]|$)' -or
            [IO.Path]::IsPathRooted($relative) -or -not $source.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Ruta de aviso fuera del expediente de terceros.'
        }
        if ($document.sha256 -notmatch '^[0-9a-f]{64}$' -or -not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Aviso ausente o hash inválido: $relative"
        }
        if ((Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant() -ne $document.sha256) {
            throw "El aviso fue modificado: $relative"
        }
        if ($documents.ContainsKey($relative) -and $documents[$relative].sha256 -ne $document.sha256) {
            throw "Hash contradictorio: $relative"
        }
        $documents[$relative] = $document
    }
    $destination = Join-Path $ApiOutput 'licenses/nuget-comunidad'
    if (Test-Path -LiteralPath $destination) { throw 'La carpeta de avisos NuGet debe estar vacía antes de empaquetar.' }
    New-Item -ItemType Directory -Path $destination | Out-Null
    foreach ($relative in @($documents.Keys | Sort-Object)) {
        $target = Join-Path $destination $relative
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $target
        if ((Get-FileHash -LiteralPath $target).Hash.ToLowerInvariant() -ne $documents[$relative].sha256) { throw 'La copia del aviso no coincide.' }
    }
    [ordered]@{
        esquema = 1
        alcance = 'Textos originales para las versiones NuGet/runtime de esta API de Comunidad. Redistribución y elegibilidad SignPath siguen pendientes de revisión.'
        depsSha256 = (Get-FileHash -LiteralPath $depsPath).Hash.ToLowerInvariant()
        indiceFuenteSha256 = (Get-FileHash -LiteralPath $indexPath).Hash.ToLowerInvariant()
        paquetes = $selected
    } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $destination 'indice.json') -Encoding utf8
    Write-Host "      Avisos NuGet de Comunidad: $($selected.Count) entradas y $($documents.Count) textos originales."
}
