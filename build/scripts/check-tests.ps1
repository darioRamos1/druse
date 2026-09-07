<#
.SYNOPSIS
    Comprueba que una pasada de `dotnet test` ejecutó pruebas de verdad.

.DESCRIPTION
    Desde el SDK 10.0.400, `dotnet test` sobre una solución termina en verde sin
    ejecutar nada si los proyectos de pruebas no se declaran como tales. El check
    queda igual de verde que cuando todo pasó, y esa es la peor forma de fallar:
    nadie mira un job que no se queja.

    Este script lee los informes TRX que dejó la pasada y falla cuando no hay
    ninguno, cuando ninguno ejecutó pruebas o cuando el total no llega al mínimo
    esperado. También imprime el recuento por suite, que es lo que se quiere ver
    en el resumen del job.

.PARAMETER ResultsDirectory
    Directorio donde `dotnet test --results-directory` dejó los TRX.

.PARAMETER MinimumTests
    Mínimo de pruebas ejecutadas que se considera aceptable. Por debajo de esa
    cifra el script falla aunque haya informes: sirve para detectar que una suite
    entera dejó de descubrirse.

.PARAMETER ExpectedSuites
    Cantidad de informes TRX que deben existir, uno por proyecto de pruebas.
    Cero desactiva la comprobación.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResultsDirectory,

    [int]$MinimumTests = 1,

    [int]$ExpectedSuites = 0
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ResultsDirectory)) {
    throw "No existe el directorio de resultados '$ResultsDirectory'. La pasada de pruebas no llegó a escribir nada."
}

$informes = @(Get-ChildItem -LiteralPath $ResultsDirectory -Filter '*.trx' -Recurse -File)

if ($informes.Count -eq 0) {
    throw "No se encontró ningún informe TRX en '$ResultsDirectory'. 'dotnet test' no ejecutó ninguna suite."
}

$totalEjecutadas = 0
$totalFallidas = 0
$vacias = @()

foreach ($informe in $informes) {
    [xml]$xml = Get-Content -LiteralPath $informe.FullName -Raw
    $contadores = $xml.TestRun.ResultSummary.Counters

    # El nombre del TRX solo lleva usuario, máquina y hora, así que no dice de
    # qué suite es. El ensamblado sí: viene en el 'storage' de cualquier prueba.
    $ensamblado = $xml.TestRun.TestDefinitions.UnitTest |
        Select-Object -First 1 -ExpandProperty storage -ErrorAction SilentlyContinue
    $suite = if ($ensamblado) { Split-Path -Leaf $ensamblado } else { $informe.Name }

    # `executed` cuenta las que llegaron a correr; `total` incluye las omitidas.
    $ejecutadas = [int]$contadores.executed
    $fallidas = [int]$contadores.failed
    $total = [int]$contadores.total

    $totalEjecutadas += $ejecutadas
    $totalFallidas += $fallidas

    # Se mira el total y no las ejecutadas: una suite puede estar entera omitida
    # por falta de motores, y eso es legítimo. Lo que nunca lo es: que un
    # proyecto de pruebas no descubra ni una.
    if ($total -eq 0) {
        $vacias += $informe.Name
    }

    $omitidas = $total - $ejecutadas
    Write-Host ("{0}: {1} ejecutadas, {2} fallidas, {3} omitidas" -f $suite, $ejecutadas, $fallidas, $omitidas)
}

Write-Host ''
Write-Host ("Suites con informe: {0}" -f $informes.Count)
Write-Host ("Pruebas ejecutadas: {0}" -f $totalEjecutadas)
Write-Host ("Pruebas fallidas:   {0}" -f $totalFallidas)

if ($env:GITHUB_STEP_SUMMARY) {
    $resumen = @(
        '### Pruebas ejecutadas',
        '',
        "- Suites con informe: $($informes.Count)",
        "- Pruebas ejecutadas: $totalEjecutadas",
        "- Pruebas fallidas: $totalFallidas"
    ) -join "`n"
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $resumen
}

if ($ExpectedSuites -gt 0 -and $informes.Count -lt $ExpectedSuites) {
    throw "Se esperaban $ExpectedSuites informes TRX y solo hay $($informes.Count). Alguna suite dejó de descubrirse."
}

if ($vacias.Count -gt 0) {
    throw "Estos informes no descubrieron ninguna prueba: $($vacias -join ', ')."
}

if ($totalEjecutadas -lt $MinimumTests) {
    throw "Se ejecutaron $totalEjecutadas pruebas y el mínimo aceptable es $MinimumTests. Se descubrieron menos suites de las que hay."
}

Write-Host ''
Write-Host 'La pasada ejecutó pruebas de verdad.'
