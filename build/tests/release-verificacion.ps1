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
$selector = Join-Path $releaseDir "Druse-$version-installer.exe"
$latest = Join-Path $releaseDir 'latest.json'

<#
.SYNOPSIS
    Deja una release completa y correcta en el directorio temporal.

.DESCRIPTION
    Cada prueba parte de una release que sí se publicaría y rompe una sola cosa.
    Así, cuando una falla, se sabe cuál es esa cosa.
#>
function Nueva-Release {
    Remove-TestDirectory $releaseDir

    New-Item -ItemType Directory -Force $releaseDir | Out-Null
    New-Item -ItemType Directory -Force $manifestDir | Out-Null

    Set-Content -LiteralPath $completo -Value 'MZ instalador completo de mentira' -Encoding ASCII
    Set-Content -LiteralPath $ligero -Value 'MZ instalador ligero de mentira' -Encoding ASCII
    Set-Content -LiteralPath $selector -Value 'MZ selector de mentira' -Encoding ASCII

    # Firma con una clave de usar y tirar: la del actualizador no está aquí.
    $clave = node (Join-Path $PSScriptRoot 'firma-de-prueba.cjs') $releaseDir $completo $ligero

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

    $manifiesto | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $latest -Encoding UTF8

    foreach ($par in @(@('completo', $completo), @('sin-informix', $ligero))) {
        $variante, $artefacto = $par
        $contenido = [ordered]@{
            producto  = 'Druse'
            version   = $version
            variante  = $variante
            contenido = @(
                [ordered]@{
                    ruta   = "bundle/$([IO.Path]::GetFileName($artefacto))"
                    bytes  = (Get-Item -LiteralPath $artefacto).Length
                    sha256 = (Get-FileHash -LiteralPath $artefacto -Algorithm SHA256).Hash.ToLowerInvariant()
                }
            )
        }

        $contenido | ConvertTo-Json -Depth 6 |
            Set-Content -LiteralPath (Join-Path $manifestDir "manifiesto-$variante-$version-win-x64.json") -Encoding UTF8
    }

    return [string]$clave
}

<#
.SYNOPSIS
    Comprueba que la verificación rechaza, y por el motivo esperado.
#>
function Debe-Rechazar {
    param([string]$Clave, [string]$Patron, [string]$Caso)

    try {
        Invoke-DruseReleaseVerificacion -SinAuthenticode `
            -ReleaseDir $releaseDir -Version $version -PublicKey $Clave -ManifestDir $manifestDir | Out-Null
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

    # --- Falta un artefacto -----------------------------------------------------
    $clave = Nueva-Release
    Remove-Item -LiteralPath "$ligero.sig" -Force
    Debe-Rechazar $clave 'Faltan artefactos' 'una release incompleta'

    'OK: release correcta aceptada; ausencia de manifiestos, producto/versión incorrectos, artefacto tocado, firma ajena, latest.json desincronizado, ediciones cruzadas y release incompleta, rechazados.'
}
finally {
    Remove-TestDirectory $raiz
}
