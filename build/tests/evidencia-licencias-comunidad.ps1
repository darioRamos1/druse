$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/evidencia-licencias-comunidad.ps1')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = Join-Path $tempRoot "druse-licencias-test-$([Guid]::NewGuid().ToString('N'))"
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
    $api = Join-Path $fixture 'api'
    $cache = Join-Path $fixture 'cache'
    $package = Join-Path $cache 'example/1.0.0'
    $runtime = Join-Path $cache 'runtime.example/1.0.0'
    New-Item -ItemType Directory -Path $api, $package, $runtime -Force | Out-Null
    $nuspec = '<package><metadata><id>Example</id><version>1.0.0</version><license type="file">LICENSE.txt</license></metadata></package>'
    $nuspec | Set-Content (Join-Path $package 'example.nuspec')
    'Aviso de prueba con autoría preservada.' | Set-Content (Join-Path $package 'LICENSE.txt')
    '<package><metadata><license type="expression">MIT</license></metadata></package>' | Set-Content (Join-Path $runtime 'runtime.example.nuspec')
    foreach ($dir in @($package, $runtime, $api)) { 'mismos bytes' | Set-Content (Join-Path $dir 'shared.dll') }
    'original' | Set-Content (Join-Path $package 'modified.dll')
    'modificado' | Set-Content (Join-Path $api 'modified.dll')
    $depsFile = Join-Path $api 'Druse.Host.LocalApi.deps.json'
    $deps = @{ libraries = @{ 'Example/1.0.0' = @{ type = 'package' }; 'runtimepack.Runtime.Example/1.0.0' = @{ type = 'runtimepack' } } }
    $deps | ConvertTo-Json -Depth 5 | Set-Content $depsFile
    $assetsFile = Join-Path $fixture 'assets.json'
    @{ packageFolders = @{ $cache = @{} } } | ConvertTo-Json -Depth 4 | Set-Content $assetsFile
    $output = Join-Path $fixture 'output'
    Export-DruseCommunityLicenseEvidence -ApiPath $api -AssetsPath $assetsFile -OutputPath $output | Out-Null
    $report = Get-Content (Join-Path $output 'evidencia.json') -Raw | ConvertFrom-Json
    Assert ($report.resumen.paquetes -eq 2) 'Falta el runtime pack en la evidencia.'
    Assert ($report.resumen.paquetesSinAvisoLocal -eq 1) 'Una expresión no debe contarse como texto de licencia copiado.'
    $shared = $report.archivos | Where-Object archivo -eq 'shared.dll'
    Assert ($shared.coincidencias.Count -eq 2) 'Debe conservar coincidencias ambiguas sin inventar un autor exclusivo.'
    $modified = $report.archivos | Where-Object archivo -eq 'modified.dll'
    Assert ($modified.coincidencias.Count -eq 0) 'Un mismo nombre con bytes diferentes no acredita procedencia.'
    $notice = @($report.paquetes | Where-Object componente -eq 'Example')[0].avisos[0]
    Assert ((Get-FileHash (Join-Path $output $notice.archivo)).Hash.ToLowerInvariant() -eq $notice.sha256) 'El aviso copiado debe conservar sus bytes.'
    Assert (-not ((Get-Content (Join-Path $output 'evidencia.json') -Raw).Contains($fixture.Replace('\', '\\')))) 'El informe no debe revelar rutas locales.'
    $failed = $false
    try { Export-DruseCommunityLicenseEvidence -ApiPath $api -AssetsPath $assetsFile -OutputPath $output | Out-Null } catch { $failed = $true }
    Assert $failed 'Debe rechazar una salida existente para no mezclar evidencias.'
    $nuspec.Replace('LICENSE.txt', '../../fuera.txt') | Set-Content (Join-Path $package 'example.nuspec')
    $failed = $false
    try { Export-DruseCommunityLicenseEvidence -ApiPath $api -AssetsPath $assetsFile -OutputPath (Join-Path $fixture 'unsafe') | Out-Null } catch { $failed = $true }
    Assert $failed 'Debe rechazar una licencia que escapa de la carpeta del paquete.'
    $deps.libraries['Oracle.Driver/1.0.0'] = @{ type = 'package' }
    $deps | ConvertTo-Json -Depth 5 | Set-Content $depsFile
    $failed = $false
    try { Export-DruseCommunityLicenseEvidence -ApiPath $api -AssetsPath $assetsFile -OutputPath (Join-Path $fixture 'vendor') | Out-Null } catch { $failed = $true }
    Assert $failed 'Debe rechazar un grafo que contiene Oracle.'
    Write-Host 'OK: hashes, ambigüedad, runtime packs, avisos originales, salida nueva y límites de rutas comprobados.'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'druse-licencias-test-*') {
        throw 'Ruta de limpieza fuera del entorno de prueba.'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
