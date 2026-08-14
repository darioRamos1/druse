#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Firma digital de los binarios de Druse en Windows.

.DESCRIPTION
    Sin firmar, Windows enseña el aviso de SmartScreen en cada equipo donde se
    abre la aplicación: no es que sospeche del código, es que no sabe quién lo
    hizo. Firmar es la única forma de quitarlo, y **la firma no basta por sí
    sola**: con un certificado OV el aviso puede seguir apareciendo hasta que el
    ejecutable acumule reputación.

    Este archivo solo aporta las funciones. Quien decide si se firma es
    `package.ps1`, y lo hace únicamente cuando hay certificado configurado: sin
    él, el empaquetado se comporta exactamente igual que antes de existir esto.

    Cómo se indica el certificado, por orden de preferencia:

    1. `-CertificateThumbprint` en `package.ps1`.
    2. La variable de entorno `DRUSE_SIGN_THUMBPRINT`.

    La huella es la del certificado ya instalado en el almacén de Windows. No se
    admite una ruta a un `.pfx` con su contraseña, y no es una omisión: desde
    2023 ninguna CA pública emite certificados de firma de código en archivo,
    porque la clave privada tiene que vivir en hardware o en un HSM.

    Para servicios que firman con su propia herramienta —Azure Trusted Signing,
    por ejemplo— está `DRUSE_SIGN_COMMAND`, que sustituye a signtool por
    completo. El marcador `{path}` se reemplaza por el archivo a firmar.

.EXAMPLE
    $env:DRUSE_SIGN_THUMBPRINT = 'a1b2c3...'
    ./build/scripts/package.ps1 -Portable

.EXAMPLE
    $env:DRUSE_SIGN_COMMAND = 'azuresigntool sign -kvu ... "{path}"'
    ./build/scripts/package.ps1
#>

<#
.SYNOPSIS
    Localiza signtool.exe dentro del SDK de Windows.
#>
function Find-SignTool {
    [CmdletBinding()]
    param()

    $existing = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue

    if ($existing) {
        return $existing.Source
    }

    # El SDK instala una carpeta por versión y conviven varias. Se ordena
    # descendente para tomar la más nueva, que es la que entiende los algoritmos
    # de firma actuales.
    $roots = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "$env:ProgramFiles\Windows Kits\10\bin"
    ) | Where-Object { Test-Path $_ }

    foreach ($root in $roots) {
        $candidate = Get-ChildItem $root -Recurse -Filter 'signtool.exe' -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\(x64|arm64)\\' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1

        if ($candidate) {
            return $candidate.FullName
        }
    }

    return $null
}

<#
.SYNOPSIS
    Firma un archivo, o varios.

.DESCRIPTION
    El sellado de tiempo no es opcional en la práctica: sin él, la firma deja de
    validar el día que caduca el certificado, y las copias ya repartidas empiezan
    a dar problemas años después de haberlas entregado.
#>
function Invoke-DruseSigning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string[]]$Path,

        [string]$Thumbprint,

        [string]$TimestampUrl = 'http://timestamp.digicert.com',

        [string]$Command
    )

    $files = @($Path | Where-Object { Test-Path $_ })

    if ($files.Count -eq 0) {
        return
    }

    if ($Command) {
        foreach ($file in $files) {
            $expanded = $Command.Replace('{path}', $file)

            Write-Host "      Firmando $(Split-Path $file -Leaf)" -ForegroundColor DarkGray
            Invoke-Expression $expanded

            if ($LASTEXITCODE -ne 0) {
                throw "Falló la firma de $file."
            }
        }

        return
    }

    $signtool = Find-SignTool

    if (-not $signtool) {
        throw @'
No se encontró signtool.exe.

Viene con el SDK de Windows, que ya instalaste junto a las Build Tools de C++.
Si no aparece, instálalo desde el Instalador de Visual Studio marcando
«Windows 10/11 SDK».
'@
    }

    foreach ($file in $files) {
        Write-Host "      Firmando $(Split-Path $file -Leaf)" -ForegroundColor DarkGray

        & $signtool sign `
            /sha1 $Thumbprint `
            /fd sha256 `
            /td sha256 `
            /tr $TimestampUrl `
            /v `
            $file | Out-Null

        if ($LASTEXITCODE -ne 0) {
            throw "Falló la firma de $file."
        }
    }
}

<#
.SYNOPSIS
    Comprueba que un archivo quedó firmado y con sello de tiempo.

.DESCRIPTION
    Se comprueba después de firmar porque signtool puede devolver éxito y dejar
    una firma que Windows no acepta —certificado sin la finalidad de firma de
    código, cadena incompleta—, y descubrirlo en el equipo del usuario es tarde.
#>
function Test-DruseSignature {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Path)

    $signature = Get-AuthenticodeSignature -FilePath $Path

    if ($signature.Status -ne 'Valid') {
        throw "La firma de $Path no es válida: $($signature.Status) — $($signature.StatusMessage)"
    }

    if (-not $signature.TimeStamperCertificate) {
        Write-Warning "$(Split-Path $Path -Leaf) quedó firmado pero sin sello de tiempo: la firma dejará de valer cuando caduque el certificado."
    }

    return $signature
}
