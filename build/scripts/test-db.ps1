#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Levanta o retira el PostgreSQL desechable que usan las pruebas.

.DESCRIPTION
    Las pruebas de proveedor e integración necesitan un servidor real. Este script
    crea un contenedor aislado con datos que no importan.

    La contraseña es de usar y tirar y solo escucha en loopback: no debe
    reutilizarse para nada más ni parecerse a una credencial real (plan §11).

    Si el puerto por defecto está ocupado, pásale otro con -Port y exporta
    DRUSE_TEST_PG_PORT con el mismo valor antes de ejecutar las pruebas.

.PARAMETER Down
    Detiene y elimina el contenedor en lugar de crearlo.

.EXAMPLE
    ./build/scripts/test-db.ps1
    dotnet test backend/Druse.slnx

.EXAMPLE
    ./build/scripts/test-db.ps1 -Down
#>
[CmdletBinding()]
param(
    [int]$Port = 55440,
    [string]$Name = 'druse-pg-test',
    [string]$Image = 'postgres:18-alpine',
    [switch]$Down
)

$ErrorActionPreference = 'Stop'

if ($Down) {
    Write-Host "Eliminando el contenedor $Name..." -ForegroundColor Yellow
    docker rm -f $Name 2>$null | Out-Null
    Write-Host 'Listo.' -ForegroundColor Green
    return
}

$existing = docker ps -a --filter "name=^/$Name$" --format '{{.Names}}'

if ($existing -eq $Name) {
    Write-Host "El contenedor $Name ya existe; se reinicia." -ForegroundColor Cyan
    docker start $Name | Out-Null
}
else {
    Write-Host "Creando $Name con $Image en el puerto $Port..." -ForegroundColor Cyan

    docker run -d `
        --name $Name `
        -e POSTGRES_PASSWORD=druse_dev_only `
        -e POSTGRES_DB=druse_test `
        -p "${Port}:5432" `
        $Image | Out-Null
}

# Espera a que el servidor acepte conexiones: recién arrancado tarda un momento.
foreach ($attempt in 1..30) {
    Start-Sleep -Milliseconds 500

    docker exec $Name pg_isready -U postgres 2>$null | Out-Null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "PostgreSQL listo en 127.0.0.1:$Port" -ForegroundColor Green
        Write-Host ''
        Write-Host 'Las pruebas lo encuentran solas si usas el puerto por defecto.' -ForegroundColor DarkGray
        Write-Host 'Con otro puerto, exporta: $env:DRUSE_TEST_PG_PORT = ' -NoNewline -ForegroundColor DarkGray
        Write-Host $Port -ForegroundColor DarkGray
        return
    }
}

throw "El contenedor $Name no respondió a tiempo."
