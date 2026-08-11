# ADR 0003 — Estrategia multiplataforma

- **Fecha:** 2026-08-11
- **Estado:** aceptada
- **Fase:** 0

## Contexto

El primer instalador estable se publicará para Windows, pero ninguna decisión del núcleo debe impedir compilar para Linux y macOS. Las trampas habituales aparecen temprano y en sitios discretos: rutas con `\`, el registro de Windows, DPAPI, autenticación integrada, directorios de datos fijos.

## Decisión

La base de código debe compilar para Windows, Linux y macOS en x64 y ARM64. Para lograrlo:

1. **Ninguna llamada directa al sistema operativo fuera de `Druse.Platform.Native`.** El resto del código depende de `Druse.Platform.Abstractions`:
   - `IAppPaths` — directorios de datos y configuración de cada plataforma.
   - `ISecretStore` — Windows Credential Manager, macOS Keychain, Linux Secret Service.
   - `IFilePicker`, `IAppLifecycle`, `IPlatformInfo`.
2. **Ningún Runtime Identifier fijado en los `.csproj`.** Se pasa al publicar. `Directory.Build.props` no fija RID.
3. **La API .NET se publica autocontenida** por Runtime Identifier, para que el usuario no instale el SDK.
4. **SQLite y los documentos del usuario** viven en el directorio de datos de cada plataforma, obtenido con `IAppPaths`.
5. **La autenticación integrada de Windows no puede ser la única forma de conectarse a SQL Server.** Queda como tarea separada de la Fase 4.
6. **El contrato OpenAPI se versiona**, para desacoplar frontend y host.
7. **Compilación y pruebas en matriz** de Windows, Linux y macOS desde integración continua.

### Sobre la palabra «portable»

Se usa en dos sentidos que no deben confundirse:

1. **Portable entre sistemas operativos:** la misma base de código produce aplicaciones nativas por plataforma.
2. **Modo portable sin instalación:** distribución ZIP que guarda la configuración junto al ejecutable. Este modo **no guardará contraseñas por defecto**, porque no hay almacén seguro del sistema al que recurrir. Más adelante podrá ofrecer una bóveda cifrada con contraseña maestra.

## Consecuencias

**A favor**

- Publicar para Linux o macOS es agregar un Runtime Identifier, no reescribir.
- Las dependencias del sistema operativo quedan aisladas y son sustituibles en pruebas.

**En contra**

- Escribir una abstracción para algo que en Windows sería una línea cuesta más al principio.
- La matriz de integración continua triplica el tiempo de ejecución.

## Desviación aceptada en la Fase 0

La integración continua arranca con la matriz de los tres sistemas para compilar y ejecutar pruebas, pero **no genera instaladores**. El empaquetado por plataforma llega en la Fase 7.
