# Convocatoria para probar Druse Comunidad — borrador

Preparada el 14 de octubre de 2026. REA-05 del [plan de reaplicación](../planes/plan-reaplicacion-signpath-2026-10-11.md).

Estado: material listo para revisar; no enviado ni publicado. La difusión amplia depende del protocolo de Windows limpio. Darío elige destinatarios y autoriza las publicaciones. La guía nueva aún necesita desplegarse en Pages; usar el enlace al Markdown del repositorio solo después de publicar ese commit.

Actualización de seguridad del 14 de octubre: el código y el runtime local ya se corrigieron, pero la beta pública enlazada en el borrador conserva las dependencias anteriores. Antes de usar esta convocatoria, publicar una candidata distinta con los cambios de la [revisión de seguridad](../revisiones/seguridad-comunidad-2026-10-14.md), validar sus bytes y sustituir versión, enlace y hashes en el material. No basta con que compile el código local.

## Mensaje breve

Estoy desarrollando Druse, un cliente de escritorio de código abierto para bases de datos, y busco personas que prueben su beta de Comunidad en Windows x64.

Puedes probarlo con SQLite y datos ficticios en unos diez minutos, sin montar un servidor. También incluye PostgreSQL, SQL Server y MySQL/MariaDB. Me sirve saber qué funcionó y en qué paso te atascaste; no necesitas aportar código.

Descarga y hashes: <https://github.com/darioRamos1/druse/releases/tag/v1.3.0-beta.1>.

La beta no tiene firma Authenticode, Windows puede mostrar SmartScreen y no se actualiza automáticamente. La validación completa en Windows limpio sigue pendiente. No uses datos de trabajo para esta prueba.

Puedes dejar el resultado, incluso si todo funcionó, en <https://github.com/darioRamos1/druse/issues/new?template=compatibilidad.yml> o escribir a `druse.contacto@gmail.com`. Indica versión de Windows, pasos realizados y resultado; sin credenciales ni datos personales. Los informes de GitHub son públicos; un correo no se publica sin permiso.

## Antes de publicar

- [ ] Publicar la candidata con las dependencias corregidas y actualizar el enlace, versión y hashes del mensaje y las guías.
- [ ] Completar la prueba del instalador en Windows limpio y actualizar el mensaje con su resultado real.
- [ ] Publicar la guía y añadir su enlace accesible sin sesión.
- [ ] Elegir un grupo concreto cuyas reglas permitan presentar proyectos y adaptar el mensaje a ese público.
- [ ] Revisar y autorizar el envío. No pedir estrellas a cambio de soporte ni presentar la beta como aprobada por SignPath.

## Respuesta a quien haya probado

Gracias por probar Druse. ¿Qué versión de Windows y de Druse usaste, qué pasos completaste y qué ocurrió? Si hubo un error, basta con el mensaje sin las partes sensibles. Si prefieres escribir en privado, no publicaré tu informe sin permiso.

Una segunda prueba, después de corregir un problema o unos días más tarde, también ayuda. Se registrará como uso repetido de la misma persona, no como un usuario adicional.
