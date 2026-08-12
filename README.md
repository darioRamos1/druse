# Druse

Aplicación de escritorio para administrar y consultar distintos motores de bases de datos desde una interfaz moderna y personalizable.

Una *drusa* es la costra de cristales que tapiza el interior de una geoda: la estructura que aparece al abrir la piedra. Es lo que hace la aplicación con una base de datos.

> **Estado: Fase 0 (preparación).** La solución compila, la API local responde y el frontend arranca. Todavía no hay conexión real a ningún motor.

---

## Requisitos

| Herramienta | Versión mínima | Para qué |
| --- | --- | --- |
| .NET SDK | 10.0 | API local y proveedores |
| Node.js | 22 o superior | Frontend Angular |
| Rust (cargo) | estable | Solo para el empaquetado con Tauri (Fase 7) |

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

### Base de datos de pruebas

Las pruebas de proveedor y de integración necesitan un PostgreSQL real. Hay un contenedor desechable preparado:

```powershell
./build/scripts/test-db.ps1        # Windows
```

```bash
./build/scripts/test-db.sh         # Linux y macOS
./build/scripts/test-db.sh down    # retirarlo
```

Levanta `postgres:18-alpine` en `127.0.0.1:55440` con una contraseña de usar y tirar. Las pruebas lo encuentran solas; si necesitas otro puerto, ajusta `DRUSE_TEST_PG_PORT`.

**Sin contenedor las pruebas no fallan: se omiten.** Una máquina sin Docker no debería dar por rota la suite entera.

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

## Seguridad

- Las contraseñas nunca se guardan en el repositorio, en `appsettings.json` ni en SQLite en texto plano.
- Los secretos van al almacén seguro del sistema operativo.
- Las respuestas de la API no devuelven credenciales ni cadenas de conexión.
- La API local no se expone a la red.
