# Seguimiento a SignPath — enviado

Enviado el 21 de septiembre de 2026 a las 16:33 (America/Bogota), tras autorización expresa de Darío, a `support@signpath.io` desde `druse.contacto@gmail.com`, como respuesta a Phillip. Gmail confirmó la etiqueta `SENT`, mensaje `1a0c5e3a818b1ae2`, hilo `1a0a683d44455314`. Se verificaron destinatario, remitente y cabecera de respuesta. Pendiente de contestación; no es una solicitud formal de admisión.

[Abrir el correo enviado](https://mail.google.com/mail/u/?authuser=druse.contacto%40gmail.com#all/1a0c5e3a818b1ae2).

Subject: Re: Eligibility clarification for Druse database client dependencies

Hello Phillip,

Thank you for the clarification. Druse's repository is now public at https://github.com/darioRamos1/druse under GPL-3.0-only, with the previously described linking permission. We have implemented a separate Community edition excluding Oracle and IBM drivers and the JDBC/IKVM bridge. GitHub-hosted Windows CI has built its installer and dependency inventory and verified that its API starts and executes a SQLite query without those components: https://github.com/darioRamos1/druse/actions/runs/35625598733. The downloaded installer's SHA-256 matches the inventory. This is an unsigned candidate, not yet a reviewed public release; clean-Windows lifecycle and runtime traffic checks remain pending.

Before finalizing its package, could you clarify three outstanding points?

1. Would Microsoft.Data.SqlClient.SNI.runtime 6.0.2, used for SQL Server connectivity under its separate Microsoft terms, be permitted in this edition under the System Libraries exception?
2. Would the dependency on Microsoft Edge WebView2, installed through its bootstrapper when needed, be permitted? Please let us know whether you need different handling of that prerequisite.
3. For optional GitHub update checks, is explicit opt-in on first run and in preferences sufficient, or must the choice also be offered inside the installer? Checks remain disabled until opt-in and users may request a manual check.

We will provide the exact candidate artifact, dependency inventory and build workflow for assessment once the scope and remaining distribution checks are complete.

Thank you,
Darío — Druse maintainer
