#!/usr/bin/env bash
#
# Arranca Druse en desarrollo: la API local y el frontend Angular.
# Equivalente a build/scripts/dev.ps1 para Linux y macOS.
#
# Uso: ./build/scripts/dev.sh [puerto-api]

set -euo pipefail

API_PORT="${1:-5177}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_PROJECT="$REPO_ROOT/backend/src/Druse.Host.LocalApi"
FRONTEND="$REPO_ROOT/frontend"

api_pid=""

cleanup() {
    if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
        echo "Deteniendo la API local..."
        kill "$api_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo "Arrancando la API local en http://127.0.0.1:$API_PORT ..."
LocalApi__Port="$API_PORT" dotnet run --project "$API_PROJECT" &
api_pid=$!

# Espera a que el endpoint de salud responda antes de abrir el frontend.
ready=0
for _ in $(seq 1 40); do
    sleep 0.5
    if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null; then
        ready=1
        break
    fi
done

if [[ "$ready" -ne 1 ]]; then
    echo "La API local no respondió en http://127.0.0.1:$API_PORT/api/health." >&2
    exit 1
fi

echo "API local lista."
echo "Arrancando el frontend en http://127.0.0.1:4200 ..."

# A qué puerto habla el proxy del servidor de desarrollo. Lo fija al arrancar
# —Vite no admite un destino por petición—, así que hay que decírselo o un
# puerto distinto del de siempre acaba en 502.
export DRUSE_API_PORT="$API_PORT"

cd "$FRONTEND"
npm start
