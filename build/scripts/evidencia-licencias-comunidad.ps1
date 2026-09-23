# Recoge evidencia del paquete local; no aprueba licencias ni modifica el instalador.
[CmdletBinding()]
param(
    [string]$ApiPath,
    [string]$AssetsPath,
    [string]$OutputPath
)

function Export-DruseCommunityLicenseEvidence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ApiPath,
        [Parameter(Mandatory)][string]$AssetsPath,
        [Parameter(Mandatory)][string]$OutputPath
    )
    $ErrorActionPreference = 'Stop'
    function Join-Confined([string]$Root, [string]$Relative) {
        $base = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        $full = [IO.Path]::GetFullPath((Join-Path $base $Relative))
        if ([IO.Path]::IsPathRooted($Relative) -or -not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Ruta de evidencia fuera de su carpeta.'
        }
        return $full
    }
    function Get-Hash([string]$File) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() }
    $api = (Resolve-Path -LiteralPath $ApiPath).Path
    $assets = Get-Content -LiteralPath $AssetsPath -Raw | ConvertFrom-Json -AsHashtable
    $depsFile = Join-Path $api 'Druse.Host.LocalApi.deps.json'
    $deps = Get-Content -LiteralPath $depsFile -Raw | ConvertFrom-Json -AsHashtable
    if (@($deps.libraries.Keys | Where-Object { $_ -match '^(Oracle\.|Net\.IBM\.|IBM\.|IKVM|Druse\.(Jdbc|Provider\.(Oracle|Informix)))/?' }).Count) {
        throw 'La API contiene dependencias excluidas de Comunidad.'
    }
    $roots = @($assets.packageFolders.Keys)
    if (-not $roots.Count) { throw 'El archivo de restore no indica carpetas NuGet.' }
    $output = [IO.Path]::GetFullPath($OutputPath)
    if (Test-Path -LiteralPath $output) { throw 'La salida debe ser una carpeta nueva para no mezclar evidencias.' }
    New-Item -ItemType Directory -Path $output | Out-Null

    $packages = [System.Collections.Generic.List[object]]::new()
    $candidates = @{}
    foreach ($key in @($deps.libraries.Keys | Sort-Object)) {
        $kind = $deps.libraries[$key].type
        if ($kind -notin @('package', 'runtimepack')) { continue }
        if ($key -notmatch '^(?<id>[A-Za-z0-9_.-]+)/(?<version>[A-Za-z0-9.+-]+)$') { throw 'Identificador NuGet no válido.' }
        $id = $Matches.id -replace '^runtimepack\.', ''
        $version = $Matches.version
        $relative = "$($id.ToLowerInvariant())/$($version.ToLowerInvariant())"
        $packageRoot = $null
        foreach ($root in $roots) {
            $possible = Join-Confined $root $relative
            if (Test-Path -LiteralPath $possible -PathType Container) { $packageRoot = $possible; break }
        }
        $record = [ordered]@{
            componente = $id; version = $version; tipo = $kind
            estado = 'REVISION PENDIENTE'; licenciaDeclarada = $null; tipoLicencia = $null
            urlLicencia = $null; avisos = @(); metadatos = $null; problemas = @()
        }
        if (-not $packageRoot) {
            $record.problemas += 'Paquete ausente en las carpetas del restore.'
            $packages.Add([pscustomobject]$record)
            continue
        }
        $packageFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File)
        if (Get-ChildItem -LiteralPath $packageRoot -Recurse -Attributes ReparsePoint) { throw 'No se admiten enlaces en la evidencia NuGet.' }
        $nuspec = @($packageFiles | Where-Object { $_.DirectoryName -eq $packageRoot -and $_.Extension -eq '.nuspec' })
        $declaredNotice = $null
        if ($nuspec.Count -eq 1) {
            $xml = [xml]::new()
            $xml.XmlResolver = $null
            $xml.Load($nuspec[0].FullName)
            $metadata = $xml.SelectSingleNode('/*[local-name()="package"]/*[local-name()="metadata"]')
            $license = $metadata.SelectSingleNode('*[local-name()="license"]')
            $url = $metadata.SelectSingleNode('*[local-name()="licenseUrl"]')
            if ($license) {
                $record.licenciaDeclarada = $license.InnerText
                $record.tipoLicencia = $license.GetAttribute('type')
                if ($record.tipoLicencia -eq 'file') { $declaredNotice = Join-Confined $packageRoot $license.InnerText }
            }
            if ($url) { $record.urlLicencia = $url.InnerText }
            $record.metadatos = @{ archivo = "$relative/$($nuspec[0].Name)"; sha256 = (Get-Hash $nuspec[0].FullName) }
        } else { $record.problemas += 'Nuspec ausente o ambiguo.' }
        $notices = @($packageFiles | Where-Object {
            $_.Name -match '^(?i:licen[cs]e|notice|third[-_]?party[-_]?notices|copying|copyright)([._-].*)?$' -or $_.FullName -eq $declaredNotice
        })
        if ($declaredNotice -and -not (Test-Path -LiteralPath $declaredNotice -PathType Leaf)) {
            $record.problemas += 'Falta el texto de licencia declarado en nuspec.'
        }
        if (-not $notices.Count) { $record.problemas += 'No se localizó un texto de licencia/aviso por nombre; una expresión o URL no es una copia del texto.' }
        foreach ($file in @($notices) + @($nuspec)) {
            $sourceRelative = [IO.Path]::GetRelativePath($packageRoot, $file.FullName).Replace('\', '/')
            $destinationRelative = "documentos/$relative/$sourceRelative"
            $destination = Join-Confined $output $destinationRelative
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination
            $hash = Get-Hash $file.FullName
            if ((Get-Hash $destination) -ne $hash) { throw 'La evidencia copiada no coincide.' }
            if ($file -in $notices) {
                $record.avisos += @{ origen = $sourceRelative; archivo = $destinationRelative; sha256 = $hash }
            }
        }
        $packages.Add([pscustomobject]$record)
        foreach ($file in $packageFiles) {
            # Indexar por nombre solo reduce candidatos; la atribución exige SHA-256 idéntico.
            if (-not $candidates.ContainsKey($file.Name)) { $candidates[$file.Name] = [System.Collections.Generic.List[object]]::new() }
            $candidates[$file.Name].Add(@{
                path = $file.FullName; componente = $id; version = $version
                origen = [IO.Path]::GetRelativePath($packageRoot, $file.FullName).Replace('\', '/')
            })
        }
    }
    $hashCache = @{}
    $files = @(foreach ($file in Get-ChildItem -LiteralPath $api -Recurse -File | Sort-Object FullName) {
        $hash = Get-Hash $file.FullName
        $origins = @(foreach ($candidate in $candidates[$file.Name]) {
            if (-not $hashCache.ContainsKey($candidate.path)) { $hashCache[$candidate.path] = Get-Hash $candidate.path }
            if ($hashCache[$candidate.path] -eq $hash) {
                @{ componente = $candidate.componente; version = $candidate.version; origen = $candidate.origen }
            }
        })
        [pscustomobject]@{
            archivo = [IO.Path]::GetRelativePath($api, $file.FullName).Replace('\', '/')
            bytes = $file.Length; sha256 = $hash; coincidencias = $origins
            estado = $(if ($origins.Count) { 'HASH COINCIDE; REVISION PENDIENTE' } else { 'SIN ATRIBUCION NUGET' })
        }
    })
    $report = [ordered]@{
        esquema = 1; generado = [DateTimeOffset]::UtcNow.ToString('o')
        alcance = 'API local de Comunidad; no equivale al instalador de CI ni cubre frontend, Rust, WebView2 o NSIS.'
        depsSha256 = (Get-Hash $depsFile); assetsSha256 = (Get-Hash $AssetsPath)
        resumen = @{ paquetes = $packages.Count; archivos = $files.Count; archivosConCoincidencia = @($files | Where-Object { $_.coincidencias.Count }).Count
            paquetesSinAvisoLocal = @($packages | Where-Object { -not $_.avisos.Count }).Count }
        paquetes = @($packages.ToArray()); archivos = $files
        limites = @('Las coincidencias son evidencia byte a byte con la caché local, no certificación de su autenticidad ni atribución exclusiva.',
            'La búsqueda de avisos por nombre no garantiza cubrir todas las obligaciones de licencia.',
            'No se infiere autorización de redistribución, compatibilidad GPL ni elegibilidad SignPath.',
            'Los archivos sin atribución incluyen código propio, configuración y avisos; requieren clasificación separada.',
            'Los documentos se guardan como evidencia separada; este script no los incorpora al instalador.')
    }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $output 'evidencia.json') -Encoding utf8
    return [pscustomobject]$report.resumen
}

if ($MyInvocation.InvocationName -ne '.') {
    $root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    if (-not $ApiPath) { $ApiPath = Join-Path $root 'shells/desktop-tauri/api' }
    if (-not $AssetsPath) { $AssetsPath = Join-Path $root 'backend/src/Druse.Host.LocalApi/obj/project.assets.json' }
    if (-not $OutputPath) { $OutputPath = Join-Path $root "artifacts/licencias-comunidad/$([Guid]::NewGuid().ToString('N'))" }
    Export-DruseCommunityLicenseEvidence -ApiPath $ApiPath -AssetsPath $AssetsPath -OutputPath $OutputPath
    Write-Host "Evidencia: $OutputPath"
}
