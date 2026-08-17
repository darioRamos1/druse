# Druse

Aplicación de escritorio para administrar y consultar distintos motores de bases de datos desde una interfaz moderna y personalizable.

Una *drusa* es la costra de cristales que tapiza el interior de una geoda: la estructura que aparece al abrir la piedra. Es lo que hace la aplicación con una base de datos.

> **Estado: primera beta (0.1.0).** Funciona el flujo completo contra **PostgreSQL, SQL Server y MySQL/MariaDB**: conectar, explorar el catálogo, escribir SQL con ayudas de esquema, ejecutar, cancelar, consultar el historial, **exportar e importar CSV o Excel** y **editar filas desde la cuadrícula**, todo dentro de una aplicación de escritorio que no necesita .NET ni Node.js instalados. Ver las [notas de la versión](docs/release-notes/0.1.0-beta.md).

## Editar, importar y exportar

Lo que escribe en tus datos comparte tres reglas: **va en una transacción**, usa
parámetros y **te enseña el SQL antes de ejecutarlo**.

| Acción | Dónde | Qué exige |
| --- | --- | --- |
| Editar filas | Doble clic en una celda del resultado | Que la pestaña venga de una tabla con clave primaria y que esa clave esté entre las columnas |
| Importar | Icono en la tabla, dentro del explorador | Ver antes la correspondencia de columnas y que ningún valor sea imposible |
| Componer consultas | Icono en la tabla, dentro del explorador | Nada: no escribe en la base, solo produce SQL |

Al editar, **cada instrucción tiene que afectar exactamente a una fila**. Si toca
cero —la fila ya no está— o más de una —la clave no era única—, se deshace todo.
Al importar, las columnas se emparejan **por nombre y nunca por posición**, y si
un solo valor no cabe en su columna no entra nada.

## Exportar

El botón **Exportar** del panel de resultados manda la consulta al servidor y descarga el archivo completo, **no solo las 500 filas que muestra la cuadrícula**.

| Formato | Límite | Notas |
| --- | --- | --- |
| CSV | 1 000 000 filas | UTF-8 con BOM, para que Excel no rompa los acentos |
| Excel | 200 000 filas | El formato XLSX obliga a construir el libro en memoria |

El CSV sigue el RFC 4180: entrecomilla los valores con separador, comillas o saltos de línea. Los valores se escriben tal y como los devuelve el motor, sin que Excel los reinterprete.

**Exportar no salta las protecciones**: una instrucción destructiva sigue necesitando confirmación y una conexión de solo lectura sigue rechazando escrituras.

---

## Requisitos

| Herramienta | Versión mínima | Para qué |
| --- | --- | --- |
| .NET SDK | 10.0 | API local y proveedores |
| Node.js | 22 o superior | Frontend Angular |
| Docker | — | Solo para las bases de datos de pruebas |
| Rust (cargo) | estable | Solo para el envoltorio de escritorio |
| MSVC Build Tools | 2022 | En Windows: el enlazador que necesita Rust |
| libxml2 | — | **Solo en Linux**: dependencia nativa del driver de Informix |

En Linux, el driver de Informix es una biblioteca nativa de IBM que depende de `libxml2`. No viaja en el paquete de NuGet, así que hay que instalarla aparte:

```bash
sudo apt-get install libxml2   # Debian y Ubuntu
```

Sin ella, la primera conexión a Informix falla con un mensaje sobre `libxml2.so.2`. Los otros tres motores no la necesitan.

En Windows, Rust por sí solo no basta: necesita el enlazador de Microsoft. Se instala con

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools
# y en el instalador, marcar «Desarrollo para el escritorio con C++»
```

## Empaquetar como aplicación de escritorio

```powershell
./build/scripts/package.ps1                       # instalador para esta máquina
./build/scripts/package.ps1 -SkipInstaller        # solo preparar el contenido
./build/scripts/package.ps1 -Runtime linux-x64
```

Publica la API de forma **autocontenida** y la mete dentro del paquete, de modo que quien instale Druse **no necesita .NET ni Node.js**.

Al empaquetar cambian dos cosas respecto al desarrollo:

- **La API usa un puerto que le asigna el sistema**, no el 5177. Publica el puerto y su token en `endpoint.json`, dentro del directorio de datos.
- **Tauri lee ese archivo** y se lo pasa al frontend. En desarrollo esa misma función la cumple el proxy del servidor de Angular. El resto de la aplicación no distingue un caso del otro.

### Firmar los artefactos

Sin firmar, Windows enseña el aviso de SmartScreen en cada equipo donde se abre la aplicación. No es que sospeche del código: es que no sabe quién lo hizo.

```powershell
$env:DRUSE_SIGN_THUMBPRINT = 'huella del certificado'
./build/scripts/package.ps1 -Portable
```

La huella es la de un certificado **ya instalado en el almacén de Windows**. No se admite un `.pfx` con su contraseña, y no es una omisión: desde 2023 ninguna CA pública emite certificados de firma de código en archivo, porque la clave privada tiene que vivir en hardware o en un HSM.

| Variable | Para qué |
| --- | --- |
| `DRUSE_SIGN_THUMBPRINT` | Certificado del almacén de Windows |
| `DRUSE_SIGN_COMMAND` | Herramienta propia del servicio de firma; `{path}` es el archivo. Sustituye a signtool |
| `DRUSE_SIGN_TIMESTAMP_URL` | Servidor de sellado. Por defecto, el de DigiCert |

**Sin ninguna de las tres el empaquetado funciona igual**, solo que los artefactos salen sin firmar y el script lo dice al empezar, no al terminar.

Se firma el ejecutable, los dos instaladores y **también la API que viaja dentro**: Tauri no la toca, y un instalador firmado que suelta un binario sin firmar es lo que hace saltar a los antivirus corporativos. El runtime de .NET no se refirma, porque ya viene firmado por Microsoft.

Dos advertencias que evitan un chasco caro:

- **Firmar no apaga SmartScreen al instante.** Con un certificado OV el aviso puede seguir apareciendo hasta que el ejecutable acumule reputación. Los certificados EV eran la vía a la confianza inmediata, aunque ese comportamiento ha ido cambiando.
- **El sellado de tiempo no es opcional.** Sin él, la firma deja de validar el día que caduca el certificado, y fallan las copias ya repartidas.

La huella nunca se escribe en `tauri.conf.json`: es de la máquina que compila, no del proyecto. El script genera la configuración de firma al vuelo y la borra al terminar, incluso si la construcción falla.

## Atajos del editor

| Atajo | Acción |
| --- | --- |
| `Ctrl/Cmd + Enter` | Ejecutar |
| `Ctrl/Cmd + Shift + Enter` | Ejecutar solo la selección |
| `Esc` | Cancelar la consulta en curso |
| `Ctrl/Cmd + O` | Abrir un archivo `.sql` |
| `Ctrl/Cmd + S` | Guardar el archivo `.sql` activo |
| `Ctrl/Cmd + Shift + S` | Guardar como otro archivo `.sql` |
| `Ctrl/Cmd + T` | Nueva consulta |
| `Ctrl/Cmd + Shift + F` | Formatear |
| `Ctrl/Cmd + F` | Buscar en el editor |
| `Ctrl/Cmd + Espacio` | Sugerencias |

El autocompletado ofrece las tablas, vistas y columnas **que el explorador ya ha cargado**, resolviendo los alias del `FROM`: si escribes `FROM users u`, después `u.` sugiere las columnas de `users`.

En la aplicación de escritorio, abrir y guardar utiliza los selectores nativos y
`Ctrl/Cmd + S` vuelve a escribir el mismo archivo. En navegador, abrir usa el
selector web y guardar descarga un `.sql` nuevo.

## Motores soportados

| Motor | Estado |
| --- | --- |
| PostgreSQL 12 – 18 | Funcionando |
| SQL Server 2016 – 2022 | Funcionando (autenticación SQL; la integrada de Windows está en el backlog) |
| MySQL 8.0+ y MariaDB | Funcionando |
| Informix 12.10+ | Funcionando (por DRDA; en Linux necesita `libxml2`) |

Los tres superan **el mismo conjunto de 24 pruebas contractuales**, sin excepciones por motor.

En MySQL, `SCHEMA` es un sinónimo de `DATABASE`, así que el explorador muestra un esquema del mismo nombre que su base. El árbol se comporta igual en los tres motores; la alternativa habría sido ramificar por motor en la interfaz, que es justo lo que el plan prohíbe.

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
./build/scripts/test-db.ps1                    # los tres motores
./build/scripts/test-db.ps1 -Engine postgres   # solo uno
./build/scripts/test-db.ps1 -Down              # retirarlos
```

```bash
./build/scripts/test-db.sh                     # los tres motores
./build/scripts/test-db.sh sqlserver           # solo uno
./build/scripts/test-db.sh down                # retirarlos
```

| Motor | Imagen | Puerto | Variable para cambiarlo |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:18-alpine` | 55440 | `DRUSE_TEST_PG_PORT` |
| SQL Server | `mssql/server:2022-latest` | 14433 | `DRUSE_TEST_MSSQL_PORT` |
| MySQL | `mysql:8.4` | 33306 | `DRUSE_TEST_MYSQL_PORT` |

Para comprobar MariaDB basta apuntar las variables `DRUSE_TEST_MYSQL_*` a un contenedor `mariadb`: el contrato es el mismo y el proveedor no distingue entre ambos.

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
    ├── release-notes/  Notas de cada versión publicada
    └── mockups/        Mockup de referencia
```

La dirección de las dependencias apunta siempre al núcleo. Está fijada por pruebas automáticas en `backend/tests/Druse.UnitTests/ArchitectureRulesTests.cs`: si alguien agrega una referencia que rompe la arquitectura, la compilación de las pruebas falla.

## Documentación

| Documento | Contenido |
| --- | --- |
| [`PLAN_TRABAJO_DRUSE.md`](PLAN_TRABAJO_DRUSE.md) | Plan maestro: alcance, arquitectura y las 8 fases |
| [`BITACORA.md`](BITACORA.md) | Bitácora por sesión: estado actual, qué toca retomar y decisiones |
| [`docs/decisions/`](docs/decisions/) | ADR de las decisiones estructurales |
| [`docs/release-notes/0.1.0-beta.md`](docs/release-notes/0.1.0-beta.md) | Qué trae la primera beta, con qué números se comprobó y qué no garantiza |
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
