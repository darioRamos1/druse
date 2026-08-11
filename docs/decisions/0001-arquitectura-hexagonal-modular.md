# ADR 0001 — Arquitectura hexagonal modular

- **Fecha:** 2026-08-11
- **Estado:** aceptada
- **Fase:** 0

## Contexto

Druse debe soportar varios motores de bases de datos (PostgreSQL y SQL Server en el MVP, MySQL después) y varios envoltorios de ejecución (hoy Angular más una API local, mañana Tauri con posible transporte IPC). El riesgo principal de una herramienta así es que el dialecto de un motor concreto o el framework de turno se filtre al centro del sistema y agregar el siguiente motor obligue a tocarlo todo.

## Decisión

Se adopta **arquitectura hexagonal (Ports and Adapters) modular**, con reglas de Clean Architecture, sobre un **monolito modular local**.

Los límites son:

| Módulo | Puede conocer |
| --- | --- |
| `Druse.Domain` | nada |
| `Druse.Platform.Abstractions` | nada |
| `Druse.Database.Abstractions` | `Domain` |
| `Druse.Application` | `Domain`, `Database.Abstractions`, `Platform.Abstractions` |
| `Druse.Infrastructure`, `Druse.Persistence.Sqlite` | `Application` |
| `Druse.Provider.*` | `Database.Abstractions` y su propio driver |
| `Druse.Platform.Native` | `Platform.Abstractions` |
| `Druse.Host.LocalApi` | todo lo anterior, solo para componer dependencias |

Los proveedores se registran por inyección de dependencias. El MVP no carga DLL desconocidas en tiempo de ejecución, pero los contratos quedan listos para una futura arquitectura de plugins.

## Alternativas descartadas

- **Capas clásicas (UI / BLL / DAL).** No impide que el dialecto de un motor suba hasta la interfaz.
- **Microservicios.** Separar procesos no aporta nada a una aplicación de escritorio local y complica distribuir, depurar y trabajar sin conexión.
- **Un único proyecto.** Rápido al principio, imposible de mantener con tres motores.

## Consecuencias

**A favor**

- Agregar un motor no obliga a modificar `Domain`, `Application` ni los componentes Angular.
- Las mismas pruebas contractuales sirven para todos los proveedores.
- El núcleo se puede probar sin base de datos.

**En contra**

- Más proyectos y más ceremonia inicial.
- Hay que resistir la tentación de referenciar un driver desde `Application` cuando algo parece más fácil por ahí.

## Cumplimiento

La dirección de las dependencias no se confía a la disciplina. Está verificada por `backend/tests/Druse.UnitTests/ArchitectureRulesTests.cs`, que lee los archivos `.csproj` y falla si:

- un proyecto referencia algo fuera de su lista permitida;
- el núcleo referencia un driver, Entity Framework o ASP.NET;
- un proveedor referencia a otro proveedor;
- aparece un proyecto nuevo en `src/` sin regla declarada.
