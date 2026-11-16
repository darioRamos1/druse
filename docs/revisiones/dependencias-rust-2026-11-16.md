# Revisión del grafo Rust del 16 de noviembre de 2026

Actualización de seguridad del envoltorio de escritorio sobre main
`5b332281b1bfd5f525e8990db0cf5136fabc7bc1`. Todas las vulnerabilidades que
afectan a Windows llegaban por el actualizador (`tauri-plugin-updater`), que
descarga las versiones nuevas por HTTPS y las descomprime. Cargo.toml no
cambia: solo se mueve Cargo.lock. Recoge también lo que proponía el PR de
Dependabot #62 (tauri-plugin-dialog y tauri-plugin-updater).

## Avisos corregidos

Consultados en OSV (crates.io) contra el Cargo.lock de main:

| Crate | Antes | Ahora | Avisos |
| --- | --- | --- | --- |
| rustls | 0.23.43 | 0.23.46 | RUSTSEC-2026-0285, -0346, -0348, -0349 |
| rustls-webpki | 0.103.15 | 0.103.17 | RUSTSEC-2026-0382 |
| tokio | 1.53.1 | 1.54.1 | RUSTSEC-2026-0386 |
| zip | 4.6.1 | 9.6.0 | RUSTSEC-2026-0367, -0368, -0369, -0429 y tres GHSA |
| webpki-root-certs | 1.0.9 | 1.0.12 | RUSTSEC-2026-0383 (fuera del grafo Windows) |
| rustix | 1.1.4 | 1.1.6 | RUSTSEC-2026-0486 (fuera del grafo Windows) |

`zip` 9 llega con tauri-plugin-updater 2.14.1; arrastra rfd 0.17.2,
tauri-plugin-dialog 2.8.4 y tauri-plugin-fs 2.7.1. Siguen avisados
`glib` 0.18.5 (RUSTSEC-2024-0429) y `proc-macro-error` 1.0.4 (sin
mantenimiento): pertenecen a la pila GTK de Linux, no entran en el grafo
Windows y no tienen arreglo compatible con Tauri 2.

npm (frontend y e2e) y NuGet (`dotnet list package --vulnerable
--include-transitive`) no presentan vulnerabilidades conocidas en la misma fecha.

## Expediente de avisos

Mismo procedimiento que la [revisión del 28 de octubre](dependencias-rust-2026-10-28.md):
`cargo metadata --locked --features custom-protocol --filter-platform
x86_64-pc-windows-msvc`, aristas normales desde la raíz y parada en proc-macros.
El recorrido sobre el lockfile anterior reproduce exactamente sus 224 entradas.

- Salen 11 versiones: rustls, rustls-webpki, tokio y zip de la tabla;
  tauri-plugin-updater 2.13.3, tauri-plugin-dialog 2.8.2, tauri-plugin-fs
  2.7.0 y rfd 0.16.0; y windows-sys 0.60.2, windows-targets 0.53.5 y
  windows_x86_64_msvc 0.53.1, que ya no usa nadie.
- Entran 10: las versiones nuevas y dos crates nuevas, constant_time_eq 0.6.1
  y typed-path 0.13.0. zeroize_derive 1.5.0 es una macro y se separa.
- Quedan 223 crates normales y 22 macros, con 402 referencias a 167 textos.

Cada `.crate` nuevo se descargó del registro y su SHA-256 coincide con el
checksum de Cargo.lock; el commit procede de `.cargo_vcs_info.json`. Las
versiones sustituidas conservan los mismos nombres de aviso. Textos nuevos:

| Documento | SHA-256 |
| --- | --- |
| constant_time_eq `LICENSE-MIT0` | `9a3aeb3f63659c4c6302d315e1d98784d1e8559858a47ff9562e091bb922d28d` |
| rfd `src/backend/xdg_desktop_portal/window_identifier/LICENSE` | `ae26bc7b1bc91fb8648f6a298decbb1a77090a56c9d04e2c23b8365e5f54acb5` |

Se retira el `LICENSE` exclusivo de zip 4.6.1, sin referencias en el grafo.

Huellas revisadas:

| Archivo | SHA-256 |
| --- | --- |
| Cargo.lock | `f9864c1754bc527fe87c150c20fba9a1bec1b09e8021ce4f321c83c805c02fef` |
| Cargo.toml | `314aa238a602928e298348c07d2e72c49e1b64a0f9fb0323beebde8d1a642d9d` |

webview2-com-sys no cambia, así que el expediente nativo se mantiene;
`--verify-native` sigue coincidiendo.

## Comprobaciones

- Las cinco pruebas de `build/tests/avisos-rust-comunidad.cjs` pasan.
- La copia real escribe 223 entradas y 167 textos de Rust y 3 entradas y 9
  textos nativos.
- `--verify-native` confirma NSIS y el loader de WebView2.

Como el resto de actualizaciones de dependencias, no sube la versión de Druse
ni añade novedades. Esta revisión no amplía lo que demostraba la anterior
sobre compatibilidad, código generado, fuente correspondiente o SignPath.
