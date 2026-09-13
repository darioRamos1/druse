#!/usr/bin/env bash
# Ejecuta el script real con Docker simulado, sin crear contenedores.
set -euo pipefail
test_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
port_log="$(mktemp)"
trap 'rm -f -- "$port_log"' EXIT
export DRUSE_TEST_PORT_LOG="$port_log"
docker() {
    case "$1" in
        ps) return 0 ;;
        run)
            shift
            while (( $# )); do
                if [[ "$1" == '-p' ]]; then
                    printf '%s\n' "$2" >> "$DRUSE_TEST_PORT_LOG"
                    shift
                fi
                shift
            done
            ;;
        exec) printf '1\n' ;;
    esac
}
sleep() { :; }
export -f docker sleep
DRUSE_TEST_PG_PORT=55441 DRUSE_TEST_MSSQL_PORT=14434 \
DRUSE_TEST_MYSQL_PORT=33307 DRUSE_TEST_ORACLE_PORT=15211 \
    bash "$test_dir/../scripts/test-db.sh" all
expected=$'127.0.0.1:55441:5432\n127.0.0.1:14434:1433\n127.0.0.1:33307:3306\n127.0.0.1:15211:1521'
[[ "$(cat "$port_log")" == "$expected" ]] || { echo 'Publicación de puertos incorrecta' >&2; exit 1; }
echo 'OK: cuatro motores limitados a loopback, con puertos personalizados.'
