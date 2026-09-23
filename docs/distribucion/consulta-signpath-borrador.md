# Consulta de elegibilidad — respuesta recibida, candidatura pendiente

Preparación: 13 de septiembre de 2026. Relacionada con OSS-03 del [plan](../planes/plan-signpath-donaciones.md).

Actualización: 15 de septiembre de 2026. Licencia elegida y [evidencia de controladores](../revisiones/controladores-signpath-2026-09-15.md) incorporadas. Consulta enviada a las 14:21 (America/Bogota).

Darío autorizó el contacto y eligió el remitente. No se adjuntaron código privado, inventarios con rutas personales ni credenciales. Las versiones y nombres de paquetes siguientes son metadatos públicos de dependencias.

Envío del 15 de septiembre: de `druse.contacto@gmail.com` a `info@signpath.io`, contacto publicado en la [web oficial](https://signpath.io/contact), solicitando revisión por el equipo de Foundation. Gmail confirmó «Mensaje enviado» y el mensaje se verificó en Enviados. **Respuesta recibida el 16 de septiembre; esta consulta no constituye una solicitud formal ni la admisión del proyecto.**

La cuenta estaba conectada en Codex, pero no aparecía en las herramientas del conector. Se completó el envío mediante Gmail en el navegador, tras verificar la cuenta de Druse y que Enviados estaba vacío. [Mensaje enviado en Gmail](https://mail.google.com/mail/u/2/#sent/KtbxLrjNcFjVVgtTwwFwgGCnkSTtgvRhpg) (requiere la sesión de Druse; el índice de cuenta puede variar). No volver a enviar la consulta como si siguiera pendiente.

## Mensaje enviado

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

A second question concerns update checks against GitHub. They are now off until the user explicitly enables them, with the choice offered on first run and in the application's preferences; the updater does not contact GitHub before that choice. Users may also explicitly request a manual check. Database, SSH and optional AI connections are user-configured; runtime traffic validation, including third-party components, is still pending. For this update feature, would notice and consent on first run satisfy your installation/privacy requirement, or do you require the option inside the installer itself?

We can provide a public dependency inventory, the proposed package contents, and a verifiable build once the publication scope is resolved. Please let us know which evidence would be useful for this dependency review.

Thank you,
Darío — Druse maintainer

## Respuesta del 16 de septiembre de 2026

Phillip Deng, desde `support@signpath.io`, respondió a las 06:47:12 de Colombia. [Correo original en Gmail](https://mail.google.com/mail/u/?authuser=druse.contacto%40gmail.com#all/1a0aa0ad9dca9581). Mensaje `1a0aa0ad9dca9581`, conversación `1a0a683d44455314`. Resumen de alcance, sin publicar el correo completo:

- Druse todavía no está listo para revisión: el repositorio es privado y el contenido final de la distribución pública no está definido. Necesitan repositorio abierto, artefacto publicado en la forma que se firmaría, licencia, inventario de dependencias y flujo de construcción/firma.
- El permiso de redistribución o la excepción de enlace GPL no acredita elegibilidad. Consideran que los controladores Oracle e IBM probablemente tendrían que excluirse, salvo demostración clara de una excepción admitida de bibliotecas de sistema; por la descripción recibida, no parecen encajar.
- Una edición separada sin Oracle ni IBM podría evaluarse si contiene únicamente componentes elegibles y funciona sin depender de los excluidos. Otra distribución con esas integraciones quedaría fuera del alcance de firma de Foundation.
- Valoran que las comprobaciones de GitHub requieran activación explícita. Reiteran que las transferencias de datos deben documentarse, mostrarse al usuario y poder desactivarse cuando corresponda.

**Sin resolver expresamente:** SNI de Microsoft, WebView2 y si el consentimiento en el primer arranque satisface la condición de instalación. No interpretar el silencio como aprobación. OSS-03, P-01 y SIG-01 siguen abiertos. La respuesta tampoco aprueba licencias de redistribución ni garantiza la admisión de una futura edición.

Siguiente trabajo propuesto: concretar con Darío la edición candidata, excluir Oracle/IBM de ese artefacto y comprobar su independencia, resolver SNI/WebView2 y el lugar del consentimiento, completar la auditoría de apertura y aportar los enlaces y la construcción verificable pedidos. No se han retirado motores, cambiado la visibilidad ni enviado una nueva respuesta por leer este correo.

## Seguimiento

Registrar fecha, alcance exacto, componentes aceptados/excluidos y condiciones. Una aclaración técnica no equivale a la admisión del proyecto ni autoriza a anunciar patrocinio de SignPath.
