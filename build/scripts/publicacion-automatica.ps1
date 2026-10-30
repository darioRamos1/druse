. (Join-Path $PSScriptRoot 'verificacion-release.ps1')

# Ambos workflows pueden terminar en cualquier orden. El primero conserva las
# descargas anteriores; el segundo publica solo si los dos validaron ese SHA.
function Get-DruseDecisionPublicacion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Repository,
        [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Commit,
        [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
        [switch]$Automatica
    )

    if ($Automatica) {
        $main = Get-DruseCompatibilidadMain -Repository $Repository -Commit $Commit -Version $Version
        if (-not $main.compatible) {
            return @{ publicar = $false; detalle = $main.detalle }
        }
    }

    foreach ($workflow in @('ci.yml', 'comunidad.yml')) {
        $result = Get-DruseEstadoCI -Repository $Repository -Commit $Commit -Workflow $workflow
        if (-not $result.verde) {
            if (-not $Automatica) { throw $result.detalle }
            return @{ publicar = $false; detalle = "Se conservan las descargas anteriores: $($result.detalle)." }
        }
    }

    $response = gh api "repos/$Repository/releases?per_page=100" --paginate --slurp
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar si esta versión ya está publicada.' }
    $pages = $response | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $pages -or $pages -isnot [array]) { throw 'Respuesta de releases inválida.' }
    $existing = @($pages | ForEach-Object { $_ } | Where-Object { $_.tag_name -eq "v$Version" })
    if ($existing.Count) {
        if (@($existing | Where-Object draft).Count) {
            throw "La versión $Version tiene un borrador pendiente. Revisa sus archivos en GitHub antes de publicarlo o retirarlo; no se reemplaza automáticamente."
        }
        if (-not $Automatica) { throw "La versión $Version ya existe. No se reemplazan sus instaladores; sube la versión para publicar otro ajuste." }
        return @{ publicar = $false; detalle = "La versión $Version ya existe; se conservan sus archivos." }
    }

    return @{ publicar = $true; detalle = "La versión $Version tiene CI y Comunidad satisfactorios para $Commit." }
}
