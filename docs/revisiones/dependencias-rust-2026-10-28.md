# Revisión del grafo Rust del 28 de octubre de 2026

El PR #43 actualiza Tauri a 2.12.3, tauri-plugin-dialog a 2.8.2,
tauri-plugin-updater a 2.13.3 y serde_json a 1.0.154, además de las
dependencias transitivas resueltas en Cargo.lock. Se incorpora main
`e2f2fc94a787a3dd2b37c82f16e5e208ec856e67`, conservando Druse 1.11.0
y todos sus cambios. Una actualización de dependencias no añade novedades
ni sube la versión de la aplicación.

## Alcance reproducible

Se obtuvo el grafo con:

```powershell
cargo metadata --locked --features custom-protocol --format-version 1 --filter-platform x86_64-pc-windows-msvc --manifest-path shells/desktop-tauri/Cargo.toml
```

Desde `resolve.root` se recorrieron solo aristas con `dep_kinds.kind = null`,
deteniendo el recorrido en los targets `proc-macro`. El mismo procedimiento
aplicado al lockfile de main reproduce exactamente sus 238 entradas y 24
macros, sin faltantes ni entradas adicionales. El nuevo grafo contiene 224
crates normales y separa 21 macros: mantiene 185 versiones y recoge 39
versiones nuevas o reemplazadas. Se eliminan las versiones fuera del grafo.

Para las 224 entradas se verificó el SHA-256 del archivo `.crate` del registro
contra el checksum de Cargo.lock, la licencia de Cargo metadata y, cuando
existe, el commit de `.cargo_vcs_info.json`. Se buscaron documentos por nombre
también en subdirectorios y en `license_file`.

Se contrastaron los bytes de las 402 referencias del índice: 398 proceden de
entradas del archivo `.crate`; tres de LICENSE en el commit upstream fijado
por alloc-stdlib, webview2-com y webview2-com-sys; y una del texto oficial MPL
enlazado en la cabecera de selectors. Las URL, rutas y hashes concretos están
en el índice. Se conservaron las referencias sin cambios cuando correspondían
a la misma versión y se renovó la procedencia de las versiones actualizadas.

Los avisos de las versiones reemplazadas resultaron idénticos a textos ya
conservados. La nueva dependencia web-time 1.1.0 aporta dos textos originales:

| Documento | SHA-256 |
| --- | --- |
| LICENSE-APACHE | `54a744942eb3fa63a74d8d359989ed6962c04f3f10ff20cfa08ff8aa7efbe4e6` |
| LICENSE-MIT | `f428305bbf2e70fbd807af0f3c7ac1b7acfb95311640f451e9d2e48db6d7e96b` |

Se retira el texto de autoría exclusivo de UNIC, ya sin referencias en el
grafo. Quedan 166 textos únicos, con los bytes originales.

Huellas revisadas:

| Archivo | SHA-256 |
| --- | --- |
| Cargo.lock | `ee40db0f939b5b536cc62c0c342cc1f510e6a52d2c6c723cb18a2de80c347ed1` |
| Cargo.toml | `bb405e07569809f7a98e4558f74626e075b210c2ebe9696cb6d7367455b3c848` |

## SDK nativo WebView2

El commit upstream de webview2-com-sys 0.39.1,
`edc2caf886175ccaebe86078c9cfe1ae2a187328`, fija
Microsoft.Web.WebView2 1.0.3800.47 en
`crates/update-bindings/src/main.rs`. Se descargó el paquete oficial desde
NuGet y se comparó su `build/native/x64/WebView2LoaderStatic.lib` con el
archivo incluido en el crate: coinciden byte a byte.

| Elemento | SHA-256 |
| --- | --- |
| Paquete NuGet 1.0.3800.47 | `56c9f26bdd07916a2d1949fb58a5c7e434dfa1173577dca879206050c4e718db` |
| Loader estático x64 | `89c6b872783b8f6c3cedbff618adb42082d455c615453ae10cfc753f1e8f25d8` |
| LICENSE.txt | `0af8f1b807512aae39c2ac1aa4d0cae65cabecb6fd554b8439a5162a0d6eca55` |
| NOTICE.txt | `106423785c5b7eba0a8e61d1837f2132e9c828e20ad530f565d981c1df60dd90` |

Los dos documentos coinciden con los conservados del SDK anterior. Se
actualizan versión, procedencia y huella del loader; los avisos de NSIS
se mantienen porque sus 26 archivos siguen coincidiendo.

## Comprobaciones y límites

- Las cinco pruebas de `build/tests/avisos-rust-comunidad.cjs` pasan, incluidas
  las que rechazan manifiestos, avisos, NSIS o loader alterados.
- La copia real conserva los bytes de sus 179 archivos: índices, README y
  175 textos únicos entre los dos expedientes. `--verify-native` comprueba los
  26 archivos de NSIS y el loader efectivo de Cargo metadata.
- `cargo test --locked updates::tests` pasa sus cuatro pruebas después de
  cargar Visual C++ Build Tools 2022 mediante `build/scripts/msvc-env.ps1`.
  La detección automática inicial eligió otra instalación incompleta de
  Visual Studio; no fue necesario modificar ni instalar el toolchain.
- Con `DRUSE_VARIANT=comunidad`, `cargo test --locked` pasa las 25 pruebas
  del contenedor de escritorio, incluidas las cuatro del actualizador.
- La compilación con `custom-protocol` requiere generar antes la interfaz
  en `frontend/dist/frontend/browser`. Este checkout de revisión no contiene
  esa salida: el intento compiló las dependencias, pero se detuvo al generar
  el contexto de Druse por ausencia de frontendDist. La construcción del
  instalador completo queda para el recorrido de Comunidad en CI, que sí
  prepara la API y la interfaz antes de construir Tauri.

Esta revisión conserva las guardas de empaquetado. No demuestra qué bytes
sobreviven a la optimización ni cierra compatibilidad, código generado,
fuente correspondiente del conjunto GPL o admisión de SignPath.
