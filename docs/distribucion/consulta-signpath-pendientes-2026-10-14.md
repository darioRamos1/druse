# Consulta técnica pendiente para SignPath

Preparada el 14 de octubre de 2026 para REA-14/15 del [plan de reaplicación](../planes/plan-reaplicacion-signpath-2026-10-11.md). **Borrador local; no enviado ni creado en Gmail.** Desarrolla las tres preguntas del [seguimiento enviado el 21 de septiembre](consulta-signpath-seguimiento.md), que siguen sin respuesta expresa.

Destinatario propuesto: Phillip, SignPath. La respuesta del 9 de octubre procede de `oss-support@signpath.org`; la consulta técnica anterior se envió a `support@signpath.io`. Antes de enviar, comprobar en el hilo la dirección de respuesta y el asunto vigentes, y obtener autorización de Darío para el envío del texto definitivo.

## Texto propuesto

Hola, Phillip:

Gracias por revisar la solicitud de Druse. Entendemos la respuesta del 9 de octubre y estamos trabajando en reunir experiencias de uso y referencias independientes antes de volver a solicitar la admisión.

Para orientar el trabajo técnico de la edición Comunidad, ¿podrían aclararnos las tres preguntas que quedaron abiertas en nuestra consulta del 21 de septiembre?

1. ¿Sería admisible `Microsoft.Data.SqlClient.SNI.runtime` 6.0.2, utilizado para conectar con SQL Server y sujeto a sus términos de Microsoft, bajo la excepción de bibliotecas del sistema? Si necesitan otra forma de distribuirlo, agradeceríamos conocerla.
2. ¿Es admisible que el instalador invoque el bootstrapper de Microsoft Edge WebView2 cuando falta ese requisito? ¿Exigen algún tratamiento o aviso adicional para ese paso?
3. Las comprobaciones automáticas de actualizaciones en GitHub están desactivadas hasta que la persona las activa expresamente en el primer arranque o en Preferencias; también puede solicitar una comprobación manual. ¿Ese consentimiento es suficiente o la elección debe ofrecerse además dentro del instalador?

Comunidad incluye PostgreSQL, SQL Server, MySQL/MariaDB y SQLite; excluye los componentes de Oracle e IBM y el puente JDBC/IKVM. La propuesta de firma se limita a los binarios propios y al instalador de Druse; los componentes de terceros conservarían sus firmas originales cuando las tengan.

El repositorio es público: https://github.com/darioRamos1/druse. Hay una beta pública, pero las pruebas de instalación, desinstalación y tráfico en Windows limpio siguen pendientes. Hemos corregido dependencias en una candidata local posterior; todavía no está publicada ni sustituye los bytes de esa beta.

La consulta busca aclarar estos requisitos para preparar una futura candidatura. Agradecemos sus indicaciones.

Darío — mantenedor de Druse

## Evidencia y cierre

- La [beta pública](https://github.com/darioRamos1/druse/releases/tag/v1.3.0-beta.1) y la [candidata local corregida](../revisiones/seguridad-comunidad-2026-10-14.md) son artefactos distintos. No adjuntar la candidata como si procediera de una CI pública comprobada.
- La [preparación de Windows limpio](entorno-windows-limpio.md) permanece pendiente: Darío confirmó que no dispone de otro disco o carpeta con el espacio necesario. No hay resultados del protocolo de instalación ni de tráfico.
- Registrar la respuesta con fecha, componente, versión y condiciones concretas. Una aclaración sobre una dependencia no concede admisión ni resuelve el requisito de reconocimiento público.
- Si solicitan cambios en el instalador o en el consentimiento, implementarlos y ejecutar las comprobaciones correspondientes antes de describirlos como resueltos. El silencio no cierra REA-14/15.
