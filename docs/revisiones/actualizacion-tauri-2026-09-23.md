# Revisión de Tauri y actualizador — 23 de septiembre de 2026

El PR #29 actualiza `tauri` de 2.11.5 a 2.11.6 y `tauri-plugin-updater` de 2.11.0 a 2.12.0. El empaquetado rechazaba el nuevo Cargo.lock porque el expediente seguía describiendo las versiones anteriores.

## Procedencia de los avisos

Se resolvió el grafo con `cargo metadata --locked --features custom-protocol --filter-platform x86_64-pc-windows-msvc`. Conserva 238 crates normales y 24 proc-macros separados; no aparecen otras versiones o componentes nuevos en ese alcance.

Los dos archivos `.crate` descargados por Cargo se contrastaron con los checksums del lockfile:

| Paquete | SHA-256 del archivo original | Commit upstream incluido en el paquete |
| --- | --- | --- |
| tauri 2.11.6 | `6fa5bacdb9bbad5954af3d1bd6cf6ae9192cab1b2e270f4a07f904610b9e85f4` | `9452ddee5ebefd9b678a94ff003521379df6c9ae` |
| tauri-plugin-updater 2.12.0 | `7a5cad8ed5948d988e1018ecd31e27cacedbf72ce3fb972940c3e4bf51639e4b` | `5baf71a47292d8490f0ba3d53f15224e55c48327` |

Se inspeccionaron las entradas de esos archivos, buscando también avisos anidados. Los dos avisos de Tauri y los tres del actualizador coinciden byte a byte con los textos archivados. La declaración de ambos sigue siendo `Apache-2.0 OR MIT`. Se actualizan versión, URL, commit y checksum en el índice; los 165 textos originales se conservan. El resto de componentes coincide con el nuevo lockfile.

## Comportamiento

[Tauri 2.11.6](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.11.6) corrige el aislamiento de datos IPC entre webviews. [Updater 2.12.0](https://github.com/tauri-apps/plugins-workspace/releases/tag/updater-v2.12.0) retira `allowDowngrades` del comando JavaScript y lo traslada a configuración, desactivado por defecto. Druse usa el constructor Rust y `.check()`, no ese argumento del comando JavaScript; mantiene el endpoint y el canal por variante.

## Comprobaciones del expediente

- Las cinco pruebas de `build/tests/avisos-rust-comunidad.cjs` pasan, incluidas las que rechazan hashes alterados y cambios no revisados del grafo.
- La copia de avisos al directorio de API incorpora 238 entradas Rust y tres entradas nativas sin omitir las guardas.
- NSIS y el SDK/loader de WebView2 coinciden con el expediente nativo.

La construcción del instalador y sus pruebas de integración se verifican en la ejecución de Comunidad del PR actualizado. Esta revisión no equivale a admisión en SignPath ni cierra la entrega de fuente correspondiente o la revisión de compatibilidad del conjunto.
