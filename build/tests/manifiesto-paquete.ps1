# Ejercita las reglas de contenido del paquete con archivos falsos: no publica
# la API, no compila nada y no toca el directorio de artefactos del repositorio.
#
# Lo que se comprueba es lo que haría fallar una release: que la variante ligera
# reconozca el controlador de IBM si reaparece, que la completa no lo rechace, y
# que lo que sigue pendiente de decisión se cuente sin detener el empaquetado.
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '../scripts/manifiesto.ps1')

$raiz = Join-Path ([IO.Path]::GetTempPath()) "druse-manifiesto-$([Guid]::NewGuid().ToString('N'))"
$paquete = Join-Path $raiz 'api'

function Nuevo-Archivo {
    param([string]$Ruta, [string]$Contenido = 'x')

    $completa = Join-Path $paquete $Ruta
    New-Item -ItemType Directory -Force (Split-Path -Parent $completa) | Out-Null
    Set-Content -LiteralPath $completa -Value $Contenido -Encoding UTF8
}

try {
    # Lo que sale hoy de una publicación real, reducido a los nombres que
    # deciden algo. Los de IBM e IKVM son los que la variante ligera no debe
    # llevar; SNI y Oracle son los que siguen sin decisión.
    Nuevo-Archivo 'Druse.Host.LocalApi.dll'
    Nuevo-Archivo 'Druse.Provider.PostgreSql.dll'
    Nuevo-Archivo 'Microsoft.Data.SqlClient.SNI.dll'
    Nuevo-Archivo 'Oracle.ManagedDataAccess.dll'
    Nuevo-Archivo 'IBM.Data.Db2.dll'
    Nuevo-Archivo 'Druse.Jdbc.dll'
    Nuevo-Archivo 'ikvm.properties'
    Nuevo-Archivo 'IKVM.Runtime.dll'
    Nuevo-Archivo 'clidriver/bin/db2app64.dll'
    Nuevo-Archivo 'ikvm/win-x64/bin/java.exe'

    $inventario = @(Get-DrusePackageInventory -Path $paquete -Prefix 'api')

    if ($inventario.Count -ne 10) {
        throw "El inventario debería listar los diez archivos creados; listó $($inventario.Count)."
    }

    if ($inventario[0].ruta -notlike 'api/*') {
        throw 'Las rutas del inventario deben conservar el prefijo y las barras normales.'
    }

    $esperado = (Get-FileHash -LiteralPath (Join-Path $paquete 'Druse.Host.LocalApi.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
    $anotado = ($inventario | Where-Object { $_.ruta -eq 'api/Druse.Host.LocalApi.dll' }).sha256

    if ($anotado -ne $esperado) {
        throw 'El SHA-256 del inventario no coincide con el del archivo.'
    }

    # --- Variante ligera: lo de IBM e IKVM detiene el empaquetado -------------
    $ligera = @(Test-DrusePackageContent -Inventory $inventario -Rules (Get-DrusePackageRules -Variant 'sin-informix'))
    $bloqueantes = @($ligera | Where-Object { $_.aplicar })

    if ($bloqueantes.Count -ne 2) {
        throw "La variante sin Informix debería bloquear por dos reglas; bloqueó por $($bloqueantes.Count)."
    }

    $archivosBloqueados = $bloqueantes.archivos

    foreach ($debe in @('api/IBM.Data.Db2.dll', 'api/clidriver/bin/db2app64.dll', 'api/ikvm.properties',
            'api/IKVM.Runtime.dll', 'api/ikvm/win-x64/bin/java.exe', 'api/Druse.Jdbc.dll')) {
        if ($archivosBloqueados -notcontains $debe) {
            throw "La variante sin Informix no reconoció $debe como excluido."
        }
    }

    if ($archivosBloqueados -contains 'api/Druse.Provider.PostgreSql.dll') {
        throw 'Una regla de Informix no puede alcanzar a un proveedor que sí va en la variante ligera.'
    }

    # --- Lo pendiente se cuenta, no bloquea ----------------------------------
    $pendientes = @($ligera | Where-Object { -not $_.aplicar })

    if ($pendientes.Count -ne 2) {
        throw "Oracle y SNI deberían aparecer como pendientes de decisión; aparecieron $($pendientes.Count)."
    }

    # --- Variante completa: nada de esto la detiene ---------------------------
    $completa = @(Test-DrusePackageContent -Inventory $inventario -Rules (Get-DrusePackageRules -Variant 'completo'))

    if (@($completa | Where-Object { $_.aplicar }).Count -ne 0) {
        throw 'La variante completa no debe bloquearse por los componentes que sí distribuye.'
    }

    # --- Avisos legales ------------------------------------------------------
    # El paquete de arriba no los lleva, y eso es justo lo que debe detectarse.
    $sinAvisos = @(Test-DruseRequiredNotices -Inventory $inventario)

    if ($sinAvisos.Count -ne 3) {
        throw "Un paquete sin avisos debería dar tres ausencias; dio $($sinAvisos.Count)."
    }

    $avisos = @(Get-DruseRequiredNotices)

    foreach ($aviso in $avisos) {
        if (-not (Test-Path -LiteralPath $aviso.origen -PathType Leaf)) {
            throw "El origen de $($aviso.ruta) no existe en el repositorio."
        }

        Copy-Item -LiteralPath $aviso.origen -Destination (Join-Path $raiz $aviso.ruta) -Force
    }

    $conAvisos = @(Get-DrusePackageInventory -Path $paquete -Prefix 'api')

    if (@(Test-DruseRequiredNotices -Inventory $conAvisos).Count -ne 0) {
        throw 'Con los tres avisos copiados del repositorio no debería faltar nada.'
    }

    # Mismo nombre, otro contenido: la copia de una construcción anterior.
    Add-Content -LiteralPath (Join-Path $raiz 'api/COPYRIGHT-Druse.txt') -Value 'editado' -Encoding UTF8
    $viejo = @(Test-DruseRequiredNotices -Inventory @(Get-DrusePackageInventory -Path $paquete -Prefix 'api'))

    if ($viejo.Count -ne 1 -or $viejo[0] -notmatch 'COPYRIGHT-Druse\.txt no coincide') {
        throw "Un aviso con otro contenido debería detectarse como tal; resultado: $($viejo -join '; ')"
    }

    # Las reglas de exclusión no deben tocar los avisos en ninguna variante.
    foreach ($variante in @('completo', 'sin-informix')) {
        $alcanzados = @(Test-DrusePackageContent -Inventory $conAvisos -Rules (Get-DrusePackageRules -Variant $variante)).archivos

        foreach ($aviso in $avisos) {
            if ($alcanzados -contains $aviso.ruta) {
                throw "Una regla de la variante $variante alcanza al aviso $($aviso.ruta)."
            }
        }
    }

    # --- Manifiesto -----------------------------------------------------------
    $destino = Join-Path $raiz 'manifiesto.json'

    Write-DrusePackageManifest `
        -Inventory $inventario `
        -Variant 'sin-informix' `
        -Version '1.1.0' `
        -Runtime 'win-x64' `
        -Path $destino `
        -Findings $ligera `
        -Signed $false | Out-Null

    $documento = Get-Content -LiteralPath $destino -Raw | ConvertFrom-Json

    if ($documento.archivos -ne 10 -or $documento.variante -ne 'sin-informix' -or $documento.firmado -ne $false) {
        throw 'El manifiesto no describe la construcción que se le pasó.'
    }

    if ($documento.contenido.Count -ne 10 -or -not $documento.hallazgos) {
        throw 'El manifiesto debe conservar el contenido y los hallazgos, no solo el resumen.'
    }

    # Un manifiesto con la ruta de la máquina que compiló acabaría publicado.
    if ((Get-Content -LiteralPath $destino -Raw) -match [Regex]::Escape($raiz)) {
        throw 'El manifiesto no debe contener rutas absolutas de la máquina que empaqueta.'
    }

    'OK: inventario con SHA-256, exclusiones de la variante ligera, pendientes contados, avisos legales ausentes o viejos detectados y manifiesto sin rutas locales.'
}
finally {
    Remove-Item -LiteralPath $raiz -Recurse -Force -ErrorAction SilentlyContinue
}
