#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Ejecuta en esta máquina lo que comprobaría la integración continua.

.DESCRIPTION
    Existe porque **la integración continua de este repositorio no se ejecuta**:
    la cuenta no tiene cuota de Actions y sus trabajos mueren antes de empezar
    con «The job was not started because recent account payments have failed or
    your spending limit needs to be increased». El workflow quedó a petición,
    así que lo único que puede decir si el árbol está sano es esta máquina.

    No es un sustituto exacto y conviene saber en qué se diferencia: aquí todo
    corre en un solo sistema —el tuyo—, mientras que el workflow recorre Windows
    y Linux. Lo que solo falla en el otro sistema, aquí no se ve.

    **Sigue hasta el final aunque algo falle.** Parar en el primer error
    obligaría a repetir veinte minutos de pruebas para descubrir el segundo; al
    terminar se resume qué pasó con cada bloque y se devuelve un código distinto
    de cero si algo no pasó.

.PARAMETER Rapido
    Omite lo que tarda: la compilación del frontend y el análisis del envoltorio.
    Para usar antes de un commit, no antes de una release.

.PARAMETER ConMotores
    Exige que los motores de prueba estén levantados (`DRUSE_REQUIRE_ENGINES=1`).
    Sin esto, las pruebas que necesitan una base se saltan solas y **una suite en
    verde no significa que se hayan comprobado**.

.PARAMETER ConE2E
    Añade las pruebas de punta a punta. Necesitan el contenedor de PostgreSQL y
    los navegadores de Playwright instalados.

.EXAMPLE
    ./build/scripts/comprobar-todo.ps1

.EXAMPLE
    ./build/scripts/test-db.ps1 -Engine postgres
    ./build/scripts/comprobar-todo.ps1 -ConMotores -ConE2E
#>
[CmdletBinding()]
param(
    [switch]$Rapido,
    [switch]$ConMotores,
    [switch]$ConE2E
)

$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resultados = [System.Collections.Generic.List[object]]::new()

# Cada bloque escribe su salida en su propio archivo. Sin esto, lo que dijo el
# que falló queda enterrado bajo miles de líneas de los que pasaron —y con la
# salida de varios procesos mezclándose entre sí—, que es justo cuando hace falta
# leerla entera.
$registros = Join-Path $repoRoot 'artifacts/comprobaciones'

if (Test-Path $registros) { Remove-Item $registros -Recurse -Force }
New-Item -ItemType Directory -Force $registros | Out-Null

<#
.SYNOPSIS
    Ejecuta un bloque, lo cronometra y anota si pasó.

.DESCRIPTION
    El código de salida de un proceso nativo no llega por excepción, así que se
    mira `$LASTEXITCODE` además de capturar los errores de PowerShell. Sin las
    dos cosas, un `dotnet test` en rojo pasaría por bueno.
#>
function Invoke-Bloque {
    param(
        [Parameter(Mandatory)][string]$Nombre,
        [Parameter(Mandatory)][scriptblock]$Bloque,
        [string]$Directorio = $repoRoot
    )

    Write-Host ''
    Write-Host "== $Nombre" -ForegroundColor Cyan

    $reloj = [Diagnostics.Stopwatch]::StartNew()
    $global:LASTEXITCODE = 0
    $fallo = $null
    $registro = Join-Path $registros ("{0}.log" -f ($Nombre -replace '[^\w]+', '-'))

    Push-Location $Directorio
    try {
        # `*>&1` junta también los avisos y el error estándar: un `npm` que se
        # queja por stderr no debe perder su queja por el camino.
        & $Bloque *>&1 | Tee-Object -FilePath $registro
        if ($LASTEXITCODE -ne 0) { $fallo = "código de salida $LASTEXITCODE" }
    }
    catch {
        $fallo = $_.Exception.Message
        $fallo | Out-File -FilePath $registro -Append
    }
    finally {
        Pop-Location
    }

    $reloj.Stop()

    $resultados.Add([pscustomobject]@{
            Bloque   = $Nombre
            Resultado = if ($fallo) { 'FALLÓ' } else { 'OK' }
            Duración = '{0:mm\:ss}' -f $reloj.Elapsed
            Motivo   = $fallo
            Registro = $registro
        })

    if ($fallo) {
        Write-Host "   FALLÓ: $fallo" -ForegroundColor Red
        Write-Host "   salida completa en: $registro" -ForegroundColor DarkGray
    }
}

Write-Host 'Comprobando Druse en esta máquina.' -ForegroundColor Cyan

if ($ConMotores) {
    # Lo mismo que hace el job de motores reales: sin esto, un motor caído deja
    # una suite verde que no comprobó nada.
    $env:DRUSE_REQUIRE_ENGINES = '1'
    Write-Host 'Se exigirá que todos los motores respondan.' -ForegroundColor DarkGray
}
else {
    $env:DRUSE_REQUIRE_ENGINES = $null
    Write-Host 'Los motores que no respondan se saltarán: esto no comprueba los proveedores.' -ForegroundColor Yellow
}

# --- Guiones de construcción -------------------------------------------------
# Van primero porque tardan un segundo y son los que deciden si un paquete se
# puede repartir.
Invoke-Bloque 'Guiones: contenido del paquete' { & "$PSScriptRoot/../tests/manifiesto-paquete.ps1" }
Invoke-Bloque 'Guiones: rechazo de un artefacto alterado' { node build/tests/verificacion-de-actualizacion.cjs }
Invoke-Bloque 'Guiones: guardas de una publicación' { & "$PSScriptRoot/../tests/release-verificacion.ps1" }
Invoke-Bloque 'Guiones: puertos de las bases de prueba' { & "$PSScriptRoot/../tests/test-db-loopback.ps1" }

# --- Backend -----------------------------------------------------------------
Invoke-Bloque 'Backend: pruebas' {
    dotnet test backend/Druse.slnx --configuration Release -m:1 --verbosity quiet `
        --results-directory artifacts/test-results --logger trx
}

Invoke-Bloque 'Backend: se ejecutaron pruebas de verdad' {
    & "$PSScriptRoot/check-tests.ps1" -ResultsDirectory artifacts/test-results -ExpectedSuites 3 -MinimumTests 800
}

# --- Frontend ----------------------------------------------------------------
Invoke-Bloque 'Frontend: formato' { npm run format:check } -Directorio (Join-Path $repoRoot 'frontend')
Invoke-Bloque 'Frontend: pruebas' { npm test } -Directorio (Join-Path $repoRoot 'frontend')

if (-not $Rapido) {
    Invoke-Bloque 'Frontend: compilación' { npm run build } -Directorio (Join-Path $repoRoot 'frontend')
}

# --- Envoltorio de escritorio ------------------------------------------------
# En Windows hay que cargar el entorno de MSVC o cargo encuentra un enlazador sin
# las librerías del SDK y falla con un mensaje que no explica la causa.
. (Join-Path $PSScriptRoot 'msvc-env.ps1')

$tauri = Join-Path $repoRoot 'shells/desktop-tauri'

Invoke-Bloque 'Envoltorio: formato' { cargo fmt --check } -Directorio $tauri
Invoke-Bloque 'Envoltorio: pruebas' { cargo test --locked } -Directorio $tauri

if (-not $Rapido) {
    Invoke-Bloque 'Envoltorio: Clippy' { cargo clippy --locked --all-targets -- -D warnings } -Directorio $tauri
}

# --- Punta a punta -----------------------------------------------------------
if ($ConE2E) {
    Invoke-Bloque 'Punta a punta' { npm test } -Directorio (Join-Path $repoRoot 'e2e')
}

# --- Resumen -----------------------------------------------------------------
Write-Host ''
Write-Host 'Resumen' -ForegroundColor Cyan
$resultados | Format-Table -AutoSize Bloque, Resultado, Duración
Write-Host "Salida de cada bloque en: $registros" -ForegroundColor DarkGray

$fallidos = @($resultados | Where-Object { $_.Resultado -eq 'FALLÓ' })

if ($fallidos.Count -gt 0) {
    Write-Host "$($fallidos.Count) bloque(s) en rojo:" -ForegroundColor Red
    $fallidos | ForEach-Object {
        Write-Host "  $($_.Bloque): $($_.Motivo)" -ForegroundColor Red
        Write-Host "    $($_.Registro)" -ForegroundColor DarkGray
    }
    exit 1
}

# Se dice lo que **no** se comprobó. Un «todo en verde» que calla las lagunas es
# la forma más cómoda de creer que el árbol está sano.
Write-Host 'Todo en verde.' -ForegroundColor Green

$lagunas = @()
if (-not $ConMotores) { $lagunas += 'los proveedores contra motores reales (-ConMotores)' }
if (-not $ConE2E) { $lagunas += 'la aplicación de punta a punta (-ConE2E)' }
if ($Rapido) { $lagunas += 'la compilación del frontend y Clippy (se omitieron con -Rapido)' }
$lagunas += 'lo que solo falla en otro sistema operativo'

Write-Host "Sin comprobar: $($lagunas -join '; ')." -ForegroundColor Yellow
