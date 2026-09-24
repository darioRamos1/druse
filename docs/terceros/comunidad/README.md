# Textos de terceros de la API de Comunidad

Recopilación inicial del 21 de septiembre de 2026 para las 37 entradas NuGet/runtime del grafo examinado. El [índice](indice.json) relaciona cada componente y versión con sus textos originales, SHA-256 y procedencia. La recopilación inicial conserva 41 archivos; varios componentes comparten textos. El 23 de septiembre se añadieron doce fichas de versiones y dos textos nuevos: véase la [revisión de la actualización](../../revisiones/actualizacion-nuget-2026-09-23.md). El catálogo contiene 49 fichas y el paquete solo selecciona las versiones de su grafo publicado.

Se han recuperado textos para las 28 entradas que no tenían aviso local en la [revisión inicial](../../revisiones/licencias-comunidad-2026-09-21.md). Esto resuelve la localización de esos textos; **no cierra la revisión de compatibilidad, redistribución ni elegibilidad para SignPath**.

## Procedencia

- Para 22 de los 28 paquetes pendientes, el `nuspec` identifica repositorio y commit. Los textos se descargaron de ese commit, comprobando el identificador del blob de Git y el SHA-256 de sus bytes.
- `Microsoft.SqlServer.Server/1.0.0` no declara commit en `nuspec`; la DLL contiene `1.0.0-dev+54ab5aef2e1b74c0971a00711fecb003b624efdf` en `ProductVersion`. El índice conserva también el hash y ruta de esa DLL como evidencia del enlace al commit.
- `ExcelNumberFormat/1.1.0` se vincula a `v1.1.0`, resuelta a `38c6a71919ad3895e3ba61d7a888012670d26303`; las cuatro entradas `SQLitePCLRaw/2.1.12`, a `v2.1.12`, resuelta a `ca835d21508bff43121c65081035840ac5006c4c`. Estas cinco correspondencias por etiqueta no prueban una reconstrucción del NuGet.
- Los avisos locales de los otros nueve paquetes se copiaron byte a byte de la evidencia recogida en NuGet. `Microsoft.AspNetCore.OpenApi/10.0.10` solo aportaba avisos de terceros: se añadió también su licencia y avisos de `src/aspnetcore` en el commit declarado por su `nuspec`.
- Para `Microsoft.Data.Sqlite`, cuyo origen es el repositorio agregado `dotnet/dotnet`, se toma la licencia de `src/efcore`, no una licencia de otro subproyecto.

No se traducen ni alteran los textos. `.gitattributes` desactiva la conversión de finales de línea en `fuentes/` para conservar los hashes al clonar. Algunos avisos upstream incluyen herramientas o componentes que pueden no viajar en Druse; preservarlos no equivale a afirmar que todos estén distribuidos. En particular, los avisos de SQLitePCLRaw abarcan variantes del proyecto, además de SQLite.

## Incorporación al paquete

`package.ps1 -Community` comprueba el grafo `.deps.json` de la API publicada y exige documentos para cada versión NuGet/runtime exacta. Copia los textos, sin descargarlos durante el build, a `api/licenses/nuget-comunidad/`, junto con un índice limitado a las versiones realmente presentes y el hash del grafo publicado. Estos recursos viajan en NSIS y portable mediante la carpeta de API existente.

Un documento modificado, una ruta fuera del expediente, una copia previa mezclada o una versión sin ficha detienen el empaquetado. **Actualizar una dependencia o el runtime de .NET exige actualizar su ficha y evidencia**, aunque solo cambie la versión de parche. No reutilizar sin revisión la licencia de otra versión.

```powershell
./build/tests/avisos-nuget-comunidad.ps1
./build/scripts/package.ps1 -Community
```

El expediente no acredita autenticidad de todos los paquetes ni cubre Rust, WebView2 o NSIS. La licencia separada de SNI está incluida, pero su aceptación por SignPath sigue pendiente. Permanecen abiertas la procedencia completa, obligaciones de código fuente y avisos por archivo, pruebas de Windows limpio y la solicitud formal.
