#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Inventario del paquete de Druse y comprobación de lo que no debe ir dentro.

.DESCRIPTION
    Dos preguntas que hasta ahora no tenían respuesta escrita: **qué archivos
    exactos salen de una construcción** y **cuáles no deberían estar ahí**.

    La primera hace falta para cualquier release verificable: quien descarga el
    instalador puede comparar su SHA-256, pero nadie —ni quien lo construyó—
    podía decir qué llevaba dentro sin abrirlo. El manifiesto lo deja anotado en
    el momento en que se genera, que es el único momento en que se sabe.

    La segunda es la que evita repartir lo que se prometió no repartir. La
    variante sin Informix se construye con `-p:IncludeInformix=false`, y eso es
    una intención: si mañana un paquete de NuGet arrastra el controlador de IBM
    por otra vía, el instalador sale igual, con el mismo nombre y 111 MB de más.
    Aquí se comprueba el resultado, no la intención.

    Las reglas viven en `build/paquete-excluidos.json` y no en este archivo a
    propósito: son una decisión de producto —qué incluye cada edición— y cambian
    sin que cambie la forma de comprobarlas. Una regla puede estar **aplicada**,
    y entonces detiene el empaquetado, o **pendiente**, y entonces solo se
    cuenta: los componentes cuyo alcance sigue sin decidirse (OSS-03 y DEC-03
    del plan de SignPath) no pueden hacer fallar una construcción por una
    decisión que nadie ha tomado todavía.

.NOTES
    Este archivo solo aporta funciones. Quien las llama es `package.ps1`.
    `build/tests/manifiesto-paquete.ps1` las ejercita sin compilar nada.
#>

<#
.SYNOPSIS
    Lista cada archivo de un directorio con su tamaño y su SHA-256.

.PARAMETER Path
    Directorio a inventariar. Se recorre entero.

.PARAMETER Prefix
    Prefijo que se antepone a la ruta relativa. Sirve para distinguir de dónde
    salió cada archivo cuando el manifiesto junta varios directorios: `api/...`
    y `bundle/...` en el mismo listado.
#>
function Get-DrusePackageInventory {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$Prefix = ''
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    $root = (Resolve-Path -LiteralPath $Path).Path

    Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
        # Barras normales en la ruta relativa: el mismo paquete se construye en
        # Windows y se revisa en otra parte, y una regla no debería depender de
        # cómo escriba las rutas el sistema que la evalúa.
        $relative = $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')

        if ($Prefix) {
            $relative = "$Prefix/$relative"
        }

        [pscustomobject]@{
            ruta   = $relative
            bytes  = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
}

<#
.SYNOPSIS
    Convierte archivos sueltos en entradas de inventario.

.DESCRIPTION
    Para los artefactos finales —el instalador, su `.sig`, el ZIP portable—, que
    no están en un directorio propio: el de bundles conserva también los de
    construcciones anteriores, y meterlos en el manifiesto de esta diría que
    salieron de aquí.

.PARAMETER Path
    Archivos a incluir. Los que no existan se omiten sin ruido: el `.sig` solo
    aparece cuando hay clave del actualizador.
#>
function Get-DruseArtifactEntries {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][string[]]$Path,
        [string]$Prefix = 'bundle'
    )

    foreach ($file in $Path) {
        if (-not $file -or -not (Test-Path -LiteralPath $file)) {
            continue
        }

        $item = Get-Item -LiteralPath $file

        [pscustomobject]@{
            ruta   = if ($Prefix) { "$Prefix/$($item.Name)" } else { $item.Name }
            bytes  = $item.Length
            sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
}

<#
.SYNOPSIS
    Lee las reglas de contenido de una variante.

.DESCRIPTION
    Devuelve las reglas de la variante pedida seguidas de las que están
    pendientes de decisión, que son comunes a todas. Cada regla conserva su
    `aplicar`, que es lo que distingue detener el empaquetado de solo anotarlo.

.PARAMETER Variant
    `completo` o `sin-informix`. Una variante que no figure en el archivo se
    queda sin reglas propias, y se avisa: es distinto de no tener ninguna.
#>
function Get-DrusePackageRules {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Variant,
        [string]$RulesFile
    )

    if (-not $RulesFile) {
        $RulesFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'paquete-excluidos.json'
    }

    if (-not (Test-Path -LiteralPath $RulesFile)) {
        throw "No se encontró el archivo de reglas de contenido: $RulesFile"
    }

    $document = Get-Content -LiteralPath $RulesFile -Raw | ConvertFrom-Json
    $rules = [System.Collections.Generic.List[object]]::new()

    $variants = $document.variantes
    $known = if ($variants) { $variants.PSObject.Properties.Name } else { @() }

    if ($known -notcontains $Variant) {
        Write-Warning "La variante '$Variant' no figura en $RulesFile; solo se evaluarán las reglas pendientes."
    }
    elseif ($variants.$Variant.reglas) {
        foreach ($rule in $variants.$Variant.reglas) { $rules.Add($rule) }
    }

    foreach ($rule in $document.pendientes_de_decision) {
        $rules.Add($rule)
    }

    return $rules.ToArray()
}

<#
.SYNOPSIS
    Compara un inventario con las reglas y devuelve lo que coincide.

.DESCRIPTION
    Devuelve una entrada por regla con coincidencias, con sus archivos. No lanza
    nada: decidir qué hacer con el resultado es de quien empaqueta, y este mismo
    resultado se escribe en el manifiesto tanto si detiene la construcción como
    si no.
#>
function Test-DrusePackageContent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Inventory,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Rules
    )

    $findings = [System.Collections.Generic.List[object]]::new()

    foreach ($rule in $Rules) {
        $matched = [System.Collections.Generic.List[string]]::new()

        foreach ($item in $Inventory) {
            $path = $item.ruta.ToLowerInvariant()

            foreach ($pattern in $rule.patrones) {
                # Tres comparaciones, y las tres hacen falta. La ruta entera es
                # la obvia. El nombre suelto reconoce `ibm.data.db2.dll` esté en
                # la raíz del paquete o en una subcarpeta del runtime. Y la
                # tercera deja que `clidriver/*` funcione sin que la regla tenga
                # que saber bajo qué prefijo se inventarió el paquete: `api/` hoy
                # y otro mañana no es una decisión de producto.
                if ($path -like $pattern -or
                    (Split-Path $path -Leaf) -like $pattern -or
                    $path -like "*/$pattern") {
                    $matched.Add($item.ruta)
                    break
                }
            }
        }

        if ($matched.Count -gt 0) {
            $findings.Add([pscustomobject]@{
                    regla    = $rule.id
                    aplicar  = [bool]$rule.aplicar
                    motivo   = $rule.motivo
                    archivos = $matched.ToArray()
                })
        }
    }

    return $findings.ToArray()
}

<#
.SYNOPSIS
    Escribe el manifiesto de una construcción.

.DESCRIPTION
    Un archivo JSON con qué se construyó, cuándo, con qué resultado de reglas y
    qué archivos salieron. Es lo que permite después comprobar que el instalador
    que se publica es el que se revisó, y lo que la candidatura a SignPath puede
    enseñar como contenido declarado del paquete.

    No lleva rutas absolutas de la máquina que compila: el manifiesto se publica,
    y el directorio de trabajo de quien empaqueta no es asunto de quien descarga.
#>
function Write-DrusePackageManifest {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Inventory,
        [Parameter(Mandatory)][string]$Variant,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$Runtime,
        [Parameter(Mandatory)][string]$Path,
        [AllowEmptyCollection()][object[]]$Findings = @(),
        [bool]$Signed = $false
    )

    $directory = Split-Path -Parent $Path

    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Force $directory | Out-Null
    }

    $manifest = [ordered]@{
        producto  = 'Druse'
        version   = $Version
        variante  = $Variant
        runtime   = $Runtime
        generado  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        firmado   = $Signed
        archivos  = $Inventory.Count
        bytes     = ($Inventory | Measure-Object -Property bytes -Sum).Sum
        # La advertencia va dentro del propio archivo: un manifiesto sin firma
        # Authenticode describe el contenido, no demuestra su procedencia.
        alcance   = 'Inventario del contenido construido en esta ejecución. No acredita licencia, procedencia ni firma de cada archivo.'
        hallazgos = $Findings
        contenido = $Inventory
    }

    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Path -Encoding UTF8

    return $Path
}
