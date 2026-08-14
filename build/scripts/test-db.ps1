#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Levanta o retira los motores desechables que usan las pruebas.

.DESCRIPTION
    Las pruebas de proveedor e integración necesitan servidores reales. Este
    script crea contenedores aislados con datos que no importan.

    Las contraseñas son de usar y tirar y solo escuchan en loopback: no deben
    reutilizarse para nada más ni parecerse a credenciales reales (plan §11).

    Si un puerto está ocupado, pásale otro y exporta la variable correspondiente
    antes de ejecutar las pruebas (DRUSE_TEST_PG_PORT, DRUSE_TEST_MSSQL_PORT,
    DRUSE_TEST_MYSQL_PORT).

.PARAMETER Engine
    Qué motor levantar: postgres, sqlserver, mysql o all (por defecto).

.PARAMETER Down
    Detiene y elimina los contenedores en lugar de crearlos.

.EXAMPLE
    ./build/scripts/test-db.ps1
    dotnet test backend/Druse.slnx

.EXAMPLE
    ./build/scripts/test-db.ps1 -Engine sqlserver

.EXAMPLE
    ./build/scripts/test-db.ps1 -Down
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'postgres', 'sqlserver', 'mysql')]
    [string]$Engine = 'all',

    [int]$PostgresPort = 55440,
    [int]$SqlServerPort = 14433,
    [int]$MySqlPort = 33306,
    [switch]$Down
)

$ErrorActionPreference = 'Stop'

$PostgresName = 'druse-pg-test'
$SqlServerName = 'druse-mssql-test'
$MySqlName = 'druse-mysql-test'

function Remove-Container([string]$Name) {
    Write-Host "Eliminando $Name..." -ForegroundColor Yellow
    docker rm -f $Name 2>$null | Out-Null
}

if ($Down) {
    if ($Engine -in 'all', 'postgres') { Remove-Container $PostgresName }
    if ($Engine -in 'all', 'sqlserver') { Remove-Container $SqlServerName }
    if ($Engine -in 'all', 'mysql') { Remove-Container $MySqlName }

    Write-Host 'Listo.' -ForegroundColor Green
    return
}

function Test-ContainerExists([string]$Name) {
    return (docker ps -a --filter "name=^/$Name$" --format '{{.Names}}') -eq $Name
}

# --- PostgreSQL -------------------------------------------------------------
if ($Engine -in 'all', 'postgres') {
    if (Test-ContainerExists $PostgresName) {
        Write-Host "$PostgresName ya existe; se reinicia." -ForegroundColor Cyan
        docker start $PostgresName | Out-Null
    }
    else {
        Write-Host "Creando $PostgresName en el puerto $PostgresPort..." -ForegroundColor Cyan

        docker run -d `
            --name $PostgresName `
            -e POSTGRES_PASSWORD=druse_dev_only `
            -e POSTGRES_DB=druse_test `
            -p "${PostgresPort}:5432" `
            postgres:18-alpine | Out-Null
    }

    $ready = $false

    foreach ($attempt in 1..40) {
        Start-Sleep -Milliseconds 500
        docker exec $PostgresName pg_isready -U postgres 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }

    if ($ready) {
        $secondary = docker exec $PostgresName psql -U postgres -d postgres -tAc `
            "SELECT 1 FROM pg_database WHERE datname = 'druse_test_secondary'" 2>$null

        if ($secondary -notcontains '1') {
            docker exec $PostgresName createdb -U postgres druse_test_secondary 2>$null
        }

        Write-Host "  PostgreSQL listo en 127.0.0.1:$PostgresPort" -ForegroundColor Green
    }
    else {
        throw "$PostgresName no respondió a tiempo."
    }
}

# --- SQL Server -------------------------------------------------------------
if ($Engine -in 'all', 'sqlserver') {
    if (Test-ContainerExists $SqlServerName) {
        Write-Host "$SqlServerName ya existe; se reinicia." -ForegroundColor Cyan
        docker start $SqlServerName | Out-Null
    }
    else {
        Write-Host "Creando $SqlServerName en el puerto $SqlServerPort..." -ForegroundColor Cyan
        Write-Host '  (la imagen ocupa ~1,5 GB y el primer arranque tarda)' -ForegroundColor DarkGray

        docker run -d `
            --name $SqlServerName `
            -e 'ACCEPT_EULA=Y' `
            -e 'MSSQL_SA_PASSWORD=Druse_dev_only_1' `
            -e 'MSSQL_PID=Developer' `
            -p "${SqlServerPort}:1433" `
            mcr.microsoft.com/mssql/server:2022-latest | Out-Null
    }

    # SQL Server tarda bastante más que PostgreSQL en aceptar conexiones.
    $ready = $false

    foreach ($attempt in 1..90) {
        Start-Sleep -Seconds 1

        docker exec $SqlServerName /opt/mssql-tools18/bin/sqlcmd `
            -S localhost -U sa -P 'Druse_dev_only_1' -C -Q 'SELECT 1' 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }

    if (-not $ready) {
        throw "$SqlServerName no respondió a tiempo."
    }

    # La base no se crea sola, a diferencia de POSTGRES_DB.
    docker exec $SqlServerName /opt/mssql-tools18/bin/sqlcmd `
        -S localhost -U sa -P 'Druse_dev_only_1' -C `
        -Q "IF DB_ID('druse_test') IS NULL CREATE DATABASE druse_test; IF DB_ID('druse_test_secondary') IS NULL CREATE DATABASE druse_test_secondary;" 2>$null | Out-Null

    Write-Host "  SQL Server listo en 127.0.0.1:$SqlServerPort" -ForegroundColor Green
}

# --- MySQL ------------------------------------------------------------------
if ($Engine -in 'all', 'mysql') {
    if (Test-ContainerExists $MySqlName) {
        Write-Host "$MySqlName ya existe; se reinicia." -ForegroundColor Cyan
        docker start $MySqlName | Out-Null
    }
    else {
        Write-Host "Creando $MySqlName en el puerto $MySqlPort..." -ForegroundColor Cyan

        docker run -d `
            --name $MySqlName `
            -e MYSQL_ROOT_PASSWORD=druse_dev_only `
            -e MYSQL_DATABASE=druse_test `
            -p "${MySqlPort}:3306" `
            mysql:8.4 | Out-Null
    }

    $ready = $false

    foreach ($attempt in 1..60) {
        Start-Sleep -Seconds 1
        docker exec $MySqlName mysqladmin ping -uroot -pdruse_dev_only 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }

    if ($ready) {
        docker exec $MySqlName mysql -uroot -pdruse_dev_only `
            -e 'CREATE DATABASE IF NOT EXISTS druse_test_secondary;' 2>$null | Out-Null

        Write-Host "  MySQL listo en 127.0.0.1:$MySqlPort" -ForegroundColor Green
    }
    else {
        throw "$MySqlName no respondió a tiempo."
    }
}

Write-Host ''
Write-Host 'Las pruebas encuentran los motores solas si usas los puertos por defecto.' -ForegroundColor DarkGray
Write-Host 'Para exigir que todos estén disponibles: $env:DRUSE_REQUIRE_ENGINES = 1' -ForegroundColor DarkGray
