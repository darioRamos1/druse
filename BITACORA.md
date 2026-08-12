# Bitácora de seguimiento — Druse

> Documento vivo. Se actualiza **al final de cada sesión de trabajo**.
> El plan maestro (alcance, arquitectura, fases) vive en `PLAN_TRABAJO_DRUSE.md`.
> Esta bitácora responde solo a tres preguntas: **qué se hizo**, **en qué estado quedó** y **qué toca retomar**.

---

## 1. Estado actual

| Campo | Valor |
| --- | --- |
| Última sesión | **004** — 2026-08-11 |
| Fase activa | **Fase 3 — Persistencia local y seguridad** |
| Fase 0 | ✅ Cerrada. 9/9 tareas. |
| Fase 1 | ✅ Cerrada. 8/8 tareas. |
| Fase 2 | ✅ **Cerrada.** 11/11 tareas. |
| ¿Compila el backend? | Sí — 0 advertencias, 0 errores |
| ¿Compila el frontend? | Sí — 386 kB iniciales, 0 advertencias |
| ¿Pasan las pruebas? | Sí — **90 en backend** (54 unitarias + 21 contractuales + 15 integración) y **37 en frontend** |
| ¿Funciona contra una base real? | Sí — verificado de punta a punta contra PostgreSQL 18.4 en Docker |
| Bloqueantes | Ninguno |
| Git | Rama `feature/postgresql-connection`, pendiente de fusionar en `main`. Sin remoto configurado. |

### Qué toca retomar en la próxima sesión

1. **Fusionar `feature/postgresql-connection` en `main`** y abrir `feature/local-persistence`.
2. Empezar la **Fase 3**, cuyo primer objetivo es que las contraseñas dejen de pedirse en cada arranque:
   - `Druse.Persistence.Sqlite` con la base local;
   - `IAppPaths` e `ISecretStore` en `Platform.Abstractions`, con implementación por sistema en `Platform.Native`;
   - guardar perfiles **sin contraseña** en SQLite y la contraseña en el almacén del sistema;
   - historial de consultas y preferencias.
3. Token temporal entre Angular y la API, que hoy no existe: cualquier proceso local puede llamarla.
4. La base de pruebas se levanta con `./build/scripts/test-db.ps1`. El contenedor `druse-pg-test` puede seguir corriendo entre sesiones.

**Sigue pendiente el visto bueno visual.** La extensión de Chrome no estaba conectada en ninguna de las dos sesiones, así que la pantalla nunca se ha comparado a ojo con el mockup.

---

## 2. Cómo retomar (prompt de arranque de sesión)

```text
Lee BITACORA.md y PLAN_TRABAJO_DRUSE.md, y revisa el mockup de referencia
docs/mockups/druse-main.html.

Antes de escribir código:
1. Confirma la fase activa y las tareas pendientes según la bitácora.
2. Verifica el estado real del repositorio (no confíes solo en la bitácora).
3. Propón únicamente los cambios de la siguiente tarea pendiente.

Al terminar: ejecuta compilación y pruebas, resume archivos modificados y
actualiza el checklist del plan y esta bitácora.
```

---

## 3. Identidad del proyecto

| Campo | Valor |
| --- | --- |
| Nombre | **Druse** (sin sufijo «Studio») |
| Origen | Una *drusa* es la costra de cristales que tapiza el interior de una geoda: la estructura que aparece al abrir la piedra. Metáfora de explorar el esquema de una base de datos. |
| Raíz de namespaces | `Druse.*` |
| Solución | `backend/Druse.slnx` |
| Ejecutable | `druse.exe` |
| Raíz del repositorio | `P:\Proyectos\Trabajo\DB STUDIO\druse` |
| Nombre anterior | ~~Quarzo Studio~~ — descartado en la sesión 001 |

**Verificación de colisiones (sesión 001).** Candidatos comprobados antes de fijar el nombre:

| Candidato | Resultado |
| --- | --- |
| **Druse** | ✅ Elegido. Sin colisiones encontradas en software. |
| Geode | ❌ Apache Geode: base de datos distribuida en memoria, proyecto top-level de la ASF (antes GemFire). Colisión directa en el mismo dominio. |
| Facet | ❌ Paquete NuGet `Facet` activo (source generator de DTOs), versión 5.x. |
| Kyanite | ⚠️ Saturado: un lenguaje, una librería de inferencia en Rust, Kyanite Labs. |
| Shard | ✅ Libre como nombre de app, pero «sharding» satura el término en bases de datos. |
| Lazuli | ✅ Casi libre; solo un paquete Python nicho en PyPI. |

Pendiente cuando haya presencia pública: reservar dominio, organización de GitHub y el identificador `druse` en NuGet/npm.

---

## 4. Entorno verificado

| Herramienta | Versión | Estado |
| --- | --- | --- |
| .NET SDK | 10.0.302 | OK |
| Node.js | v24.16.0 | OK |
| npm | 11.12.1 | OK |
| Git | 2.50.0.windows.2 | OK |
| Angular | 22.1.0 (CLI 22.1.3) | OK |
| TypeScript | 6.0.2 | OK |
| Vitest | 4.1.10 | OK — es el runner por defecto de Angular 22 |
| Rust / cargo | — | **Falta.** Necesario solo para Tauri (Fase 7). |

Pendiente de verificar cuando toque: Docker (pruebas de integración con contenedores), instancias PostgreSQL y SQL Server de prueba (Fases 2 y 4).

---

## 5. Registro de sesiones

### Sesión 004 — 2026-08-11 · Fase 2 completa

**Objetivo:** el flujo vertical contra PostgreSQL, de la interfaz al motor.

**Hecho:**

*Dominio y contratos*
- `ConnectionProfile`, `DatabaseObject`, `DatabaseColumn`, `QueryRequest`, `QueryResult` y compañía en `Druse.Domain`.
- `IDatabaseProvider`, `IDatabaseSession`, `IDatabaseMetadataReader` e `IQueryExecutor` en `Druse.Database.Abstractions`.
- **`ConnectionProfile` no tiene campo de contraseña.** Las credenciales viajan aparte en `DatabaseCredentials`, se usan al abrir y se descartan. Hay una prueba que falla si alguien añade una propiedad que se llame «password», «secret» o «credential».
- `SqlSafetyAnalyzer`: detecta DROP, TRUNCATE, DELETE/UPDATE sin WHERE, cambios de esquema y de permisos. Descarta cadenas, identificadores citados y comentarios antes de analizar, para no avisar sin motivo.

*Proveedor PostgreSQL*
- `PostgreSqlDatabaseProvider` con Npgsql 10.
- `PostgreSqlQueryExecutor` sobre `DbCommand`/`DbDataReader`. **No reescribe el SQL**: el límite de filas se aplica al leer, no añadiendo `LIMIT`, porque modificar la consulta cambiaría su significado y su plan.
- `PostgreSqlMetadataReader` sobre los catálogos `pg_*`, con carga perezosa por nivel y recuento estimado desde `reltuples`.
- `PostgreSqlErrorNormalizer`: traduce excepciones a `QueryError` **saneado**, porque los mensajes del driver pueden traer la cadena de conexión.
- Los valores se formatean en cultura invariante: un `numeric` con la coma decimal de la máquina no se podría copiar de vuelta a una consulta.

*Aplicación e infraestructura*
- `ConnectionService`, `MetadataService` y `QueryService`.
- `QueryService.Validate` concentra las reglas comunes: solo lectura, confirmación de instrucciones destructivas y límites. **Confirmar un riesgo no permite saltarse el modo de solo lectura**, que tiene prioridad.
- `ProviderRegistry`, `SessionRegistry` y `QueryExecutionTracker` (cancelación con tokens enlazados).

*API local*
- Endpoints de motores, prueba de conexión, sesiones, metadatos, ejecución y cancelación.
- Middleware que traduce las excepciones conocidas: **ninguna traza llega al cliente**.
- Las sesiones se cierran al apagar el proceso.

*Frontend*
- `ApplicationGateway` ampliado con todo el contrato; `HttpApplicationGateway` traduce los DTO y clasifica los tipos de columna por nombre, no por motor.
- **`WorkspaceStore`**: conexiones, árbol perezoso, pestañas, ejecución y cancelación con Signals.
- Diálogo de nueva conexión según el mockup, con «Probar conexión».
- El árbol carga hijos al expandir y no vuelve a pedirlos; hay que actualizar el nodo explícitamente.
- Doble clic en una tabla abre una pestaña con su `SELECT`.
- Aviso de instrucción destructiva con «Ejecutar de todos modos».
- **Los datos simulados se borraron**, como estaba previsto.

*Pruebas*
- 21 contractuales contra PostgreSQL real: conexión válida e inválida, tipos, nulos, varios conjuntos de resultados, errores con su SQLSTATE, timeout, cancelación y metadatos.
- 15 de integración por HTTP, incluido el flujo completo y la comprobación de que **ninguna respuesta devuelve la contraseña**.
- 20 unitarias nuevas del analizador de SQL y las reglas de ejecución.

**Verificado ejecutando:**
- `dotnet build` y `ng build` — 0 advertencias.
- 90 pruebas de backend y 37 de frontend, todas pasan.
- Flujo completo por HTTP contra PostgreSQL 18.4: salud → motores → sesión → bases → esquemas → `SELECT` con nulo → cierre.
- `DELETE FROM pg_class` sin filtro devuelve **409** con el riesgo explicado, en lugar de ejecutarse.
- Proxy de Angular alcanzando la API y ésta la base.

**Incidencias resueltas:**
1. El puerto 55440 se eligió porque **55432 ya lo ocupaba `prima-postgres`**, un contenedor ajeno al proyecto. No se tocó ningún contenedor existente.
2. Una prueba destapó que `ALTER TABLE … DROP COLUMN` solo se marcaba como cambio de esquema, cuando **destruye datos**. Se amplió el patrón para tratarlo como DROP.
3. El diálogo de conexión superaba el presupuesto de estilos por 281 bytes. Aquí sí se subió el límite a 6 kB: partir un modal en dos componentes por eso habría sido peor que el problema.

**No hecho / decidido no hacer:**
- **Sin verificación visual**: la extensión de Chrome sigue sin estar conectada.
- El timeout está fijo en 30 s; exponerlo en la interfaz es de la Fase 5.
- No hay historial ni persistencia: la contraseña se pide en cada conexión. Es justo el objetivo de la Fase 3.
- No hay token entre Angular y la API. También Fase 3.
- Sin exportación a CSV/XLSX (Fase 6) ni plan de ejecución.

---

### Sesión 003 — 2026-08-11 · Fase 1 completa

**Objetivo:** reproducir el mockup como shell de Angular.

**Hecho:**

*Dependencias*
- Fuentes **Inter** y **JetBrains Mono** empaquetadas con `@fontsource` y cargadas desde `angular.json`. **D-07 resuelto**: verificado que el CSS servido tiene **cero** referencias a Google Fonts y que los WOFF2 salen del propio servidor.
- **Monaco Editor 0.56.0** copiado como recurso estático a `assets/monaco/vs`.

*Componentes* (todos `OnPush`, todos con los tokens, ningún color literal suelto salvo los pocos matices que aún no eran token)
- `layout/app-shell` — compone la ventana y sostiene el estado con Signals.
- `layout/top-bar` — marca, acciones, búsqueda global, controles de ventana.
- `layout/status-bar` — estado de sesión, motor, base, usuario, posición del cursor.
- `features/connections/connections-sidebar` — conexiones y árbol del explorador con sangría por nivel.
- `features/query-editor/editor-tabs` — pestañas con indicador de cambios sin guardar.
- `features/query-editor/editor-toolbar` — ejecutar, ejecutar selección, cancelar, formatear, contexto y timeout.
- `features/query-editor/sql-editor` — Monaco encapsulado; **ningún otro componente importa su API**.
- `features/query-results/results-panel` y `results-grid` — separados a propósito (ver «Incidencias»).
- `shared/ui/icon` — los 20 trazos del mockup en un solo sitio, con unión cerrada de nombres.
- `shared/ui/engine-badge` — el color por motor vive aquí y solo aquí, para no ramificar por motor en las plantillas (plan §13).
- `shared/ui/resize-handle` — arrastre con Pointer Events **y ajuste por teclado**, con `role="separator"` y valores ARIA.

*Editor*
- Tema `druse-dark` para Monaco derivado del mockup: violeta para reservadas, verde para literales, azul para identificadores.
- Creado fuera de la zona de Angular para no disparar detección de cambios en cada pulsación.
- `Ctrl/Cmd + Enter` ejecuta.
- Autocompletado por palabras del documento **desactivado**: sin esquema real solo estorba. Se activa en la Fase 5 con metadatos.

**Verificado:**
- `ng build` — 320 kB iniciales, 0 advertencias.
- `ng test` — 17 pruebas, todas pasan.
- `dotnet test` — 7 pruebas, siguen pasando.
- Servidor de desarrollo sirviendo `loader.js` de Monaco (39 kB) y los WOFF2 de ambas fuentes.

**Incidencias resueltas:**
1. **Monaco arrastraba una `dompurify` vulnerable** (3.4.8; avisos de XSS y de contaminación de configuración). `npm audit fix` proponía degradar Monaco a 0.53. En su lugar se añadió un `override` a `dompurify ^3.4.13`, que resuelve a la versión parcheada manteniendo Monaco 0.56.
2. **El panel de resultados superaba el presupuesto de estilos de Angular** (5,45 kB sobre 4 kB). En vez de subir el límite se extrajo `results-grid`, que además aísla justo la pieza que habrá que sustituir al resolver D-08.

**No hecho:**
- **Sin captura visual comparada con el mockup:** la extensión de Chrome no estaba conectada. La estructura está verificada por DOM y pruebas, pero falta el vistazo a ojo.
- El diálogo «Nueva conexión» del mockup **no se implementó**: pertenece a `connections`, no a la Fase 1.
- Quedan 3 vulnerabilidades moderadas en `@angular/cli` (su servidor MCP interno, vía `@hono/node-server`). Son de desarrollo, no llegan al bundle, y la única «solución» sería degradar Angular a la 21. Se espera actualización.

**Archivos:** 30 nuevos en `frontend/src/app`, más `angular.json` y `package.json`.

---

### Sesión 002 — 2026-08-11 · Fase 0 completa

**Objetivo:** montar el esqueleto del proyecto y cerrar la Fase 0.

**Hecho:**

*Estructura y repositorio*
- Creada la raíz `druse/` con el árbol del plan §4; movidos el plan, la bitácora y los mockups.
- Mockups renombrados: `druse-main.html` (referencia) y `druse-main-v0.html` (versión previa).
- `git init` en la rama `main`. `.gitignore` de .NET ampliado con Node, Angular, Tauri, artefactos de empaquetado y, sobre todo, bases SQLite, `.env` y `appsettings.Local.json` — nada de datos de usuario ni secretos en el repositorio.
- `.editorconfig` con convenciones de C#, TypeScript y SCSS, más reglas de nomenclatura y de diagnóstico alineadas con el plan.

*Backend*
- Solución con los 13 proyectos (10 en `src`, 3 en `tests`), todos en `Druse.slnx`.
- Grafo de referencias del plan §10 aplicado y verificado.
- `Directory.Build.props` con `net10.0`, `Nullable`, `TreatWarningsAsErrors` y `AnalysisLevel=latest-recommended`.
- `GET /api/health` implementado. Kestrel con `ListenLocalhost`: **verificado con `Get-NetTCPConnection` que solo escucha en `127.0.0.1` y `::1`**, nunca en `0.0.0.0`.
- 4 pruebas de arquitectura que leen los `.csproj` y hacen fallar la compilación si se rompe la dirección de dependencias, si el núcleo toca un driver o si un proveedor referencia a otro.
- 3 pruebas de integración de `/api/health`, incluida una que comprueba que la respuesta no filtra credenciales.

*Frontend*
- Angular 22.1.0 generado, zoneless y con Signals; encaja con la decisión del plan de no usar NgRx.
- Estructura de carpetas `core / shared / layout / features/*`.
- **Design tokens** en `src/styles/_tokens.scss` con toda la paleta, tipografías y medidas del mockup (§7).
- `ApplicationGateway` abstracto + `HttpApplicationGateway`, registrados en un único punto de `app.config.ts`. Ningún componente conoce host, puerto ni `HttpClient`.
- Proxy de desarrollo `/api` → `127.0.0.1:5177`.
- Pantalla provisional que verifica la conexión con la API, con 4 pruebas.

*Documentación e integración continua*
- `README.md` con requisitos, comando único y estructura.
- Tres ADR: arquitectura hexagonal, transporte local en loopback y estrategia multiplataforma.
- `build/scripts/dev.ps1` y `dev.sh`: **un solo comando** arranca API y frontend, espera a que la API responda y la detiene al salir.
- `.github/workflows/ci.yml` con matriz Windows/Linux/macOS para backend y frontend, más un job que publica la API autocontenida por Runtime Identifier.

**Verificado de verdad, no asumido:**
- `dotnet build` — 0 advertencias, 0 errores.
- `dotnet test` — 7 pruebas, todas pasan.
- `npm run build` — 220 kB iniciales.
- `npm test` — 4 pruebas, todas pasan.
- `GET /api/health` con la API real levantada → `200 OK`.
- Binding de red comprobado con `Get-NetTCPConnection`.
- `dotnet publish -r win-x64 --self-contained` → ejecutable de 107 MB generado correctamente.

**Incidencias resueltas:**
1. **Vulnerabilidad en la plantilla.** La plantilla `webapi` de .NET 10 arrastra `Microsoft.OpenApi` 2.0.0, con CVE-2026-49451 (GHSA-v5pm-xwqc-g5wc, CVSS 7.5, desbordamiento de pila con referencias circulares de esquema). `TreatWarningsAsErrors` lo convirtió en error de compilación. Elevado a 2.7.5 con una referencia directa comentada en el `.csproj`. **Revisar en futuras actualizaciones del SDK si ya viene elevada.**
2. **`.slnx` en vez de `.sln`.** .NET 10 genera el formato nuevo. Se mantiene; el plan quedó actualizado.
3. **CA1707 contra los nombres de prueba.** Los analizadores prohibían los guiones bajos de `Metodo_Escenario`. Desactivada solo para `tests/` mediante un `Directory.Build.props` propio.

*Cierre*
- `.gitattributes` que normaliza a LF. Sin él, `core.autocrlf` de Windows convertía todo a CRLF y `dev.sh` habría dejado de funcionar en Linux: `#!/usr/bin/env bash\r` no es un intérprete válido. Los `.ps1` y `.cmd` quedan forzados a CRLF.
- Commit inicial `4ba1319`: 71 archivos, 4861 inserciones. Sin remoto configurado.

**No hecho:**
- `Druse.ProviderContractTests` está vacío a propósito: se llena en las Fases 2 y 4.
- Sin trimming ni ReadyToRun en la publicación (107 MB). Optimizar en la Fase 7.

**Archivos creados/modificados:** 70 archivos versionables. Los principales:
- `README.md`, `.editorconfig`, `.gitignore`, `.github/workflows/ci.yml`
- `backend/Directory.Build.props`, `backend/tests/Directory.Build.props`
- `backend/src/Druse.Host.LocalApi/Program.cs`
- `backend/tests/Druse.UnitTests/ArchitectureRulesTests.cs`
- `backend/tests/Druse.IntegrationTests/HealthEndpointTests.cs`
- `frontend/src/styles/_tokens.scss`, `frontend/src/styles.scss`
- `frontend/src/app/core/application-gateway/*`, `app.ts`, `app.html`, `app.scss`, `app.config.ts`, `app.spec.ts`
- `frontend/proxy.conf.json`, `frontend/angular.json`
- `build/scripts/dev.ps1`, `build/scripts/dev.sh`
- `docs/decisions/0001…0003`

---

### Sesión 001 — 2026-08-11 · Arranque

**Hecho:**
- Analizado el plan completo y los dos mockups; confirmado el de referencia.
- Extraídas paleta, tipografías y medidas del mockup (§7).
- Verificado el toolchain instalado.
- **Cambio de nombre:** «Quarzo Studio» → **Druse**, con verificación previa de colisiones. Se descartó Geode por Apache Geode.
- Renombradas las 40 referencias del plan y el archivo a `PLAN_TRABAJO_DRUSE.md`.
- Creada esta bitácora.

**Notas:** el cambio de nombre se hizo antes de generar código, así que no hubo que tocar namespaces ni `.csproj`.

---

## 6. Decisiones

### Tomadas

| ID | Decisión | Resuelto |
| --- | --- | --- |
| D-01 | **Raíz del repositorio: `druse/`** dentro de `P:\Proyectos\Trabajo\DB STUDIO`. La carpeta contenedora conserva su nombre; el repositorio lleva el del producto. | 2026-08-11 |
| D-02 | **Mockup de referencia: `docs/mockups/druse-main.html`** (antes `Quarzo Studio.dc .html`). Incluye el diálogo «Nueva conexión»; el otro queda como `druse-main-v0.html`. El diseño se mantiene tal cual. | 2026-08-11 |
| D-03 | **El mockup HTML es la fuente de verdad**, no un PNG. Los tokens ya se extrajeron a SCSS; la comparación visual se hará por captura. | 2026-08-11 |
| D-04 | **Angular 22.1.0**, zoneless, con Signals y Vitest. Sin NgRx hasta que haya necesidad comprobada. | 2026-08-11 |
| D-05 | **Nombre del producto: Druse**, sin sufijo. Ver §3. | 2026-08-11 |
| D-07 | **Fuentes empaquetadas con `@fontsource`**, no enlazadas desde Google Fonts. La aplicación funciona sin conexión. Inter y JetBrains Mono son de licencia abierta (SIL OFL). | 2026-08-11 |
| D-09 | **Formato de solución `.slnx`**, el nuevo de .NET 10. Requiere VS 2022 17.13+ o Rider recientes. | 2026-08-11 |
| D-12 | **Monaco se carga con su cargador AMD desde `assets`**, no como ESM a través del bundler. Sus *web workers* se resuelven solos y queda fuera del bundle inicial. Encapsulado por completo en `SqlEditor`. | 2026-08-11 |
| D-13 | **`dompurify` fijado con `override` a ^3.4.13** en lugar de degradar Monaco. Revisar cuando Monaco actualice su dependencia. | 2026-08-11 |
| D-10 | **La integración continua no genera instaladores todavía.** Compila, prueba y verifica la publicación autocontenida. El empaquetado llega en la Fase 7 (ADR 0003). | 2026-08-11 |

### Abiertas

| ID | Decisión | Opciones | Estado |
| --- | --- | --- | --- |
| D-08 | Biblioteca de cuadrícula | Aplazada a propósito. La cuadrícula es una rejilla CSS propia, aislada en `results-grid`. Con 500 filas se comporta bien; la decisión entre AG Grid Community y virtualización propia se toma cuando haya que subir ese límite. | Abierta — **Fase 6** |
| D-15 | Selector de base de datos | PostgreSQL no permite cambiar de base sin reconectar, así que el explorador solo muestra los esquemas de la base de la sesión. Falta decidir si abrir una sesión nueva por base o pedirle al usuario que cree otra conexión. | Abierta — Fase 4, al comparar con SQL Server |
| D-16 | Paginación de resultados | El pie muestra el rango pero no navega: hoy se trae un único bloque de 500 filas. Decidir entre paginación por `OFFSET` (cambia el SQL del usuario) o desplazamiento sobre un cursor. | Abierta — Fase 6 |
| D-11 | Optimización del ejecutable | La publicación autocontenida pesa 107 MB. Evaluar trimming y ReadyToRun. | Abierta — Fase 7 |
| D-14 | Estado del shell | Hoy vive en Signals dentro de `AppShell`. Al llegar los datos reales hay que decidir si se reparte en servicios por funcionalidad. Sigue en pie no incorporar NgRx sin necesidad comprobada. | Abierta — Fase 2 |

_D-06 (wordmark) quedó resuelta al construir el shell: la barra superior dice «Druse». El HTML del mockup no se retocó._

---

## 7. Referencia extraída del mockup

Fuente: `docs/mockups/druse-main.html`. **Ya implementado** en `frontend/src/styles/_tokens.scss`; esta tabla queda como referencia legible.

### Paleta

| Rol | Token | Hex |
| --- | --- | --- |
| Fondo exterior / ventana | `--dr-surface-outer` | `#07080B` |
| Fondo principal (editor, main) | `--dr-surface-base` | `#0B0D11` |
| Superficie de paneles | `--dr-surface-panel` | `#0E1219` |
| Top bar | `--dr-surface-topbar` | `#101420` |
| Barra de estado | `--dr-surface-statusbar` | `#0C1018` |
| Encabezado de cuadrícula | `--dr-surface-grid-header` | `#121824` |
| Superficie elevada / botón | `--dr-surface-raised` | `#1B2233` |
| Borde principal | `--dr-border` | `#1E2534` |
| Borde secundario | `--dr-border-subtle` | `#232A38` |
| Acento primario | `--dr-accent` | `#6C8BFF` |
| Acento claro (hover/iconos) | `--dr-accent-bright` | `#9FB0FF` |
| Acento secundario (violeta) | `--dr-accent-alt` | `#9A7CFF` |
| Éxito / conectado | `--dr-success` | `#3DDC97` |
| Texto principal | `--dr-text` | `#E4E8F1` |
| Texto secundario | `--dr-text-secondary` | `#C9D3E6` |
| Texto atenuado | `--dr-text-muted` | `#B9C2D4` |
| Texto terciario | `--dr-text-tertiary` | `#8B96AB` |
| Texto tenue | `--dr-text-faint` | `#66728A` |

### Tipografías

- UI: **Inter** (400, 500, 600, 700), tamaño base 13px.
- Código / SQL: **JetBrains Mono** (400, 500, 700).
- Ver D-07: hay que empaquetarlas, no enlazarlas.

### Medidas del layout (lienzo 1440×900)

| Zona | Token | Medida |
| --- | --- | --- |
| Top bar | `--dr-topbar-height` | 46px |
| Sidebar de conexiones | `--dr-sidebar-width` | 274px (redimensionable) |
| Encabezado de sidebar | `--dr-sidebar-header-height` | 38px |
| Barra de pestañas | `--dr-tabs-height` | 36px |
| Toolbar del editor | `--dr-editor-toolbar-height` | 42px |
| Canaleta de números de línea | `--dr-editor-gutter-width` | 44px |
| Panel de resultados | `--dr-results-height` | 322px (redimensionable) |
| Encabezado de resultados | `--dr-results-header-height` | 36px |
| Encabezado de la cuadrícula | `--dr-grid-header-height` | 31px |
| Barra de estado | `--dr-statusbar-height` | 26px |
| Radio de la ventana | `--dr-radius-window` | 10px |

---

## 8. Seguimiento por fases

| Fase | Descripción | Estado |
| --- | --- | --- |
| 0 | Preparación y decisiones | ✅ **Cerrada** — 9/9 |
| 1 | Shell visual basado en el mockup | ✅ **Cerrada** — 8/8 |
| 2 | Flujo vertical PostgreSQL | ✅ **Cerrada** — 11/11 |
| 3 | Persistencia local y seguridad | 🔄 **Activa** — 0/10 |
| 4 | SQL Server | ⬜ No iniciada |
| 5 | Productividad del editor | ⬜ No iniciada |
| 6 | Resultados y exportaciones | ⬜ No iniciada |
| 7 | Empaquetado de escritorio | ⬜ No iniciada |
| 8 | MySQL y estabilización | ⬜ No iniciada |

### Fase 0 — criterio de salida ✅

> «La solución compila, Angular inicia, la API responde en `/api/health` y existe un único comando documentado para ejecutar ambos proyectos en desarrollo.»

Los cuatro puntos están verificados con ejecución real, no por inspección.

### Fase 1 — criterio de salida ✅

> «La pantalla reproduce el mockup con proporciones, colores y comportamiento de paneles consistente, todavía sin conexión real.»

Proporciones y colores salen de los tokens extraídos del propio mockup, y los dos paneles se redimensionan con ratón y con teclado. **Pendiente el visto bueno a ojo**: la comparación por captura no se pudo hacer.

### Fase 2 — criterio de salida ✅

> «Un usuario puede conectarse a PostgreSQL, navegar hasta una tabla, ejecutar un `SELECT`, ver el resultado y cancelar una consulta larga.»

Los cinco pasos están verificados contra PostgreSQL 18.4 real, no simulado.

### Fase 3 — detalle

- [ ] Crear la base SQLite local.
- [ ] Guardar perfiles sin incluir la contraseña en texto plano.
- [ ] Integrar el almacén seguro del sistema operativo para secretos.
- [ ] Guardar historial de consultas.
- [ ] Guardar pestañas recientes y preferencias.
- [ ] Implementar perfiles de color para producción, pruebas y desarrollo.
- [ ] Ocultar información sensible de logs y excepciones.
- [ ] Agregar token temporal entre Angular y la API local.
- [ ] Restringir CORS al origen de la aplicación. _(Hecho parcialmente: hay política para el origen de desarrollo.)_
- [ ] Implementar `IAppPaths` e `ISecretStore` sin dependencias del sistema operativo en Application.

**Criterio de salida:** cerrar y abrir la aplicación conserva conexiones, historial y preferencias sin almacenar contraseñas legibles.

---

## 9. Riesgos y notas técnicas abiertas

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| **La contraseña se pide en cada conexión** | Molesto de usar; empuja a soluciones caseras del usuario | Es el objetivo de la Fase 3: `ISecretStore` sobre el almacén del sistema |
| **La API local no pide token** | Cualquier proceso de la máquina puede llamarla | Token temporal en la Fase 3. Mitigado en parte: solo escucha en loopback |
| Contenedor `druse-pg-test` en el 55440 | El 55432 lo ocupa `prima-postgres`, ajeno al proyecto | Puerto configurable con `DRUSE_TEST_PG_PORT` |
| Rust no instalado | Bloquea la Fase 7 | Instalar antes de empezarla; no urge |
| Ejecutable de 107 MB | Instalador pesado | D-11: trimming y ReadyToRun en la Fase 7 |
| Dependencias con vulnerabilidades en plantillas | Ya pasó dos veces: `Microsoft.OpenApi` y `dompurify` | En backend lo caza `TreatWarningsAsErrors`; en frontend, `npm audit` en cada instalación |
| 3 vulnerabilidades moderadas en `@angular/cli` | Solo desarrollo; no llegan al bundle | Esperar actualización de Angular. Degradar a la 21 sería peor |
| Fidelidad visual no comprobada a ojo | El shell podría desviarse del mockup en detalles | Revisar con `npm start` junto a `docs/mockups/druse-main.html` |
| Los datos simulados podrían filtrarse a producción | `mock-workspace.ts` es solo de la Fase 1 | Debe borrarse en la Fase 2. Ningún componente lo importa: solo `AppShell` |
| Identificador `druse` no reservado | Podría ocuparlo otro | Reservar dominio, org de GitHub y NuGet/npm cuando haya algo publicable |

---

## 10. Convención para actualizar esta bitácora

Al cerrar cada sesión:

1. Agregar una entrada nueva en §5, arriba de las anteriores (**Hecho**, **Verificado**, **No hecho**, **Archivos**).
2. Actualizar la tabla de §1 y el «Qué toca retomar».
3. Mover a **Decisiones tomadas** lo que se haya resuelto en §6.
4. Actualizar los checkboxes de §8 y del plan maestro.
5. Registrar cualquier riesgo nuevo en §9.
