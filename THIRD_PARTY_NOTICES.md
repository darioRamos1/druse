# Componentes de terceros

El código original de Druse se licencia bajo **GPL-3.0-only**. Esta elección no cambia las licencias ni la autoría de dependencias, runtimes, fuentes, marcas o archivos de terceros.

El [inventario de dependencias](docs/licencias-dependencias.csv) recoge versiones, procedencia y fuentes de sus términos. Incluye herramientas de desarrollo y otras plataformas; no representa el contenido exacto de cada instalador ni sustituye los avisos originales. Los manifiestos del empaquetado identifican los archivos que viajan en cada variante.

El empaquetado conserva la extracción de licencias de Angular y los avisos originales de Monaco, Inter y JetBrains Mono en `api/licenses/frontend/`. Esa carpeta no representa una revisión completa de todos los componentes. La [reconciliación de Comunidad](docs/revisiones/licencias-comunidad-2026-09-21.md) identifica los archivos de su API que coinciden con NuGet y los textos todavía pendientes.

Comunidad incluye además los textos de sus versiones NuGet/runtime en `api/licenses/nuget-comunidad/`, con un índice de versiones, procedencia y hashes. El [expediente de textos originales](docs/terceros/comunidad/README.md) conserva los documentos y los límites de esta recopilación. Incluirlos no supone aprobación de redistribución ni de SignPath.

## Controladores de bases de datos no libres

Cuatro controladores que usa Druse no son software libre:

| Controlador | Paquete | Términos |
| --- | --- | --- |
| Oracle Data Provider for .NET, Managed Driver | `Oracle.ManagedDataAccess.Core` | Oracle Free Distribution, Hosting, and Use Terms and Conditions |
| IBM Data Server Provider for .NET y su clidriver | `Net.IBM.Data.Db2` (y `-lnx`, `-osx`) | IBM IPLA / License Information |
| IBM Informix JDBC Driver, traducido a .NET con IKVM | `com.ibm.informix:jdbc` | IBM Informix JDBC Software License Agreement |
| Biblioteca nativa SNI de SqlClient | `Microsoft.Data.SqlClient.SNI.runtime` | Microsoft Software License Terms |

Para que Druse pueda combinarse con ellos y distribuirse así, [`COPYRIGHT`](COPYRIGHT) concede un **permiso adicional según la sección 7 de la GPL v3**. Con ese permiso, cualquiera puede distribuir Druse, modificado o no, enlazado con estos cuatro controladores sin publicar su código fuente, que no está disponible. El código de Druse sigue obligado a acompañarse de su fuente. El texto en inglés de `COPYRIGHT` es el que tiene efecto; este resumen solo lo explica.

El permiso:

- **No se extiende** a ninguna otra biblioteca no libre.
- **No concede derechos sobre los controladores.** Usarlos y redistribuirlos sigue sujeto a sus propios términos, y esa revisión continúa pendiente.
- **Puede retirarse** de una copia al distribuirla, como permite la sección 7. Esa copia ya no puede distribuirse junto a los controladores.

IKVM y su imagen del runtime de Java se distribuyen bajo Zlib y GPL-2.0 con excepción Classpath. Esa excepción permite enlazarlos con módulos independientes bajo cualquier licencia, así que no necesitan el permiso anterior.

## Revisión de redistribución pendiente

Falta reconciliar los componentes distribuidos con sus textos completos de licencia y obligaciones, en especial los términos de redistribución de los cuatro controladores anteriores y los componentes de sistema.

Antes de distribuir una versión GPL de Druse deben incluirse los avisos exigidos y facilitarse el código fuente correspondiente conforme a GPL v3. La licencia y su permiso adicional no acreditan por sí solos la elegibilidad para SignPath.

Las fuentes de la landing tienen sus propios avisos: [Inter](landing/assets/inter-LICENSE.txt) y [JetBrains Mono](landing/assets/jetbrains-mono-LICENSE.txt). Las marcas de motores identifican compatibilidad y pertenecen a sus titulares. Los derechos de procedencia sobre recursos propios siguen dentro de la auditoría de apertura.
