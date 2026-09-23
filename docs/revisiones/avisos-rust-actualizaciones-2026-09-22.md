# Avisos Rust/nativos y canal de Comunidad: resultados

El [PR #25](https://github.com/darioRamos1/druse/pull/25) quedó integrado en `main` como `b800e4e94c66dfa164b0a0bbdf2073ba47f017f8`. La revisión probada del PR es `f621dee3bb3e5e9f0e1c99cc09e0f1302b6c5ddf`; el checkout de integración de Actions es `4994091d02f4a404b836bbaf2cc452f12b7d84c3`.

## Instalador

La [ejecución 35734632929](https://github.com/darioRamos1/druse/actions/runs/35734632929) terminó correctamente el 22 de septiembre. Incluye guardas de avisos, inventario y releases, API publicada/SQLite, canal de actualización Rust y construcción NSIS.

| Resultado | GitHub Actions | Local |
| --- | --- | --- |
| Archivo | `Druse Comunidad_1.1.0_x64-setup-comunidad.exe` | Mismo nombre |
| Bytes | 50.573.131 | 50.585.128 |
| SHA-256 | `7f4735518cdeb2d38d48ffc27e34ed13c82ecb9867a405c59837df2b710b8791` | `182712f7f6389ca9558440306448991358b89e1cf3af15ee8a497bf456b2c7aa` |
| Entradas del manifiesto final | 627 | 628 |
| Authenticode | `NotSigned` | `NotSigned` |
| Firma del actualizador | No generada; CI no tiene la clave privada | Válida contra los bytes finales |

Los dos manifiestos contienen 626 archivos de API/avisos. Se descargó el instalador de Actions y su hash coincide con el inventario. Se contrastaron los hashes inventariados de 165 textos Rust, nueve textos nativos y 41 textos NuGet con sus expedientes originales. El paquete conserva además los cinco avisos del frontend y los avisos propios de Druse. La diferencia de una entrada es la firma del actualizador local.

El empaquetado comprobó los 26 archivos fijados de NSIS y el loader estático x64 de WebView2. Los 174 nuevos textos conservan sus bytes en Git; la normalización de finales de línea está desactivada para ellos. Las 416 referencias a documentos procedentes de crates coinciden con entradas de los archivos `.crate` originales, cuyo SHA-256 corresponde a Cargo.lock; las 19 referencias restantes conservan su origen upstream/oficial en el índice.

Localmente también se verificaron el índice NuGet y el hash de su grafo, los avisos finales, los cuatro motores y `SELECT 42` en SQLite con un perfil temporal. El instalador no se ejecutó sobre el perfil habitual del usuario. Permanece el aviso conocido de tamaño inicial de Angular. El artefacto de Actions conserva su retención de 14 días y todavía no es una beta publicada.

## Actualizaciones

`release.ps1` prepara ahora las tres ediciones y añade `windows-x86_64-comunidad` al `latest.json` compartido. El verificador exige su instalador, firma e inventario, y comprueba la URL HTTPS exacta de destino. Para publicar, se comprueba además el workflow de Comunidad sobre el commit exacto; CI general no lo sustituye.

Pasaron cinco pruebas de avisos, las guardas NuGet/inventario, los escenarios de release de dos y tres ediciones, y 27 escenarios de CI. Se rechaza Comunidad ausente, con firma o URL de otra edición, bytes alterados, HTTP o inventario ausente. Se analizaron sintaxis PowerShell, YAML y enlaces locales.

Se ejercitó además el guion real de construcción de releases en un repositorio temporal con empaquetadores/NSIS simulados y claves de prueba. Solicitó las tres ediciones con firma, respetó `CARGO_TARGET_DIR`, copió los inventarios y generó un manifiesto aceptado por el verificador real. Esta comprobación no se presenta como una construcción de los tres instaladores reales ni como una actualización instalada.

No se ejecutó el workflow de publicación, no se modificó el manifiesto público y no se publicó una release. El selector anterior conserva sus dos opciones; Comunidad usa su descarga directa. Antes de publicar se debe validar también el commit final integrado, no atribuirle automáticamente el resultado de otro SHA.

## Respaldo de fuentes de Rust

Se preparó localmente `fuentes-rust-f621dee3bb3e.zip`, con 307 archivos `.crate` del grafo resuelto para Windows, incluidas dependencias de construcción, Cargo.lock/Cargo.toml e índice de procedencia. Cada crate se contrastó con Cargo.lock antes de archivarla y nuevamente leyendo su entrada en el ZIP.

- Tamaño: 46.402.276 bytes.
- SHA-256: `59e817a37a22ba0197a564092dd0108ce5a8fd70cc857c239a6e8b73a7bd8728`.
- Estado: respaldo local, sin publicar. No constituye por sí solo la fuente correspondiente completa de Druse, .NET, frontend, NSIS o WebView2.

## Pendientes que permanecen abiertos

OSS-04 sigue abierto por compatibilidad, derechos de procedencia, código generado, obligaciones por componente y fuente correspondiente del conjunto. PKG-04 requiere instalación, actualización, desinstalación y observación de tráfico en Windows limpio. Falta completar el responsable de privacidad y publicar una beta revisada.

La consulta a SignPath sigue pendiente: la búsqueda del 22 de septiembre en el correo de Druse no encontró una respuesta nueva del dominio signpath.io posterior al seguimiento. No se envió otro correo. El SDK/loader no sustituye los términos de Evergreen Runtime; SNI y consentimiento siguen sin aclaración expresa. La firma de actualización válida no equivale a Authenticode ni a admisión de SignPath.
