# Recoge evidencia local; no aprueba licencias, restaura paquetes ni publica archivos.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$inventory = Import-Csv -LiteralPath (Join-Path $repoRoot 'docs/licencias-dependencias.csv')
$nugetRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE '.nuget/packages' }
$mavenRoot = Join-Path $env:USERPROFILE '.m2/repository'
$outputDir = Join-Path $repoRoot ('artifacts/open-source-audit/controladores-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $outputDir | Out-Null
$evidence = [System.Collections.Generic.List[object]]::new()

function Get-InventoryVersion([string]$Component) {
    $versions = @($inventory | Where-Object component -EQ $Component | Select-Object -ExpandProperty version -Unique)
    if ($versions.Count -ne 1 -or $versions[0] -notmatch '^[0-9][0-9A-Za-z.+-]*$') {
        throw "Versión ausente o ambigua en inventario: $Component"
    }
    return $versions[0]
}

function Save-Evidence([string]$Component, [string]$Version, [string]$Root, [string]$Relative, [string]$Destination) {
    $source = Join-Path $Root $Relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Falta la evidencia: $Component/$Version/$Relative" }
    $target = Join-Path $outputDir $Destination
    Copy-Item -LiteralPath $source -Destination $target
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'La copia no coincide.' }
    $evidence.Add([pscustomobject]@{ componente = $Component; version = $Version; origen = $Relative.Replace('\', '/'); archivo = $Destination; sha256 = $hash })
}

$oracleVersion = Get-InventoryVersion 'Oracle.ManagedDataAccess.Core'
$ibmVersion = Get-InventoryVersion 'Net.IBM.Data.Db2'
$sniVersion = Get-InventoryVersion 'Microsoft.Data.SqlClient.SNI.runtime'
$jdbcVersion = Get-InventoryVersion 'com.ibm.informix:jdbc'
Save-Evidence 'Oracle.ManagedDataAccess.Core' $oracleVersion $nugetRoot "oracle.manageddataaccess.core/$oracleVersion/LICENSE.txt" 'oracle-LICENSE.txt'
Save-Evidence 'Microsoft.Data.SqlClient.SNI.runtime' $sniVersion $nugetRoot "microsoft.data.sqlclient.sni.runtime/$sniVersion/LICENSE.txt" 'sni-LICENSE.txt'
foreach ($entry in @(
    @('Lic_en.txt', 'ibm-Lic_en.txt'),
    @('REDIST.txt', 'ibm-REDIST.txt'),
    @('buildTransitive/clidriver/license/odbc_REDIST.txt', 'ibm-odbc-REDIST.txt'),
    @('buildTransitive/clidriver/license/odbc_notices.rtf', 'ibm-odbc-notices.rtf'),
    @('buildTransitive/clidriver/license/Windows/odbc_LI_en.rtf', 'ibm-odbc-LI-en.rtf')
)) {
    Save-Evidence 'Net.IBM.Data.Db2' $ibmVersion $nugetRoot "net.ibm.data.db2/$ibmVersion/$($entry[0])" $entry[1]
}
$jdbcBase = "com/ibm/informix/jdbc/$jdbcVersion/jdbc-$jdbcVersion"
Save-Evidence 'com.ibm.informix:jdbc' $jdbcVersion $mavenRoot "$jdbcBase.pom" 'informix-jdbc.pom'
$jarPath = Join-Path $mavenRoot "$jdbcBase.jar"
$jar = [IO.Compression.ZipFile]::OpenRead($jarPath)
try {
    $jarNotices = @($jar.Entries | Where-Object FullName -Match '(?i)licen[cs]e|notice|copying|copyright' | Select-Object -ExpandProperty FullName)
    $jarEntries = $jar.Entries.Count
} finally { $jar.Dispose() }
[xml]$pom = Get-Content -LiteralPath (Join-Path $mavenRoot "$jdbcBase.pom") -Raw
$redistNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($redist in @('ibm-REDIST.txt', 'ibm-odbc-REDIST.txt')) {
    foreach ($line in Get-Content -LiteralPath (Join-Path $outputDir $redist)) {
        [void]$redistNames.Add($line.Trim())
    }
}
$apiDir = Join-Path $repoRoot 'shells/desktop-tauri/api'
$ibmFiles = @()
$cliDir = Join-Path $apiDir 'clidriver'
if (Test-Path -LiteralPath $cliDir -PathType Container) { $ibmFiles += @(Get-ChildItem -LiteralPath $cliDir -Recurse -File) }
$providerFile = Join-Path $apiDir 'IBM.Data.Db2.dll'
if (Test-Path -LiteralPath $providerFile -PathType Leaf) { $ibmFiles += Get-Item -LiteralPath $providerFile }
$ibmComparison = @($ibmFiles | ForEach-Object {
    [pscustomobject]@{
        archivo = [IO.Path]::GetRelativePath($apiDir, $_.FullName).Replace('\', '/')
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        coincideNombreEnRedist = $redistNames.Contains($_.Name)
    }
})
$result = [ordered]@{
    fecha = [DateTimeOffset]::UtcNow.ToString('o')
    estado = 'EVIDENCIA RECOGIDA; REDISTRIBUCION Y SIGNPATH PENDIENTES'
    archivos = @($evidence.ToArray())
    jdbc = @{ version = $jdbcVersion; sha256Jar = (Get-FileHash -LiteralPath $jarPath -Algorithm SHA256).Hash.ToLowerInvariant(); entradas = $jarEntries; avisosPorNombre = $jarNotices; urlLicenciaPom = [string]$pom.project.licenses.license.url }
    ibmPaqueteLocal = @{ archivos = $ibmComparison; total = $ibmComparison.Count; sinCoincidenciaDeNombre = @($ibmComparison | Where-Object { -not $_.coincideNombreEnRedist }).Count }
    limites = @('Lee caches locales conforme al inventario, no restaura ni valida una nueva compilación.', 'Los hashes identifican evidencia; no acreditan autoría ni permiso de redistribución.', 'La búsqueda de avisos en el JAR usa nombres de entradas, no analiza todo el contenido.', 'IBM se contrasta por nombre de archivo con ambas listas REDIST, sin validar versión, plataforma o términos. Una coincidencia no aprueba su redistribución; una ausencia pide revisión, no prueba infracción.', 'El directorio api existente puede ser de una construcción anterior o de la variante sin Informix.', 'No incluye valores de credenciales ni rutas personales en el manifiesto.')
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputDir 'evidencia.json') -Encoding utf8
Write-Output "OK: $($evidence.Count) documentos copiados y verificados; $($jarNotices.Count) avisos identificados por nombre en el JAR."
Write-Output "IBM: $($ibmComparison.Count) archivos locales contrastados; $($result.ibmPaqueteLocal.sinCoincidenciaDeNombre) sin coincidencia por nombre en REDIST."
Write-Output "Evidencia local: $outputDir"
