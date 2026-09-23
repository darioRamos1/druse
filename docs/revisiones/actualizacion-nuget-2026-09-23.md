# Actualización de avisos NuGet — 23 de septiembre de 2026

El PR #33 cambia cinco dependencias directas. La API de Comunidad resultante mantiene 37 entradas NuGet/runtime, pero doce versiones no estaban documentadas. El empaquetado se detenía correctamente en la primera, `Microsoft.AspNetCore.OpenApi/10.0.12`.

Se añaden fichas para esas doce versiones, conservando las 37 fichas históricas. El índice distribuido se sigue limitando al grafo `.deps.json` publicado; no se distribuyen todas las versiones del catálogo.

## Fuentes contrastadas

| Componentes | Versión | Origen de los textos |
| --- | --- | --- |
| Microsoft.AspNetCore.OpenApi | 10.0.12 | NuGet y `dotnet/dotnet`, commit `95017c711e6afc1085133d440e42b4bd78155701`, subdirectorio `src/aspnetcore` |
| Microsoft.Data.Sqlite y Microsoft.Data.Sqlite.Core | 10.0.12 | El mismo commit de `dotnet/dotnet`, subdirectorio `src/efcore` |
| Microsoft.Data.SqlClient, Extensions.Abstractions e Internal.Logging | 7.1.0 | `dotnet/SqlClient`, commit `744f4f0aa264c751120e5b909e8591ec5754638f` |
| Microsoft.Data.SqlClient.SNI.runtime | 7.1.0 | `LICENSE.txt` incluido en el NuGet |
| Microsoft.OpenApi | 2.12.2 | `Microsoft/OpenAPI.NET`, commit `a24aac560adbf013ff5aa63a873e5a7babce38d2` |
| SQLitePCLRaw.core | 3.0.5 | `ericsink/SQLitePCL.raw`, commit `ed046114d5a30534e13294d94d78eb73de896ad4` |
| Microsoft.Bcl.Cryptography, System.Configuration.ConfigurationManager y System.Security.Cryptography.ProtectedData | 9.0.18 | NuGet y `dotnet/runtime`, commit `d839c41c85988aadc213e8e42269ecd7883a1790` |

Los commits proceden de los `.nuspec` de las versiones exactas. Se contrastó cada aviso local con su entrada en el archivo `.nupkg`; se registran hashes SHA-256 tanto del paquete como del `.nuspec`. Para upstream, el contenido descargado coincide con el identificador del blob del árbol de Git y su SHA-256 queda archivado. Esto identifica la evidencia; no demuestra una reconstrucción del NuGet.

Solo hacen falta dos textos nuevos: los avisos de .NET Runtime para 9.0.18 y `NOTICE.TXT` de SQLitePCLRaw 3.0.5. Los demás coinciden con textos existentes y se referencian por sus bytes, conservando la procedencia de la nueva versión en cada ficha. La licencia de SNI 7.1.0 coincide con la de 6.0.2; no se interpreta esa coincidencia como aprobación de SignPath.

## Validación

- Publicación `Release`, Windows x64, autocontenida, sin Oracle ni Informix: correcta.
- Arranque de esa API: ofrece MySQL, PostgreSQL, SQLite y SQL Server y ejecuta `SELECT 42` en SQLite.
- Pruebas unitarias del backend: 671 aprobadas, 14 omitidas de JDBC/Informix; ninguna fallida. Las omisiones no prueban esos casos.
- El copiador sigue exigiendo versiones exactas y rechazando textos alterados o rutas externas; sus pruebas pasan. Con el índice renovado selecciona 37 entradas y 38 archivos de avisos.

Las pruebas de arranque no acreditan conexiones reales a SQL Server, MySQL ni PostgreSQL. La ejecución de Comunidad del PR comprueba además el empaquetado del instalador. Se mantienen pendientes la aceptación de SNI por SignPath y la revisión completa de redistribución y fuente correspondiente.
