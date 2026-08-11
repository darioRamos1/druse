# ADR 0002 — Transporte local por HTTP en loopback

- **Fecha:** 2026-08-11
- **Estado:** aceptada
- **Fase:** 0

## Contexto

El frontend Angular necesita hablar con la lógica en .NET. Es una aplicación de escritorio: ambos procesos viven en la misma máquina y no hay servidor remoto. Durante el desarrollo conviene poder ejecutar y depurar cada parte por separado, pero al empaquetar con Tauri (Fase 7) el mecanismo puede cambiar.

## Decisión

Durante el desarrollo, Angular y la API .NET se ejecutan como **procesos locales separados**, comunicados por **HTTP sobre la interfaz de loopback**.

- La API escucha exclusivamente en `127.0.0.1` y `::1`, mediante `ListenLocalhost` en `Program.cs`. Nunca en `0.0.0.0`.
- El puerto por defecto es 5177, configurable con `LocalApi:Port`.
- El servidor de desarrollo de Angular redirige `/api` hacia la API con `frontend/proxy.conf.json`.
- Ningún componente Angular conoce host ni puerto: todos usan rutas relativas a través del gateway.

El acoplamiento se contiene con la abstracción **`ApplicationGateway`** (`frontend/src/app/core/application-gateway/`). Los componentes dependen de la clase abstracta; `HttpApplicationGateway` es solo una implementación, elegida en un único proveedor de `app.config.ts`.

## Alternativas descartadas

- **IPC de Tauri desde el principio.** Ataría el desarrollo a Tauri antes de haber validado el flujo vertical, y volvería incómodo depurar el frontend en el navegador.
- **Alojar Angular dentro de ASP.NET.** Un solo proceso, pero se pierde el servidor de desarrollo con recarga en caliente y se mezcla el ciclo de vida de ambas partes.
- **WebSocket.** Complejidad innecesaria para peticiones y respuestas. Podrá evaluarse para resultados en streaming.

## Consecuencias

**A favor**

- Cada parte se ejecuta y depura por separado.
- El contrato queda descrito por OpenAPI y el cliente Angular podrá generarse.
- Cambiar a IPC en la Fase 7 es sustituir una implementación del gateway, no reescribir componentes.

**En contra**

- Hay dos procesos que administrar; por eso existe el script único `build/scripts/dev.ps1`.
- Un puerto local fijo puede chocar con otra aplicación. En la Fase 7 pasará a ser dinámico.

## Pendiente para fases posteriores

- **Fase 3:** token temporal entre Angular y la API, y CORS restringido al origen de la aplicación.
- **Fase 7:** puerto dinámico o IPC, y cierre ordenado de la API al cerrar la ventana.
