# Angular deja 3rdpartylicenses.txt fuera de browser/, que es frontendDist de Tauri.
# Los avisos se copian a api/, compartido por NSIS y portable.
function Copy-DruseFrontendNotices {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$RepoRoot,
        [Parameter(Mandatory)][string]$ApiOutput
    )
    $ErrorActionPreference = 'Stop'
    $notices = @(
        @{ source = 'frontend/dist/frontend/3rdpartylicenses.txt'; name = 'angular-3rdpartylicenses.txt' },
        @{ source = 'frontend/node_modules/monaco-editor/LICENSE'; name = 'monaco-LICENSE.txt' },
        @{ source = 'frontend/node_modules/monaco-editor/ThirdPartyNotices.txt'; name = 'monaco-ThirdPartyNotices.txt' },
        @{ source = 'frontend/node_modules/@fontsource/inter/LICENSE'; name = 'inter-LICENSE.txt' },
        @{ source = 'frontend/node_modules/@fontsource/jetbrains-mono/LICENSE'; name = 'jetbrains-mono-LICENSE.txt' }
    )
    foreach ($notice in $notices) {
        $source = Join-Path $RepoRoot $notice.source
        if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source).Length -eq 0) {
            throw "Falta el aviso del frontend: $($notice.source)"
        }
    }
    $destination = Join-Path $ApiOutput 'licenses/frontend'
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($notice in $notices) {
        $source = Join-Path $RepoRoot $notice.source
        $target = Join-Path $destination $notice.name
        Copy-Item -LiteralPath $source -Destination $target -Force
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $target).Hash) {
            throw "El aviso copiado no coincide: $($notice.name)"
        }
    }
}
