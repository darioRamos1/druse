# Expediente para SignPath Foundation — preparación tras el rechazo

Estado revisado el 14 de octubre de 2026: la solicitud recibió una respuesta negativa el 9 de octubre por falta de reconocimiento y adopción pública. La [beta Comunidad 1.3.0](https://github.com/darioRamos1/druse/releases/tag/v1.3.0-beta.1) está publicada desde el 8 de octubre (America/Bogota), después del envío del formulario. Se sigue el [plan de reaplicación](../planes/plan-reaplicacion-signpath-2026-10-11.md). No hay admisión ni firma concedida; SNI, WebView2 y consentimiento durante instalación siguen sin resolución expresa.

Los párrafos fechados de septiembre y el formulario enviado conservan el estado que existía en ese momento. Para pruebas externas y avances actuales, consultar el [registro de evidencia](evidencia-adopcion-signpath.md).

[Solicitud formal enviada](solicitud-signpath-2026-10-08.md) el 8 de octubre de 2026 mediante el formulario oficial. SignPath mostró «Form submitted» sin identificador. Se declararon entonces la ausencia de release pública y de reputación de uso. La [respuesta del 9 de octubre](https://mail.google.com/mail/u/?authuser=druse.contacto%40gmail.com#all/1a11f4083f4875b9) invita a volver a solicitarlo cuando exista mayor reconocimiento.

[Consulta de seguimiento enviada](consulta-signpath-seguimiento.md) el 21 de septiembre: repo público y construcción de Comunidad comunicados; SNI, WebView2 y consentimiento pendientes de respuesta. La consulta no sustituye una solicitud formal.

[Nueva consulta técnica preparada](consulta-signpath-pendientes-2026-10-14.md) el 14 de octubre: borrador local que retoma esas tres preguntas y reconoce el rechazo por falta de reconocimiento público. No se ha enviado ni resuelve los pendientes. La prueba en Windows limpio sigue sin ejecutarse por falta de espacio para la VM.

Actualización del 21 de septiembre: [repositorio público](https://github.com/darioRamos1/druse), GPL y avisos disponibles. La [edición Comunidad](edicion-comunidad.md) excluye Oracle/IBM/IKVM; el PR #18 está integrado y su CI produjo el instalador y el inventario, descargados con hash coincidente. Falta completar pruebas de Windows limpio, publicar una beta revisada y aclarar SNI, WebView2 y consentimiento; no se ha presentado una solicitud formal.

Actualización del 16 de septiembre: [respuesta a la consulta](consulta-signpath-borrador.md). SignPath considera que Druse todavía no está listo para revisión y admite evaluar una edición separada sin Oracle/IBM bajo condiciones; no ha aprobado la candidatura. SNI, WebView2, consentimiento durante la instalación y revisión de redistribución siguen abiertos. La [revisión documental de controladores](../revisiones/controladores-signpath-2026-09-15.md) conserva la evidencia local.

Preparación: 13 de septiembre de 2026. Corresponde a **SIG-01** del [plan de SignPath y donaciones](../planes/plan-signpath-donaciones.md).

Revisión técnica: [14 de septiembre de 2026](../revisiones/revision-signpath-2026-09-14.md). El inventario y las guardas de publicación están actualizados; la solicitud se presentó después, con las limitaciones declaradas. La excepción explícita `-SinComprobarCI` se registra y no puede describirse como CI verificada ante SignPath.

Privacidad: el aviso provisional ya está incorporado al código de Preferencias y a la landing. Pendiente de distribuir, completar datos del responsable y ejecutar el [protocolo de Windows limpio](pruebas-instalador-signpath.md); todavía no es una política final validada por tráfico real.

**Este expediente no acredita elegibilidad ni admisión.** Hay requisitos que hoy no se cumplen y están marcados como tales. El [formulario presentado](solicitud-signpath-2026-10-08.md) los declaró sin exagerar el estado del proyecto.

## 1. Pendientes para que la candidatura pueda prosperar

| Qué falta | De quién depende |
| --- | --- |
| Repositorio público desde el 16 de septiembre | **DEC-01 cerrado**; verificación de procedencia sigue separada |
| GPL-3.0-only elegida y `LICENSE` incorporado; faltan procedencia y compatibilidad de terceros | **DEC-02-R**, **OSS-03/04** |
| Beta pública disponible; falta validar el instalador en Windows limpio y reunir uso externo | **PUB-04** parcialmente cubierto; **PUB-05** abierto |
| Comunidad excluye Oracle/IBM; SNI y WebView2 siguen sin resolución expresa | **OSS-03 / DEC-03**: edición separada construida y funcional; elegibilidad todavía pendiente |
| La opción de desactivar la búsqueda de actualizaciones no se ofrece durante la instalación | **P-01**: la respuesta valora la activación explícita, pero no aclara si basta el primer arranque |

La respuesta pide repositorio público, artefacto publicado en la forma que se firmaría, licencia, inventario y flujo de construcción/firma. Debe aclararse el quinto punto; no se considera cerrado por la valoración favorable de la activación explícita.

## 2. El proyecto

| Campo | Valor |
| --- | --- |
| Nombre | Druse |
| Qué es | Cliente de escritorio para administrar y consultar bases de datos: PostgreSQL, SQL Server, MySQL/MariaDB, Oracle, SQLite e Informix |
| Plataforma de distribución | Windows x64, instalador NSIS construido con Tauri; API local en .NET autocontenida |
| Versión actual | 1.11.0, con beta Comunidad pública `v1.3.0-beta.1`; sin release estable |
| Repositorio | [github.com/darioRamos1/druse](https://github.com/darioRamos1/druse) (público) |
| Contacto público | `druse.contacto@gmail.com` |
| Licencia | GNU GPL v3 exclusivamente (`GPL-3.0-only`), elegida por Darío el 14 de septiembre de 2026; [LICENSE](../../LICENSE). Con un permiso adicional de la sección 7 en [COPYRIGHT](../../COPYRIGHT), limitado a cuatro controladores de bases de datos no libres |

Druse no es una herramienta de seguridad ofensiva: no explota vulnerabilidades ni elude protecciones del sistema. Se conecta a las bases de datos que configura quien lo usa, con las credenciales que esa persona introduce.

## 3. Equipo y aprobaciones

| Requisito del programa | Estado |
| --- | --- |
| Responsable identificable del proyecto | Darío Ramos, mantenedor único |
| Autenticación en dos pasos | Activa en la cuenta de GitHub del proyecto |
| Quién revisa las contribuciones | Darío. [`CONTRIBUTING.md`](../../CONTRIBUTING.md) establece aportes bajo GPL-3.0-only, revisión y declaración de procedencia |
| Quién aprueba cada firma | Darío, de forma manual. No hay publicación automática desencadenada por un commit |
| Política de firma pública | [`CODE_SIGNING_POLICY.md`](../../CODE_SIGNING_POLICY.md), en borrador y sin atribución a SignPath porque no hay servicio concedido |

Un mantenedor único es lo que hay. No se inventan revisores ni un tamaño de equipo que el repositorio desmentiría en dos minutos.

## 4. Cómo se construye y se publica

1. El árbol de Git debe estar limpio: los binarios corresponden a un commit exacto.
2. `package.ps1` publica la API .NET autocontenida y **comprueba el contenido del paquete** contra [`build/paquete-excluidos.json`](../../build/paquete-excluidos.json), deteniendo la construcción si aparece un componente que esa edición no debe llevar.
3. Se genera un manifiesto con el SHA-256 de cada archivo distribuido y de los artefactos finales.
4. `release.ps1` trabaja en tres etapas —construir, verificar y publicar— precisamente para que la firma pueda ocurrir fuera de la máquina de construcción y los bytes firmados se publiquen sin reconstruirse.
5. La verificación comprueba, sobre los bytes finales, que cada firma de actualización corresponde a su archivo, que `latest.json` coincide con lo que hay en disco, que ninguna firma Authenticode es inválida y que los instaladores son los que se revisaron. Publicar exige integración continua verde para ese commit exacto y deja `evidencia.json` con commit, hashes y resultados.

**Estado de la integración continua:** las ejecuciones anteriores a la apertura fallaban sin iniciar pasos por facturación/cuota. El 21 de septiembre finalizaron correctamente Pages y el [workflow específico de Comunidad](https://github.com/darioRamos1/druse/actions/runs/35625598733), que construyó instalador e inventario en un runner alojado por GitHub. Los commits, hashes y límites de estas comprobaciones están en la [evidencia de Comunidad](edicion-comunidad.md). Esto no acredita la CI general de todos los proveedores ni una integración de firma, todavía no concedida.

## 5. Dependencias que hay que resolver

El inventario completo está en [`licencias-dependencias.csv`](../licencias-dependencias.csv): 1.144 registros de npm, Cargo, NuGet, Maven, fuentes y WebView2, con la licencia identificada y la decisión pendiente en todos. Lo que decide la elegibilidad es esta lista corta:

| Componente | Términos | Situación |
| --- | --- | --- |
| `Oracle.ManagedDataAccess.Core` 23.26.301 | Oracle Free Distribution, Hosting, and Use Terms | Excluido de Comunidad; presente en completa y sin Informix |
| `Net.IBM.Data.Db2` 10.0.0.200 | IBM IPLA | Solo en la edición completa |
| `com.ibm.informix:jdbc` 15.0.0.1.1 | IBM Informix JDBC License Agreement | Solo en la completa, mediante IKVM |
| IKVM 8.11.2 y sus runtimes | Zlib y GPL con excepción Classpath, según archivo | Solo en la completa; obligaciones de aviso por archivo |
| `Microsoft.Data.SqlClient.SNI.runtime` 6.0.2 | Microsoft Software License Terms propios del componente nativo | También en Comunidad; elegibilidad pendiente de respuesta expresa |
| WebView2 | Runtime externo de Microsoft | No se distribuye; lo instala su propio bootstrapper |

La edición sin Informix no equivale a Comunidad: esta última también excluye Oracle. Los recuentos antiguos de completa y sin Informix no describen el instalador candidato actual; usar el manifiesto adjunto a la beta. SNI y WebView2 siguen pendientes de aclaración.

## 6. Requisitos de conducta de la aplicación

| Requisito | Estado |
| --- | --- |
| Desinstalación | El instalador NSIS la ofrece. **No se ha comprobado qué deja atrás**: es P-02 de la [privacidad](../privacidad/privacidad-aplicacion.md) y se resuelve en PKG-04 |
| Aviso de cambios en el sistema | Instalación por usuario (`currentUser`); pendiente de documentar con una instalación limpia |
| Protección de la privacidad | [Documentada y contrastada con el código](../privacidad/privacidad-aplicacion.md): sin telemetría, sin servidor propio, credenciales en el Administrador de credenciales de Windows, API local solo en loopback y con token |
| Aviso y opción de desactivar transferencias de datos | La única conexión no pedida por el usuario es la búsqueda de actualizaciones. **Está desactivada mientras nadie la autorice**, con aviso en el primer arranque y ajuste en Preferencias. Falta ofrecerlo durante la instalación, que es lo que se pregunta en la consulta |
| Nada de explotar vulnerabilidades ni eludir protecciones | Se cumple |

## 7. Evidencia de uso

La beta candidata ya tiene descarga pública. Todavía no se ha reunido evidencia de uso externo verificado; el [registro de adopción](evidencia-adopcion-signpath.md) distingue contadores, comprobaciones propias y pruebas de terceros.

Lo que sí se puede enseñar hoy: historial de desarrollo sostenido, suite de pruebas —950 del frontend, más de 1.100 del backend, pruebas de contrato por motor y de punta a punta— y la [matriz de motores](../motores/matriz-de-motores.md) que distingue lo probado de lo anunciado.

## 8. Texto en inglés para el formulario

Antecedente de la primera candidatura. No reutilizar sin actualizar release, respuesta recibida y evidencias de uso conforme al plan de reaplicación.

> Druse is a Windows desktop database client (Tauri shell, self-contained .NET local API) for PostgreSQL, SQL Server, MySQL/MariaDB, Oracle, SQLite and Informix. It is maintained by a single developer.
>
> Druse's original code is licensed under GPL-3.0-only, with an additional permission under GPL v3 section 7 for four database drivers. The repository is now public. A separate Community edition excludes Oracle and IBM components and the JDBC/IKVM bridge; Microsoft SNI, WebView2 and the remaining redistribution checks still need resolution. No reviewed public candidate release is claimed.
>
> Releases are produced from a clean Git tree by a staged script: the package contents are checked against an explicit exclusion list and the build is stopped if an excluded component appears; a SHA-256 manifest is produced for every build; before publishing, every updater signature is verified against the final bytes, the update manifest is checked against the artifacts on disk, and any invalid Authenticode signature stops the release. Publishing requires a green CI run for that exact commit and records commit, hashes and check results as release evidence. Only Druse's own installers and binaries would be submitted for signing; third-party components would not.
>
> The project's draft code signing policy is available in the public repository. The maintainer approves every release manually and uses two-factor authentication. Code review found no telemetry integration; network behavior still needs runtime validation. Druse runs a local API and connects to user-configured databases, SSH servers and optional AI providers. Automatic update checks stay disabled until the user explicitly enables them. The application privacy draft describes these connections and the data involved.
>
> Open items we are aware of: the dependency scope of Oracle, IBM and Microsoft SNI components (subject of a separate eligibility question), and offering the update opt-out during installation rather than on first run.

## 9. Después de presentarlo

Registrar fecha, respuesta, condiciones particulares y el request ID. Una aclaración técnica no es una admisión, y una admisión no autoriza a anunciar patrocinio antes de que el servicio esté concedido y configurado. Si la respuesta es negativa, anotar el motivo y comparar con la [ruta de Microsoft Store](distribucion-windows-smartscreen.md) antes de retirar funciones del producto.
