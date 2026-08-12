#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Arranca Druse en desarrollo: la API local y el frontend Angular.

.DESCRIPTION
    Levanta Druse.Host.LocalApi en 127.0.0.1:5177 y el servidor de desarrollo de
    Angular en 127.0.0.1:4200, que redirige /api al backend mediante proxy.conf.json.

    Al cerrar el script (Ctrl+C) se detiene también la API.

.PARAMETER ApiPort
    Puerto de la API local. Por defecto 5177.

.PARAMETER SkipApi
    Arranca solo el frontend, útil si ya tienes la API corriendo en otra consola.

.EXAMPLE
    ./build/scripts/dev.ps1
#>
[CmdletBinding()]
param(
    [int]$ApiPort = 5177,
    [switch]$SkipApi
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$apiProject = Join-Path $repoRoot 'backend/src/Druse.Host.LocalApi'
$frontend = Join-Path $repoRoot 'frontend'

$apiProcess = $null

try {
    if (-not $SkipApi) {
        Write-Host "Arrancando la API local en http://127.0.0.1:$ApiPort ..." -ForegroundColor Cyan

        $env:LocalApi__Port = $ApiPort

        # La ruta va entre comillas: Start-Process une los argumentos con
        # espacios sin entrecomillarlos, así que un directorio con espacios en el
        # nombre llegaría partido a dotnet.
        $apiProcess = Start-Process -FilePath 'dotnet' `
            -ArgumentList 'run', '--project', "`"$apiProject`"" `
            -PassThru -NoNewWindow

        # Espera a que el endpoint de salud responda antes de abrir el frontend.
        $ready = $false
        foreach ($attempt in 1..40) {
            Start-Sleep -Milliseconds 500
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/api/health" `
                    -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $ready = $true; break }
            }
            catch {
                # Todavía no está lista; se reintenta.
            }
        }

        if (-not $ready) {
            throw "La API local no respondió en http://127.0.0.1:$ApiPort/api/health."
        }

        Write-Host 'API local lista.' -ForegroundColor Green
    }

    Write-Host 'Arrancando el frontend en http://127.0.0.1:4200 ...' -ForegroundColor Cyan
    Push-Location $frontend
    try {
        npm start
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Write-Host 'Deteniendo la API local...' -ForegroundColor Yellow
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
