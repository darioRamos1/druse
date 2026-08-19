# Druse

Guía práctica: levantar los servicios a mano y generar los instaladores

*Versión 0.1.0 beta · 18 de agosto de 2026 · Windows, con notas para Linux y macOS*

Todo lo de esta guía se ejecuta desde la carpeta del repositorio (donde están las carpetas backend, frontend, shells y build) y con **PowerShell**. Si una ruta lleva espacios —como «DB STUDIO»— no pasa nada: los scripts ya lo tienen en cuenta.

```powershell
# Colócate primero en el repositorio
cd "P:\Proyectos\Trabajo\DB STUDIO\druse"
```

## 1. Qué hay que tener instalado

Solo hace falta la primera vez. La columna «¿cuándo?» dice si puedes saltártelo según lo que vayas a hacer.

| Herramienta | Versión | ¿Cuándo hace falta? |
| --- | --- | --- |
| .NET SDK | 10.0 | Siempre (es la API local) |
| Node.js | 22 o superior | Siempre (es la interfaz) |
| Rust (cargo) | estable | Solo para la app de escritorio y los instaladores |
| MSVC Build Tools 2022 | — | En Windows, junto con Rust: es su enlazador |
| Tauri CLI | 2.x | Solo para la app de escritorio y los instaladores |
| Docker Desktop | — | Solo para las bases de datos de prueba |

Instalación en Windows, una línea por herramienta:

```powershell
winget install --id Microsoft.DotNet.SDK.10
winget install --id OpenJS.NodeJS.LTS
winget install --id Rustlang.Rustup
winget install --id Microsoft.VisualStudio.2022.BuildTools
winget install --id Docker.DockerDesktop

# El CLI de Tauri se instala con cargo, no con winget
cargo install tauri-cli --version "^2"
```

> [!WARNING]
> En el instalador de Visual Studio Build Tools hay que marcar la carga de trabajo **«Desarrollo para el escritorio con C++»**. Sin ella, Rust compila a medias y falla con un error que no explica la causa.

La primera vez, y cada vez que cambien las dependencias del frontend, hay que descargar los paquetes de Node:

```powershell
cd frontend
npm install
cd ..
```

## 2. Levantar Druse en desarrollo

### 2.1 La forma corta: un solo comando

Este script arranca **la API y la interfaz** y espera a que la API responda antes de abrir el navegador. Es lo que conviene usar el 90 % de las veces.

```powershell
./build/scripts/dev.ps1
```

*En Linux y macOS: ./build/scripts/dev.sh*

Cuando termine de arrancar, tendrás esto:

| Servicio | Dirección | Para qué |
| --- | --- | --- |
| Interfaz (Angular) | `http://127.0.0.1:4200` | La aplicación; ábrela en el navegador |
| API local (.NET) | `http://127.0.0.1:5177` | El motor: conexiones, consultas, respaldos |
| Comprobación de salud | `http://127.0.0.1:5177/api/health` | Si responde, la API está viva |

Para **parar todo**, pulsa Ctrl+C en esa consola: el script detiene también la API que había arrancado por su cuenta.

> [!NOTE]
> La API escucha **solo en 127.0.0.1** y exige un token. Es a propósito: nunca debe publicarse en 0.0.0.0.

### 2.2 La forma manual: cada servicio en su consola

Útil cuando quieres ver los registros por separado, reiniciar solo una parte o depurar. Abre **una consola para cada uno** y déjalas abiertas.

1. **Consola A — la API local**

```powershell
dotnet run --project backend/src/Druse.Host.LocalApi

# Con otro puerto, si el 5177 está ocupado:
$env:LocalApi__Port = 5180
dotnet run --project backend/src/Druse.Host.LocalApi
```

2. **Consola B — la interfaz**

```powershell
cd frontend
npm start
```

El servidor de Angular redirige todo lo que empiece por /api a la API local, según **frontend/proxy.conf.json**. Por eso ningún componente sabe en qué puerto está la API.

3. **Consola C — la aplicación de escritorio** (opcional)

```powershell
cd shells/desktop-tauri
cargo tauri dev
```

Abre la ventana de escritorio apuntando a la interfaz que ya corre en el 4200. Si no la necesitas, con el navegador basta.

Comprobar que la API está lista, sin salir de la consola:

```powershell
Invoke-WebRequest http://127.0.0.1:5177/api/health

# Si devuelve 200, la API está lista.
```

### 2.3 Solo la interfaz, con la API ya arrancada

```powershell
./build/scripts/dev.ps1 -SkipApi
```

## 3. Bases de datos de prueba (opcional)

Son contenedores desechables con datos que no importan. Hacen falta para las pruebas automáticas y para probar Druse contra un motor de verdad sin tocar nada real. **Docker Desktop tiene que estar arrancado** antes de lanzarlos.

```powershell
./build/scripts/test-db.ps1                    # los cuatro motores
./build/scripts/test-db.ps1 -Engine postgres   # solo uno
./build/scripts/test-db.ps1 -Down              # retirarlos
```

Con qué datos se conecta uno a ellos desde la propia aplicación:

| Motor | Puerto | Usuario | Contraseña | Base |
| --- | --- | --- | --- | --- |
| PostgreSQL | 55440 | postgres | druse\_dev\_only | druse\_test |
| SQL Server | 14433 | sa | Druse\_dev\_only\_1 | druse\_test |
| MySQL | 33306 | root | druse\_dev\_only | druse\_test |
| Informix | 9089 | informix | in4mix | druse\_test |

> [!WARNING]
> Estas contraseñas son **de usar y tirar**, solo escuchan en loopback y no deben parecerse a ninguna real.

Si ya creaste los contenedores antes, basta con volver a arrancarlos:

```powershell
docker start druse-pg-test druse-mssql-test druse-mysql-test druse-informix-test
```

### 3.1 Ejecutar las pruebas

```powershell
dotnet test backend/Druse.slnx        # backend completo
cd frontend; npm test -- --watch=false  # interfaz

# Exigiendo que los cuatro motores respondan de verdad:
$env:DRUSE_REQUIRE_ENGINES = '1'
dotnet test backend/Druse.slnx
```

Sin contenedores las pruebas **no fallan: se omiten**. Con DRUSE\_REQUIRE\_ENGINES=1, un motor que no responda rompe la ejecución en lugar de dejar una suite verde que no comprobó nada.

## 4. Generar los instaladores y el portable

Un solo script hace las tres cosas: publica la API **autocontenida**, compila la interfaz y construye el paquete. Quien instale Druse **no necesita .NET ni Node.js**: todo viaja dentro.

### 4.1 El comando de siempre

```powershell
./build/scripts/package.ps1
```

Eso produce, para esta máquina, el instalador NSIS (.exe) y el MSI.

### 4.2 Las opciones que se usan de verdad

| Opción | Qué hace |
| --- | --- |
| `-Portable` | Genera además un ZIP que se ejecuta sin instalar |
| `-WithoutInformix` | Deja fuera el driver de IBM (111 MB): el paquete sale mucho más ligero |
| `-SkipInstaller` | Publica y prepara todo pero no llama a Tauri; sirve para revisar el contenido sin esperar a la parte lenta |
| `-Runtime <rid>` | Compila para otra plataforma: win-x64, linux-x64, osx-arm64 |

```powershell
./build/scripts/package.ps1 -Portable                    # instaladores + ZIP portable
./build/scripts/package.ps1 -Portable -WithoutInformix   # lo mismo, versión ligera
```

### 4.3 Receta completa: las dos variantes, con portable

Esto es lo que se lanza para tener **todo lo que se reparte**. Tarda varios minutos: cada variante compila Rust entero.

```powershell
# 1) Variante completa (los cuatro motores) + ZIP portable
./build/scripts/package.ps1 -Portable

# 2) Variante ligera, sin Informix + ZIP portable
./build/scripts/package.ps1 -Portable -WithoutInformix
```

El script pone un sufijo a cada artefacto —**-completo** o **-sin-informix**— para que las dos variantes puedan convivir en la misma carpeta sin pisarse. Por eso el orden no importa y ninguna sobrescribe a la otra.

### 4.4 Dónde quedan los archivos

| Artefacto | Ruta (desde el repositorio) |
| --- | --- |
| Instalador NSIS (.exe) | `shells/desktop-tauri/target/<rid>/release/bundle/nsis/` |
| Instalador MSI (.msi) | `shells/desktop-tauri/target/<rid>/release/bundle/msi/` |
| ZIP portable | `shells/desktop-tauri/target/portable/` |
| API publicada (dentro del paquete) | `shells/desktop-tauri/api/` |

Donde pone \<rid\> va win-x64 en Windows. El propio script imprime al final la ruta y el tamaño de cada archivo que ha generado, así que no hace falta buscarlos a mano.

Para abrir la carpeta con los instaladores recién hechos:

```powershell
explorer shells\desktop-tauri\target\win-x64\release\bundle
explorer shells\desktop-tauri\target\portable
```

### 4.5 Firmar los artefactos (opcional)

Sin firma, Windows enseña el aviso de SmartScreen en cada equipo donde se abra la aplicación. **Sin certificado el empaquetado funciona igual**; solo salen sin firmar, y el script lo dice al empezar, no al terminar.

```powershell
$env:DRUSE_SIGN_THUMBPRINT = 'huella del certificado'
./build/scripts/package.ps1 -Portable
```

| Variable | Para qué |
| --- | --- |
| `DRUSE_SIGN_THUMBPRINT` | Certificado ya instalado en el almacén de Windows |
| `DRUSE_SIGN_COMMAND` | Herramienta propia del servicio de firma; sustituye a signtool |
| `DRUSE_SIGN_TIMESTAMP_URL` | Servidor de sellado; por defecto el de DigiCert |

> [!WARNING]
> El **sellado de tiempo no es opcional**: sin él, la firma deja de validar el día que caduca el certificado, y fallan hasta las copias ya repartidas.

## 5. Cuando algo no arranca

| Síntoma | Qué pasa y cómo se resuelve |
| --- | --- |
| cargo falla con «no se puede abrir el archivo incluir: 'excpt.h'» | Es el SDK de Windows mal enlazado con el compilador de C++ que encuentra Rust. Hay que reparar las MSVC Build Tools 2022 marcando «Desarrollo para el escritorio con C++». Mientras tanto, package.ps1 -SkipInstaller sí funciona: prepara todo salvo el instalador. |
| «La API local no respondió en /api/health» | El puerto 5177 está ocupado. Arranca con otro: ./build/scripts/dev.ps1 -ApiPort 5180 |
| Las pruebas de motores no comprueban nada | Docker Desktop no está arrancado o faltan los contenedores: ./build/scripts/test-db.ps1 |
| npm start falla nada más empezar | Faltan las dependencias: cd frontend && npm install |
| Windows avisa de SmartScreen al abrir el instalador | El artefacto no está firmado. Es esperable en las compilaciones locales; ver el punto 4.5. |
| En Linux, la primera conexión a Informix falla por libxml2 | sudo apt-get install libxml2 — el driver de IBM la necesita y no viaja en el paquete. |

## 6. Chuleta de una sola página

| Quiero… | Comando |
| --- | --- |
| Arrancar todo para trabajar | `./build/scripts/dev.ps1` |
| Arrancar solo la API | `dotnet run --project backend/src/Druse.Host.LocalApi` |
| Arrancar solo la interfaz | `cd frontend; npm start` |
| Abrir la ventana de escritorio | `cd shells/desktop-tauri; cargo tauri dev` |
| Levantar las bases de prueba | `./build/scripts/test-db.ps1` |
| Retirar las bases de prueba | `./build/scripts/test-db.ps1 -Down` |
| Pasar todas las pruebas | `dotnet test backend/Druse.slnx` |
| Generar instalador + portable | `./build/scripts/package.ps1 -Portable` |
| Lo mismo, versión ligera | `./build/scripts/package.ps1 -Portable -WithoutInformix` |
| Preparar sin construir instalador | `./build/scripts/package.ps1 -SkipInstaller` |

*Referencias del repositorio: README.md (visión general), build/scripts/dev.ps1, build/scripts/package.ps1 y build/scripts/test-db.ps1 (cada uno documenta sus parámetros con Get-Help).*
