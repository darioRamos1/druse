#!/usr/bin/env pwsh
# Arranca los bytes autocontenidos que se empaquetan; no usa dotnet run ni el
# perfil de quien ejecuta la prueba. Así se detecta quitar una pieza necesaria.
[CmdletBinding()]
param(
    [string]$ApiPath = (Join-Path $PSScriptRoot '../../shells/desktop-tauri/api'),
    [ValidateRange(1024, 65535)][int]$Port = 5199
)
$ErrorActionPreference = 'Stop'
$apiRoot = (Resolve-Path -LiteralPath $ApiPath).Path
$executable = Join-Path $apiRoot $(if ($IsWindows) { 'Druse.Host.LocalApi.exe' } else { 'Druse.Host.LocalApi' })
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'Falta el ejecutable publicado de la API.' }
$version = (Get-Content (Join-Path $PSScriptRoot '../../shells/desktop-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testData = Join-Path $temporaryRoot "druse-api-publicada-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testData | Out-Null
$previousData = $env:DRUSE_DATA_DIR
$hostProcess = $null
try {
    $env:DRUSE_DATA_DIR = $testData
    $start = @{
        FilePath = $executable
        ArgumentList = @("--LocalApi:Port=$Port")
        WorkingDirectory = $apiRoot
        RedirectStandardOutput = (Join-Path $testData 'stdout.log')
        RedirectStandardError = (Join-Path $testData 'stderr.log')
        PassThru = $true
    }
    if ($IsWindows) { $start.WindowStyle = 'Hidden' }
    $hostProcess = Start-Process @start
    $endpointFile = Join-Path $testData 'endpoint.json'
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path -LiteralPath $endpointFile)) {
        if ($hostProcess.HasExited -or (Get-Date) -gt $deadline) { throw 'La API autocontenida no arrancó a tiempo.' }
        Start-Sleep -Milliseconds 200
    }
    $endpoint = Get-Content -LiteralPath $endpointFile -Raw | ConvertFrom-Json
    if ($hostProcess.HasExited -or $endpoint.pid -ne $hostProcess.Id -or $endpoint.port -ne $Port) {
        throw 'El punto de conexión no pertenece al proceso y puerto de esta prueba.'
    }
    # Health es público; el token temporal nunca sale en la salida de la prueba.
    $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 10
    if ($hostProcess.HasExited -or $health.status -ne 'ok' -or $health.product -ne 'Druse' -or $health.version -ne $version) {
        throw 'La API autocontenida no respondió correctamente con la versión que se empaqueta.'
    }
    Write-Host "OK: la API autocontenida $version arranca y responde en el proceso aislado de la prueba."
}
catch {
    # Estos registros son del perfil desechable recién creado; nunca se lee el
    # archivo de endpoint, que sí contiene el token temporal de autenticación.
    foreach ($log in @('stdout.log', 'stderr.log')) {
        $logPath = Join-Path $testData $log
        if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 30 | Write-Host }
    }
    throw
}
finally {
    if ($hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
    $env:DRUSE_DATA_DIR = $previousData
    $resolvedData = [IO.Path]::GetFullPath($testData)
    if ((Split-Path -Parent $resolvedData) -ne $temporaryRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        (Split-Path $resolvedData -Leaf) -notlike 'druse-api-publicada-*') { throw 'Ruta temporal fuera del alcance de limpieza.' }
    Remove-Item -LiteralPath $resolvedData -Recurse -Force
}
