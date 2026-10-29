# Ejercita las guardas que deciden si una release puede publicarse, con
# artefactos de mentira: no empaqueta, no firma con Authenticode, no llama a
# GitHub y no toca `artifacts/`.
#
# Lo que se comprueba es lo que evita repartir una actualización que la propia
# aplicación rechazará en el equipo del usuario, que es donde se descubriría si
# no se comprobara aquí.
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '../scripts/verificacion-release.ps1')

$version = '9.9.9'
$raiz = Join-Path ([IO.Path]::GetTempPath()) "druse-release-$([Guid]::NewGuid().ToString('N'))"
$releaseDir = Join-Path $raiz 'release'
$manifestDir = Join-Path $raiz 'paquete'

function Remove-TestDirectory([string]$Target) {
    $resolved = [IO.Path]::GetFullPath($Target)
    $testRoot = [IO.Path]::GetFullPath($raiz)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ((Split-Path -Parent $testRoot) -ne $tempRoot -or
        ($resolved -ne $testRoot -and -not $resolved.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar))) {
        throw 'El directorio a borrar no pertenece a esta prueba.'
    }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

$completo = Join-Path $releaseDir "Druse-$version-windows-x86_64-completo-setup.exe"
$ligero = Join-Path $releaseDir "Druse-$version-windows-x86_64-sin-informix-setup.exe"
$comunidad = Join-Path $releaseDir "Druse-$version-windows-x86_64-comunidad-setup.exe"
$selector = Join-Path $releaseDir "Druse-$version-installer.exe"
$latest = Join-Path $releaseDir 'latest.json'

<#
.SYNOPSIS
    Deja una release completa y correcta en el directorio temporal.

.DESCRIPTION
    Cada prueba parte de una release que sí se publicaría y rompe una sola cosa.
    Así, cuando una falla, se sabe cuál es esa cosa.
#>
function Nueva-Release([switch]$Community, [switch]$Portable) {
    Remove-TestDirectory $releaseDir

    New-Item -ItemType Directory -Force $releaseDir | Out-Null
    New-Item -ItemType Directory -Force $manifestDir | Out-Null

    Set-Content -LiteralPath $completo -Value 'MZ instalador completo de mentira' -Encoding ASCII
    Set-Content -LiteralPath $ligero -Value 'MZ instalador ligero de mentira' -Encoding ASCII
    Set-Content -LiteralPath $selector -Value 'MZ selector de mentira' -Encoding ASCII
    $installers = @($completo, $ligero)
    $pairs = @(@('completo', $completo), @('sin-informix', $ligero))
    if ($Community) {
        Set-Content -LiteralPath $comunidad -Value 'MZ Comunidad de mentira' -Encoding ASCII
        $installers += $comunidad
        $pairs += ,@('comunidad', $comunidad)
    }

    # Firma con una clave de usar y tirar: la del actualizador no está aquí.
    $clave = node (Join-Path $PSScriptRoot 'firma-de-prueba.cjs') $releaseDir @installers

    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron generar las firmas de prueba.' }

    $manifiesto = [ordered]@{
        version   = $version
        notes     = 'prueba'
        pub_date  = (Get-Date).ToUniversalTime().ToString('o')
        platforms = [ordered]@{
            'windows-x86_64-completo'     = [ordered]@{
                url       = "https://example.invalid/$([IO.Path]::GetFileName($completo))"
                signature = (Get-Content -LiteralPath "$completo.sig" -Raw).Trim()
            }
            'windows-x86_64-sin-informix' = [ordered]@{
                url       = "https://example.invalid/$([IO.Path]::GetFileName($ligero))"
                signature = (Get-Content -LiteralPath "$ligero.sig" -Raw).Trim()
            }
        }
    }

    if ($Community) {
        $manifiesto.platforms['windows-x86_64-comunidad'] = @{
            url = "https://example.invalid/$([IO.Path]::GetFileName($comunidad))"
            signature = (Get-Content "$comunidad.sig" -Raw).Trim()
        }
    }
    $manifiesto | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latest -Encoding UTF8

    foreach ($par in $pairs) {
        $variante, $artefacto = $par
        $contenido = [ordered]@{
            producto  = 'Druse'
            version   = $version
            variante  = $variante
            # El instalador va primero: el caso de bytes no revisados altera la
            # primera entrada. Detrás, los avisos legales tal como están en el
            # repositorio, que es lo que anotaría un empaquetado correcto.
            contenido = @(
                [ordered]@{
                    ruta   = "bundle/$([IO.Path]::GetFileName($artefacto))"
                    bytes  = (Get-Item -LiteralPath $artefacto).Length
                    sha256 = (Get-FileHash -LiteralPath $artefacto -Algorithm SHA256).Hash.ToLowerInvariant()
                }
            ) + @(foreach ($aviso in Get-DruseRequiredNotices) {
                    [ordered]@{
                        ruta   = $aviso.ruta
                        bytes  = (Get-Item -LiteralPath $aviso.origen).Length
                        sha256 = (Get-FileHash -LiteralPath $aviso.origen -Algorithm SHA256).Hash.ToLowerInvariant()
                    }
                })
        }

        if ($Portable) {
            $staging = Join-Path $raiz "portable-$variante"
            Remove-TestDirectory $staging
            New-Item -ItemType Directory -Path (Join-Path $staging 'api') -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $staging 'druse.exe') -Value "MZ Druse $variante" -Encoding ascii
            Set-Content -LiteralPath (Join-Path $staging 'LEEME.txt') -Value 'Extrae el ZIP antes de ejecutar.' -Encoding utf8
            Set-Content -LiteralPath (Join-Path $staging 'api/Druse.Host.LocalApi.exe') -Value "MZ API $variante" -Encoding ascii
            foreach ($aviso in Get-DruseRequiredNotices) {
                Copy-Item -LiteralPath $aviso.origen -Destination (Join-Path $staging $aviso.ruta)
            }
            $portablePath = Join-Path $releaseDir "Druse-$version-windows-x86_64-$variante-portable.zip"
            [IO.Compression.ZipFile]::CreateFromDirectory($staging, $portablePath)
            $contenido.contenido = @($contenido.contenido | Where-Object { $_.ruta -notlike 'api/*' }) +
                @(Get-DrusePackageInventory -Path (Join-Path $staging 'api') -Prefix 'api') +
                @(Get-DruseArtifactEntries -Path @((Join-Path $staging 'druse.exe'), (Join-Path $staging 'LEEME.txt'), $portablePath))
        }

        $contenido | ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath (Join-Path $manifestDir "manifiesto-$variante-$version-win-x64.json") -Encoding UTF8
    }

    if ($Portable) { Write-DruseReleaseChecksums -ReleaseDir $releaseDir }

    return [string]$clave
}

<#
.SYNOPSIS
    Comprueba que la verificación rechaza, y por el motivo esperado.
#>
function Debe-Rechazar {
    param([string]$Clave, [string]$Patron, [string]$Caso, [switch]$Community, [switch]$Portable)

    try {
        Invoke-DruseReleaseVerificacion -SinAuthenticode `
            -ReleaseDir $releaseDir -Version $version -PublicKey $Clave -ManifestDir $manifestDir -IncludeCommunity:$Community -IncludePortable:$Portable | Out-Null
    }
    catch {
        if ($_.Exception.Message -notmatch $Patron) {
            throw "$Caso se rechazó por otro motivo: $($_.Exception.Message)"
        }

        return
    }

    throw "$Caso debería haber detenido la publicación y no lo hizo."
}

try {
    # --- Una release correcta sale --------------------------------------------
    $clave = Nueva-Release
    $resultado = Invoke-DruseReleaseVerificacion -SinAuthenticode `
        -ReleaseDir $releaseDir -Version $version -PublicKey $clave -ManifestDir $manifestDir

    if ($resultado.artefactos.Count -ne 3) {
        throw 'La verificación debería anotar los tres artefactos con su hash.'
    }

    if (@($resultado.contenido_revisado).Count -ne 2) {
        throw 'Las dos variantes deberían contrastarse con su manifiesto de contenido.'
    }

    # No se puede convertir la ausencia de evidencia en una simple advertencia.
    foreach ($variante in @('completo', 'sin-informix')) {
        $clave = Nueva-Release
        Remove-Item -LiteralPath (Join-Path $manifestDir "manifiesto-$variante-$version-win-x64.json") -Force
        Debe-Rechazar $clave 'Falta el manifiesto de contenido' "manifiesto ausente: $variante"
    }
    $clave = Nueva-Release
    $rejected = $false
    try {
        Invoke-DruseReleaseVerificacion -SinAuthenticode -ReleaseDir $releaseDir -Version $version -PublicKey $clave | Out-Null
    } catch {
        if ($_.Exception.Message -notmatch 'Se requiere ManifestDir') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'ManifestDir omitido debería impedir la publicación.' }
    foreach ($field in @('version', 'producto')) {
        $clave = Nueva-Release
        $file = Join-Path $manifestDir "manifiesto-completo-$version-win-x64.json"
        $doc = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
        $doc.$field = 'otro'
        $doc | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $file -Encoding UTF8
        Debe-Rechazar $clave 'producto y versión requeridos' "manifiesto de otro $field"
    }

    # --- El caso que esto existe para cazar ------------------------------------
    # Firmar con Authenticode modifica el archivo. Si la `.sig` se calculó antes,
    # la release sale con una firma que no corresponde a esos bytes y el rechazo
    # aparece en el equipo del usuario.
    $clave = Nueva-Release
    Add-Content -LiteralPath $completo -Value 'firmado después' -Encoding ASCII
    Debe-Rechazar $clave 'no corresponde a' 'un artefacto tocado después de firmarlo'

    # --- Una firma de otra clave ----------------------------------------------
    $clave = Nueva-Release
    node (Join-Path $PSScriptRoot 'firma-de-prueba.cjs') $releaseDir $completo | Out-Null
    Debe-Rechazar $clave 'no pertenece a la clave pública' 'una firma de otra clave'

    # --- `latest.json` desincronizado ------------------------------------------
    # El manifiesto conserva la firma de la construcción anterior: los archivos
    # están bien y aun así nadie podría actualizarse.
    $clave = Nueva-Release
    $anterior = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
    $anterior.platforms.'windows-x86_64-completo'.signature = (Get-Content -LiteralPath "$ligero.sig" -Raw).Trim()
    $anterior | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latest -Encoding UTF8
    Debe-Rechazar $clave 'no es la del archivo .sig' 'un latest.json con la firma cambiada'

    # --- Una versión que no es la que se publica --------------------------------
    $clave = Nueva-Release
    $otraVersion = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
    $otraVersion.version = '1.0.0'
    $otraVersion | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latest -Encoding UTF8
    Debe-Rechazar $clave 'anuncia la versión' 'un latest.json de otra versión'

    # --- Las dos ediciones siendo el mismo instalador ---------------------------
    # No es hipotético: Tauri nombra igual los dos instaladores y ya pasó que la
    # segunda construcción pisara a la primera antes de renombrarla. Si eso
    # vuelve a ocurrir, los dos artefactos son el mismo archivo con dos nombres,
    # cada comprobación por separado pasa, y una instalación sin Informix se
    # actualiza a la completa con los 111 MB del controlador de IBM detrás.
    $clave = Nueva-Release
    Copy-Item -LiteralPath $completo -Destination $ligero -Force
    Copy-Item -LiteralPath "$completo.sig" -Destination "$ligero.sig" -Force
    $mezclado = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
    $mezclado.platforms.'windows-x86_64-sin-informix'.signature = (Get-Content -LiteralPath "$ligero.sig" -Raw).Trim()
    $mezclado | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latest -Encoding UTF8
    Debe-Rechazar $clave 'cambiaría de edición' 'las dos ediciones siendo el mismo archivo'

    # Y la firma de una edición anunciada bajo la otra, que es lo que deja sin
    # actualizaciones a quien la pida.
    $clave = Nueva-Release
    $firmaCruzada = Get-Content -LiteralPath $latest -Raw | ConvertFrom-Json
    $firmaCruzada.platforms.'windows-x86_64-sin-informix'.signature = $firmaCruzada.platforms.'windows-x86_64-completo'.signature
    $firmaCruzada | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latest -Encoding UTF8
    Debe-Rechazar $clave 'no es la del archivo .sig' 'una edición con la firma de la otra'

    # --- Un manifiesto de contenido de otra edición ------------------------------
    $clave = Nueva-Release
    $cruzado = Join-Path $manifestDir "manifiesto-sin-informix-$version-win-x64.json"
    $documento = Get-Content -LiteralPath $cruzado -Raw | ConvertFrom-Json
    $documento.variante = 'completo'
    $documento | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $cruzado -Encoding UTF8
    Debe-Rechazar $clave 'describe la variante' 'un manifiesto de contenido de otra edición'

    # --- Bytes que no son los que revisó el empaquetado -------------------------
    $clave = Nueva-Release
    $manifiestoPaquete = Join-Path $manifestDir "manifiesto-completo-$version-win-x64.json"
    $contenido = Get-Content -LiteralPath $manifiestoPaquete -Raw | ConvertFrom-Json
    $contenido.contenido[0].sha256 = '0' * 64
    $contenido | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifiestoPaquete -Encoding UTF8
    Debe-Rechazar $clave 'no figura en su manifiesto de contenido' 'un instalador que no es el revisado'

    # --- Sin los avisos que exige la licencia ------------------------------------
    # Un paquete sin el texto de la GPL no se puede repartir, aunque los bytes y
    # las firmas estén bien. Y uno con un aviso viejo dice algo que ya no es.
    foreach ($variante in @('completo', 'sin-informix')) {
        $clave = Nueva-Release
        $manifiestoPaquete = Join-Path $manifestDir "manifiesto-$variante-$version-win-x64.json"
        $contenido = Get-Content -LiteralPath $manifiestoPaquete -Raw | ConvertFrom-Json
        $contenido.contenido = @($contenido.contenido | Where-Object { $_.ruta -ne 'api/LICENSE-Druse.txt' })
        $contenido | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifiestoPaquete -Encoding UTF8
        Debe-Rechazar $clave 'avisos legales vigentes: falta api/LICENSE-Druse.txt' "una variante $variante sin LICENSE"
    }

    $clave = Nueva-Release
    $manifiestoPaquete = Join-Path $manifestDir "manifiesto-completo-$version-win-x64.json"
    $contenido = Get-Content -LiteralPath $manifiestoPaquete -Raw | ConvertFrom-Json
    ($contenido.contenido | Where-Object { $_.ruta -eq 'api/THIRD_PARTY_NOTICES-Druse.md' }).sha256 = 'f' * 64
    $contenido | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifiestoPaquete -Encoding UTF8
    Debe-Rechazar $clave 'no coincide con THIRD_PARTY_NOTICES.md' 'un aviso de terceros desactualizado'

    # --- Falta un artefacto -----------------------------------------------------
    $clave = Nueva-Release
    Remove-Item -LiteralPath "$ligero.sig" -Force
    Debe-Rechazar $clave 'Faltan artefactos' 'una release incompleta'

    $clave = Nueva-Release -Community
    $result = Invoke-DruseReleaseVerificacion -SinAuthenticode -ReleaseDir $releaseDir -Version $version -PublicKey $clave -ManifestDir $manifestDir -IncludeCommunity -ExpectedBaseUrl 'https://example.invalid'
    if ($result.artefactos.Count -ne 4 -or $result.contenido_revisado -notcontains 'comunidad') { throw 'Falta Comunidad en la evidencia.' }
    try {
        Invoke-DruseReleaseVerificacion -SinAuthenticode -ReleaseDir $releaseDir -Version $version -PublicKey $clave -ManifestDir $manifestDir -IncludeCommunity -ExpectedBaseUrl 'https://otro.invalid' | Out-Null
        throw 'Se aceptó un origen distinto.'
    } catch { if ($_.Exception.Message -notmatch 'La dirección') { throw } }

    foreach ($case in @('ausente', 'firma', 'http', 'otro instalador', 'bytes', 'inventario')) {
        $clave = Nueva-Release -Community
        $manifest = Get-Content $latest -Raw | ConvertFrom-Json
        switch ($case) {
            'ausente' { $manifest.platforms.PSObject.Properties.Remove('windows-x86_64-comunidad'); $pattern='no anuncia la plataforma' }
            'firma' { $manifest.platforms.'windows-x86_64-comunidad'.signature = $manifest.platforms.'windows-x86_64-completo'.signature; $pattern='no es la del archivo' }
            'http' { $manifest.platforms.'windows-x86_64-comunidad'.url = $manifest.platforms.'windows-x86_64-comunidad'.url.Replace('https:','http:'); $pattern='La dirección' }
            'otro instalador' { $manifest.platforms.'windows-x86_64-comunidad'.url = $manifest.platforms.'windows-x86_64-completo'.url; $pattern='La dirección' }
            'bytes' { Add-Content $comunidad 'alterado'; $pattern='no corresponde a' }
            'inventario' { Remove-Item -LiteralPath (Join-Path $manifestDir "manifiesto-comunidad-$version-win-x64.json"); $pattern='Falta el manifiesto' }
        }
        $manifest | ConvertTo-Json -Depth 6 | Set-Content $latest -Encoding utf8
        Debe-Rechazar $clave $pattern "Comunidad: $case" -Community
    }
    $clave = Nueva-Release -Community -Portable
    $result = Invoke-DruseReleaseVerificacion -SinAuthenticode -ReleaseDir $releaseDir -Version $version -PublicKey $clave -ManifestDir $manifestDir -IncludeCommunity -IncludePortable
    if ($result.artefactos.Count -ne 7) { throw 'Faltan los tres portables en la evidencia.' }
    Set-Content -LiteralPath (Join-Path $releaseDir 'evidencia.json') -Value '{"prueba":true}'
    Write-DruseReleaseChecksums -ReleaseDir $releaseDir
    Test-DruseReleaseChecksums -ReleaseDir $releaseDir
    if (-not (Select-String -LiteralPath (Join-Path $releaseDir 'SHA256SUMS.txt') -SimpleMatch 'evidencia.json' -Quiet)) {
        throw 'La evidencia publicada necesita su propio hash.'
    }

    foreach ($case in @('ausente', 'otra edición', 'API alterada', 'falta API', 'archivo extra', 'ruta no segura', 'ejecutable alterado', 'sin hashes', 'hash incorrecto', 'hash omitido', 'hash repetido')) {
        $clave = Nueva-Release -Community -Portable
        $portablePath = Join-Path $releaseDir "Druse-$version-windows-x86_64-comunidad-portable.zip"
        $manifestPath = Join-Path $manifestDir "manifiesto-comunidad-$version-win-x64.json"
        $checksumsPath = Join-Path $releaseDir 'SHA256SUMS.txt'
        $pattern = 'portable'
        switch ($case) {
            'ausente' { Remove-Item -LiteralPath $portablePath; $pattern = 'Faltan artefactos' }
            'otra edición' {
                Copy-Item -LiteralPath (Join-Path $releaseDir "Druse-$version-windows-x86_64-completo-portable.zip") -Destination $portablePath -Force
                $pattern = 'no figura en su manifiesto'
            }
            { $_ -in @('API alterada', 'falta API', 'archivo extra', 'ruta no segura', 'ejecutable alterado') } {
                $archive = [IO.Compression.ZipFile]::Open($portablePath, [IO.Compression.ZipArchiveMode]::Update)
                try {
                    switch ($case) {
                        'API alterada' { $archive.GetEntry('api/Druse.Host.LocalApi.exe').Delete(); $name = 'api/Druse.Host.LocalApi.exe'; $pattern = 'no coincide con el inventario' }
                        'ejecutable alterado' { $archive.GetEntry('druse.exe').Delete(); $name = 'druse.exe'; $pattern = 'no coincide con el inventario' }
                        'falta API' { $archive.GetEntry('api/Druse.Host.LocalApi.exe').Delete(); $name = $null; $pattern = 'no contiene todos' }
                        'archivo extra' { $name = 'api/controlador-no-revisado.dll'; $pattern = 'inesperado' }
                        'ruta no segura' { $name = '../fuera.exe'; $pattern = 'ruta no segura' }
                    }
                    if ($name) {
                        $writer = [IO.StreamWriter]::new($archive.CreateEntry($name).Open())
                        try { $writer.Write('bytes no revisados') } finally { $writer.Dispose() }
                    }
                } finally { $archive.Dispose() }
                # Incluso si alguien recalcula el hash del ZIP, sus archivos deben
                # coincidir con la API y el ejecutable revisados al empaquetar.
                $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                ($manifest.contenido | Where-Object { $_.ruta -like 'bundle/*-portable*.zip' }).sha256 = (Get-FileHash -LiteralPath $portablePath).Hash.ToLowerInvariant()
                $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath
            }
            'sin hashes' { Remove-Item -LiteralPath $checksumsPath; $pattern = 'Falta SHA256SUMS' }
            'hash incorrecto' { (Get-Content -LiteralPath $checksumsPath) -replace '^[a-f0-9]{64}', ('0' * 64) | Set-Content -LiteralPath $checksumsPath; $pattern = 'SHA256SUMS.txt no coincide' }
            'hash omitido' { Get-Content -LiteralPath $checksumsPath | Select-Object -Skip 1 | Set-Content -LiteralPath (Join-Path $raiz 'sums.txt'); Copy-Item -LiteralPath (Join-Path $raiz 'sums.txt') -Destination $checksumsPath -Force; $pattern = 'no enumera todos' }
            'hash repetido' { $firstHash = Get-Content -LiteralPath $checksumsPath -TotalCount 1; Add-Content -LiteralPath $checksumsPath -Value $firstHash; $pattern = 'repite un artefacto' }
        }
        Debe-Rechazar $clave $pattern "Portable: $case" -Community -Portable
    }
    'OK: instaladores y portables de las tres ediciones verificados; rechazos de firmas, inventarios, ZIP mezclados o alterados y hashes incompletos comprobados.'
}
finally {
    Remove-TestDirectory $raiz
}
