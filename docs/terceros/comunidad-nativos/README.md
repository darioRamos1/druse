# Avisos de componentes nativos de Comunidad

Textos originales del SDK Microsoft.Web.WebView2 1.0.3650.58, NSIS 3.11 y nsis-tauri-utils 0.5.3. El índice conserva las fuentes y SHA-256; las copias se distribuyen con el instalador. La licencia del SDK/loader no sustituye los términos del Evergreen Runtime ni del bootstrapper.

El loader estático x64 coincide con el del paquete oficial NuGet. El zip de NSIS coincide con el SHA-1 fijado por Tauri CLI 2.11.4 (`EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D`); se registró además su SHA-256. El complemento coincide con la fijación de Tauri (`75197FEE3C6A814FE035788D1C34EAD39349B860`), y sus licencias proceden del commit `13d9edd27b69310e108d6fbd49f90992f8a05390`. Después de construir, se comprueban los hashes de 26 archivos de NSIS en la caché utilizada y del loader de WebView2.

COPYING de NSIS incluye términos de sus módulos de compresión; se conservan completos. Se incluyen también los avisos de Modern UI, NSISdl y makensisw, aunque recopilar un documento no demuestra que ese componente concreto aporte bytes al instalador. Falta concluir la revisión de código generado, fuente correspondiente y obligaciones de distribución; esto no declara aprobado ningún componente por SignPath.

Fuentes de referencia: https://github.com/kichik/nsis/tree/v311 y https://github.com/tauri-apps/nsis-tauri-utils/tree/13d9edd27b69310e108d6fbd49f90992f8a05390. La documentación oficial de NSIS sobre licencias está en https://nsis.sourceforge.io/License. Las URL exactas de los documentos descargados constan en `indice.json`.
