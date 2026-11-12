# Matriz de motores realmente comprobados

Preparación: 13 de septiembre de 2026. Corresponde a **PUB-01** del [plan de SignPath y donaciones](../planes/plan-signpath-donaciones.md).

El [README](../../README.md) anuncia rangos de versiones. Esta tabla dice otra cosa: **contra qué se ejecutaron pruebas de verdad**. Son dos afirmaciones distintas y conviene no confundirlas, porque la primera es una intención de compatibilidad y la segunda es evidencia.

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

## Reportes BI por motor y edición

Reportes BI lee cada fuente con su propio proveedor, en una sesión de solo lectura, y cruza los datos en Druse. Un motor se declara compatible cuando pasa, contra un servidor real, las pruebas de contrato de la lectura tipada (`LecturaTipada_*` en `DatabaseProviderContractTests`):

- números, decimales y fechas que llegan con su tipo, y nulos que llegan como nulos;
- el tope de filas de una fuente (20.000) que se detecta y se dice;
- la cancelación, que corta la lectura;
- cada valor con un tipo que el resultado guardado sabe conservar.

Comprobado el 12 de noviembre de 2026, versión 1.20.0:

| Motor | Lectura tipada | Lectura de 20.000 filas | Completa | Sin Informix | Comunidad |
| --- | --- | ---: | :---: | :---: | :---: |
| PostgreSQL | Comprobada | 26 ms | Sí | Sí | Sí |
| SQL Server | Comprobada | 176 ms | Sí | Sí | Sí |
| MySQL | Comprobada (`mysql:8.4`) | 47 ms | Sí | Sí | Sí |
| Oracle | Comprobada (Oracle Database Free) | 86 ms | Sí | Sí | No |
| SQLite | Comprobada | 35 ms | Sí | Sí | Sí |
| Informix | Implementada; **la comprueba la integración continua**, que es donde se levanta su contenedor | — | Sí | No | No |
| MariaDB | Sin prueba propia, como en el resto de Druse | — | Sí | Sí | Sí |

Los tiempos son de una sola ejecución en Windows, con el servidor en un contenedor local y una columna entera; sirven para comparar motores, no como garantía. Se reproducen con `DRUSE_MEDIR=<archivo>` y `dotnet test backend/tests/Druse.ProviderContractTests --filter LecturaTipada`.

El cruce de SQL Server con PostgreSQL se prueba además de punta a punta (`e2e/tests/reportes.spec.ts`, «cruza ventas de SQL Server con metas de PostgreSQL»): tres filas, 220 en ventas y 60 % de cumplimiento con el municipio sin meta aparte.

Lo que cada motor entrega se normaliza al leer:

- Una fecha `DATE` de SQL Server o MySQL se guarda como fecha sin hora. El `DATE` de Oracle lleva hora y solo pasa a fecha si todas las filas caen a medianoche.
- Los enteros sin signo de MySQL suben al tipo con signo que los contiene; `BIGINT UNSIGNED` pasa a decimal.
- En SQLite cada valor tiene su tipo, no la columna. Una columna que mezcla enteros y reales se lee como real, y una que mezcla números y texto, como texto. Una columna declarada `DATE` con fechas ISO se lee como fecha.
- Un `NUMBER` de Oracle de más de 28 cifras se lee como texto antes que perder precisión.

Si un conjunto se abre en una edición que no tiene el proveedor de alguna de sus fuentes, esa fuente lo dice y el resultado guardado sigue a la vista.

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
