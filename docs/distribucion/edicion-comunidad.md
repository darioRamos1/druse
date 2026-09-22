# Edición Comunidad — candidata a revisión

La edición Comunidad conserva PostgreSQL, SQL Server, MySQL/MariaDB y SQLite. Excluye los proveedores de Oracle e Informix, los controladores de Oracle/IBM y el puente JDBC/IKVM. La edición completa sigue disponible en el código.

Esta separación aplica la vía que SignPath indicó en su respuesta del 16 de septiembre. **No acredita elegibilidad ni firma concedida:** Microsoft SNI y WebView2 siguen sin aclaración expresa, y quedan obligaciones de redistribución y pruebas de Windows pendientes.

## Construcción y comprobaciones

Desde la raíz, con .NET 10, Node, Rust, las herramientas de Windows y Tauri CLI 2.11.4:

```powershell
npm ci --prefix frontend
./build/scripts/package.ps1 -Community -SkipInstaller
./build/tests/comunidad-publicada.ps1
./build/scripts/package.ps1 -Community
```

`-Community` no se combina con `-WithoutInformix`. La primera opción publica la API con `IncludeOracle=false` e `IncludeInformix=false`; por omisión ambos proveedores siguen incluidos. El inventario del paquete rechaza los archivos excluidos aunque una dependencia transitiva los reintroduzca. La prueba del paquete examina también el grafo `.deps.json`, arranca la API con datos temporales, comprueba sus cuatro motores y ejecuta `SELECT 42` en SQLite.

El instalador se identifica como **Druse Comunidad** (`io.druse.comunidad`) y los artefactos llevan `-comunidad`. Su canal de actualización es `windows-x86_64-comunidad`, sin fallback a la completa ni a la edición sin Informix. Las preferencias/conexiones de la API conservan la ubicación de Druse; no se anuncia aislamiento de perfiles entre ediciones.

El workflow [comunidad.yml](../../.github/workflows/comunidad.yml) construye en un runner Windows alojado por GitHub y conserva instalador e inventario bajo un nombre que contiene el SHA del commit. No usa secretos de firma, no publica una release y no envía artefactos a SignPath.

`release.ps1` prepara las tres ediciones y añade `windows-x86_64-comunidad` al mismo `latest.json` que consulta el actualizador. Exige instalador, firma, URL HTTPS de la release y manifiesto de contenido propios; las firmas y los instaladores no pueden cruzarse entre ediciones. Los tres inventarios y la evidencia se conservan junto a los artefactos. Antes de publicar exige el workflow de Comunidad y CI general satisfactorios para el commit exacto; un intento nuevo pendiente invalida un verde anterior. El selector existente sigue ofreciendo las dos ediciones anteriores; Comunidad tiene su descarga directa. No se ha publicado todavía este canal ni se ha probado una actualización en Windows limpio.

Comunidad está limitada a `win-x64` en este expediente. Incluye 165 textos únicos de Rust y los avisos del SDK/loader WebView2, NSIS y su complemento Tauri. Cambios de Cargo.lock/Cargo.toml, documentos o bibliotecas nativas requieren renovar la evidencia. Los detalles y límites están en [Rust](../terceros/comunidad-rust/README.md) y [componentes nativos](../terceros/comunidad-nativos/README.md).

## Evidencia local del 21 de septiembre de 2026

- API autocontenida `win-x64`: 401 archivos, 140.790.551 bytes incluyendo avisos legales.
- Sin archivos ni dependencias de ejecución Oracle, IBM o IKVM; SNI aparece expresamente como pendiente en el manifiesto.
- API iniciada, lista exacta de cuatro motores y consulta SQLite correctas con datos temporales independientes del perfil del usuario.
- Frontend de producción compilado; persiste el aviso de presupuesto inicial (649,27 kB frente al umbral orientativo de 500 kB).
- Las pruebas de exclusión del paquete incluyen la reintroducción accidental de Oracle/IBM y comprueban que los avisos legales no sean excluidos.

El manifiesto detallado local se genera en `artifacts/paquete/`. Estas pruebas no sustituyen una instalación/desinstalación en Windows limpio ni la revisión completa de tráfico.

## Instalador y validación completados el 21 de septiembre

El [PR #18](https://github.com/darioRamos1/druse/pull/18) se integró en `main`. La [construcción de Comunidad en GitHub](https://github.com/darioRamos1/druse/actions/runs/35625598733) terminó correctamente para la revisión `7dddc0c5e2804702ace58a4ccd849b526bb35ba7`. El checkout de integración de ese PR fue `b5e1d87f8a686322fb1551143d42196dc75a63ba`, que identifica el artefacto de Actions.

- Instalador: `Druse Comunidad_1.1.0_x64-setup-comunidad.exe`, 50.447.507 bytes.
- SHA-256: `7b0905b2286bd40bdb184b33c4003b1b19bfd10cc16cd8839c9ce7eff076dc0c`, comprobado tras descargarlo contra el manifiesto final de CI.
- Authenticode: `NotSigned`. El artefacto de Actions se conserva durante 14 días; todavía no es una release pública estable ni una firma concedida por SignPath.
- CI de Comunidad: exclusiones, arranque de la API y SQLite, cuatro pruebas Rust del actualizador y construcción NSIS aprobados. No equivale a ejecutar la CI general de todos los proveedores.
- Frontend local con Vitest 4.1.11: **969 pruebas aprobadas en 69 archivos**. El primer intento tuvo tres timeouts durante la compilación simultánea de Rust; la repetición completa sin esa carga pasó sin modificar las pruebas.
- Verificaciones locales del inventario y de releases existentes aprobadas; también se generó un instalador local, cuyos bytes son distintos del artefacto de GitHub.

La landing tiene despliegue satisfactorio en [GitHub Pages](https://github.com/darioRamos1/druse/actions/runs/35624053451), en `https://darioramos1.github.io/druse/`. La lectura HTTP desde el equipo local agotó el tiempo de espera, por lo que no se registra aquí una comprobación visual de esa URL pública.

## Pendientes antes de solicitar la firma

Actualización del 22 de septiembre: el [PR #22 y su instalador](../revisiones/comunidad-2026-09-22.md) incorporan los 41 avisos NuGet y los cinco del frontend. La nueva revisión registra hashes distintos para los instaladores de GitHub y local; reemplaza los anteriores como evidencia más reciente. Las comprobaciones de CI, API/SQLite, inventario y firma local del actualizador pasan. Continúa sin Authenticode y sin prueba de instalación en Windows limpio.

1. Aclarar con SignPath SNI, WebView2 y el lugar del consentimiento de actualizaciones. La respuesta anterior no aprobó esos tres puntos.
2. Completar avisos y reconciliación de terceros del artefacto final, procedencia y condiciones de distribución.
3. Probar instalación, actualización, desinstalación y tráfico real según el protocolo de Windows limpio.
4. Publicar una beta revisada con hashes y procedencia de construcción; presentar el artefacto exacto y los enlaces públicos.
