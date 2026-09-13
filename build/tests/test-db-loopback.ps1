# Ejecuta el script real con Docker simulado: no crea ni modifica contenedores.
$ErrorActionPreference = 'Stop'
$global:DruseLoopbackTestPorts = [System.Collections.Generic.List[string]]::new()
function docker {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'ps') { return }
    if ($args[0] -eq 'run') {
        for ($i = 0; $i -lt $args.Count; $i++) {
            if ($args[$i] -eq '-p') { $global:DruseLoopbackTestPorts.Add($args[$i + 1]) }
        }
    }
    if ($args[0] -eq 'exec') { '1 On-Line druse_test druse_test2' }
}
function Start-Sleep { param($Seconds, $Milliseconds) }
& (Join-Path $PSScriptRoot '../scripts/test-db.ps1') -Engine all `
    -PostgresPort 55441 -SqlServerPort 14434 -MySqlPort 33307 `
    -OraclePort 15211 -InformixPort 19089 -InformixSqliPort 19088
$expected = @('127.0.0.1:55441:5432', '127.0.0.1:14434:1433',
    '127.0.0.1:33307:3306', '127.0.0.1:15211:1521',
    '127.0.0.1:19089:9089', '127.0.0.1:19088:9088')
if (@(Compare-Object $expected $global:DruseLoopbackTestPorts).Count -ne 0) {
    throw 'Los puertos publicados no conservan los valores personalizados y loopback.'
}
'OK: seis puertos de cinco motores limitados a loopback, con puertos personalizados.'
