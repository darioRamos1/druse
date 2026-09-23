$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/avisos-nuget-comunidad.ps1')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = Join-Path $tempRoot "druse-nuget-notices-$([Guid]::NewGuid().ToString('N'))"
function Must-Fail([scriptblock]$Action, [string]$Message) {
    try { & $Action } catch { if ($_.Exception.Message.Contains($Message)) { return }; throw }
    throw "Debió rechazar: $Message"
}
try {
    $source = Join-Path $fixture 'docs/terceros/comunidad'
    $api = Join-Path $fixture 'api'
    New-Item -ItemType Directory -Path (Join-Path $source 'fuentes/example'), $api -Force | Out-Null
    $notice = Join-Path $source 'fuentes/example/LICENSE'
    [IO.File]::WriteAllBytes($notice, [Text.Encoding]::UTF8.GetBytes("Aviso original`r`nCopyright de prueba.`r`n"))
    $hash = (Get-FileHash -LiteralPath $notice).Hash.ToLowerInvariant()
    $record = @{ componente = 'Example'; version = '1.0.0'; documentos = @(@{ archivo = 'fuentes/example/LICENSE'; sha256 = $hash }) }
    $runtime = @{ componente = 'Example.Runtime'; version = '2.0.0'; documentos = @(@{ archivo = 'fuentes/example/LICENSE'; sha256 = $hash }) }
    $index = @{ esquema = 1; paquetes = @($record, $runtime) }
    $indexFile = Join-Path $source 'indice.json'
    $index | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $indexFile
    $depsFile = Join-Path $api 'Druse.Host.LocalApi.deps.json'
    $deps = @{ libraries = @{ 'Example/1.0.0' = @{type='package'}; 'runtimepack.Example.Runtime/2.0.0' = @{type='runtimepack'}; 'Druse/1.0.0' = @{type='project'} } }
    $deps | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $depsFile
    Copy-DruseCommunityNugetNotices -RepoRoot $fixture -ApiOutput $api
    $copied = Join-Path $api 'licenses/nuget-comunidad/fuentes/example/LICENSE'
    if ((Get-FileHash -LiteralPath $copied).Hash.ToLowerInvariant() -ne $hash) { throw 'Cambió los bytes originales.' }
    $installed = Get-Content -LiteralPath (Join-Path $api 'licenses/nuget-comunidad/indice.json') -Raw | ConvertFrom-Json
    if ($installed.paquetes.Count -ne 2 -or $installed.depsSha256 -ne (Get-FileHash -LiteralPath $depsFile).Hash.ToLowerInvariant()) { throw 'Índice de instalación incorrecto.' }
    if (@(Get-ChildItem (Join-Path $api 'licenses/nuget-comunidad/fuentes') -Recurse -File).Count -ne 1) { throw 'Duplica un documento compartido.' }
    Must-Fail { Copy-DruseCommunityNugetNotices -RepoRoot $fixture -ApiOutput $api } 'debe estar vacía'
    $deps.libraries['Example/1.0.1'] = $deps.libraries['Example/1.0.0']
    $deps.libraries.Remove('Example/1.0.0')
    $deps | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $depsFile
    Must-Fail { Copy-DruseCommunityNugetNotices -RepoRoot $fixture -ApiOutput $api } 'versión exacta Example/1.0.1'
    $deps.libraries['Example/1.0.0'] = $deps.libraries['Example/1.0.1']
    $deps.libraries.Remove('Example/1.0.1')
    $deps | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $depsFile
    'Alterado' | Set-Content -LiteralPath $notice
    Must-Fail { Copy-DruseCommunityNugetNotices -RepoRoot $fixture -ApiOutput $api } 'fue modificado'
    $record.documentos[0].archivo = 'fuentes/../../fuera.txt'
    $index | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $indexFile
    Must-Fail { Copy-DruseCommunityNugetNotices -RepoRoot $fixture -ApiOutput $api } 'fuera del expediente'
    Write-Host 'OK: avisos exactos, runtime, índice, deduplicación, cambio de versión, alteración y rutas comprobados.'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'druse-nuget-notices-*') { throw 'Limpieza fuera del entorno de prueba.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
