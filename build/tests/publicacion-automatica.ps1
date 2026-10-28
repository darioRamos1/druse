$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/publicacion-automatica.ps1')
$commit = 'a' * 40
$state = @{ main = $commit; mainVersion = '1.11.0'; comparison = 'ahead'; ci = $true; comunidad = $true; releases = '[[]]'; exitCode = 0; calls = 0 }

function gh {
    $global:LASTEXITCODE = $state.exitCode
    $state.calls++
    if ($args[0] -ne 'api') { throw 'Solo se admiten consultas de la API.' }
    if ($args[1] -eq 'repos/test/druse/commits/main') { return $state.main }
    if ($args[1] -like 'repos/test/druse/contents/shells/desktop-tauri/tauri.conf.json?ref=*') { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{version=$state.mainVersion} | ConvertTo-Json))) }
    if ($args[1] -eq "repos/test/druse/compare/$commit...$($state.main)") { return $state.comparison }
    if ($args[1] -eq 'repos/test/druse/releases?per_page=100' -and $args -contains '--paginate' -and $args -contains '--slurp') { return $state.releases }
    throw "Endpoint inesperado: $args"
}
function Get-DruseEstadoCI {
    param($Repository, $Commit, $Workflow)
    if ($Repository -ne 'test/druse' -or $Commit -ne ('a' * 40)) { throw 'CI consultada para otro origen.' }
    return @{ verde = $(if ($Workflow -eq 'ci.yml') { $state.ci } else { $state.comunidad }); detalle = $Workflow }
}
function Check([string]$Case, [bool]$Expected) {
    $result = Get-DruseDecisionPublicacion -Repository test/druse -Commit $commit -Version 1.11.0 -Automatica
    if ($result.publicar -ne $Expected) { throw "Decisión incorrecta: $Case" }
}
function Reject([string]$Case, [scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw "Debió rechazarse: $Case" }
}

Check 'ambas comprobaciones satisfactorias' $true
$state.ci = $false
Check 'Comunidad termina antes que CI' $false
$state.ci = $true; $state.comunidad = $false
Check 'CI termina antes que Comunidad' $false
Reject 'publicación manual sin Comunidad verde' { Get-DruseDecisionPublicacion -Repository test/druse -Commit $commit -Version 1.11.0 }
$state.comunidad = $true
$state.main = 'b' * 40
Check 'main avanzó solo en documentación sin cancelar la versión comprobada' $true
$state.mainVersion = '1.12.0'
Check 'main avanzó a otra versión' $false
$state.mainVersion = '1.11.0'; $state.comparison = 'diverged'
Check 'commit fuera del historial actual' $false
$state.comparison = 'ahead'
$state.main = $commit
$state.releases = '[[{"tag_name":"v1.10.0"}],[{"tag_name":"v1.11.0"}]]'
Check 'versión existente en otra página; no se sobrescribe' $false
Reject 'publicación manual que reemplaza una versión' { Get-DruseDecisionPublicacion -Repository test/druse -Commit $commit -Version 1.11.0 }
$state.releases = '[[{"tag_name":"v1.11.0","draft":true}]]'
Reject 'borrador pendiente que necesita recuperación' { Check 'borrador' $false }
$state.releases = '[[]]'; $state.exitCode = 1
Reject 'error de consulta de main' { Check 'main inaccesible' $false }
Reject 'error al consultar releases en modo manual' { Get-DruseDecisionPublicacion -Repository test/druse -Commit $commit -Version 1.11.0 }
$state.exitCode = 0; $state.releases = 'null'
Reject 'respuesta de releases inválida' { Check 'null' $false }
$state.releases = '[[]]'
Check 'reintento sin publicación previa' $true
$global:LASTEXITCODE = 0
Write-Host 'OK: publicación automática exige ambos workflows del commit, conserva versiones y falla ante errores de la API.'
