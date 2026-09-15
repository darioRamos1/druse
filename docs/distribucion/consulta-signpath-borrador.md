# Consulta de elegibilidad — borrador sin enviar

Preparación: 13 de septiembre de 2026. Relacionada con OSS-03 del [plan](../planes/plan-signpath-donaciones.md).

Actualización: 15 de septiembre de 2026. Licencia elegida y [evidencia de controladores](../revisiones/controladores-signpath-2026-09-15.md) incorporadas. Sigue sin enviar.

El titular debe revisar el alcance y autorizar el contacto. No adjuntar código privado, inventarios con rutas personales ni credenciales. Las versiones y nombres de paquetes siguientes son metadatos públicos de dependencias.

Preparación de envío, 15 de septiembre: Darío pidió realizar la consulta. Destino propuesto: `info@signpath.io`, contacto publicado en la [web oficial](https://signpath.io/contact), solicitando revisión por el equipo de Foundation. El buzón de Druse no está conectado y el formulario no cargó; falta resolver el remitente. **No enviado; sin acuse ni solicitud formal presentada.**

Remitente elegido por Darío: `druse.contacto@gmail.com`. Pendiente de que complete la conexión de esa cuenta a Gmail; el plugin está instalado, pero las cuentas disponibles son otras. No usar una cuenta personal como alternativa sin una nueva elección del titular. La consulta ya está autorizada; una vez conectada la cuenta elegida, comprobar remitente y ausencia de envío previo antes de enviarla.

## Mensaje propuesto

Subject: Eligibility clarification for Druse database client dependencies

Hello SignPath Foundation team,

I maintain Druse, a Windows desktop database client built with Tauri and a local .NET API. The source repository is currently private. Druse's original code is licensed under GPL-3.0-only, with an additional permission under section 7 for linking with the four database driver libraries listed below. This permission grants no rights in those libraries and we are still reviewing their redistribution terms. We are determining the scope of a public candidate edition; this is an eligibility question, not a claim that we already qualify.

Our current Windows package includes:

- Oracle.ManagedDataAccess.Core 23.26.301 under Oracle Free Distribution, Hosting, and Use Terms and Conditions.
- Net.IBM.Data.Db2 10.0.0.200 under IBM's license terms.
- IBM Informix JDBC 15.0.0.1.1, compiled through IKVM, under the IBM Informix JDBC Software License Agreement.
- Microsoft.Data.SqlClient.SNI.runtime 6.0.2, whose native SNI DLL has separate Microsoft Software License Terms.
- The .NET runtime and a dependency on Microsoft Edge WebView2.

We understand that neither our GPL linking permission nor a vendor's redistribution permission establishes eligibility for your program. Could you clarify whether any of these runtime components can fall within your permitted System Libraries exception, especially SNI and WebView2? We would submit only Druse's own artifacts for signing, not those vendors' binaries or the IBM JDBC code translated through IKVM.

If Oracle and IBM components must be excluded, would an open-source edition that excludes them qualify for assessment while another distribution retains those integrations? We would not submit excluded third-party binaries for signing or assume that separate downloads bypass your policy.

A second question concerns update checks against GitHub. They are now **off until the user explicitly enables them**, with the choice offered on first run and in the application's preferences; the updater does not contact GitHub before that choice. Users may also explicitly request a manual check. Database, SSH and optional AI connections are user-configured; runtime traffic validation, including third-party components, is still pending. For this update feature, would notice and consent on first run satisfy your installation/privacy requirement, or do you require the option inside the installer itself?

We can provide a public dependency inventory, the proposed package contents, and a verifiable build once the publication scope is resolved. Please let us know which evidence would be useful for this dependency review.

Thank you,
Darío — Druse maintainer

## Después de recibir respuesta

Registrar fecha, alcance exacto, componentes aceptados/excluidos y condiciones. Una aclaración técnica no equivale a la admisión del proyecto ni autoriza a anunciar patrocinio de SignPath.
