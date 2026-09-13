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
    if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }

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

    'OK: release correcta aceptada; artefacto tocado, firma ajena, latest.json desincronizado o de otra versión, contenido distinto y release incompleta, rechazados.'
}
finally {
    Remove-Item -LiteralPath $raiz -Recurse -Force -ErrorAction SilentlyContinue
}
