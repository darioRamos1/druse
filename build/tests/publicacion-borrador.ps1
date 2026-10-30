# La función real se carga desde su AST sin ejecutar el empaquetado ni la
# orquestación del script. Los dobles nunca delegan a gh o git de la máquina.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/verificacion-release.ps1')
$source = (Resolve-Path (Join-Path $PSScriptRoot '../scripts/release.ps1')).Path
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$null, [ref]$parseErrors)
if ($parseErrors) { throw 'No se pudo analizar el script de publicación.' }
$definitions = @($ast.FindAll({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-DrusePublicacion'
}, $true))
if ($definitions.Count -ne 1) { throw 'Debe existir una sola función de publicación.' }
$publicationBody = $definitions[0].Body.GetScriptBlock()

function Invoke-PublicacionDePrueba {
    param([object]$verificacion)
    & $publicationBody
}

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$releaseDir = Join-Path $temporaryRoot "druse-borrador-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $releaseDir | Out-Null
$version = '1.11.0'
$tag = "v$version"
$Repository = 'test/druse'
$SinComprobarCI = $false
$selector = Join-Path $releaseDir 'selector.exe'
$complete = Join-Path $releaseDir 'completo.exe'
$lite = Join-Path $releaseDir 'sin-informix.exe'
$community = Join-Path $releaseDir 'comunidad.exe'
$latest = Join-Path $releaseDir 'latest.json'
$evidencia = Join-Path $releaseDir 'evidencia.json'
$checksums = Join-Path $releaseDir 'SHA256SUMS.txt'
$portables = @(foreach ($variant in @('completo', 'sin-informix', 'comunidad')) { Join-Path $releaseDir "$variant.zip" })
$notesFile = Join-Path $releaseDir 'notas.md'
$notes = 'Notas ficticias para comprobar la publicación.'
$expectedAssets = @($selector, $complete, "$complete.sig", $lite, "$lite.sig", $community, "$community.sig", $latest, $evidencia, $checksums) + $portables +
    @(foreach ($variant in @('completo', 'sin-informix', 'comunidad')) { Join-Path $releaseDir "manifiesto-$variant-$version-win-x64.json" })
foreach ($asset in $expectedAssets | Where-Object { $_ -ne $evidencia -and $_ -ne $checksums }) {
    Set-Content -LiteralPath $asset -Value "Contenido revisado: $([IO.Path]::GetFileName($asset))"
}
$state = @{ mode = 'correcto'; edits = 0; creates = 0; lists = 0; api = 0; mainChecks = 0; useNotesFile = $false }
$expectedCommit = 'a' * 40
$advancedMain = 'b' * 40
$expectedReleaseId = 123456789

function git {
    $global:LASTEXITCODE = 0
    if ($args.Count -eq 2 -and $args[0] -eq 'rev-parse' -and $args[1] -eq 'HEAD') { return 'a' * 40 }
    if ($args[0] -eq 'ls-remote' -and $args[1] -eq "https://github.com/$Repository.git" -and $args[2] -eq "refs/tags/$tag") {
        if ($state.mode -eq 'etiqueta existente') { return "$expectedCommit`trefs/tags/$tag" }
        if ($state.mode -eq 'etiqueta remota ajena') { return "$advancedMain`trefs/tags/$tag" }
        return
    }
    throw "Invocación git inesperada; no se ejecutará: $args"
}

function Get-DruseEstadoCI {
    param($Repository, $Commit, $Workflow = 'ci.yml')
    if ($Repository -ne 'test/druse' -or $Commit -ne ('a' * 40) -or $Workflow -notin @('ci.yml', 'comunidad.yml')) {
        throw 'La publicación consultó un origen o commit inesperado.'
    }
    return @{ verde = $true; detalle = 'CI ficticia satisfactoria'; run_id = 1; url = 'https://example.invalid/run/1' }
}

function gh {
    $global:LASTEXITCODE = 0
    if ($args[0] -eq 'api' -and $args[1] -eq "repos/$Repository/commits/main") {
        $state.mainChecks++
        if ($state.mode -eq 'fallo main antes del borrador' -or
            ($state.mode -eq 'fallo main durante subida' -and $state.creates -gt 0)) {
            $global:LASTEXITCODE = 1; return
        }
        if ($state.mode -eq 'main avanzó antes del borrador' -or
            ($state.creates -gt 0 -and $state.mode -in @('main avanzó durante subida', 'documentación durante subida', 'otra versión durante subida', 'comparación inválida durante subida'))) {
            return $advancedMain
        }
        return $expectedCommit
    }
    if ($args[0] -eq 'api' -and $args[1] -eq "repos/$Repository/contents/shells/desktop-tauri/tauri.conf.json?ref=$advancedMain") {
        $mainVersion = if ($state.mode -eq 'otra versión durante subida') { '1.12.0' } else { $version }
        return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{version=$mainVersion} | ConvertTo-Json)))
    }
    if ($args[0] -eq 'api' -and $args[1] -eq "repos/$Repository/compare/$expectedCommit...$advancedMain") {
        if ($state.mode -eq 'comparación inválida durante subida') { return 'no JSON' }
        $changed = if ($state.mode -eq 'documentación durante subida') { 'docs/guia.md' } else { 'backend/Program.cs' }
        return ConvertTo-Json -InputObject @{
            status = 'ahead'; ahead_by = 1; behind_by = 0; total_commits = 1
            base_commit = @{sha=$expectedCommit}; merge_base_commit = @{sha=$expectedCommit}
            files = @(@{filename=$changed; status='modified'})
        } -Depth 5 -Compress
    }
    if ($args[0] -eq 'release' -and $args[1] -eq 'create') {
        $state.creates++
        if ($state.mainChecks -lt 1) { throw 'Se intentó crear un borrador sin volver a comprobar main tras construir.' }
        if ($args[2] -ne $tag -or $args -notcontains '--draft' -or $args -contains '--clobber') { throw 'Debe crear un borrador nuevo sin sobrescribir.' }
        $targetIndex = [array]::IndexOf([object[]]$args, '--target')
        if ($targetIndex -lt 0 -or $args[$targetIndex + 1] -cne $expectedCommit -or
            (($args -contains '--verify-tag') -ne ($state.mode -eq 'etiqueta existente'))) {
            throw 'El borrador debe fijar el commit, incluso al verificar una etiqueta existente.'
        }
        foreach ($asset in $expectedAssets) {
            if ($args -notcontains $asset) { throw "Falta el artefacto esperado $asset en la creación del borrador." }
        }
        $notesArgument = if ($state.useNotesFile) { '--notes-file' } else { '--notes' }
        if ($args -notcontains $notesArgument) { throw 'No se eligió la fuente de notas correspondiente.' }
        if ($state.mode -eq 'fallo subida') { $global:LASTEXITCODE = 1 }
        return
    }
    if ($args[0] -eq 'api' -and $args[1] -eq "repos/$Repository/releases?per_page=100") {
        $state.lists++
        if ($state.creates -ne 1 -or $args -notcontains '--paginate' -or $args -notcontains '--slurp') {
            throw 'Debe buscar el borrador ya creado en todas las páginas del listado autenticado.'
        }
        if ($state.mode -eq 'fallo listado') { $global:LASTEXITCODE = 1; return }
        if ($state.mode -eq 'JSON inválido en listado') { return 'respuesta no JSON' }
        $draft = @{ id = $expectedReleaseId; draft = $true; tag_name = $tag; target_commitish = $expectedCommit }
        if ($state.mode -eq 'ID inválido') { $draft.id = 'id/no-numérico' }
        if ($state.mode -eq 'target distinto en listado') { $draft.target_commitish = 'main' }
        $pages = [object[]]::new(1)
        $pages[0] = @($draft)
        switch ($state.mode) {
            'sin borrador' { $pages[0] = @() }
            'borrador duplicado' { $pages[0] = @($draft, $draft.Clone()) }
            'listado sin páginas' { return ConvertTo-Json -InputObject @($draft) -Compress }
            'paginado' {
                $pages = [object[]]::new(3)
                $pages[0] = @(@{ id = 111; draft = $false; tag_name = 'v0.0.1' })
                $pages[1] = @(@{ id = 222; draft = $true; tag_name = 'v9.0.0' })
                $pages[2] = @($draft)
            }
        }
        return ConvertTo-Json -InputObject $pages -Depth 5 -Compress
    }
    if ($args[0] -eq 'api' -and $args.Count -eq 2 -and $args[1] -eq "repos/$Repository/releases/$expectedReleaseId") {
        $state.api++
        if ($state.lists -ne 1) { throw 'Debe resolver el ID del borrador antes de consultar sus archivos.' }
        if ($state.mode -eq 'fallo API') { $global:LASTEXITCODE = 1; return }
        if ($state.mode -eq 'JSON inválido') { return 'respuesta no JSON' }
        $remoteAssets = @(foreach ($asset in $expectedAssets) {
            $local = Get-Item -LiteralPath $asset
            @{ name = $local.Name; size = $local.Length; state = 'uploaded'; digest = 'sha256:' + (Get-FileHash -LiteralPath $asset).Hash.ToLowerInvariant() }
        })
        $remote = @{ id = $expectedReleaseId; draft = $true; tag_name = $tag; target_commitish = $expectedCommit; assets = $remoteAssets }
        switch ($state.mode) {
            'falta archivo' { $remote.assets = @($remoteAssets | Select-Object -Skip 1) }
            'tamaño distinto' { $remoteAssets[0].size++ }
            'hash distinto' { $remoteAssets[0].digest = 'sha256:' + ('0' * 64) }
            'sin digest' { foreach ($asset in $remoteAssets) { $asset.digest = $null } }
            'subida abierta' { $remoteAssets[0].state = 'open' }
            'nombre duplicado' { $remoteAssets[0].name = $remoteAssets[1].name }
            'otra etiqueta' { $remote.tag_name = 'v9.9.9' }
            'ya pública' { $remote.draft = $false }
            'otro ID' { $remote.id = $expectedReleaseId + 1 }
            'otro target' { $remote.target_commitish = $advancedMain }
        }
        return ConvertTo-Json -InputObject $remote -Depth 4 -Compress
    }
    if ($args[0] -eq 'api' -and $args[1] -eq "repos/$Repository/releases/$expectedReleaseId" -and $args -contains 'PATCH') {
        $state.edits++
        if ($state.creates -ne 1 -or $state.lists -ne 1 -or $state.api -ne 1 -or $state.mainChecks -lt 2 -or
            $args -notcontains '--method' -or $args -notcontains '--field' -or $args -notcontains 'draft=false') {
            throw 'Se intentó publicar antes de verificar el borrador por ID y revalidar main.'
        }
        if ($state.mode -eq 'fallo publicación') { $global:LASTEXITCODE = 1 }
        return
    }
    throw "Invocación gh inesperada; no se ejecutará: $args"
}

try {
    $cases = @('correcto', 'sin digest', 'notas desde archivo', 'paginado', 'etiqueta existente', 'falta archivo', 'tamaño distinto', 'hash distinto', 'subida abierta', 'nombre duplicado', 'otra etiqueta', 'ya pública', 'otro ID', 'otro target', 'fallo subida', 'fallo listado', 'JSON inválido en listado', 'listado sin páginas', 'sin borrador', 'borrador duplicado', 'ID inválido', 'target distinto en listado', 'etiqueta remota ajena', 'fallo API', 'JSON inválido', 'fallo publicación', 'main avanzó antes del borrador', 'main avanzó durante subida', 'documentación durante subida', 'otra versión durante subida', 'fallo main antes del borrador', 'fallo main durante subida', 'comparación inválida durante subida')
    foreach ($case in $cases) {
        $state.mode = $case; $state.edits = 0; $state.creates = 0; $state.lists = 0; $state.api = 0; $state.mainChecks = 0
        $state.useNotesFile = $case -eq 'notas desde archivo'
        if ($state.useNotesFile) { Set-Content -LiteralPath $notesFile -Value $notes }
        elseif (Test-Path -LiteralPath $notesFile) { Remove-Item -LiteralPath $notesFile }
        $caught = $null
        try { Invoke-PublicacionDePrueba @{ prueba = $true } | Out-Null } catch { $caught = $_ }
        if ($case -in @('correcto', 'sin digest', 'notas desde archivo', 'paginado', 'etiqueta existente', 'documentación durante subida')) {
            if ($caught -or $state.edits -ne 1) { throw "No se publicó el borrador válido ($case): $caught" }
        }
        elseif ($case -eq 'fallo publicación') {
            if (-not $caught -or $state.edits -ne 1 -or $caught.Exception.Message -notmatch 'no pudo publicar el borrador verificado') {
                throw 'El fallo final de publicación debe quedar indicado.'
            }
        }
        elseif (-not $caught -or $state.edits -ne 0) { throw "Se intentó publicar un borrador incorrecto: $case" }
        if ($case -in @('main avanzó antes del borrador', 'fallo main antes del borrador') -and $state.creates -ne 0) {
            throw 'Un cambio anterior a la subida no debe crear un borrador.'
        }
        if ($case -in @('main avanzó durante subida', 'otra versión durante subida', 'fallo main durante subida', 'comparación inválida durante subida') -and
            ($state.creates -ne 1 -or $state.api -ne 1 -or $state.edits -ne 0 -or -not $caught)) {
            throw 'Un cambio durante la subida debe conservar el borrador sin hacerlo público.'
        }
    }
    "OK: $($cases.Count) escenarios de borrador; solo se publica con todos los archivos comprobados, sin red."
}
finally {
    $resolved = [IO.Path]::GetFullPath($releaseDir)
    if ((Split-Path -Parent $resolved) -ne $temporaryRoot -or (Split-Path -Leaf $resolved) -notlike 'druse-borrador-*') {
        throw 'Directorio temporal fuera del alcance de limpieza.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    $global:LASTEXITCODE = 0
}
