#!/usr/bin/env bash
#
# Levanta o retira el PostgreSQL desechable que usan las pruebas.
# Equivalente a build/scripts/test-db.ps1 para Linux y macOS.
#
# La contraseña es de usar y tirar y solo escucha en loopback: no debe
# reutilizarse para nada más ni parecerse a una credencial real (plan §11).
#
# Uso:
#   ./build/scripts/test-db.sh          # crear o reiniciar
#   ./build/scripts/test-db.sh down     # eliminar

set -euo pipefail

NAME="${DRUSE_TEST_PG_NAME:-druse-pg-test}"
PORT="${DRUSE_TEST_PG_PORT:-55440}"
IMAGE="${DRUSE_TEST_PG_IMAGE:-postgres:18-alpine}"

if [[ "${1:-}" == "down" ]]; then
    echo "Eliminando el contenedor $NAME..."
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "Listo."
    exit 0
fi

if docker ps -a --filter "name=^/${NAME}$" --format '{{.Names}}' | grep -q "^${NAME}$"; then
    echo "El contenedor $NAME ya existe; se reinicia."
    docker start "$NAME" >/dev/null
else
    echo "Creando $NAME con $IMAGE en el puerto $PORT..."
    docker run -d \
        --name "$NAME" \
        -e POSTGRES_PASSWORD=druse_dev_only \
        -e POSTGRES_DB=druse_test \
        -p "${PORT}:5432" \
        "$IMAGE" >/dev/null
fi

# Espera a que el servidor acepte conexiones.
for _ in $(seq 1 30); do
    sleep 0.5

    if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
        echo "PostgreSQL listo en 127.0.0.1:$PORT"
        echo
        echo "Las pruebas lo encuentran solas si usas el puerto por defecto."
        echo "Con otro puerto: export DRUSE_TEST_PG_PORT=$PORT"
        exit 0
    fi
done

echo "El contenedor $NAME no respondió a tiempo." >&2
exit 1
