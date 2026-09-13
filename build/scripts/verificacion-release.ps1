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
    Dónde buscar los manifiestos de contenido que escribe `package.ps1`. Si no se
    indica, esa comprobación se omite y se dice.

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
        [switch]$SinAuthenticode
    )

    $completeName = "Druse-$Version-windows-x86_64-completo-setup.exe"
    $liteName = "Druse-$Version-windows-x86_64-sin-informix-setup.exe"
    $selectorName = "Druse-$Version-installer.exe"

    $complete = Join-Path $ReleaseDir $completeName
    $lite = Join-Path $ReleaseDir $liteName
    $selector = Join-Path $ReleaseDir $selectorName
    $latest = Join-Path $ReleaseDir 'latest.json'

    $faltan = @($complete, "$complete.sig", $lite, "$lite.sig", $selector, $latest) |
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

    foreach ($firma in @("$complete.sig", "$lite.sig")) {
        if ((Get-DruseMinisignKeyId (Get-Content -LiteralPath $firma -Raw)) -ne $publicKeyId) {
            throw "La firma $([IO.Path]::GetFileName($firma)) no pertenece a la clave pública configurada. No se publicará."
        }
    }

    Write-Host '  OK   las firmas pertenecen a la clave de la aplicación' -ForegroundColor Green

    # 2. Y corresponden a **estos** bytes. Es la comprobación que descubre el
    #    error clásico: calcular la `.sig` antes de firmar con Authenticode, que
    #    modifica el archivo y deja la firma apuntando a algo que ya no existe.
    $verificador = Join-Path $PSScriptRoot 'verificar-actualizacion.cjs'

    foreach ($artefacto in @($complete, $lite)) {
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

    $declaradas = @(
        @('windows-x86_64-completo', $manifiesto.platforms.'windows-x86_64-completo', "$complete.sig", $completeName),
        @('windows-x86_64-sin-informix', $manifiesto.platforms.'windows-x86_64-sin-informix', "$lite.sig", $liteName)
    )

    foreach ($entrada in $declaradas) {
        $plataforma, $anunciada, $archivoFirma, $nombre = $entrada

        if (-not $anunciada) {
            throw "latest.json no anuncia la plataforma $plataforma."
        }

        if ($anunciada.signature.Trim() -ne (Get-Content -LiteralPath $archivoFirma -Raw).Trim()) {
            throw "La firma de $plataforma en latest.json no es la del archivo .sig. No se publicará."
        }

        if (-not $anunciada.url.EndsWith("/$nombre")) {
            throw "La dirección de $plataforma en latest.json no apunta a $nombre."
        }
    }

    # Las dos ediciones comparten `latest.json` y lo único que las separa es su
    # clave. Si una acabara anunciando el instalador de la otra —copiar y pegar
    # basta—, una instalación sin Informix se actualizaría a la completa y se
    # llevaría los 111 MB del controlador de IBM que alguien decidió no
    # instalar. Una actualización no cambia de edición.
    $completoAnunciado = $manifiesto.platforms.'windows-x86_64-completo'
    $ligeroAnunciado = $manifiesto.platforms.'windows-x86_64-sin-informix'

    if ($completoAnunciado.url -eq $ligeroAnunciado.url -or
        $completoAnunciado.signature.Trim() -eq $ligeroAnunciado.signature.Trim()) {
        throw 'Las dos ediciones anuncian el mismo artefacto en latest.json: una actualización cambiaría de edición.'
    }

    Write-Host '  OK   cada edición anuncia su propio instalador' -ForegroundColor Green

    # 4. Authenticode. Una firma inválida detiene la publicación; **no tenerla**
    #    es el estado de hoy y solo se avisa, porque bloquear por eso dejaría el
    #    proyecto sin poder publicar hasta conseguir un certificado.
    $authenticode = [ordered]@{}

    foreach ($artefacto in @($selector, $complete, $lite)) {
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

    foreach ($par in @(@('completo', $complete), @('sin-informix', $lite))) {
        $variante, $artefacto = $par

        if (-not $ManifestDir) { continue }

        $manifiestoPaquete = Join-Path $ManifestDir "manifiesto-$variante-$Version-win-x64.json"

        if (-not (Test-Path -LiteralPath $manifiestoPaquete)) {
            Write-Host "  ---  sin manifiesto de contenido para la variante $variante" -ForegroundColor Yellow
            continue
        }

        $contenido = Get-Content -LiteralPath $manifiestoPaquete -Raw | ConvertFrom-Json
        $hash = (Get-FileHash -LiteralPath $artefacto -Algorithm SHA256).Hash.ToLowerInvariant()

        if ($contenido.variante -ne $variante) {
            throw "El manifiesto de contenido de $variante describe la variante $($contenido.variante)."
        }

        if (-not ($contenido.contenido | Where-Object { $_.sha256 -eq $hash })) {
            throw "El instalador $variante no figura en su manifiesto de contenido: sus bytes no son los que se revisaron."
        }

        $revisados += $variante
        Write-Host "  OK   la variante $variante coincide con su manifiesto de contenido" -ForegroundColor Green
    }

    return [ordered]@{
        firmas_actualizador = 'verificadas contra los bytes publicados'
        authenticode        = $authenticode
        contenido_revisado  = $revisados
        artefactos          = [ordered]@{
            $completeName = (Get-FileHash -LiteralPath $complete -Algorithm SHA256).Hash.ToLowerInvariant()
            $liteName     = (Get-FileHash -LiteralPath $lite -Algorithm SHA256).Hash.ToLowerInvariant()
            $selectorName = (Get-FileHash -LiteralPath $selector -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
}
