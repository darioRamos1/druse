# Corrección de dependencias y runtime de Comunidad

Fecha: 14 de octubre de 2026. Continuación del [plan de reaplicación a SignPath](../planes/plan-reaplicacion-signpath-2026-10-11.md). Esta revisión documenta una construcción local; la beta pública `v1.3.0-beta.1` conserva sus bytes originales y no incorpora estos cambios.

## Corrección aplicada

La restauración estaba bloqueada por NU1902/NU1903 en `System.Security.Cryptography.Pkcs` 8.0.1 y 9.0.13, transitivas de Oracle y SQL Server. Los avisos de Microsoft [CVE-2026-70162](https://github.com/dotnet/announcements/issues/454) y [CVE-2026-84008](https://github.com/dotnet/announcements/issues/468) identifican 8.0.2, 9.0.21 y 10.0.13 como versiones corregidas en sus respectivas ramas.

- Oracle declara directamente PKCS 8.0.2, conservando la rama de su controlador.
- SQL Server declara directamente PKCS 9.0.21.
- La API fija `RuntimeFrameworkVersion=10.0.13` cuando `SelfContained=true`. La publicación nueva incluye `Microsoft.NETCore.App` y `Microsoft.AspNetCore.App` 10.0.13 y el PKCS de ese runtime. No depende de que el equipo del usuario tenga instalado un runtime actualizado.

No se desactivó la auditoría de NuGet ni se suprimieron los avisos. La actualización de dependencias no cambia la versión de producto, conforme a AGENTS.md.

## Evidencia de la API publicada localmente

Comando de construcción desde la raíz:

```powershell
dotnet publish backend/src/Druse.Host.LocalApi/Druse.Host.LocalApi.csproj --configuration Release --runtime win-x64 --self-contained true --output artifacts/signpath-seguridad-2026-10-14/api --artifacts-path artifacts/signpath-seguridad-2026-10-14/publicacion -p:IncludeInformix=false -p:IncludeOracle=false -p:DebugType=none
```

| Archivo | Dato comprobado |
| --- | --- |
| `Druse.Host.LocalApi.dll` | SHA-256 `7212e69ce5cb256b8e4573c49c1252607622da8a65dc6e7aceb3b3e5c3905bbb` |
| `Druse.Host.LocalApi.deps.json` | SHA-256 `41e3f3aa38e00f07c5d312d23d9d442c9d029714a859327828da7ded9a6ff669` |
| `System.Security.Cryptography.Pkcs.dll` | Versión de producto `10.0.13+4099f83977f4d29604a9aeb971fb0a7bc1d5f699`; SHA-256 `38db9fbd1a34bd7d3a495c2068038477ea9aac89aa11798a68d36fbb5b7d3ef7` |
| `Druse.Host.LocalApi.runtimeconfig.json` | Ambos frameworks incluidos en 10.0.13 |

Los avisos de los dos runtime packs se contrastaron byte a byte con sus NuGet restaurados, con hash de cada documento y del `nuspec`. Los cuatro textos coinciden con los ya recopilados. Las fichas nuevas del [índice de Comunidad](../terceros/comunidad/indice.json) referencian esos mismos archivos y registran la procedencia de 10.0.13, sin modificar los textos históricos ni duplicarlos. El copiado estricto del grafo publicado selecciona 37 entradas y 41 documentos originales. El [inventario general](../licencias-dependencias.csv) registra las referencias PKCS corregidas y los runtime packs nuevos. Una futura actualización del runtime requiere revisar tanto la versión fijada como sus avisos.

La recopilación de evidencia de NuGet vinculó por hash 392 de 439 archivos de la API, incluidos los avisos copiados, con la caché examinada. Veintiocho paquetes no incluyen un aviso local por nombre en su propio NuGet; sus textos se resuelven desde el expediente versionado, como antes. No se considera resuelta la compatibilidad de licencias, la procedencia completa ni la elegibilidad para SignPath.

## Validación

- Solución completa: compilación satisfactoria, sin errores. Permanecen 448 advertencias IKVM del puente de Informix, fuera de Comunidad; no se han ocultado ni se consideran corregidas por esta tarea.
- Auditoría NuGet de los 19 proyectos, con dependencias transitivas: ningún paquete vulnerable informado por los orígenes consultados en esta fecha.
- API autocontenida: arranque con perfil temporal, lista exacta PostgreSQL/SQL Server/MySQL/SQLite y `SELECT 42` en SQLite correctos; sin Oracle, IBM ni IKVM.
- Avisos NuGet y recopilación de evidencia: pruebas de versiones exactas, runtime packs, hashes, rutas y rechazo de documentos alterados correctas.
- Pruebas contractuales de SQL Server, Oracle y SQLite: 165 correctas, con disponibilidad exigida. SQL Server y Oracle se ejecutaron en sus contenedores de pruebas, no contra bases del usuario.
- Unitarias: 699 correctas y 14 omisiones explícitas (Informix SQLI/JDBC y medición de memoria).
- Integración: 196 correctas. PostgreSQL, SQL Server y Oracle estaban disponibles; no se exige ni se declara cobertura de MySQL o Informix en esta ejecución. Algunos casos mixtos de esa suite terminan sin comprobar el motor cuando no está disponible.
- Recorrido de la guía con la nueva API autocontenida y perfil aislado: correcto. Se cargó el SQL ficticio, se comprobaron las tres ventas, el total de 60000 y la exportación CSV. El archivo vacío lo creó la herramienta de verificación; no se ejercitó el diálogo nativo de creación.

El primer intento usó una carpeta de salida fuera de `backend/`, que las pruebas de arquitectura no reconocen, y exigió globalmente motores no levantados. Ese intento no se presenta como satisfactorio; las repeticiones anteriores pasaron con la salida habitual para las unitarias y sin exigir motores ausentes en la suite mixta de integración. El código de las pruebas conserva sus guardas. La suite contractual seleccionada sí exige sus tres motores y pasó sin omisiones.

Las salidas y TRX se conservan en `artifacts/signpath-seguridad-2026-10-14/`, fuera del control de versiones. La construcción local no sustituye una ejecución de CI del commit final.

## Instalador candidato local

`./build/scripts/package.ps1 -Community` terminó correctamente con el índice final de terceros. El frontend de producción compiló, con su aviso de presupuesto inicial de 799,27 kB frente a 500 kB. Se comprobaron los avisos NuGet, Rust y nativos, y NSIS/SDK-loader WebView2. La API final volvió a superar la prueba de exclusiones, motores y SQLite.

| Artefacto final | Resultado |
| --- | --- |
| `Druse Comunidad_1.3.0_x64-setup-comunidad.exe` | 50.707.589 bytes; SHA-256 `431069a096ff82deaf26373a8c8dd337b7420e0069ccb215cf464f43275a8510` |
| Firma del actualizador `.sig` | Válida para esos bytes y la clave pública del proyecto |
| Authenticode | `NotSigned` |
| API preparada por `package.ps1` | SHA-256 de `Druse.Host.LocalApi.dll`: `2170d274d6d3c67f4ad749e9068155124932be2ca729188b373c321c9030e114` |
| PKCS preparado por `package.ps1` | SHA-256 `38db9fbd1a34bd7d3a495c2068038477ea9aac89aa11798a68d36fbb5b7d3ef7`, versión de producto 10.0.13 |
| Índice de avisos de origen | SHA-256 `db3738f9c25465eb88aa1bb7e6cb67ca3d2d48b3f04544d70c4293bfedbb66bf`, coincidente con el índice registrado dentro de la API |

El manifiesto final está en `artifacts/paquete/manifiesto-comunidad-1.3.0-win-x64.json`. El kit transferible está en `artifacts/signpath-seguridad-2026-10-14/kit-windows-limpio.zip`: instalador, `.sig`, manifiesto, hashes, SQL ficticio, protocolo y hoja de resultados. Su copia del instalador se llama `Druse-Comunidad-local-win-x64-setup.exe`; se comprobó también su firma después de copiarla.

El `candidato.json` del kit registra como base `6fc12bc852ee79847682c1a1712c63aafb65c05e` y declara los cambios de trabajo de esta tarea. No se atribuye el binario al código intacto de ese commit ni a una ejecución de CI. La fecha del manifiesto es `2026-10-15T00:01:00Z`, equivalente al 14 de octubre a las 19:01 en America/Bogota.

## Pendientes de distribución

Antes de ampliar la convocatoria, se requiere probar el candidato en Windows limpio: instalación, actualización, desinstalación y tráfico. La corrección en el repositorio y el instalador local no actualizan a quienes descargaron la beta anterior. La nueva distribución debe tener identificador y hashes propios; no sustituir el instalador dentro de la release ya publicada.

Darío confirmó que no dispone de entorno de pruebas. Este equipo usa Windows 11 Home Single Language; [Windows Sandbox no está admitido en Home](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/). La siguiente dependencia es preparar una VM con Windows. El kit local incluye protocolo, datos ficticios y una hoja de resultados inicialmente «No probado»; no se cambiaron funciones del sistema ni se instaló software de virtualización.

SNI, WebView2, consentimiento durante instalación, procedencia y revisión de terceros siguen abiertos. No se han enviado correos, publicado una nueva release ni solicitado firma.
