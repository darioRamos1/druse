$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/avisos-frontend.ps1')
. (Join-Path $PSScriptRoot '../scripts/manifiesto.ps1')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = Join-Path $tempRoot "druse-avisos-test-$([Guid]::NewGuid().ToString('N'))"
try {
    $sources = @(
        'frontend/dist/frontend/3rdpartylicenses.txt',
        'frontend/node_modules/monaco-editor/LICENSE',
        'frontend/node_modules/monaco-editor/ThirdPartyNotices.txt',
        'frontend/node_modules/@fontsource/inter/LICENSE',
        'frontend/node_modules/@fontsource/jetbrains-mono/LICENSE'
    )
    foreach ($source in $sources) {
        $file = Join-Path $fixture $source
        New-Item -ItemType Directory -Path (Split-Path $file -Parent) -Force | Out-Null
        "Aviso original: $source" | Set-Content -LiteralPath $file
    }
    $api = Join-Path $fixture 'api'
    Copy-DruseFrontendNotices -RepoRoot $fixture -ApiOutput $api
    $inventory = @(Get-DrusePackageInventory -Path $api -Prefix 'api')
    if ($inventory.Count -ne 5) { throw 'Faltan avisos en los recursos que empaqueta Tauri.' }
    foreach ($source in $sources) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $fixture $source)).Hash.ToLowerInvariant()
        if (@($inventory | Where-Object sha256 -eq $hash).Count -ne 1) { throw 'El inventario no conserva los bytes del aviso.' }
    }
    foreach ($variant in @('comunidad', 'completo', 'sin-informix')) {
        if (@(Test-DrusePackageContent -Inventory $inventory -Rules (Get-DrusePackageRules -Variant $variant) | Where-Object aplicar).Count) {
            throw "Las reglas de $variant excluyen avisos del frontend."
        }
    }
    # Un frontend sin extracción de licencias no puede generar un paquete silenciosamente.
    Remove-Item -LiteralPath (Join-Path $fixture $sources[0])
    $failed = $false
    try { Copy-DruseFrontendNotices -RepoRoot $fixture -ApiOutput $api } catch { $failed = $true }
    if (-not $failed) { throw 'El empaquetado debe rechazar un aviso ausente incluso si queda una copia vieja.' }
    Write-Host 'OK: cinco avisos originales inventariados, admitidos en tres ediciones y ausencia detectada.'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'druse-avisos-test-*') {
        throw 'Ruta de limpieza fuera del entorno de prueba.'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
