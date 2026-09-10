#!/usr/bin/env bash
#
# Levanta o retira los motores desechables que usan las pruebas.
# Equivalente a build/scripts/test-db.ps1 para Linux y macOS.
#
# Las contraseñas son de usar y tirar y solo escuchan en loopback: no deben
# reutilizarse para nada más ni parecerse a credenciales reales (plan §11).
#
# Uso:
#   ./build/scripts/test-db.sh                  # todos los motores
#   ./build/scripts/test-db.sh postgres         # solo PostgreSQL
#   ./build/scripts/test-db.sh sqlserver        # solo SQL Server
#   ./build/scripts/test-db.sh mysql            # solo MySQL
#   ./build/scripts/test-db.sh oracle           # solo Oracle
#   ./build/scripts/test-db.sh down             # eliminar todos

set -euo pipefail

PG_NAME="${DRUSE_TEST_PG_NAME:-druse-pg-test}"
PG_PORT="${DRUSE_TEST_PG_PORT:-55440}"
PG_IMAGE="${DRUSE_TEST_PG_IMAGE:-postgres:18-alpine}"

MSSQL_NAME="${DRUSE_TEST_MSSQL_NAME:-druse-mssql-test}"
MSSQL_PORT="${DRUSE_TEST_MSSQL_PORT:-14433}"
MSSQL_IMAGE="${DRUSE_TEST_MSSQL_IMAGE:-mcr.microsoft.com/mssql/server:2022-latest}"
MSSQL_PASSWORD='Druse_dev_only_1'

MYSQL_NAME="${DRUSE_TEST_MYSQL_NAME:-druse-mysql-test}"
MYSQL_PORT="${DRUSE_TEST_MYSQL_PORT:-33306}"
MYSQL_IMAGE="${DRUSE_TEST_MYSQL_IMAGE:-mysql:8.4}"
MYSQL_PASSWORD='druse_dev_only'

ORACLE_NAME="${DRUSE_TEST_ORACLE_NAME:-druse-oracle-test}"
ORACLE_PORT="${DRUSE_TEST_ORACLE_PORT:-15210}"
ORACLE_IMAGE="${DRUSE_TEST_ORACLE_IMAGE:-gvenzl/oracle-free:slim}"
ORACLE_PASSWORD='druse_dev_only'

TARGET="${1:-all}"

if [[ "$TARGET" == "down" ]]; then
    for name in "$PG_NAME" "$MSSQL_NAME" "$MYSQL_NAME" "$ORACLE_NAME"; do
        echo "Eliminando $name..."
        docker rm -f "$name" >/dev/null 2>&1 || true
    done
    echo "Listo."
    exit 0
fi

container_exists() {
    docker ps -a --filter "name=^/${1}$" --format '{{.Names}}' | grep -q "^${1}$"
}

# --- PostgreSQL -------------------------------------------------------------
if [[ "$TARGET" == "all" || "$TARGET" == "postgres" ]]; then
    if container_exists "$PG_NAME"; then
        echo "$PG_NAME ya existe; se reinicia."
        docker start "$PG_NAME" >/dev/null
    else
        echo "Creando $PG_NAME en el puerto $PG_PORT..."
        docker run -d \
            --name "$PG_NAME" \
            -e POSTGRES_PASSWORD=druse_dev_only \
            -e POSTGRES_DB=druse_test \
            -p "${PG_PORT}:5432" \
            "$PG_IMAGE" >/dev/null
    fi

    ready=0
    for _ in $(seq 1 40); do
        sleep 0.5
        if docker exec "$PG_NAME" pg_isready -U postgres >/dev/null 2>&1; then
            ready=1
            break
        fi
    done

    [[ "$ready" -eq 1 ]] || { echo "$PG_NAME no respondió a tiempo." >&2; exit 1; }

    if ! docker exec "$PG_NAME" psql -U postgres -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = 'druse_test_secondary'" | grep -q 1; then
        docker exec "$PG_NAME" createdb -U postgres druse_test_secondary
    fi

    echo "  PostgreSQL listo en 127.0.0.1:$PG_PORT"
fi

# --- SQL Server -------------------------------------------------------------
if [[ "$TARGET" == "all" || "$TARGET" == "sqlserver" ]]; then
    if container_exists "$MSSQL_NAME"; then
        echo "$MSSQL_NAME ya existe; se reinicia."
        docker start "$MSSQL_NAME" >/dev/null
    else
        echo "Creando $MSSQL_NAME en el puerto $MSSQL_PORT..."
        echo "  (la imagen ocupa ~1,5 GB y el primer arranque tarda)"
        docker run -d \
            --name "$MSSQL_NAME" \
            -e 'ACCEPT_EULA=Y' \
            -e "MSSQL_SA_PASSWORD=$MSSQL_PASSWORD" \
            -e 'MSSQL_PID=Developer' \
            -p "${MSSQL_PORT}:1433" \
            "$MSSQL_IMAGE" >/dev/null
    fi

    # SQL Server tarda bastante más que PostgreSQL en aceptar conexiones.
    ready=0
    for _ in $(seq 1 90); do
        sleep 1
        if docker exec "$MSSQL_NAME" /opt/mssql-tools18/bin/sqlcmd \
            -S localhost -U sa -P "$MSSQL_PASSWORD" -C -Q 'SELECT 1' >/dev/null 2>&1; then
            ready=1
            break
        fi
    done

    [[ "$ready" -eq 1 ]] || { echo "$MSSQL_NAME no respondió a tiempo." >&2; exit 1; }

    # La base no se crea sola, a diferencia de POSTGRES_DB.
    docker exec "$MSSQL_NAME" /opt/mssql-tools18/bin/sqlcmd \
        -S localhost -U sa -P "$MSSQL_PASSWORD" -C \
        -Q "IF DB_ID('druse_test') IS NULL CREATE DATABASE druse_test; IF DB_ID('druse_test_secondary') IS NULL CREATE DATABASE druse_test_secondary;" >/dev/null 2>&1

    echo "  SQL Server listo en 127.0.0.1:$MSSQL_PORT"
fi

# --- MySQL ------------------------------------------------------------------
if [[ "$TARGET" == "all" || "$TARGET" == "mysql" ]]; then
    if container_exists "$MYSQL_NAME"; then
        echo "$MYSQL_NAME ya existe; se reinicia."
        docker start "$MYSQL_NAME" >/dev/null
    else
        echo "Creando $MYSQL_NAME en el puerto $MYSQL_PORT..."
        docker run -d \
            --name "$MYSQL_NAME" \
            -e "MYSQL_ROOT_PASSWORD=$MYSQL_PASSWORD" \
            -e MYSQL_DATABASE=druse_test \
            -p "${MYSQL_PORT}:3306" \
            "$MYSQL_IMAGE" >/dev/null
    fi

    ready=0
    for _ in $(seq 1 60); do
        sleep 1
        if docker exec "$MYSQL_NAME" mysqladmin ping -uroot -p"$MYSQL_PASSWORD" >/dev/null 2>&1; then
            ready=1
            break
        fi
    done

    [[ "$ready" -eq 1 ]] || { echo "$MYSQL_NAME no respondió a tiempo." >&2; exit 1; }
    docker exec "$MYSQL_NAME" mysql -uroot -p"$MYSQL_PASSWORD" \
        -e 'CREATE DATABASE IF NOT EXISTS druse_test_secondary;' >/dev/null 2>&1
    echo "  MySQL listo en 127.0.0.1:$MYSQL_PORT"
fi

# --- Oracle -----------------------------------------------------------------
if [[ "$TARGET" == "all" || "$TARGET" == "oracle" ]]; then
    if container_exists "$ORACLE_NAME"; then
        echo "$ORACLE_NAME ya existe; se reinicia."
        docker start "$ORACLE_NAME" >/dev/null
    else
        echo "Creando $ORACLE_NAME en el puerto $ORACLE_PORT..."
        echo "  (la imagen ocupa ~2 GB y el primer arranque tarda un par de minutos)"
        docker run -d             --name "$ORACLE_NAME"             -e "ORACLE_PASSWORD=$ORACLE_PASSWORD"             -e APP_USER=druse             -e "APP_USER_PASSWORD=$ORACLE_PASSWORD"             -p "${ORACLE_PORT}:1521"             "$ORACLE_IMAGE" >/dev/null
    fi

    ready=0
    for _ in $(seq 1 180); do
        sleep 1
        if docker exec "$ORACLE_NAME" bash -lc             "echo 'SELECT 1 FROM DUAL;' | sqlplus -s system/$ORACLE_PASSWORD@localhost/FREEPDB1"             >/dev/null 2>&1; then
            ready=1
            break
        fi
    done

    [[ "$ready" -eq 1 ]] || { echo "$ORACLE_NAME no respondió a tiempo." >&2; exit 1; }

    # El segundo esquema y los permisos que pide el contrato. Los `ANY` son para
    # poder crear y borrar en ese segundo esquema, que es lo único que trabaja
    # fuera del suyo; `SELECT ANY SEQUENCE` hace falta porque una columna de
    # identidad crea una secuencia por detrás.
    docker exec -i "$ORACLE_NAME" bash -lc "cat > /tmp/druse-setup.sql" <<'SQL'
DECLARE
  ya NUMBER;
BEGIN
  SELECT COUNT(*) INTO ya FROM all_users WHERE username = 'DRUSE_SECUNDARIO';
  IF ya = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER druse_secundario IDENTIFIED BY druse_dev_only';
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
SQL

    docker exec "$ORACLE_NAME" bash -lc         "sqlplus -s system/$ORACLE_PASSWORD@localhost/FREEPDB1 @/tmp/druse-setup.sql" >/dev/null

    echo "  Oracle listo en 127.0.0.1:$ORACLE_PORT, servicio FREEPDB1, usuario druse"
fi

echo
echo "Las pruebas encuentran los motores solas si usas los puertos por defecto."
echo "Para exigir que todos estén disponibles: export DRUSE_REQUIRE_ENGINES=1"
