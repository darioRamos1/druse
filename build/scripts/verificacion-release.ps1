#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Qué tiene que cumplir una release de Druse para poder publicarse.

.DESCRIPTION
    Vive aparte de `release.ps1` por dos razones. La primera es que **entre
    construir y publicar puede haber una firma que ocurre en otra máquina**: un
    servicio como SignPath recibe el artefacto, lo firma y lo devuelve, y
    entonces hay que poder verificar sin reconstruir. La segunda es que así se
    puede probar con artefactos de mentira, que es lo que hace
    `build/tests/release-verificacion.ps1`.

    Aquí no se construye ni se publica nada: se mira lo que hay en el directorio
    de la release y se dice si sale o no sale.

.NOTES
    Este archivo solo aporta funciones. Quien las llama es `release.ps1`.
#>

. (Join-Path $PSScriptRoot 'manifiesto.ps1')

function Test-DruseRutaSoloDocumental {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '[\\\x00-\x1f\x7f]|(^/)|//|(^|/)\.\.?(/|$)') { return $false }
    if ($Path -clike 'landing/*') { return $true }
    # Los expedientes de terceros sí aportan avisos y pruebas a los paquetes.
    if ($Path -clike 'docs/*' -and $Path -notmatch '^docs/terceros(?:[/.-]|$)') { return $true }
    return $Path -cin @('README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'SUPPORT.md', 'CODE_SIGNING_POLICY.md')
}

# Una versión puede esperar a CI mientras main recibe documentación. Sólo esa
# clase de avance conserva los mismos bytes del programa que se comprobaron.
function Get-DruseCompatibilidadMain {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Commit,
        [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
    )

    $mainResponse = gh api "repos/$Repository/commits/main" --jq '.sha'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar el commit actual de main.' }
    $main = ($mainResponse -join '').Trim()
    if ($main -notmatch '^[0-9a-fA-F]{40}$') { throw 'La respuesta del commit de main no es válida.' }
    if ($main -eq $Commit) { return @{ compatible = $true; detalle = 'El commit comprobado sigue siendo main.' } }

    $config = gh api "repos/$Repository/contents/shells/desktop-tauri/tauri.conf.json?ref=$main" --jq '.content'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la versión actual de main.' }
    try {
        $mainVersion = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($config -join '').Trim())) | ConvertFrom-Json -ErrorAction Stop).version
        if ($mainVersion -isnot [string] -or $mainVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Versión inválida.' }
    }
    catch { throw 'La configuración de versión de main no es válida.' }
    if ($mainVersion -ne $Version) {
        return @{ compatible = $false; detalle = 'main ya tiene otra versión; se espera su comprobación.' }
    }

    $response = gh api "repos/$Repository/compare/$Commit...$main"
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar qué cambió en main.' }
    try { $comparison = $response | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'La comparación de main no es JSON válido.' }
    if ($null -eq $comparison -or $comparison -is [array] -or
        $comparison.status -isnot [string] -or $comparison.status -notin @('ahead', 'behind', 'diverged', 'identical') -or
        $comparison.base_commit.sha -isnot [string] -or $comparison.merge_base_commit.sha -isnot [string] -or
        $comparison.base_commit.sha -ne $Commit -or
        $comparison.files -isnot [array]) {
        throw 'La comparación de main no contiene la evidencia esperada.'
    }
    if ($comparison.status -ne 'ahead' -or $comparison.merge_base_commit.sha -ne $Commit) {
        return @{ compatible = $false; detalle = 'El commit comprobado ya no es antecesor de main.' }
    }
    if ($comparison.ahead_by -isnot [long] -or $comparison.ahead_by -lt 1 -or
        $comparison.behind_by -isnot [long] -or $comparison.behind_by -ne 0 -or
        $comparison.total_commits -isnot [long] -or $comparison.total_commits -ne $comparison.ahead_by) {
        throw 'La comparación de main no describe un avance completo y válido.'
    }
    if ($comparison.PSObject.Properties['truncated'] -and $comparison.truncated -isnot [bool]) {
        throw 'La comparación de main contiene un indicador de truncamiento inválido.'
    }
    # GitHub limita a 300 los archivos de compare. En el límite no se puede
    # acreditar que todos los demás sean documentos: se espera el nuevo SHA.
    if ($comparison.files.Count -ge 300 -or $comparison.truncated -eq $true) {
        return @{ compatible = $false; detalle = 'La lista de cambios de main puede estar truncada; se espera su comprobación.' }
    }
    foreach ($file in $comparison.files) {
        if ($file.filename -isnot [string] -or [string]::IsNullOrWhiteSpace($file.filename) -or
            $file.status -isnot [string] -or $file.status -notin @('added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged') -or
            ($null -ne $file.previous_filename -and $file.previous_filename -isnot [string]) -or
            ($file.status -in @('renamed', 'copied') -and [string]::IsNullOrWhiteSpace($file.previous_filename))) {
            throw 'La comparación de main contiene un archivo sin evidencia completa.'
        }
        if (-not (Test-DruseRutaSoloDocumental $file.filename) -or
            ($file.previous_filename -and -not (Test-DruseRutaSoloDocumental $file.previous_filename))) {
            return @{ compatible = $false; detalle = 'main tiene cambios de aplicación o de contenido del paquete; se espera su comprobación.' }
        }
    }
    $latestResponse = gh api "repos/$Repository/commits/main" --jq '.sha'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo confirmar que main se mantuvo durante la comprobación.' }
    if (($latestResponse -join '').Trim() -ne $main) {
        return @{ compatible = $false; detalle = 'main volvió a avanzar durante la comprobación; se espera la nueva validación.' }
    }
    return @{ compatible = $true; detalle = 'main sólo añadió documentación o cambios de la landing.' }
}

function Assert-DruseMainCompatible {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][string]$Commit,
        [Parameter(Mandatory)][string]$Version
    )
    $result = Get-DruseCompatibilidadMain -Repository $Repository -Commit $Commit -Version $Version
    if (-not $result.compatible) {
        throw "La publicación ya no corresponde al código actual de main. $($result.detalle) Se conservan las descargas anteriores y cualquier borrador pendiente."
    }
}

function Write-DruseReleaseChecksums {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ReleaseDir)

    $lines = @(Get-ChildItem -LiteralPath $ReleaseDir -File | Where-Object Name -ne 'SHA256SUMS.txt' |
        Sort-Object Name | ForEach-Object {
            if ($_.Name -notmatch '^[A-Za-z0-9._-]+$') { throw 'Nombre de artefacto no admitido en SHA256SUMS.txt.' }
            '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
        })
    if (-not $lines.Count) { throw 'No hay artefactos para generar SHA256SUMS.txt.' }
    $lines | Set-Content -LiteralPath (Join-Path $ReleaseDir 'SHA256SUMS.txt') -Encoding utf8
}

function Test-DruseReleaseChecksums {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$ReleaseDir)

    $path = Join-Path $ReleaseDir 'SHA256SUMS.txt'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Falta SHA256SUMS.txt.' }
    $declared = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -notmatch '^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$' -or $Matches[2] -eq 'SHA256SUMS.txt') {
            throw 'SHA256SUMS.txt contiene una línea no válida.'
        }
        if (-not $declared.TryAdd($Matches[2], $Matches[1])) { throw 'SHA256SUMS.txt repite un artefacto.' }
    }
    $files = @(Get-ChildItem -LiteralPath $ReleaseDir -File | Where-Object Name -ne 'SHA256SUMS.txt')
    if ($declared.Count -ne $files.Count) { throw 'SHA256SUMS.txt no enumera todos los artefactos de la release.' }
    foreach ($file in $files) {
        if (-not $declared.ContainsKey($file.Name) -or
            $declared[$file.Name] -cne (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) {
            throw "SHA256SUMS.txt no coincide con $($file.Name)."
        }
    }
}

# El hash del ZIP acredita sus bytes, pero no detecta haber comprimido la API
# de otra edición. Se contrasta cada entrada sin extraer archivos al disco.
function Test-DrusePortableContent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][object]$Manifest
    )

    $zipHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not @($Manifest.contenido | Where-Object { $_.ruta -like 'bundle/*-portable*.zip' -and $_.sha256 -eq $zipHash }).Count) {
        throw "El portable $($Manifest.variante) no figura en su manifiesto de contenido."
    }
    $expected = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    foreach ($entry in $Manifest.contenido | Where-Object { $_.ruta -like 'api/*' -or $_.ruta -in @('bundle/druse.exe', 'bundle/LEEME.txt') }) {
        $name = ([string]$entry.ruta) -replace '^bundle/', ''
        if (-not $expected.TryAdd($name, $entry)) { throw 'El inventario portable contiene rutas repetidas.' }
    }
    foreach ($required in @('druse.exe', 'LEEME.txt', 'api/Druse.Host.LocalApi.exe')) {
        if (-not $expected.ContainsKey($required)) { throw "Falta $required en el inventario portable." }
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if ($name -match '(^/|:|(^|/)\.\.(/|$))') { throw 'El portable contiene una ruta no segura.' }
            if (-not $entry.Name) { continue }
            if (-not $seen.Add($name) -or -not $expected.ContainsKey($name)) { throw "Contenido portable inesperado: $name." }
            $stream = $entry.Open()
            try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
            finally { $stream.Dispose() }
            if ($entry.Length -ne $expected[$name].bytes -or $hash -cne $expected[$name].sha256) {
                throw "El contenido portable no coincide con el inventario: $name."
            }
        }
        if ($seen.Count -ne $expected.Count) { throw 'El portable no contiene todos los archivos del inventario.' }
    }
    finally { $archive.Dispose() }
}

# Consulta el workflow del proyecto, nunca checks ajenos como Dependabot.
# No filtrar por completed: una ejecución nueva pendiente invalida el verde anterior.
function Get-DruseEstadoCI {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Commit,
        [ValidateSet('ci.yml', 'comunidad.yml')][string]$Workflow = 'ci.yml'
    )
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        return @{ verde = $false; detalle = 'no se encontró gh para consultar CI' }
    }
    $endpoint = "repos/$Repository/actions/workflows/$Workflow/runs?head_sha=$Commit&per_page=100"
    $respuesta = gh api $endpoint --paginate --slurp 2>&1
    if ($LASTEXITCODE -ne 0) {
        return @{ verde = $false; detalle = "no se pudo consultar el workflow $Workflow" }
    }
    try {
        $paginas = $respuesta | ConvertFrom-Json -ErrorAction Stop
        $ejecuciones = @($paginas | ForEach-Object { $_.workflow_runs } | Where-Object { $null -ne $_ })
        if ($ejecuciones.Count -eq 0) {
            return @{ verde = $false; detalle = "el commit no tiene ninguna ejecución de $Workflow" }
        }
        foreach ($ejecucion in $ejecuciones) {
            if ($ejecucion.head_sha -ne $Commit -or $ejecucion.path -ne ".github/workflows/$Workflow" -or -not $ejecucion.id) {
                return @{ verde = $false; detalle = 'la respuesta no corresponde al workflow y commit requeridos' }
            }
        }
        $ultima = $ejecuciones | Sort-Object -Descending -Property @{
            Expression = { [DateTimeOffset]$(if ($_.run_started_at) { $_.run_started_at } else { $_.created_at }) }
        }, id | Select-Object -First 1
        return @{
            verde = $ultima.status -eq 'completed' -and $ultima.conclusion -eq 'success'
            detalle = "${Workflow}: ejecución $($ultima.id), intento $($ultima.run_attempt), $($ultima.status)/$($ultima.conclusion)"
            run_id = $ultima.id
            url = $ultima.html_url
        }
    }
    catch {
        return @{ verde = $false; detalle = "no se pudo interpretar la respuesta de $Workflow" }
    }
}

<#
.SYNOPSIS
    Los ocho bytes con los que Minisign identifica una clave o una firma.
#>
function Get-DruseMinisignKeyId {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$EncodedDocument)

    try {
        $document = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($EncodedDocument.Trim()))
        $payload = $document -split "`r?`n" |
            Where-Object { $_ -and $_ -notmatch '^(untrusted|trusted) comment:' } |
            Select-Object -First 1
        $bytes = [Convert]::FromBase64String($payload)

        if ($bytes.Length -lt 10) { throw 'Documento Minisign incompleto.' }

        return [Convert]::ToHexString($bytes[2..9])
    }
    catch {
        throw "No se pudo leer una clave o firma Minisign: $_"
    }
}

<#
.SYNOPSIS
    Comprueba que lo que hay en el directorio de la release se puede publicar.

.DESCRIPTION
    Devuelve el resumen de lo comprobado, que acaba en la evidencia de la
    release. Lanza en cuanto algo no cuadra: una publicación a medias es peor que
    no publicar, porque deja a los usuarios una actualización que su propia
    aplicación rechazará.

.PARAMETER ReleaseDir
    Directorio con los artefactos, sus `.sig` y `latest.json`.

.PARAMETER PublicKey
    Clave pública del actualizador, tal como está en `tauri.conf.json`.

.PARAMETER ManifestDir
    Directorio obligatorio con los dos manifiestos de contenido de `package.ps1`.
    Omitirlo o perder un manifiesto impide verificar y publicar la release.

.PARAMETER SinAuthenticode
    Salta la comprobación de Authenticode.

    Es para `build/tests/release-verificacion.ps1`, que ejercita el resto de
    guardas con artefactos de mentira: `Get-AuthenticodeSignature` necesita un
    ejecutable de verdad y sobre cualquier otra cosa contesta `UnknownError`, que
    no significa «sin firmar». Una release real nunca debe usarlo.
#>
function Invoke-DruseReleaseVerificacion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ReleaseDir,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$PublicKey,
        [string]$ManifestDir,
        [switch]$SinAuthenticode,
        [switch]$IncludeCommunity,
        [switch]$IncludePortable,
        [string]$ExpectedBaseUrl
    )

    if ([string]::IsNullOrWhiteSpace($ManifestDir)) {
        throw 'Se requiere ManifestDir con los manifiestos de las dos variantes.'
    }

    $completeName = "Druse-$Version-windows-x86_64-completo-setup.exe"
    $liteName = "Druse-$Version-windows-x86_64-sin-informix-setup.exe"
    $selectorName = "Druse-$Version-installer.exe"

    $complete = Join-Path $ReleaseDir $completeName
    $lite = Join-Path $ReleaseDir $liteName
    $selector = Join-Path $ReleaseDir $selectorName
    $latest = Join-Path $ReleaseDir 'latest.json'

    $pairs = @(@('completo', $complete), @('sin-informix', $lite))
    if ($IncludeCommunity) {
        $communityName = "Druse-$Version-windows-x86_64-comunidad-setup.exe"
        $pairs += ,@('comunidad', (Join-Path $ReleaseDir $communityName))
    }
    $installers = @($pairs | ForEach-Object { $_[1] })
    $portables = @()
    if ($IncludePortable) {
        $portables = @(foreach ($pair in $pairs) { Join-Path $ReleaseDir "Druse-$Version-windows-x86_64-$($pair[0])-portable.zip" })
    }

    $faltan = @(@($selector, $latest) + $portables + @($installers | ForEach-Object { $_; "$_.sig" })) |
        Where-Object { -not (Test-Path -LiteralPath $_) } |
        ForEach-Object { [IO.Path]::GetFileName($_) }

    if ($faltan.Count -gt 0) {
        throw "Faltan artefactos de la release: $($faltan -join ', '). Ejecuta antes la etapa construir."
    }

    Write-Host 'Verificando la release...' -ForegroundColor Cyan

    # 1. Las firmas pertenecen a la clave que lleva dentro la aplicación. Sin
    #    esto, una firma de otra clave pasaría a `latest.json` y el rechazo
    #    aparecería en el equipo del usuario, no aquí.
    $publicKeyId = Get-DruseMinisignKeyId $PublicKey

    foreach ($firma in @($installers | ForEach-Object { "$_.sig" })) {
        if ((Get-DruseMinisignKeyId (Get-Content -LiteralPath $firma -Raw)) -ne $publicKeyId) {
            throw "La firma $([IO.Path]::GetFileName($firma)) no pertenece a la clave pública configurada. No se publicará."
        }
    }

    Write-Host '  OK   las firmas pertenecen a la clave de la aplicación' -ForegroundColor Green

    # 2. Y corresponden a **estos** bytes. Es la comprobación que descubre el
    #    error clásico: calcular la `.sig` antes de firmar con Authenticode, que
    #    modifica el archivo y deja la firma apuntando a algo que ya no existe.
    $verificador = Join-Path $PSScriptRoot 'verificar-actualizacion.cjs'

    foreach ($artefacto in $installers) {
        node $verificador $artefacto "$artefacto.sig" --pubkey $PublicKey

        if ($LASTEXITCODE -ne 0) {
            throw "La firma de actualización no corresponde a $([IO.Path]::GetFileName($artefacto)). No se publicará."
        }
    }

    # 3. `latest.json` tiene que decir lo mismo que los archivos. Un manifiesto
    #    con la firma de la construcción anterior no actualiza a nadie.
    $manifiesto = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json

    if ($manifiesto.version -ne $Version) {
        throw "latest.json anuncia la versión $($manifiesto.version) y se está publicando la $Version."
    }

    $declaradas = @(foreach ($pair in $pairs) {
        $key = "windows-x86_64-$($pair[0])"
        ,@($key, $manifiesto.platforms.$key, "$($pair[1]).sig", [IO.Path]::GetFileName($pair[1]))
    })

    foreach ($entrada in $declaradas) {
        $plataforma, $anunciada, $archivoFirma, $nombre = $entrada

        if (-not $anunciada) {
            throw "latest.json no anuncia la plataforma $plataforma."
        }

        if ($anunciada.signature.Trim() -ne (Get-Content -LiteralPath $archivoFirma -Raw).Trim()) {
            throw "La firma de $plataforma en latest.json no es la del archivo .sig. No se publicará."
        }

        $uri = $null
        if (-not [Uri]::TryCreate([string]$anunciada.url, [UriKind]::Absolute, [ref]$uri) -or
            $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
            -not $anunciada.url.EndsWith("/$nombre") -or
            ($ExpectedBaseUrl -and $anunciada.url -cne "$ExpectedBaseUrl/$nombre")) {
            throw "La dirección de $plataforma en latest.json no apunta a $nombre."
        }
    }

    # Las dos ediciones comparten `latest.json` y lo único que las separa es su
    # clave. Si una acabara anunciando el instalador de la otra —copiar y pegar
    # basta—, una instalación sin Informix se actualizaría a la completa y se
    # llevaría los 111 MB del controlador de IBM que alguien decidió no
    # instalar. Una actualización no cambia de edición.
    $urls = @($declaradas | ForEach-Object { $_[1].url } | Sort-Object -Unique)
    $signatures = @($declaradas | ForEach-Object { $_[1].signature.Trim() } | Sort-Object -Unique)
    if ($urls.Count -ne $pairs.Count -or $signatures.Count -ne $pairs.Count) {
        throw 'Las ediciones anuncian el mismo artefacto en latest.json: una actualización cambiaría de edición.'
    }

    Write-Host '  OK   cada edición anuncia su propio instalador' -ForegroundColor Green

    # 4. Authenticode. Una firma inválida detiene la publicación; **no tenerla**
    #    es el estado de hoy y solo se avisa, porque bloquear por eso dejaría el
    #    proyecto sin poder publicar hasta conseguir un certificado.
    $authenticode = [ordered]@{}

    foreach ($artefacto in @($selector) + $installers) {
        $nombre = [IO.Path]::GetFileName($artefacto)
        $estado = if ($SinAuthenticode -or -not $IsWindows) {
            'NoComprobado'
        }
        else {
            [string](Get-AuthenticodeSignature -LiteralPath $artefacto).Status
        }

        $authenticode[$nombre] = $estado

        switch ($estado) {
            'Valid' { Write-Host "  OK   Authenticode válido en $nombre" -ForegroundColor Green }
            'NotSigned' { Write-Host "  ---  $nombre sin Authenticode; Windows avisará al abrirlo" -ForegroundColor Yellow }
            'NoComprobado' { Write-Host "  ---  Authenticode sin comprobar en $nombre" -ForegroundColor Yellow }
            default { throw "La firma Authenticode de $nombre es $estado. No se publicará." }
        }
    }

    # 5. Los bytes son los que revisó el empaquetado. El manifiesto de contenido
    #    los anotó al construir; si no coinciden, algo tocó el artefacto después
    #    de que se revisara qué llevaba dentro.
    $revisados = @()

    foreach ($par in $pairs) {
        $variante, $artefacto = $par

        $manifiestoPaquete = Join-Path $ManifestDir "manifiesto-$variante-$Version-win-x64.json"

        if (-not (Test-Path -LiteralPath $manifiestoPaquete -PathType Leaf)) {
            throw "Falta el manifiesto de contenido de la variante $variante. No se publicará."
        }

        $contenido = Get-Content -LiteralPath $manifiestoPaquete -Raw | ConvertFrom-Json
        $hash = (Get-FileHash -LiteralPath $artefacto -Algorithm SHA256).Hash.ToLowerInvariant()

        if ($contenido.variante -ne $variante) {
            throw "El manifiesto de contenido de $variante describe la variante $($contenido.variante)."
        }

        if ($contenido.producto -ne 'Druse' -or $contenido.version -ne $Version) {
            throw "El manifiesto de contenido de $variante no corresponde al producto y versión requeridos."
        }

        if (-not ($contenido.contenido | Where-Object { $_.ruta -like 'bundle/*.exe' -and $_.sha256 -eq $hash })) {
            throw "El instalador $variante no figura en su manifiesto de contenido: sus bytes no son los que se revisaron."
        }

        # La licencia obliga a repartir su texto con cada copia. `package.ps1` ya
        # se detiene sin él, pero un manifiesto de otra construcción, o de antes
        # de esa guarda, llegaría hasta aquí igual.
        $avisos = @(Test-DruseRequiredNotices -Inventory @($contenido.contenido))

        if ($avisos.Count -gt 0) {
            throw "La variante $variante no lleva los avisos legales vigentes: $($avisos -join '; '). No se publicará."
        }

        if ($IncludePortable) {
            $portable = Join-Path $ReleaseDir "Druse-$Version-windows-x86_64-$variante-portable.zip"
            Test-DrusePortableContent -Path $portable -Manifest $contenido
        }

        $revisados += $variante
        Write-Host "  OK   la variante $variante coincide con su manifiesto de contenido" -ForegroundColor Green
    }

    $artifactHashes = [ordered]@{}
    foreach ($artifact in @($selector) + $installers + $portables) {
        $artifactHashes[[IO.Path]::GetFileName($artifact)] = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if ($IncludePortable) { Test-DruseReleaseChecksums -ReleaseDir $ReleaseDir }
    return [ordered]@{
        firmas_actualizador = 'verificadas contra los bytes publicados'
        authenticode        = $authenticode
        contenido_revisado  = $revisados
        artefactos          = $artifactHashes
    }
}
