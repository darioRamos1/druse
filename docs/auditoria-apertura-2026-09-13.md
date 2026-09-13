# Auditoría inicial para la apertura de Druse

Fecha: 13 de septiembre de 2026. Alcance: primer bloque del [plan de SignPath y donaciones](plan-signpath-donaciones.md), tareas OSS-01 y OSS-02, con preparación parcial de OSS-03 y donaciones.

## Resultado

La revisión automatizada está ejecutada y el inventario inicial está disponible. **Druse todavía no está autorizado ni declarado listo para hacerse público.** No se ha elegido licencia, cambiado la visibilidad, solicitado una firma ni habilitado un cobro.

Se corrigió una exposición de red en los scripts de bases de datos de prueba. Las licencias de controladores y runtime requieren decisiones adicionales antes de una candidatura a SignPath.

## 1. Historial y archivos sensibles

Se ejecutó `git fetch origin --tags` y se revisaron todas las referencias locales alcanzables: **367 commits, 3.031 blobs únicos, 3.020 de texto y 11 binarios**. El análisis complementario no omitió blobs por tamaño y no encontró rutas históricas con las extensiones sensibles que comprueba su patrón, como claves privadas, bases, dumps, CSV y hojas de cálculo. Esto no descarta datos sensibles dentro de archivos de código o documentos.

Herramienta: **Gitleaks 8.30.1**, descargada de su release oficial y contrastada con el SHA-256 publicado allí. Se usaron todas las ramas y etiquetas locales y ocultación completa de valores. [Herramienta y uso](https://github.com/gitleaks/gitleaks).

HEAD local revisado: `acdbe25c57d7113c1a1f44cedc9f88f4240298ae`; los cambios de esta auditoría todavía están en el directorio de trabajo. La lista exacta de referencias figura en el informe local `history-supplement.json`.

| Análisis | Resultado | Interpretación |
| --- | --- | --- |
| Gitleaks sobre historial | 1 coincidencia | Constante de token en `backend/tests/Druse.IntegrationTests/LoggingTests.cs`, método `ElTokenDeLaApiNoLlegaAlArchivo`. El código la utiliza para probar ocultación de registros; no se confirmó una credencial de servicio real. |
| Gitleaks sobre snapshot de archivos versionados y no ignorados | La misma coincidencia de prueba | Incluye cambios locales; excluye datos ignorados, caches y credenciales personales. |
| Documento DOCX histórico | 0 coincidencias | Extraído desde su blob Git; analizados XML y texto. No contiene medios incrustados. |
| Patrones complementarios | 412 candidatos en versiones históricas | 143 literales relacionados con credenciales, 230 coincidencias tipo correo y 39 tipo IP privada. Son candidatos, no 412 fugas verificadas. |

La revisión por contexto sitúa los literales en pruebas y scripts de motores desechables. Las coincidencias de correo aparecen en datos de prueba, mockups y contacto público. Ocho coincidencias de IP son versiones del paquete IBM con formato de cuatro números; las restantes aparecen en pruebas y mockups. Antes de abrir el historial, el titular debe confirmar que esos ejemplos y datos visuales son sintéticos o publicables.

El DOCX histórico `docs/Guia-Druse-Levantar-y-Empaquetar.docx` sigue accesible en el historial aunque hoy esté ignorado. Se conserva este hallazgo como recordatorio: modificar `.gitignore` no borra versiones anteriores.

Los informes locales están en `artifacts/open-source-audit/`. El análisis complementario guarda ubicación y regla, sin el valor coincidente. Los reportes de Gitleaks se generan con `--redact=100`; no deben publicarse automáticamente porque también pueden contener metadatos personales de commits.

### Límites pendientes de OSS-01

- Confirmar procedencia y permiso sobre ejemplos, imágenes, documento histórico y código realizado en contexto laboral.
- Revisar visualmente los iconos y la marca; no se realizó OCR de todos los binarios.
- No se auditaron referencias de pull requests no descargadas, objetos eliminados del servidor, adjuntos de issues ni artefactos remotos de Actions/Releases.
- No se probaron posibles credenciales contra servicios externos ni se inspeccionaron secretos de cuentas personales. Un detector sin hallazgos nuevos no prueba ausencia de secretos.

## 2. Corrección aplicada: puertos de pruebas

`build/scripts/test-db.ps1` y `build/scripts/test-db.sh` usaban `-p puerto:puerto`, aunque su documentación decía que las bases de prueba escuchaban solo en loopback. Docker publica ese formato en todas las direcciones del host por defecto. Ahora las diez asignaciones entre ambos scripts incluyen explícitamente `127.0.0.1`. [Comportamiento documentado por Docker](https://docs.docker.com/engine/network/port-publishing/).

Validación realizada con los scripts reales y una función Docker simulada: seis puertos en PowerShell y cuatro en Bash, incluyendo puertos personalizados. No se crearon, reiniciaron ni borraron contenedores para estas pruebas. No se comprobó conectividad contra bases reales en esta sesión.

Las mismas pruebas fallan por la asignación de puertos al ejecutarse contra copias de los scripts anteriores de HEAD, y pasan con la corrección. También se verificó sintaxis Bash y JavaScript, enlaces locales y consistencia del CSV. La consulta de solo lectura a Docker no pudo conectar con su daemon local, por lo que no se pudo determinar si hay contenedores existentes que necesiten recreación.

**Contenedores ya existentes:** conservan sus asignaciones anteriores; reiniciarlos no las cambia. Si existen, inspeccionarlas y planificar su recreación después de comprobar que sus datos son desechables. No se hizo esa operación. Docker también documenta limitaciones de aislamiento en versiones anteriores a 28.0.0; comprobar versión y configuración de red antes de dar por validado el aislamiento de un equipo real.

También se añadieron exclusiones compartidas para `/artifacts/`, la configuración temporal `tauri.packaging.json`, claves `druse-updater*.key` y archivos `.p12`.

## 3. Inventario de dependencias

Archivo generado: [licencias-dependencias.csv](licencias-dependencias.csv).

| Ecosistema | Entradas |
| --- | ---: |
| npm, frontend y E2E | 540 |
| Cargo, todas las plataformas del lock | 490 |
| NuGet, proyectos restaurados y runtime packs | 128 |
| Maven, JDBC y dependencia BSON | 2 |
| Fuentes y marca | 3 |
| WebView2 externo | 1 |
| Total | 1.164 |

El número cuenta registros por versión y uso; no representa 1.164 bibliotecas instaladas en Windows. Todas las decisiones quedan **PENDIENTE REVISION**. Tener una expresión de licencia identificada no demuestra que se hayan cumplido avisos, atribuciones, distribución de fuentes o compatibilidad con la licencia que elija Druse.

Se consultaron manifests y licencias de los caches locales. `cargo fetch --locked` completó los metadatos de las plataformas que faltaban sin cambiar `Cargo.lock`. El recorrido Maven excluye dependencias transitivas opcionales, como SLF4J en BSON. Quedan dos registros sin licencia determinada: marca/iconos de Druse y WebView2. Para estos no se inventó una licencia.

Se inventariaron además **612 archivos** de la API publicada, con tamaño y SHA-256, en `artifacts/open-source-audit/package-files.json`. Es un inventario del directorio de publicación existente, no una extracción verificada del instalador ni una aprobación de cada archivo nativo. La procedencia de cada componente distribuido deberá reconciliarse con ese contenido al preparar una release.

### Dependencias que requieren decisión

| Componente | Evidencia revisada | Efecto |
| --- | --- | --- |
| `Oracle.ManagedDataAccess.Core` 23.26.301 | `LICENSE.txt`: Oracle Free Distribution, Hosting, and Use Terms and Conditions | Se conserva en el grafo de ambas ediciones actuales. |
| `Net.IBM.Data.Db2` 10.0.0.200 | `Lic_en.txt`: IBM IPLA e información de licencia | Se excluye del grafo inferido sin Informix. |
| `com.ibm.informix:jdbc` 15.0.0.1.1 | POM con IBM Informix JDBC Software License Agreement | El controlador se incorpora mediante IKVM. |
| `Microsoft.Data.SqlClient.SNI.runtime` 6.0.2 | `LICENSE.txt`: Microsoft Software License Terms para SNI | `Microsoft.Data.SqlClient.SNI.dll` está en la API publicada y el paquete permanece sin Informix. |
| IKVM 8.11.2 y runtimes asociados | Avisos Zlib y GPL con excepción Classpath según archivo | Preparar obligaciones y avisos por archivo; no equipararlo automáticamente a los términos del controlador IBM. |
| WebView2 | Runtime externo configurado por el empaquetador | Revisar distribución del bootstrapper/runtime y la aplicabilidad de la excepción de sistema. |

No basta con retirar Informix y Oracle y anunciar que lo demás es apto: **SNI también necesita revisión**. La licencia del paquete administrado SQL Client no sustituye la del componente nativo SNI. Debe resolverse el alcance con SignPath, incluyendo las posibles excepciones de biblioteca de sistema. Sus condiciones excluyen componentes propietarios salvo las excepciones admitidas. [Condiciones del programa](https://signpath.org/terms.html).

La columna `without_informix` es una inferencia recorriendo el grafo restaurado del host, sin recompilar otra edición ni examinar su instalador. No se cambió ningún motor ni canal de actualizaciones.

## 4. Reproducción

Desde la raíz, con dependencias restauradas y Cargo disponibles:

```powershell
node build/scripts/audit-open-source.cjs
./build/tests/test-db-loopback.ps1
```

En Bash:

```bash
bash build/tests/test-db-loopback.sh
```

El script de auditoría no instala herramientas ni restaura paquetes: identifica metadatos ausentes y los deja pendientes. `--inventory` regenera el CSV y el inventario de API; `--history` revisa blobs y crea un snapshot nuevo sin copiar archivos ignorados. No altera commits ni valida credenciales por red.

Gitleaks no se versionó como binario. Para repetir el análisis, usar una instalación verificada de 8.30.1:

```powershell
gitleaks git . --log-opts='--all --full-history' --redact=100 --ignore-gitleaks-allow --no-banner --report-format=json --report-path=artifacts/open-source-audit/gitleaks-history.json
```

Para archivos actuales, usar `gitleaks dir` sobre la ruta del último `snapshot.json`, también con redacción completa. El código 1 indica coincidencias por revisar; un error de ejecución es distinto de un resultado limpio. No añadir una exclusión global para silenciar archivos de pruebas.

## 5. Próximo bloque

1. Resolver las condiciones de Oracle, IBM y Microsoft SNI y su alcance para la candidatura; está preparado un [borrador de consulta](consulta-signpath-borrador.md), todavía sin enviar.
2. Confirmar derechos y ejemplos antes de elegir licencia y publicación. OSS-01 permanece abierto; OSS-02 tiene inventario inicial terminado pero reconciliación final pendiente.
3. Preparar los avisos de redistribución a partir de la edición que se acuerde. No atribuir a Druse licencias de terceros ni publicar un `LICENSE` sin la decisión del titular.
4. Continuar el [borrador de financiación](financiacion.md) y configurar Sponsors cuando el titular complete sus datos y la plataforma apruebe el perfil.
