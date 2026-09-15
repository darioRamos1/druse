# Revisión de preparación para SignPath — 14 de septiembre de 2026

Estado: candidatura preparada en borrador, todavía no presentada. Esta revisión complementa la [auditoría del 13 de septiembre](auditoria-apertura-2026-09-13.md); no sustituye sus resultados históricos.

## Comprobaciones realizadas

Base revisada: `f634bfc70ec19d86d15bfc8de38559c8b9ad35a4`, más las correcciones locales de verificación de releases, pruebas e inventario.

- Historial local alcanzable: 393 commits, 3.111 blobs, 3.100 de texto y 11 binarios. El barrido complementario produjo 442 candidatos para revisión; no son 442 secretos confirmados. La única ruta señalada como sensible es el propio inventario CSV.
- Gitleaks 8.30.1, con valores ocultos y sin permitir exclusiones en comentarios: un hallazgo en `backend/tests/Druse.IntegrationTests/LoggingTests.cs`. Corresponde a la constante sintética de la prueba `ElTokenDeLaApiNoLlegaAlArchivo`. No se confirmó una credencial real en este resultado. El análisis automatizado no acredita por sí solo que el historial pueda publicarse: quedan procedencia, derechos y datos organizacionales por revisar.
- Inventario regenerado: **1.144 entradas** (128 NuGet, 527 npm, 483 Cargo, 2 Maven, 3 recursos y 1 runtime). Incluye herramientas y dependencias de otras plataformas; no equivale a 1.144 componentes dentro del instalador. El inventario del directorio de API existente contiene 612 archivos; no se construyó un instalador nuevo para esta revisión.
- Quedan dos entradas sin metadatos de licencia determinados: marca/iconos propios y runtime externo WebView2. Encontrar metadatos no aprueba una licencia: las decisiones de redistribución y elegibilidad siguen pendientes, especialmente Oracle, IBM y SNI.

Resultados detallados locales en `artifacts/open-source-audit/`, excluidos de Git. No se incluyen valores detectados ni claves en este documento.

## Correcciones y pruebas de publicación

La consulta de CI comprueba ejecuciones de `.github/workflows/ci.yml` para el commit exacto. Un check ajeno, como Dependabot, no acredita esa CI. Se considera la ejecución o reintento más reciente, incluida una ejecución pendiente, y se leen todas las páginas de la API. La llamada usa `--paginate --slurp` y procesa el JSON en PowerShell: la versión instalada de `gh` rechaza combinar `--slurp` con `--jq`.

Los dos manifiestos de paquete son obligatorios; se comprueban producto, versión, variante y hashes. Omitir el directorio o un manifiesto detiene la verificación.

- `build/tests/ci-release.ps1`: **24 escenarios correctos**, mediante respuestas simuladas sin llamadas a GitHub.
- `build/tests/release-verificacion.ps1`: suite correcta; rechaza manifiestos ausentes o incorrectos, archivos alterados, firma ajena, ediciones cruzadas, metadatos desincronizados y releases incompletas. Usa claves temporales; no verifica una firma Authenticode real.
- Consulta real de solo lectura: se rechazó la ejecución fallida `34772248086` y un commit sin ejecución del workflow requerido. Esto verifica la consulta; no constituye una CI verde del proyecto.

Permanece la excepción explícita `-SinComprobarCI`, registrada en `evidencia.json`. Una release que la use no debe presentarse como una construcción con CI verificada. Las pruebas locales tampoco sustituyen la procedencia que exige el [conector de GitHub de SignPath](https://docs.signpath.io/trusted-build-systems/github).

## Lo pendiente antes de la candidatura

Continuación de privacidad: se añadió Preferencias → Privacidad y una página enlazada desde la landing, generada desde el mismo contenido. El aviso se incluye en la app sin una descarga adicional. Se corrigieron afirmaciones absolutas sobre las peticiones de actualización y el contenido de diagnósticos. Preparados el [protocolo del instalador](../distribucion/pruebas-instalador-signpath.md) y las [notas de próxima versión](../release-notes/proxima-version.md).

Verificación de esta continuación: 9 pruebas de Preferencias correctas; compilación de producción correcta, con aviso de tamaño inicial (649,27 kB frente al umbral orientativo de 500 kB); página revisada a 1.440 y 390 px, sin desbordamiento horizontal ni peticiones externas al cargarla. No se generó un instalador nuevo ni se publicó la landing. Los resultados de navegador no validan el tráfico de la aplicación nativa.

1. Confirmar derechos y alcance público, elegir licencia OSI y preparar `LICENSE` y avisos de terceros.
2. Resolver la consulta de elegibilidad sobre Oracle, IBM, SNI y componentes de sistema; definir la edición candidata con esa respuesta.
3. Finalizar privacidad y datos del responsable; aclarar el aviso durante la instalación. La consulta automática de actualizaciones ya requiere autorización en la aplicación. Probar instalación, actualización, desinstalación y tráfico en Windows limpio forma parte de la validación pendiente de Druse.
4. Publicar el código revisado, documentación, política de firma y una beta descargable; reunir evidencia real de mantenimiento y uso.
5. Recuperar una construcción verificable en CI y completar el expediente con enlaces públicos y responsables reales. Para el conector de GitHub, los trabajos previos a pedir firma deben usar agentes alojados por GitHub.
6. Revisar y presentar la solicitud; registrar respuesta y condiciones. Los identificadores, secretos e integración del servicio concedido se configuran después.

La aceptación depende de SignPath; sus [condiciones](https://signpath.org/terms.html) no garantizan admisión por alcanzar una cifra de estrellas o descargas. Las donaciones son un trabajo separado y no bloquean la candidatura. La [consulta técnica](../distribucion/consulta-signpath-borrador.md) está redactada y puede preceder a la solicitud formal, pero aún no se ha enviado.
