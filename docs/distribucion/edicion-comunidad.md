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

El workflow [comunidad.yml](../../.github/workflows/comunidad.yml) construye en un runner Windows alojado por GitHub y conserva instalador e inventario bajo un nombre que contiene el SHA del commit. No usa secretos de firma, no publica una release y no envía artefactos a SignPath. El flujo actual `release.ps1` sigue dedicado a las dos ediciones anteriores: antes de una actualización pública de Comunidad hay que incorporar su artefacto y firma de actualización al manifiesto de releases, con las mismas verificaciones.

## Evidencia local del 21 de septiembre de 2026

- API autocontenida `win-x64`: 401 archivos, 140.790.551 bytes incluyendo avisos legales.
- Sin archivos ni dependencias de ejecución Oracle, IBM o IKVM; SNI aparece expresamente como pendiente en el manifiesto.
- API iniciada, lista exacta de cuatro motores y consulta SQLite correctas con datos temporales independientes del perfil del usuario.
- Frontend de producción compilado; persiste el aviso de presupuesto inicial (649,27 kB frente al umbral orientativo de 500 kB).
- Las pruebas de exclusión del paquete incluyen la reintroducción accidental de Oracle/IBM y comprueban que los avisos legales no sean excluidos.

El manifiesto detallado local se genera en `artifacts/paquete/`. Estas pruebas no sustituyen una instalación/desinstalación en Windows limpio ni la revisión completa de tráfico.

## Pendientes antes de solicitar la firma

1. Aclarar con SignPath SNI, WebView2 y el lugar del consentimiento de actualizaciones. La respuesta anterior no aprobó esos tres puntos.
2. Completar avisos y reconciliación de terceros del artefacto final, procedencia y condiciones de distribución.
3. Probar instalación, actualización, desinstalación y tráfico real según el protocolo de Windows limpio.
4. Publicar una beta revisada con hashes y procedencia de construcción; presentar el artefacto exacto y los enlaces públicos.
