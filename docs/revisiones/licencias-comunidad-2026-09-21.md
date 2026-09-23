# Reconciliación de la API de Comunidad y avisos del frontend

Fecha: 21 de septiembre de 2026. Avanza OSS-04; no lo cierra ni acredita elegibilidad para SignPath.

## Evidencia del paquete local anterior a la corrección de avisos

Se examinó la API local generada con `package.ps1 -Community`, sin instalarla ni acceder al perfil del usuario. No se atribuyen estos resultados a los bytes del instalador de GitHub: los runtimes y las compilaciones pueden diferir.

| Comprobación | Resultado |
| --- | --- |
| Entradas NuGet del grafo publicado | 35 paquetes y 2 runtime packs de .NET |
| Archivos de API examinados | 401 |
| Coincidencia SHA-256 con al menos un archivo de la caché NuGet | 377 |
| Sin atribución NuGet | 24: código/ejecutable de Druse, configuración, manifiestos y avisos propios; lista completa en CSV |
| Paquetes con avisos locales encontrados por nombre o declaración nuspec | 9, con 15 documentos copiados byte a byte |
| Paquetes sin texto de aviso localizado | 28; algunos son metapaquetes, por lo que debe contrastarse su inclusión real antes de decidir obligaciones |

Evidencias públicas:

- [Paquetes, versiones, licencia declarada y pendientes](licencias-comunidad-api-2026-09-21.csv).
- [Cada archivo de API, SHA-256 y coincidencias de origen](archivos-comunidad-api-2026-09-21.csv).

Identificadores del material examinado:

- `Druse.Host.LocalApi.deps.json`: SHA-256 `ebb490351aef90bcb3bf3875daf35fef88cf140c298556046330672fc4bf8f25`.
- `project.assets.json`: SHA-256 `460746e941d49905ffe72fd4d606d748fa9d01ec95c127394ace26780ec41055`.
- Informe JSON local: SHA-256 `408234284d6d6bcb03059c2cdfd5a060d83c241fb8c263744a12ba99c4bbc6e7`.

Para repetir con una API publicada y su restore correspondiente:

```powershell
./build/scripts/evidencia-licencias-comunidad.ps1
./build/tests/evidencia-licencias-comunidad.ps1
```

La herramienta crea una carpeta nueva en `artifacts/licencias-comunidad/`, copia nuspec y avisos sin alterar los textos y registra hashes. No descarga términos ni copia estos documentos al instalador. No publica rutas personales en el informe. Conserva múltiples orígenes posibles si comparten bytes; un nombre de archivo igual con contenido distinto no se considera coincidencia.

Una expresión `MIT` o una URL en nuspec no se cuenta como texto copiado. La coincidencia con una caché no demuestra su autenticidad ni los derechos del titular. Quedan por reconciliar avisos upstream de las versiones concretas, obligaciones y procedencia, además de Rust, frontend, WebView2 y NSIS. SNI mantiene su licencia separada y la consulta de elegibilidad pendiente.

## Omisión corregida en el empaquetado

Angular escribe `frontend/dist/frontend/3rdpartylicenses.txt` fuera de `browser/`, mientras Tauri incorpora solamente `browser/` como frontend y `api/` como recursos. Por eso la extracción de licencias existía, pero ese archivo no viajaba en el instalador. Los recursos de Monaco se copian desde `min/vs` y tampoco incluyen sus avisos de la raíz del paquete.

`package.ps1` ahora copia cinco documentos originales a `api/licenses/frontend/` después de construir Angular: su extracción de licencias, licencia y avisos de Monaco, y licencias de Inter y JetBrains Mono. Los recursos de API se incluyen tanto en NSIS como en portable. Se comprueba que los cinco originales existan, no estén vacíos y coincidan por hash con sus copias; el inventario se recalcula después de copiarlos y después de la posible firma de la API.

La prueba `build/tests/avisos-frontend.ps1` comprueba los bytes, el inventario, las tres ediciones y el fallo ante un original ausente aunque quede una copia antigua. Esto corrige esa omisión concreta; no declara completo el conjunto de avisos de terceros.

El workflow de Comunidad ejecuta ambas pruebas nuevas y recoge la evidencia NuGet de la API que acaba de publicar, conservándola junto al instalador. También se activa ante cambios de frontend y de los tres avisos del repositorio. La ejecución satisfactoria del PR #18 es anterior a estos cambios y no se presenta como validación de esta revisión.

## Comprobación del instalador corregido

Se completó localmente `package.ps1 -Community` con los avisos actuales. Resultado: `Druse Comunidad_1.1.0_x64-setup-comunidad.exe`, 50.473.725 bytes; SHA-256 `79e030d8979a0cdbd6da3f9e64c144672d7f8034794b160865f06c88d8e907dc`.

- Manifiesto final: 408 entradas (406 archivos de API/avisos, instalador y firma del actualizador). Los cinco avisos del frontend y los tres avisos propios coinciden con sus fuentes e inventario.
- Firma del actualizador: verificada contra los bytes finales y la clave pública de Druse. Authenticode: **NotSigned**; no identifica un editor certificado ante Windows.
- API publicada: arranque, cuatro motores y `SELECT 42` en SQLite correctos. Pasaron las pruebas de avisos, evidencia de licencias, inventario y verificador de releases. YAML analizado correctamente con el parser de Prettier.
- La herramienta de evidencia se repitió sobre el paquete corregido: 406 archivos, 377 coincidencias NuGet, 37 entradas de paquetes/runtime y 28 sin aviso local localizado. Los CSV anteriores conservan deliberadamente la instantánea de 401 archivos examinada al inicio.

El binario permanece como candidato local; no se publicó una nueva release ni se instaló/desinstaló en el equipo habitual. La compilación conserva el aviso previo de tamaño inicial de Angular (649,27 kB). No se ha ejecutado todavía en GitHub la revisión nueva del workflow.
