# Sin red: el mock sustituye gh y comprueba qué endpoint consulta el código real.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/verificacion-release.ps1')
$commit = 'a' * 40
$repository = 'test/druse'
$api = @{ response = '[]'; exitCode = 0; calls = 0 }
$previousGh = Get-Item Function:gh -ErrorAction SilentlyContinue
${function:gh} = {
    if ($args[0] -ne 'api' -or $args[1] -ne "repos/$repository/actions/workflows/ci.yml/runs?head_sha=$commit&per_page=100" -or
        $args -notcontains '--paginate' -or $args -notcontains '--slurp' -or $args -contains '--jq') {
        throw 'La consulta no identifica el workflow y commit exactos con todas sus ejecuciones.'
    }
    $api.calls++
    $global:LASTEXITCODE = $api.exitCode
    $api.response
}.GetNewClosure()

function Run([int]$Id, [string]$Status = 'completed', [string]$Conclusion = 'success') {
    return [ordered]@{
        id = $Id; path = '.github/workflows/ci.yml'; head_sha = $commit
        status = $Status; conclusion = $Conclusion; run_attempt = 1
        created_at = "2026-09-13T10:00:$($Id.ToString('00'))Z"
        run_started_at = "2026-09-13T10:00:$($Id.ToString('00'))Z"
        html_url = "https://example.invalid/runs/$Id"
    }
}
function Check([string]$Case, [object[]]$Runs, [bool]$Expected) {
    $api.response = ConvertTo-Json -InputObject @(@{ workflow_runs = @($Runs) }) -Depth 5 -Compress
    $result = Get-DruseEstadoCI -Repository $repository -Commit $commit
    if ($result.verde -ne $Expected) { throw "Resultado incorrecto para ${Case}: $($result.detalle)" }
    return $result
}
try {
    Check 'sin CI, aunque otros checks puedan estar verdes' @() $false | Out-Null
    $dependabot = Run 1; $dependabot.path = '.github/workflows/dependabot.yml'
    Check 'solo Dependabot' @($dependabot) $false | Out-Null
    $different = Run 1; $different.head_sha = 'b' * 40
    Check 'otro commit' @($different) $false | Out-Null
    $valid = Check 'CI correcto' @((Run 1)) $true
    if ($valid.run_id -ne 1 -or $valid.url -ne 'https://example.invalid/runs/1') { throw 'Falta la evidencia de CI.' }
    foreach ($conclusion in @('failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required')) {
        Check "CI $conclusion" @((Run 1 'completed' $conclusion)) $false | Out-Null
    }
    foreach ($status in @('queued', 'in_progress', 'waiting')) {
        Check "nuevo CI $status después del verde" @((Run 2 $status ''), (Run 1)) $false | Out-Null
    }
    Check 'fallo posterior a verde' @((Run 1), (Run 2 'completed' 'failure')) $false | Out-Null
    Check 'verde posterior a fallo' @((Run 2), (Run 1 'completed' 'failure')) $true | Out-Null
    $retry = Run 1 'completed' 'failure'; $retry.run_attempt = 2; $retry.run_started_at = '2026-09-13T11:00:00Z'
    Check 'reintento reciente de una ejecución antigua' @((Run 2), $retry) $false | Out-Null
    $queued = Run 2 'queued' ''; $queued.run_started_at = $null
    Check 'pendiente sin fecha de inicio' @((Run 1), $queued) $false | Out-Null
    $invalidDate = Run 1; $invalidDate.run_started_at = 'invalid'
    Check 'fecha inválida' @($invalidDate) $false | Out-Null
    $api.response = ConvertTo-Json -InputObject @(@{ workflow_runs = @((Run 2)) }, @{ workflow_runs = @($retry) }) -Depth 5 -Compress
    if ((Get-DruseEstadoCI -Repository $repository -Commit $commit).verde) { throw 'Se ignoró la segunda página con un reintento más reciente fallido.' }
    foreach ($invalid in @('not-json', 'null', '{}', '')) {
        $api.response = $invalid
        if ((Get-DruseEstadoCI -Repository $repository -Commit $commit).verde) { throw 'Respuesta inválida aceptada.' }
    }
    $api.exitCode = 1; $api.response = '[]'
    if ((Get-DruseEstadoCI -Repository $repository -Commit $commit).verde) { throw 'Error de API aceptado.' }
    "OK: $($api.calls) escenarios de CI; sin llamadas a GitHub."
}
finally {
    if ($previousGh) { Set-Item Function:gh $previousGh.ScriptBlock }
    else { Remove-Item Function:gh }
    $global:LASTEXITCODE = 0
}
