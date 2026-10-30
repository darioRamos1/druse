#!/usr/bin/env pwsh
# El runtime oficial intenta cargar este proveedor con dlopen y permite que no
# exista: sólo habilita PerfCollect/LTTng, no la API ni EventPipe/dotnet-trace.
# https://github.com/dotnet/runtime/blob/v10.0.13/src/coreclr/pal/src/misc/tracepointprovider.cpp#L109-L113
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

if (-not $IsLinux) { throw 'Esta preparación corresponde únicamente al paquete Linux.' }
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$apiPath = Join-Path $repoRoot 'shells/desktop-tauri/api'
foreach ($required in @('Druse.Host.LocalApi', 'libcoreclr.so', 'Druse.Host.LocalApi.runtimeconfig.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $apiPath $required) -PathType Leaf)) {
        throw "La API autocontenida de Linux está incompleta: falta $required."
    }
}

# El NuGet usa LTTng ABI 0 y Ubuntu 24.04 proporciona ABI 1, incompatible.
# linuxdeploy 659c9db inspecciona todo ELF existente antes de sus exclusiones;
# no puede dejar esta dependencia opcional sin resolver dentro de DEB/AppImage.
# Se omite este único proveedor de ambos formatos, sin tocar el resto del CLR.
$traceProvider = Join-Path $apiPath 'libcoreclrtraceptprovider.so'
if (Test-Path -LiteralPath $traceProvider) { Remove-Item -LiteralPath $traceProvider -Force }

& (Join-Path $repoRoot 'build/tests/api-publicada.ps1') -ApiPath $apiPath -Port 5199
