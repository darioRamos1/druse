# Consulta de elegibilidad — borrador sin enviar

Preparación: 13 de septiembre de 2026. Relacionada con OSS-03 del [plan](plan-signpath-donaciones.md).

El titular debe revisar el alcance y autorizar el contacto. No adjuntar código privado, inventarios con rutas personales ni credenciales. Las versiones y nombres de paquetes siguientes son metadatos públicos de dependencias.

## Mensaje propuesto

Subject: Eligibility clarification for Druse database client dependencies

Hello SignPath Foundation team,

I maintain Druse, a Windows desktop database client built with Tauri and a local .NET API. The source repository is currently private. We are auditing the dependencies before deciding the scope and license of a public open-source edition; this is an eligibility question, not a claim that we already qualify.

Our current Windows package includes:

- Oracle.ManagedDataAccess.Core 23.26.301 under Oracle Free Distribution, Hosting, and Use Terms and Conditions.
- Net.IBM.Data.Db2 10.0.0.200 under IBM's license terms.
- IBM Informix JDBC 15.0.0.1.1, compiled through IKVM, under the IBM Informix JDBC Software License Agreement.
- Microsoft.Data.SqlClient.SNI.runtime 6.0.2, whose native SNI DLL has separate Microsoft Software License Terms.
- The .NET runtime and a dependency on Microsoft Edge WebView2.

We understand that redistribution permission alone does not establish eligibility for your program. Could you clarify whether any of these runtime components can fall within your permitted System Libraries exception, especially SNI and WebView2?

If Oracle and IBM components must be excluded, would an open-source edition that excludes them qualify for assessment while another distribution retains those integrations? We would not submit excluded third-party binaries for signing or assume that separate downloads bypass your policy.

A second, smaller question: our only outbound connection that the user does not initiate is an update check against GitHub. It is now **off until the user explicitly enables it**, with the choice offered on first run and in the application's preferences, and nothing is contacted until then. Your terms ask for notice and an opt-out **during installation**; would consent on first run satisfy that requirement, or do you require the option inside the installer itself?

We can provide a public dependency inventory, the proposed package contents, and a verifiable build once the publication scope is resolved. Please let us know which evidence would be useful for this dependency review.

Thank you,
Darío — Druse maintainer

## Después de recibir respuesta

Registrar fecha, alcance exacto, componentes aceptados/excluidos y condiciones. Una aclaración técnica no equivale a la admisión del proyecto ni autoriza a anunciar patrocinio de SignPath.
