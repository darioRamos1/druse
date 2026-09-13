# Matriz de motores realmente comprobados

Preparación: 13 de septiembre de 2026. Corresponde a **PUB-01** del [plan de SignPath y donaciones](plan-signpath-donaciones.md).

El [README](../README.md) anuncia rangos de versiones. Esta tabla dice otra cosa: **contra qué se ejecutaron pruebas de verdad**. Son dos afirmaciones distintas y conviene no confundirlas, porque la primera es una intención de compatibilidad y la segunda es evidencia.

## Lo comprobado

| Motor | Anunciado en el README | Probado de verdad | Dónde se ejecuta | Cobertura |
| --- | --- | --- | --- | --- |
| PostgreSQL | 12 – 18 | `postgres:18-alpine`, imagen fijada por digest | Integración continua y local | Contrato, integración y punta a punta |
| SQL Server | 2016 – 2022 | `mcr.microsoft.com/mssql/server:2022-latest`, fijada por digest | Integración continua y local | Contrato e integración |
| MySQL | 8.0+ y MariaDB | `mysql:8.4`, fijada por digest | Integración continua y local | Contrato e integración |
| MariaDB | Anunciado junto a MySQL | **Ninguna versión** | — | Ninguna. Se puede probar apuntando las variables `DRUSE_TEST_MYSQL_*` a un contenedor `mariadb`; nadie lo ha dejado registrado |
| Oracle | 12c – 23ai | `gvenzl/oracle-free:slim` (Oracle Database Free) | **Solo local**, declarado en `DRUSE_OPTIONAL_ENGINES` | Contrato, lotes y punta a punta (`e2e/tests/oracle.spec.ts`) |
| Informix | 12.10+ | `icr.io/informix/informix-developer-database`, imagen de desarrollo fijada por digest | Integración continua y local | Contrato por DRDA y por SQLI |
| SQLite | 3.16+ | La biblioteca que viaja en el propio paquete | Integración continua y local | Contrato y punta a punta (`e2e/tests/sqlite.spec.ts`) |

Un motor con una sola versión probada no es un motor con seis versiones comprobadas. Los rangos del README describen lo que el proveedor pretende admitir; **solo la columna «probado de verdad» está respaldada por una ejecución**.

Las pruebas de contrato se saltan solas cuando falta el servidor, y con `DRUSE_REQUIRE_ENGINES=1` esa ausencia pasa a ser un fallo en lugar de un silencio. Es lo que evita una suite verde que no comprobó nada. `DRUSE_OPTIONAL_ENGINES` nombra —separados por comas— los motores que esa exigencia no alcanza, para las ejecuciones que a propósito no los levantan.

## Lo que esta matriz deja al descubierto

- **Oracle se queda fuera de la integración continua, y ahora se dice dónde.** El job `backend-con-motores-reales` exigía `DRUSE_REQUIRE_ENGINES=1` para toda la solución sin levantar Oracle, así que su comprobación de disponibilidad tenía que fallar allí. Se resolvió acotando la exigencia con `DRUSE_OPTIONAL_ENGINES=oracle` en vez de añadir un servicio de 2 GB que tarda un par de minutos en arrancar. **La cobertura de Oracle sigue siendo solo local**; lo que cambia es que la ausencia está declarada por su nombre en lugar de romper el job.
- **La imagen de Informix ya va por digest.** Iba por etiqueta `latest`, que es un puntero que alguien más mueve, mientras el resto estaba fijado (REL-006 del plan de mejoras). Ahora lleva su digest; Dependabot no vigila una imagen lanzada con `docker run`, así que actualizarla es una decisión manual.
- **MariaDB se anuncia y no se prueba.** El proveedor no distingue MariaDB de MySQL, y por eso el contrato debería valer igual; «debería» no es una ejecución.
- **Las versiones antiguas de cada rango no tienen evidencia.** PostgreSQL 12, SQL Server 2016, MySQL 8.0, Oracle 12c e Informix 12.10 no se han probado en este repositorio.

## Cómo reproducirlo

```powershell
./build/scripts/test-db.ps1            # los cinco motores con servidor
./build/scripts/test-db.ps1 -Engine oracle
$env:DRUSE_REQUIRE_ENGINES = '1'
dotnet test backend/Druse.slnx
```

Los contenedores publican sus puertos solo en `127.0.0.1` y usan puertos propios para no pisar una instalación real: PostgreSQL 55440, SQL Server 14433, MySQL 33306, Oracle 15210, Informix 9089 y 9088.

SQLite no necesita contenedor: es un archivo, y su fixture crea el suyo.

## Para informar de un motor

Si pruebas Druse contra una versión que no figura arriba, cuéntalo en una incidencia con la plantilla de compatibilidad: versión exacta del servidor, sistema operativo, qué funcionó, qué falló y con qué mensaje. Sin contraseñas ni datos de tus clientes. Así es como esta tabla puede crecer con evidencia en lugar de con optimismo.
