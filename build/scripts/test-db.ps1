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
    DRUSE_TEST_MYSQL_PORT, DRUSE_TEST_ORACLE_PORT).

.PARAMETER Engine
    Qué motor levantar: postgres, sqlserver, mysql, oracle, informix o all
    (por defecto).

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
    [ValidateSet('all', 'postgres', 'sqlserver', 'mysql', 'oracle', 'informix')]
    [string]$Engine = 'all',

    [int]$PostgresPort = 55440,
    [int]$SqlServerPort = 14433,
    [int]$MySqlPort = 33306,
    [int]$OraclePort = 15210,
    [int]$InformixPort = 9089,
    [int]$InformixSqliPort = 9088,
    [switch]$Down
)

$ErrorActionPreference = 'Stop'

<#
    La contraseña de estos contenedores, en un solo sitio.

    Es de usar y tirar y solo escucha en loopback, pero estaba escrita a mano en
    once líneas: repetirla invita a copiarla a otro sitio, y el analizador la
    señala cada vez que la ve pegada a un `mysql -p`. Aquí se declara una vez y
    se puede cambiar con DRUSE_TEST_PASSWORD sin tocar el script.

    SQL Server exige mayúsculas, minúsculas, número y longitud mínima, así que
    la suya se deriva de la misma en lugar de ser otra distinta que recordar.
#>
$DevPassword = if ($env:DRUSE_TEST_PASSWORD) { $env:DRUSE_TEST_PASSWORD } else { 'druse_dev_only' }
$SqlServerPassword = if ($env:DRUSE_TEST_MSSQL_PASSWORD) {
    $env:DRUSE_TEST_MSSQL_PASSWORD
}
else {
    "$($DevPassword.Substring(0, 1).ToUpperInvariant())$($DevPassword.Substring(1))_1"
}

$PostgresName = 'druse-pg-test'
$SqlServerName = 'druse-mssql-test'
$MySqlName = 'druse-mysql-test'
$OracleName = 'druse-oracle-test'
$InformixName = 'druse-informix-test'

function Remove-Container([string]$Name) {
    Write-Host "Eliminando $Name..." -ForegroundColor Yellow
    docker rm -f $Name 2>$null | Out-Null
}

if ($Down) {
    if ($Engine -in 'all', 'postgres') { Remove-Container $PostgresName }
    if ($Engine -in 'all', 'sqlserver') { Remove-Container $SqlServerName }
    if ($Engine -in 'all', 'mysql') { Remove-Container $MySqlName }
    if ($Engine -in 'all', 'oracle') { Remove-Container $OracleName }
    if ($Engine -in 'all', 'informix') { Remove-Container $InformixName }

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
            -e POSTGRES_PASSWORD=$DevPassword `
            -e POSTGRES_DB=druse_test `
            -p "127.0.0.1:${PostgresPort}:5432" `
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

        # Las dos tablas que las pruebas de punta a punta dan por hechas.
        #
        # No las creaba nadie: se escribieron a mano en el contenedor en su día y
        # se fueron con él. Quien levantaba los motores de cero se encontraba con
        # el autocompletado tras un alias en rojo y el barrido de capturas parado
        # en el diagrama, que quedaba sin nada que dibujar.
        #
        # `id_ciudad` apunta a `accionista` —que no tiene sentido de negocio, pero
        # es lo que las pruebas escriben— y de paso da una relación que dibujar.
        $semilla = @(
            'CREATE TABLE IF NOT EXISTS accionista (id integer PRIMARY KEY, nombre text NOT NULL, participacion numeric(5,2))',
            'CREATE TABLE IF NOT EXISTS ciudad (id integer PRIMARY KEY, nombre text NOT NULL, poblacion integer, id_ciudad integer REFERENCES accionista (id))',
            # Para las bases que ya existían de antes: sin esto, el autocompletado
            # tras un alias no tiene ninguna columna que solo sea de `ciudad`, que
            # es justo lo que esa prueba comprueba.
            'ALTER TABLE ciudad ADD COLUMN IF NOT EXISTS poblacion integer',
            "INSERT INTO accionista (id, nombre, participacion) VALUES (1, 'Ana', 51.00), (2, 'Bea', 49.00) ON CONFLICT DO NOTHING",
            "INSERT INTO ciudad (id, nombre, poblacion, id_ciudad) VALUES (1, 'Guadalajara', 1495189, 1), (2, 'Monterrey', 1142994, 2) ON CONFLICT DO NOTHING",
            "UPDATE ciudad SET poblacion = 1495189 WHERE id = 1 AND poblacion IS NULL",
            "UPDATE ciudad SET poblacion = 1142994 WHERE id = 2 AND poblacion IS NULL"
        )

        foreach ($sentencia in $semilla) {
            docker exec $PostgresName psql -U postgres -d druse_test -v ON_ERROR_STOP=1 -c $sentencia | Out-Null
        }

        Write-Host "  PostgreSQL listo en 127.0.0.1:$PostgresPort, con accionista y ciudad dentro" -ForegroundColor Green
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
            -e "MSSQL_SA_PASSWORD=$SqlServerPassword" `
            -e 'MSSQL_PID=Developer' `
            -p "127.0.0.1:${SqlServerPort}:1433" `
            mcr.microsoft.com/mssql/server:2022-latest | Out-Null
    }

    # SQL Server tarda bastante más que PostgreSQL en aceptar conexiones.
    $ready = $false

    foreach ($attempt in 1..90) {
        Start-Sleep -Seconds 1

        docker exec $SqlServerName /opt/mssql-tools18/bin/sqlcmd `
            -S localhost -U sa -P "$SqlServerPassword" -C -Q 'SELECT 1' 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }

    if (-not $ready) {
        throw "$SqlServerName no respondió a tiempo."
    }

    # La base no se crea sola, a diferencia de POSTGRES_DB.
    docker exec $SqlServerName /opt/mssql-tools18/bin/sqlcmd `
        -S localhost -U sa -P "$SqlServerPassword" -C `
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
            -e MYSQL_ROOT_PASSWORD=$DevPassword `
            -e MYSQL_DATABASE=druse_test `
            -p "127.0.0.1:${MySqlPort}:3306" `
            mysql:8.4 | Out-Null
    }

    $ready = $false

    foreach ($attempt in 1..60) {
        Start-Sleep -Seconds 1
        docker exec $MySqlName mysqladmin ping -uroot "-p$DevPassword" 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }

    if ($ready) {
        docker exec $MySqlName mysql -uroot "-p$DevPassword" `
            -e 'CREATE DATABASE IF NOT EXISTS druse_test_secondary;' 2>$null | Out-Null

        Write-Host "  MySQL listo en 127.0.0.1:$MySqlPort" -ForegroundColor Green
    }
    else {
        throw "$MySqlName no respondió a tiempo."
    }
}

# --- Oracle -----------------------------------------------------------------
if ($Engine -in 'all', 'oracle') {
    if (Test-ContainerExists $OracleName) {
        Write-Host "$OracleName ya existe; se reinicia." -ForegroundColor Cyan
        docker start $OracleName | Out-Null
    }
    else {
        Write-Host "Creando $OracleName en el puerto $OraclePort..." -ForegroundColor Cyan
        Write-Host '  (la imagen ocupa ~2 GB y el primer arranque tarda un par de minutos)' -ForegroundColor DarkGray

        # La imagen de `gvenzl` y no la oficial de Oracle: pesa la mitad, arranca
        # sola y no exige aceptar una licencia a mano en el registro.
        docker run -d `
            --name $OracleName `
            -e ORACLE_PASSWORD=$DevPassword `
            -e APP_USER=druse `
            -e APP_USER_PASSWORD=$DevPassword `
            -p "127.0.0.1:${OraclePort}:1521" `
            gvenzl/oracle-free:slim | Out-Null
    }

    # Oracle es el que más tarda de los cinco: la primera vez crea la base.
    $ready = $false

    foreach ($attempt in 1..180) {
        Start-Sleep -Seconds 1

        docker exec $OracleName bash -lc "echo 'SELECT 1 FROM DUAL;' | sqlplus -s system/$DevPassword@localhost/FREEPDB1" 2>$null | Out-Null

        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    }

    if (-not $ready) {
        throw "$OracleName no respondió a tiempo."
    }

    # El segundo esquema y los permisos que pide el contrato.
    #
    # Los `ANY` son para que el usuario de pruebas pueda crear y borrar en el
    # segundo esquema, que es lo que comprueba la navegación entre esquemas. En
    # una instalación de verdad nadie los tiene, y no hacen falta: solo esta
    # prueba trabaja fuera de su propio esquema.
    #
    # `SELECT ANY SEQUENCE` no es de más: una columna de identidad crea por
    # detrás una secuencia, y sin poder leerla el `CREATE TABLE` en el otro
    # esquema falla con `ORA-41900`.
    #
    # El guion va en comillas simples para que PL/SQL conserve sus `$` y sus
    # comillas tal cual; la contraseña se mete después, por su marca, en lugar
    # de convertirlo en un here-string expandido donde cualquier `$` del SQL
    # pasaría a ser una variable de PowerShell.
    $preparacion = @'
DECLARE
  ya NUMBER;
BEGIN
  SELECT COUNT(*) INTO ya FROM all_users WHERE username = 'DRUSE_SECUNDARIO';
  IF ya = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER druse_secundario IDENTIFIED BY __DRUSE_PASSWORD__';
    EXECUTE IMMEDIATE 'ALTER USER druse_secundario QUOTA UNLIMITED ON USERS';
  END IF;
END;
/
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE,
      CREATE SEQUENCE, CREATE TRIGGER, CREATE SYNONYM TO druse;
ALTER USER druse QUOTA UNLIMITED ON USERS;
GRANT CREATE ANY TABLE, ALTER ANY TABLE, DROP ANY TABLE,
      SELECT ANY TABLE, INSERT ANY TABLE, UPDATE ANY TABLE, DELETE ANY TABLE,
      CREATE ANY VIEW, DROP ANY VIEW,
      CREATE ANY PROCEDURE, DROP ANY PROCEDURE, EXECUTE ANY PROCEDURE,
      CREATE ANY INDEX, DROP ANY INDEX,
      CREATE ANY SEQUENCE, DROP ANY SEQUENCE, SELECT ANY SEQUENCE TO druse;
EXIT;
'@ -replace '__DRUSE_PASSWORD__', $DevPassword

    $preparacion | docker exec -i $OracleName bash -lc "cat > /tmp/druse-setup.sql" | Out-Null
    docker exec $OracleName bash -lc "sqlplus -s system/$DevPassword@localhost/FREEPDB1 @/tmp/druse-setup.sql" | Out-Null

    Write-Host "  Oracle listo en 127.0.0.1:$OraclePort, servicio FREEPDB1, usuario druse" -ForegroundColor Green
}

# --- Informix ---------------------------------------------------------------
if ($Engine -in 'all', 'informix') {
    if (Test-ContainerExists $InformixName) {
        Write-Host "$InformixName ya existe; se reinicia." -ForegroundColor Cyan
        docker start $InformixName | Out-Null
    }
    else {
        Write-Host "Creando $InformixName en el puerto $InformixPort..." -ForegroundColor Cyan

        # Se publican **los dos** escuchadores del contenedor, porque Druse habla
        # los dos protocolos: el 9089 es DRDA, que usa el proveedor de siempre, y
        # el 9088 es SQLI, el nativo de Informix, que atiende el puente JDBC.
        # Publicar solo uno deja la mitad de las pruebas sin motor.
        #
        # `LICENSE=accept` es obligatorio: la imagen es de IBM y no arranca sin
        # aceptar sus términos.
        docker run -d `
            --name $InformixName `
            -e LICENSE=accept `
            -e DB_INIT=1 `
            -p "127.0.0.1:${InformixPort}:9089" `
            -p "127.0.0.1:${InformixSqliPort}:9088" `
            icr.io/informix/informix-developer-database:latest | Out-Null
    }

    # Informix tarda bastante más que los otros en estar listo: la primera vez
    # inicializa la instancia entera antes de aceptar conexiones.
    #
    # Se espera a «On-Line» y no a que `onstat` conteste: el servidor arranca en
    # modo administrativo, donde ya responde pero rechaza cualquier conexión con
    # «27002: No connections are allowed in quiescent mode».
    $ready = $false

    foreach ($attempt in 1..180) {
        Start-Sleep -Seconds 1
        $status = docker exec $InformixName bash -lc 'onstat -' 2>$null

        if ($status -match 'On-Line') { $ready = $true; break }
    }

    if ($ready) {
        # Las bases de prueba se crean con registro de transacciones: DRDA lo
        # exige, y sin él la conexión falla aunque el servidor esté vivo.
        #
        # Informix no tiene `CREATE DATABASE IF NOT EXISTS`: esa forma no da
        # error visible aquí —la salida va a $null— pero **no crea nada**, y el
        # fallo aparece mucho después como «database name not found» al conectar.
        # Por eso se consulta antes el catálogo y se crea solo lo que falta.
        $existing = docker exec $InformixName bash -lc `
            'echo "SELECT name FROM sysdatabases;" | dbaccess sysmaster -' 2>$null

        # Las dos últimas no están en Latin-1, y es a propósito: el driver JDBC de
        # SQLI supone `en_US.819` y contra cualquier otra base no conecta si Druse
        # no le dice su locale. El locale de una base es el `DB_LOCALE` de quien
        # la crea, así que se fija al crearla.
        $databases = [ordered]@{
            'druse_test'      = 'en_US.819'
            'druse_test2'     = 'en_US.819'
            'druse_test_utf8' = 'en_US.utf8'
            'druse_test_1252' = 'en_US.1252'
        }

        foreach ($database in $databases.Keys) {
            if ($existing -match "\b$database\b") { continue }

            $locale = $databases[$database]

            docker exec $InformixName bash -lc `
                "export DB_LOCALE=$locale CLIENT_LOCALE=$locale; echo `"CREATE DATABASE $database WITH LOG;`" | dbaccess - -" 2>$null | Out-Null
        }

        Write-Host "  Informix listo en 127.0.0.1:$InformixPort (DRDA) y 127.0.0.1:$InformixSqliPort (SQLI)" -ForegroundColor Green
    }
    else {
        throw "$InformixName no respondió a tiempo."
    }
}

Write-Host ''
Write-Host 'Las pruebas encuentran los motores solas si usas los puertos por defecto.' -ForegroundColor DarkGray
Write-Host 'Para exigir que todos estén disponibles: $env:DRUSE_REQUIRE_ENGINES = 1' -ForegroundColor DarkGray
