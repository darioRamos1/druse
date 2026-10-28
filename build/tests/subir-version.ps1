$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = Join-Path $tempRoot "druse-version-$([Guid]::NewGuid().ToString('N'))"
$files = @(
    'build/scripts/subir-version.ps1', 'backend/Directory.Build.props',
    'shells/desktop-tauri/tauri.conf.json', 'shells/desktop-tauri/Cargo.toml', 'shells/desktop-tauri/Cargo.lock',
    'README.md', 'SECURITY.md', 'docs/distribucion/distribucion-windows-smartscreen.md',
    'docs/distribucion/expediente-signpath.md', '.github/ISSUE_TEMPLATE/compatibilidad.yml',
    '.github/ISSUE_TEMPLATE/fallo.yml', 'frontend/src/app/core/whats-new/release-notes.ts'
)
try {
    foreach ($file in $files) {
        $destination = Join-Path $fixture $file
        New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $destination
    }
    $indexPath = Join-Path $fixture 'docs/terceros/comunidad-rust/indice.json'
    New-Item -ItemType Directory -Force (Split-Path -Parent $indexPath) | Out-Null
    $lock = Join-Path $fixture 'shells/desktop-tauri/Cargo.lock'
    $toml = Join-Path $fixture 'shells/desktop-tauri/Cargo.toml'
    @{
        cargoLockSha256 = (Get-FileHash $lock).Hash.ToLowerInvariant()
        cargoTomlSha256 = (Get-FileHash $toml).Hash.ToLowerInvariant()
        paquetes = @(@{ componente = 'aviso-de-prueba'; version = '1.0.0' })
    } | ConvertTo-Json -Depth 5 | Set-Content $indexPath
    $script = Join-Path $fixture 'build/scripts/subir-version.ps1'
    $config = Join-Path $fixture 'shells/desktop-tauri/tauri.conf.json'
    $current = (Get-Content $config -Raw | ConvertFrom-Json).version
    $numbers = $current.Split('.')
    $next = "$($numbers[0]).$($numbers[1]).$([int]$numbers[2] + 1)"
    & $script -Version $next
    $index = Get-Content $indexPath -Raw | ConvertFrom-Json
    if ((Get-Content $config -Raw | ConvertFrom-Json).version -ne $next -or
        $index.cargoLockSha256 -cne (Get-FileHash $lock).Hash.ToLowerInvariant() -or
        $index.cargoTomlSha256 -cne (Get-FileHash $toml).Hash.ToLowerInvariant() -or
        $index.paquetes[0].componente -ne 'aviso-de-prueba') { throw 'La subida no conserva los avisos y actualiza sus huellas.' }

    $configBefore = [IO.File]::ReadAllText($config)
    Add-Content $toml '# Cambio de dependencia sin revisar'
    $rejected = $false
    try { & $script -Parte patch } catch { $rejected = $true }
    if (-not $rejected -or [IO.File]::ReadAllText($config) -cne $configBefore) { throw 'Se cambió la versión con un grafo Rust sin revisar.' }
    Write-Host 'OK: subir versión conserva avisos y actualiza huellas; un grafo pendiente se rechaza antes de escribir.'
}
finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if ((Split-Path -Parent $resolved).TrimEnd([IO.Path]::DirectorySeparatorChar) -ne $tempRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'druse-version-*') { throw 'Ruta temporal fuera del alcance de limpieza.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
