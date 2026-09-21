# Comprueba el paquete publicado real, sin acceder al perfil ni bases del usuario.
[CmdletBinding()]
param([string]$ApiPath = (Join-Path $PSScriptRoot '../../shells/desktop-tauri/api'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/manifiesto.ps1')

$inventory = @(Get-DrusePackageInventory -Path $ApiPath -Prefix 'api')
$blocked = @(Test-DrusePackageContent -Inventory $inventory -Rules (Get-DrusePackageRules -Variant 'comunidad') | Where-Object aplicar)
if ($blocked.Count) { throw "Comunidad contiene componentes excluidos: $($blocked.regla -join ', ')" }

# Además de los archivos, el grafo de ejecución no debe requerirlos.
$depsPath = Join-Path $ApiPath 'Druse.Host.LocalApi.deps.json'
$deps = Get-Content -LiteralPath $depsPath -Raw | ConvertFrom-Json
$excludedDependencies = @($deps.libraries.PSObject.Properties.Name | Where-Object { $_ -match '^(Oracle\.|Net\.IBM\.|IBM\.|IKVM|Druse\.(Jdbc|Provider\.(Oracle|Informix)))/?' })
if ($excludedDependencies.Count) { throw "Dependencias excluidas: $($excludedDependencies -join ', ')" }

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testData = Join-Path $temporaryRoot "druse-comunidad-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testData | Out-Null
$previousData = $env:DRUSE_DATA_DIR
$hostProcess = $null
try {
    $env:DRUSE_DATA_DIR = $testData
    $executable = Join-Path $ApiPath $(if ($IsWindows) { 'Druse.Host.LocalApi.exe' } else { 'Druse.Host.LocalApi' })
    $start = @{
        FilePath = (Resolve-Path -LiteralPath $executable).Path
        ArgumentList = @('--LocalApi:Port=0')
        WorkingDirectory = (Resolve-Path -LiteralPath $ApiPath).Path
        RedirectStandardOutput = (Join-Path $testData 'stdout.log')
        RedirectStandardError = (Join-Path $testData 'stderr.log')
        PassThru = $true
    }
    if ($IsWindows) { $start.WindowStyle = 'Hidden' }
    $hostProcess = Start-Process @start
    $endpointFile = Join-Path $testData 'endpoint.json'
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path -LiteralPath $endpointFile)) {
        if ($hostProcess.HasExited -or (Get-Date) -gt $deadline) { throw 'La API de Comunidad no arrancó.' }
        Start-Sleep -Milliseconds 200
    }
    $endpoint = Get-Content -LiteralPath $endpointFile -Raw | ConvertFrom-Json
    $baseUrl = "http://127.0.0.1:$($endpoint.port)"
    $headers = @{ 'X-Druse-Token' = $endpoint.token }
    $health = Invoke-RestMethod "$baseUrl/api/health" -TimeoutSec 10
    if ($health.status -ne 'ok') { throw 'La API no está lista.' }
    $engines = @(Invoke-RestMethod "$baseUrl/api/engines" -Headers $headers -TimeoutSec 10)
    $expected = @('mysql', 'postgresql', 'sqlite', 'sqlserver')
    if (Compare-Object ($engines.id | Sort-Object) ($expected | Sort-Object)) {
        throw "Motores inesperados: $($engines.id -join ', ')"
    }
    $connect = @{ profile = @{
        id = [Guid]::NewGuid().ToString(); name = 'Prueba Comunidad'; engine = 'sqlite'
        host = ''; port = 0; database = ':memory:'; username = ''
    }} | ConvertTo-Json -Depth 4
    $session = Invoke-RestMethod "$baseUrl/api/sessions" -Method Post -Headers $headers -ContentType 'application/json' -Body $connect -TimeoutSec 15
    $query = @{ sessionId = $session.sessionId; sql = 'SELECT 42 AS prueba'; executionId = [Guid]::NewGuid().ToString() } | ConvertTo-Json
    $result = Invoke-RestMethod "$baseUrl/api/queries" -Method Post -Headers $headers -ContentType 'application/json' -Body $query -TimeoutSec 15
    if ($result.error -or $result.resultSets[0].rows[0][0] -ne '42') { throw 'Falló la consulta SQLite del paquete Comunidad.' }
    Invoke-RestMethod "$baseUrl/api/sessions/$($session.sessionId)" -Method Delete -Headers $headers -TimeoutSec 10 | Out-Null
    Write-Host "OK: Comunidad arranca sin Oracle/IBM/IKVM, ofrece $($expected -join ', ') y ejecuta SELECT 42 en SQLite."
}
finally {
    if ($hostProcess -and -not $hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id -Force; $hostProcess.WaitForExit() }
    $env:DRUSE_DATA_DIR = $previousData
    $resolvedData = [IO.Path]::GetFullPath($testData)
    if (-not $resolvedData.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolvedData -Leaf) -notlike 'druse-comunidad-*') { throw 'Ruta temporal fuera del alcance de limpieza.' }
    Remove-Item -LiteralPath $resolvedData -Recurse -Force
}
