#!/usr/bin/env bash
#
# Levanta o retira los motores desechables que usan las pruebas.
# Equivalente a build/scripts/test-db.ps1 para Linux y macOS.
#
# Las contraseñas son de usar y tirar y solo escuchan en loopback: no deben
# reutilizarse para nada más ni parecerse a credenciales reales (plan §11).
#
# Uso:
#   ./build/scripts/test-db.sh                  # ambos motores
#   ./build/scripts/test-db.sh postgres         # solo PostgreSQL
#   ./build/scripts/test-db.sh sqlserver        # solo SQL Server
#   ./build/scripts/test-db.sh down             # eliminar ambos

set -euo pipefail

PG_NAME="${DRUSE_TEST_PG_NAME:-druse-pg-test}"
PG_PORT="${DRUSE_TEST_PG_PORT:-55440}"
PG_IMAGE="${DRUSE_TEST_PG_IMAGE:-postgres:18-alpine}"

MSSQL_NAME="${DRUSE_TEST_MSSQL_NAME:-druse-mssql-test}"
MSSQL_PORT="${DRUSE_TEST_MSSQL_PORT:-14433}"
MSSQL_IMAGE="${DRUSE_TEST_MSSQL_IMAGE:-mcr.microsoft.com/mssql/server:2022-latest}"
MSSQL_PASSWORD='Druse_dev_only_1'

TARGET="${1:-all}"

if [[ "$TARGET" == "down" ]]; then
    for name in "$PG_NAME" "$MSSQL_NAME"; do
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
        -Q "IF DB_ID('druse_test') IS NULL CREATE DATABASE druse_test;" >/dev/null 2>&1

    echo "  SQL Server listo en 127.0.0.1:$MSSQL_PORT"
fi

echo
echo "Las pruebas encuentran los motores solas si usas los puertos por defecto."
echo "Para exigir que todos estén disponibles: export DRUSE_REQUIRE_ENGINES=1"
