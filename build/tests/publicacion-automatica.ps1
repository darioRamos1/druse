$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/publicacion-automatica.ps1')
$commit = 'a' * 40
$state = @{
    main = $commit; mainVersion = '1.11.0'; ci = $true; comunidad = $true
    releases = '[[]]'; exitCode = 0; calls = 0; mainReads = 0
    comparison = $null; rawComparison = $null; rawConfig = $null; advanceDuringCheck = $false
}
$cases = 0

function Comparison([object[]]$Files = @(@{ filename = 'docs/guia.md'; status = 'modified' })) {
    return @{
        status = 'ahead'; ahead_by = 1; behind_by = 0; total_commits = 1
        base_commit = @{ sha = $commit }; merge_base_commit = @{ sha = $commit }
        files = @($Files)
    }
}
$state.comparison = Comparison

function gh {
    $global:LASTEXITCODE = $state.exitCode
    $state.calls++
    if ($args[0] -ne 'api') { throw 'Solo se admiten consultas de la API.' }
    if ($args[1] -eq 'repos/test/druse/commits/main') {
        $state.mainReads++
        if ($state.advanceDuringCheck -and $state.mainReads -gt 1) { return 'c' * 40 }
        return $state.main
    }
    if ($args[1] -like 'repos/test/druse/contents/shells/desktop-tauri/tauri.conf.json?ref=*') {
        if ($null -ne $state.rawConfig) { return $state.rawConfig }
        return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{version=$state.mainVersion} | ConvertTo-Json)))
    }
    if ($args[1] -eq "repos/test/druse/compare/$commit...$($state.main)") {
        if ($args -contains '--jq') { throw 'Se necesitan las rutas reales, no sólo el estado de compare.' }
        if ($null -ne $state.rawComparison) { return $state.rawComparison }
        return ConvertTo-Json -InputObject $state.comparison -Depth 6 -Compress
    }
    if ($args[1] -eq 'repos/test/druse/releases?per_page=100' -and $args -contains '--paginate' -and $args -contains '--slurp') { return $state.releases }
    throw "Endpoint inesperado: $args"
}
function Get-DruseEstadoCI {
    param($Repository, $Commit, $Workflow)
    if ($Repository -ne 'test/druse' -or $Commit -ne ('a' * 40)) { throw 'CI consultada para otro origen.' }
    return @{ verde = $(if ($Workflow -eq 'ci.yml') { $state.ci } else { $state.comunidad }); detalle = $Workflow }
}
function Check([string]$Case, [bool]$Expected) {
    $script:cases++; $state.mainReads = 0
    $result = Get-DruseDecisionPublicacion -Repository test/druse -Commit $commit -Version 1.11.0 -Automatica
    if ($result.publicar -ne $Expected) { throw "Decisión incorrecta: $Case ($($result.detalle))" }
}
function Reject([string]$Case, [scriptblock]$Action) {
    $before = $script:cases; $state.mainReads = 0
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    $script:cases = $before + 1
    if (-not $rejected) { throw "Debió rechazarse: $Case" }
}

Check 'ambas comprobaciones satisfactorias para main exacto' $true
$state.ci = $false
Check 'Comunidad termina antes que CI' $false
$state.ci = $true; $state.comunidad = $false
Check 'CI termina antes que Comunidad' $false
Reject 'publicación manual sin Comunidad verde' { Get-DruseDecisionPublicacion -Repository test/druse -Commit $commit -Version 1.11.0 }
$state.comunidad = $true
$state.main = 'b' * 40
foreach ($path in @('docs/guia.md', 'landing/index.html', 'landing/assets/ejemplo.png', 'README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_SIGNING_POLICY.md')) {
    $state.comparison = Comparison @(@{ filename = $path; status = 'modified' })
    Check "avance documental permitido: $path" $true
}
foreach ($path in @('frontend/src/app/app.ts', 'backend/Directory.Build.props', 'build/scripts/package.ps1', '.github/workflows/ci.yml', 'docs/terceros/comunidad/indice.json', 'docs/terceros/comunidad-rust/fuentes/aviso.txt', 'docs/TERCEROS/comunidad/indice.json', 'docs/terceros-nuevo.md', 'docs/terceros.md', 'LICENSE', 'COPYRIGHT', 'THIRD_PARTY_NOTICES.md', 'OTRO.md')) {
    $state.comparison = Comparison @(@{ filename = $path; status = 'modified' })
    Check "se espera el nuevo código o contenido del paquete: $path" $false
}
$state.comparison = Comparison @(@{ filename = 'docs/nueva.md'; previous_filename = 'docs/anterior.md'; status = 'renamed' })
Check 'renombrar documentos conserva los paquetes' $true
foreach ($status in @('renamed', 'copied')) {
    $state.comparison = Comparison @(@{ filename = 'docs/disfrazado.md'; previous_filename = 'backend/Program.cs'; status = $status })
    Check "un origen de aplicación no se disfraza de documento: $status" $false
}
$state.comparison = Comparison @(@{ filename = 'landing/../backend/Program.cs'; status = 'modified' })
Check 'una ruta con navegación no es documental' $false
$state.comparison = Comparison @(@{ filename = 'docs/nueva.md'; status = 'renamed' })
Reject 'renombrado sin origen' { Check 'sin origen' $true }
$state.comparison = Comparison @(@{ filename = 'docs/nueva.md'; previous_filename = @('docs/anterior.md'); status = 'renamed' })
Reject 'origen con tipo inválido' { Check 'origen inválido' $true }
$state.comparison = Comparison @(@{ filename = $null; status = 'modified' })
Reject 'archivo sin nombre' { Check 'sin nombre' $true }
$state.comparison = Comparison @(@{ filename = 'docs/guia.md'; status = 'desconocido' })
Reject 'estado de archivo desconocido' { Check 'estado desconocido' $true }
$state.comparison = Comparison @()
Check 'un commit vacío no cambia los paquetes' $true
$state.comparison = Comparison @(1..299 | ForEach-Object { @{ filename = "docs/$_.md"; status = 'added' } })
Check 'lista completa por debajo del límite' $true
$state.comparison = Comparison @(1..300 | ForEach-Object { @{ filename = "docs/$_.md"; status = 'added' } })
Check 'el límite de 300 no acredita una comparación completa' $false
$state.comparison = Comparison; $state.comparison.truncated = $true
Check 'truncamiento explícito conserva la publicación anterior' $false
$state.comparison = Comparison; $state.comparison.truncated = 'false'
Reject 'truncamiento con tipo inválido' { Check 'truncamiento inválido' $true }
foreach ($invalid in @('null', '{}', '[]', 'no-json', '{"status":"ahead","files":[]}')) {
    $state.rawComparison = $invalid
    Reject "comparación inválida: $invalid" { Check 'comparación inválida' $true }
}
$state.rawComparison = $null
$state.comparison = Comparison; $state.comparison.files = $null
Reject 'lista de archivos ausente' { Check 'sin archivos' $true }
$state.comparison = Comparison; $state.comparison.total_commits = 2
Reject 'recuento incoherente' { Check 'incoherente' $true }
$state.comparison = Comparison; $state.comparison.base_commit.sha = 'c' * 40
Reject 'comparación de otro origen' { Check 'otro origen' $true }
$state.comparison = Comparison; $state.comparison.status = 'diverged'
Check 'commit fuera del historial actual' $false
$state.comparison = Comparison; $state.advanceDuringCheck = $true
Check 'main vuelve a avanzar al comprobar su documentación' $false
$state.advanceDuringCheck = $false
$state.mainVersion = '1.12.0'
Check 'main avanzó a otra versión' $false
$state.mainVersion = '1.11.0'; $state.rawConfig = 'no-base64'
Reject 'configuración de main inválida' { Check 'configuración inválida' $true }
$state.rawConfig = $null; $state.main = 'sha-inválido'
Reject 'respuesta de main inválida' { Check 'main inválido' $true }
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
Write-Host "OK: $cases escenarios; sólo main exacto o avances documentales completos conservan la versión comprobada, sin red."
