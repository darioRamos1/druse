# Druse

Aplicación de escritorio para administrar y consultar distintos motores de bases de datos desde una interfaz moderna y personalizable.

Una *drusa* es la costra de cristales que tapiza el interior de una geoda: la estructura que aparece al abrir la piedra. Es lo que hace la aplicación con una base de datos.

> **Estado: Fase 4 cerrada.** Funciona el flujo completo contra **PostgreSQL y SQL Server**: conectar, explorar el catálogo, escribir SQL, ejecutar, cancelar y consultar el historial. Todavía no está empaquetado como aplicación de escritorio (Fase 7) y faltan la exportación (Fase 6) y buena parte de la productividad del editor (Fase 5).

---

## Requisitos

| Herramienta | Versión mínima | Para qué |
| --- | --- | --- |
| .NET SDK | 10.0 | API local y proveedores |
| Node.js | 22 o superior | Frontend Angular |
| Docker | — | Solo para las bases de datos de pruebas |
| Rust (cargo) | estable | Solo para el empaquetado con Tauri (Fase 7) |

## Atajos del editor

| Atajo | Acción |
| --- | --- |
| `Ctrl/Cmd + Enter` | Ejecutar |
| `Ctrl/Cmd + Shift + Enter` | Ejecutar solo la selección |
| `Esc` | Cancelar la consulta en curso |
| `Ctrl/Cmd + S` | Marcar la pestaña como guardada |
| `Ctrl/Cmd + T` | Nueva consulta |
| `Ctrl/Cmd + Shift + F` | Formatear |
| `Ctrl/Cmd + F` | Buscar en el editor |
| `Ctrl/Cmd + Espacio` | Sugerencias |

El autocompletado ofrece las tablas, vistas y columnas **que el explorador ya ha cargado**, resolviendo los alias del `FROM`: si escribes `FROM users u`, después `u.` sugiere las columnas de `users`.

## Motores soportados

| Motor | Estado |
| --- | --- |
| PostgreSQL 12 – 18 | Funcionando |
| SQL Server 2016 – 2022 | Funcionando (autenticación SQL; la integrada de Windows está en el backlog) |
| MySQL | Fase 8 |

## Ejecutar en desarrollo

Un único comando arranca la API local y el frontend:

```powershell
# Windows
./build/scripts/dev.ps1
```

```bash
# Linux y macOS
./build/scripts/dev.sh
```

| Servicio | Dirección |
| --- | --- |
| Frontend | http://127.0.0.1:4200 |
| API local | http://127.0.0.1:5177 |
| Estado de la API | http://127.0.0.1:5177/api/health |

El servidor de desarrollo de Angular redirige `/api` a la API local mediante `frontend/proxy.conf.json`, de modo que ningún componente conoce el host ni el puerto.

La API escucha **exclusivamente en la interfaz de loopback**. Nunca debe exponerse en `0.0.0.0`.

### Arrancar cada parte por separado

```bash
dotnet run --project backend/src/Druse.Host.LocalApi
cd frontend && npm start
```

## Compilar y probar

```bash
dotnet build backend/Druse.slnx
dotnet test  backend/Druse.slnx

cd frontend
npm run build
npm test
```

### Bases de datos de pruebas

Las pruebas de proveedor y de integración necesitan servidores reales. Hay contenedores desechables preparados:

```powershell
./build/scripts/test-db.ps1                    # ambos motores
./build/scripts/test-db.ps1 -Engine postgres   # solo uno
./build/scripts/test-db.ps1 -Down              # retirarlos
```

```bash
./build/scripts/test-db.sh                     # ambos motores
./build/scripts/test-db.sh sqlserver           # solo uno
./build/scripts/test-db.sh down                # retirarlos
```

| Motor | Imagen | Puerto | Variable para cambiarlo |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:18-alpine` | 55440 | `DRUSE_TEST_PG_PORT` |
| SQL Server | `mssql/server:2022-latest` | 14433 | `DRUSE_TEST_MSSQL_PORT` |

**Sin contenedor las pruebas no fallan: se omiten.** Una máquina sin Docker no debería dar por rota la suite entera.

Eso tiene un riesgo, y por eso existe `DRUSE_REQUIRE_ENGINES=1`: con esa variable, un motor que no responda **rompe la compilación** en lugar de dejar una suite verde que no comprobó nada. La integración continua siempre la activa.

### Pruebas contractuales

`backend/tests/Druse.ProviderContractTests` define **un solo conjunto de comprobaciones que todos los motores deben superar**. Cada proveedor aporta únicamente su conexión y sus diferencias de dialecto, declaradas en `IProviderFixture`.

Si alguna vez hay que cambiar *lo que comprueba* una de esas pruebas para que pase en un motor concreto, es señal de que se ha colado una fuga de dialecto en las abstracciones.

## Estructura

```text
druse/
├── backend/            Solución .NET (Druse.slnx)
│   ├── src/            Núcleo, contratos, proveedores y host local
│   └── tests/          Unitarias, contractuales de proveedores e integración
├── frontend/           Aplicación Angular
├── shells/             Envoltorio de escritorio (Tauri, Fase 7)
├── build/              Scripts y empaquetado
└── docs/
    ├── architecture/
    ├── decisions/      ADR
    └── mockups/        Mockup de referencia
```

La dirección de las dependencias apunta siempre al núcleo. Está fijada por pruebas automáticas en `backend/tests/Druse.UnitTests/ArchitectureRulesTests.cs`: si alguien agrega una referencia que rompe la arquitectura, la compilación de las pruebas falla.

## Documentación

| Documento | Contenido |
| --- | --- |
| [`PLAN_TRABAJO_DRUSE.md`](PLAN_TRABAJO_DRUSE.md) | Plan maestro: alcance, arquitectura y las 8 fases |
| [`BITACORA.md`](BITACORA.md) | Bitácora por sesión: estado actual, qué toca retomar y decisiones |
| [`docs/decisions/`](docs/decisions/) | ADR de las decisiones estructurales |
| [`docs/mockups/druse-main.html`](docs/mockups/druse-main.html) | Mockup de referencia de la interfaz |

## Dónde guarda Druse tus datos

| Qué | Dónde |
| --- | --- |
| Perfiles de conexión, historial y preferencias | `druse.db` en el directorio de datos del usuario |
| Contraseñas | Almacén del sistema: Administrador de credenciales, Llavero o Secret Service |
| Token de la API | `api-token`, junto a la base; se regenera en cada arranque |

Directorio de datos por plataforma:

- **Windows:** `%APPDATA%\Druse`
- **macOS:** `~/Library/Application Support/Druse`
- **Linux:** `$XDG_DATA_HOME/druse` (por defecto `~/.local/share/druse`)

Si el sistema no ofrece un almacén seguro, Druse **no guarda la contraseña** y la pide en cada conexión, indicándolo en la interfaz. Ver [ADR 0004](docs/decisions/0004-almacenamiento-de-secretos-y-token-local.md).

## Seguridad

- Las contraseñas nunca se guardan en el repositorio, en `appsettings.json` ni en SQLite. La tabla de perfiles no tiene columna para ellas, y hay pruebas que lo comprueban.
- Las respuestas de la API no devuelven credenciales ni cadenas de conexión.
- La API local escucha solo en loopback **y exige un token**: sin él, cualquier proceso de la máquina podría abrir sesiones contra tus bases de datos.
- Las instrucciones destructivas (`DROP`, `TRUNCATE`, `DELETE` sin filtro) exigen confirmación explícita.
- Una conexión marcada como solo lectura rechaza cualquier instrucción que escriba, y confirmar un riesgo no permite saltarse esa marca.
