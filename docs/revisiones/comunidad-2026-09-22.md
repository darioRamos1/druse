# Comunidad: instalador verificado y siguiente bloque de terceros

Fecha: 22 de septiembre de 2026. El [PR #22](https://github.com/darioRamos1/druse/pull/22) quedó integrado en `main` como `1077994d0b1ffdd064073dfa582e568b6653d13f`. No es una admisión de SignPath ni una release estable.

## Avisos NuGet incluidos y comprobados

El [expediente de NuGet](../terceros/comunidad/README.md) aporta 41 textos originales para las 37 entradas de paquetes/runtime. Comunidad los copia al paquete junto a su índice y rechaza versiones sin ficha o documentos alterados. Los cinco avisos del frontend también viajan en el paquete.

La [ejecución 35687912136](https://github.com/darioRamos1/druse/actions/runs/35687912136) pasó sobre el PR `552a40a18bae4a781bef4f248607d05acd3354ca`. El artefacto está identificado por el checkout de integración `5866d9a925f47` (prefijo del identificador incluido en su nombre). Pasaron guardas, API/SQLite, pruebas del canal de actualización y construcción NSIS. Se descargó el artefacto y se contrastaron su instalador y los hashes inventariados de los 41 avisos contra el expediente.

| Evidencia | GitHub Actions | Construcción local |
| --- | --- | --- |
| Instalador | `Druse Comunidad_1.1.0_x64-setup-comunidad.exe` | Mismo nombre, bytes distintos |
| Tamaño | 50.505.066 bytes | 50.497.264 bytes |
| SHA-256 | `00a970df3a398ebb940f899e28f0436c80a5917421ba496962bc0b7ef35a743d` | `3a47cfffbdeba3a58b9dbe14d3996e6e1a9698c463eb4e1e643caf85d936b980` |
| Manifiesto final | 449 entradas: 448 archivos de API y el instalador | 450 entradas: también firma del actualizador |
| Authenticode | `NotSigned` | `NotSigned` |
| Firma Tauri del actualizador | No generada: CI no dispone de la clave privada | Válida contra los bytes finales y la clave pública de Druse |

Localmente se verificaron además el índice de origen, el hash del grafo `.deps.json`, todos los textos copiados y el arranque de API con sus cuatro motores y `SELECT 42` en SQLite. No se ejecutó el instalador sobre el perfil habitual del usuario. La compilación conserva el aviso conocido de tamaño inicial de Angular.

El artefacto de Actions tiene retención de 14 días. No sustituye una beta publicada con enlaces estables. El resultado satisfactorio de la ejecución anterior `35687059722`, sobre `5e98c56`, valida el bloque anterior de frontend/evidencia; no se usa como prueba de los cambios NuGet.

## Reconocimiento inicial de Rust

Se conserva un [inventario de declaraciones y hashes de avisos locales](rust-comunidad-2026-09-22.json) para el `Cargo.lock` con SHA-256 `8d4ddab237534dcf3067c2f372b15ba879ad9f6556bda8179ee16c61243abde8`.

Se obtuvo el grafo con `cargo metadata --locked --offline --features custom-protocol --format-version 1 --filter-platform x86_64-pc-windows-msvc`, desde el manifiesto de `shells/desktop-tauri`. Se recorrieron dependencias normales desde Druse, separando las aristas build/dev y deteniendo el recorrido en proc-macros. Se buscaron LICENSE, COPYING, COPYRIGHT, NOTICE y `license_file` en cada crate; se registraron SHA-256 sin publicar rutas personales.

- 238 crates candidatas en ese recorrido; todas declaran licencia.
- 24 nodos proc-macro separados. Esta separación no decide obligaciones del código que generan.
- Nueve crates sin texto de aviso localizado en la raíz ni en `license_file`; no significa ausencia de licencia en su código o repositorio.
- El grafo no demuestra qué archivos terminan contribuyendo bytes al ejecutable después de la optimización. Faltan código generado, avisos anidados, bibliotecas nativas y NSIS.

Se localizaron y descargaron textos originales de ocho de esas nueve entradas, anclados a `.cargo_vcs_info.json`. Se comprobaron los identificadores de blob de Git y SHA-256. Estos textos todavía **no se incorporaron al instalador**:

| Entradas | Origen exacto | Textos localizados |
| --- | --- | --- |
| alloc-stdlib 0.2.4 | [rust-alloc-no-stdlib, ae42d220](https://github.com/dropbox/rust-alloc-no-stdlib/tree/ae42d22078b98549e987d2f03d12df7b984fde47) | LICENSE |
| unic-char-property, unic-char-range, unic-common, unic-ucd-version 0.9.0 | [rust-unic, 58786053](https://github.com/open-i18n/rust-unic/tree/5878605364af97a3358368a6eaef02104af2e016) | COPYRIGHT.md, LICENSE-APACHE, LICENSE-MIT |
| unic-ucd-ident 0.9.0 | [rust-unic, 8a6ce830](https://github.com/open-i18n/rust-unic/tree/8a6ce83063d90b91ae2ce59eddb803edd393fca9) | Los mismos tres documentos, con iguales blobs |
| webview2-com y webview2-com-sys 0.38.2 | [webview2-rs, b74dc5e2](https://github.com/wravery/webview2-rs/tree/b74dc5e2b394044bea5191052868ce7a106c202c) | LICENSE del wrapper |

SHA-256 de los cinco textos únicos descargados:

- alloc-stdlib LICENSE: `c0c56f26d9c051cac4d200c34c84e7ae9aaa853e01a982a1df08b09931e518ae`.
- UNIC COPYRIGHT.md: `f5c342c49f3ac804f3e8e7bb62a8040a44c50d47bb36902b1abd13f66a1adf8b`.
- UNIC LICENSE-APACHE: `a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2`.
- UNIC LICENSE-MIT: `23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`.
- webview2-rs LICENSE: `0dcf41516e608bbcb6cdc5229feb7b86fe4a643b85e7df251133c93408fdac73`.

La novena, `selectors 0.36.1`, declara MPL-2.0 y contiene su encabezado en `lib.rs`, enlazando el texto oficial. En el árbol upstream `635e1a19d02960588a00e189bd4bd5bdb150ec3d` no se localizó un texto completo propio de selectors por nombre de licencia; no se atribuyen a selectors las licencias de otros subdirectorios. Falta recoger el texto aplicable y concretar las obligaciones de fuente de las crates MPL.

## SDK de WebView2: evidencia separada del runtime

`webview2-com-sys 0.38.2` selecciona `WebView2LoaderStatic` para MSVC en `src/lib.rs`; por tanto, revisar solo la licencia del wrapper Rust sería insuficiente. La biblioteca x64 de la crate coincide byte a byte con `WebView2LoaderStatic.lib` del [paquete oficial Microsoft.Web.WebView2 1.0.3650.58](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3650.58). La documentación de Microsoft describe esta modalidad de [enlace estático del loader](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/static).

| Objeto descargado del paquete oficial | SHA-256 |
| --- | --- |
| nupkg completo | `911a472128c82ac8baa0c486c23342cc9dd6e7dc50d754e676726642ca065c60` |
| x64 WebView2LoaderStatic.lib, 10.500.016 bytes | `0659b741bde6348d4c4a6ec4ceb9af50e3d0048ed9cd3c8659bccbb61fde55ee` |
| LICENSE.txt | `0af8f1b807512aae39c2ac1aa4d0cae65cabecb6fd554b8439a5162a0d6eca55` |
| NOTICE.txt | `106423785c5b7eba0a8e61d1837f2132e9c828e20ad530f565d981c1df60dd90` |
| Microsoft.Web.WebView2.nuspec | `7cef90215900c89711502ae3aae1fc31bca3c3c736be2264d2d3cfa8b537aaf2` |

El nuspec remite a LICENSE.txt. Su texto permite redistribuir bajo condiciones de conservación de copyright, condiciones y exención de garantía, y de no usar el nombre para avalar productos. NOTICE.txt contiene avisos adicionales. Se conservaron ambos originales localmente para preparar su inclusión; no se modificó el instalador ya verificado.

Esto identifica el SDK/loader concreto; **no** determina los términos del Evergreen Runtime, del bootstrapper ni la admisión por SignPath. Sigue pendiente la respuesta al seguimiento enviado. Tampoco demuestra por sí solo que cada byte de la biblioteca estática esté en el ejecutable final.

## Siguientes pendientes

1. Completar inclusión y revisión de avisos Rust, SDK nativo y NSIS; fuente correspondiente, procedencia y compatibilidad siguen abiertos en OSS-04.
2. Respuesta de SignPath sobre SNI, WebView2 y consentimiento; no se envió un nuevo correo en esta revisión.
3. Ejecutar PKG-04 y observación de tráfico en Windows limpio.
4. Preparar el canal público de actualización de Comunidad y publicar una beta revisada con artefactos estables.
5. Confirmar responsable de privacidad y derechos sobre los recursos; para donaciones, completar identidad y perfil receptor verificado.
