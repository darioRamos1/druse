# Avisos de las dependencias NuGet actualizadas — 28 de octubre de 2026

Los PR 51 y 55 proponen las mismas doce actualizaciones de dependencias del backend. El PR 55 parte de la versión 1.11.0 e incluye las referencias corregidas de PKCS de SQL Server 9.0.21 y Oracle 8.0.2. Se conservan esos parches y el runtime autocontenido 10.0.13. La actualización de dependencias no cambia la versión de Druse ni anuncia una publicación nueva.

La API de Comunidad publicada con estas dependencias tiene 37 entradas NuGet/runtime. Diez versiones no estaban en el catálogo: el empaquetado exige ahora sus fichas exactas, sin modificar sus guardas ni sustituir las fichas históricas. El catálogo conserva 61 fichas y el paquete solo incorpora las 37 que figuran en su propio `.deps.json`.

## Evidencia recopilada

Se abrieron los archivos `.nupkg` exactos restaurados desde NuGet y se calcularon SHA-256 del paquete y del `nuspec` sin normalizar bytes. Cada ficha conserva esos hashes y la dirección del paquete. Para los textos de GitHub, se comprobó que los bytes devueltos para cada commit producen el identificador de blob del repositorio y se calculó su SHA-256.

| Paquetes | Versión | Fuente de los textos |
| --- | --- | --- |
| Microsoft.AspNetCore.OpenApi | 10.0.14 | Avisos incluidos en el `.nupkg` y licencia/avisos de `src/aspnetcore` en `dotnet/dotnet`, commit `0427b9abbead3fa64c6655eb4290c537397131fa`, declarado en `nuspec` |
| Microsoft.Data.Sqlite y Microsoft.Data.Sqlite.Core | 10.0.14 | Licencia de `src/efcore` en ese mismo commit de `dotnet/dotnet`, declarado por ambos paquetes |
| Microsoft.Data.SqlClient, Extensions.Abstractions e Internal.Logging | 7.1.1 | LICENSE, COPYRIGHT.md y NOTICE.txt de `dotnet/SqlClient`, commit `29ce2d856cb5a9450f79ea62c0afc744fd337fde`, declarado por los tres paquetes |
| Microsoft.OpenApi | 2.13.0 | LICENSE de `Microsoft/OpenAPI.NET`, commit `0b8c9d697dcf0fca2d107cb79517c56d3f9ae940`, declarado en `nuspec` |
| SQLitePCLRaw.bundle_e_sqlite3, lib.e_sqlite3 y provider.e_sqlite3 | 2.1.13 | LICENSE.TXT y NOTICE.TXT de `ericsink/SQLitePCL.raw`, commit de mantenimiento `0873d14f6dcb3a8537444679468499ab9f5a782a` |

SQLitePCLRaw 2.1.13 no incluye textos de licencia dentro de esos tres `.nupkg`, ni un commit en su `nuspec`; declara Apache-2.0 y el repositorio. El historial de la rama `maint_21` identifica el commit que cambia el generador de versión a 2.1.13. Se conserva una copia original de `version_stamp/version_stamp.cs`, con su hash y blob, como evidencia de esa correspondencia. No se presenta como etiqueta de release, commit declarado por NuGet ni reconstrucción verificada del paquete.

Los textos de licencia y avisos revisados coinciden byte a byte con archivos ya conservados en el expediente. Se reutilizan sus archivos por hash y se registra la procedencia de cada versión nueva. El único archivo adicional es la evidencia del generador de SQLitePCLRaw; no se altera, traduce ni sustituye un aviso por un texto escrito para Druse.

## Comprobaciones

- Restauración y compilación `Release` de toda la solución: correctas, sin errores. Continúan los avisos de IKVM sobre clases del controlador JDBC.
- Auditoría NuGet de los 19 proyectos, con dependencias transitivas: no informa paquetes vulnerables en los orígenes consultados.
- Pruebas unitarias: 701 aprobadas y 14 omitidas; ninguna fallida. Las omisiones de JDBC/Informix y la medición opcional de memoria no acreditan esos recorridos.
- Pruebas contractuales: 402 aprobadas; ninguna fallida.
- Pruebas de integración: 173 aprobadas y 79 omitidas por sus requisitos de servidores; ninguna fallida.
- Las pruebas se ejecutaron desde salidas aisladas. Las unitarias necesitan una ruta dentro de `backend` para localizar la solución y los catálogos de idiomas; se repitió la suite completa desde esa ubicación, sin filtrar casos ni modificar pruebas.
- TypeScript de la aplicación, guarda de idiomas y las seis pruebas de Novedades: correctos.
- Pruebas de avisos NuGet, evidencia de licencias y avisos del frontend: correctas. Se comprobaron los hashes de todos los documentos y la ausencia de fichas duplicadas en el catálogo.
- `package.ps1 -Community -SkipInstaller`: correcto; la selección contiene 37 entradas exactas y 37 textos únicos, junto a los avisos del frontend y de Rust/nativos.
- `comunidad-publicada.ps1`: la API arranca sin Oracle, IBM ni IKVM, ofrece los cuatro motores de Comunidad y ejecuta `SELECT 42` en SQLite.

No se ha construido un instalador NSIS en esta comprobación local ni probado conexiones a servidores externos. Las comprobaciones no resuelven la revisión jurídica de redistribución, la aceptación de SNI por SignPath ni las pruebas de Windows limpio.
