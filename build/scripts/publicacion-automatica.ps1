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
        $main = gh api "repos/$Repository/commits/main" --jq '.sha'
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar el commit actual de main.' }
        if ($main.Trim() -ne $Commit) {
            $config = gh api "repos/$Repository/contents/shells/desktop-tauri/tauri.conf.json?ref=$($main.Trim())" --jq '.content'
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar la versión actual de main.' }
            $mainVersion = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($config -join '').Trim())) | ConvertFrom-Json).version
            if ($mainVersion -ne $Version) {
                return @{ publicar = $false; detalle = 'main ya tiene otra versión; se espera su comprobación.' }
            }
            # Un ajuste solo de la web o de documentación no inicia CI otra vez.
            # No debe cancelar una versión cuyo código ya terminó de validarse.
            $comparison = gh api "repos/$Repository/compare/$Commit...$($main.Trim())" --jq '.status'
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar que el commit pertenece al historial de main.' }
            if ($comparison.Trim() -notin @('ahead', 'identical')) {
                return @{ publicar = $false; detalle = 'El commit comprobado ya no pertenece al historial actual de main.' }
            }
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
