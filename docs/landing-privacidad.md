# Privacidad y preparación legal de la landing

Revisión: 12 de septiembre de 2026. Este documento es una revisión técnica y un registro de decisiones; no acredita cumplimiento legal universal. La jurisdicción, identidad del responsable y condiciones de distribución de la aplicación siguen pendientes de confirmación.

## Implementado

- Avisos accesibles desde el pie, con privacidad de la web, tratamiento técnico, almacenamiento, condiciones y enlaces a las licencias de las fuentes.
- Sin cookies creadas por el código, píxeles, analítica, formularios, fuentes remotas o contenido incrustado de terceros. La demo no hace peticiones ni ejecuta SQL.
- Sin persistencia opcional en la primera visita. Se necesita marcar la opción de recordar los efectos y guardar expresamente la elección; cerrar el diálogo no guarda nada. Rechazar y guardar se presentan con el mismo estilo.
- `druse-site-preferences` guarda exclusivamente versión, autorización de la preferencia, estado de efectos y vencimiento. No se envía al servidor, no contiene identificadores y no se renueva al navegar o alternar efectos. Vence a los 180 días desde la elección y se elimina al volver a cargar la web.
- Retirada accesible desde el pie. Solo se eliminan las claves de Druse; nunca se llama a `localStorage.clear()`. Las pestañas abiertas reciben la retirada mediante el evento de almacenamiento.
- Se elimina la antigua clave `druse-effects-paused`, sin importar su valor como una autorización nueva.
- Los errores o bloqueos de almacenamiento no impiden usar la web. Se respeta el movimiento reducido y la información legal es legible sin JavaScript.
- El aviso distingue el almacenamiento del navegador de los registros del alojamiento, y la web de la aplicación de escritorio.
- El titular confirmó `druse.contacto@gmail.com` para soporte y privacidad. Se añadió a la landing y a los avisos mediante enlaces `mailto:` con asuntos diferenciados. La recepción del buzón no se ha comprobado enviando mensajes.
- El borrador describe los datos recibidos si un visitante escribe por email e identifica Gmail como servicio del buzón. Abrir el enlace no envía mensajes automáticamente ni carga contenido de Google en la landing.

No se muestra un banner que solicite aceptar servicios inexistentes. Las preferencias son accesibles siempre desde el pie y están desactivadas por defecto. Si cambia el inventario, hay que revisar esta decisión.

## Pendientes antes de finalizar los avisos

1. Confirmar nombre o razón social del responsable, país, domicilio y los demás datos legales aplicables. El correo de soporte y privacidad ya está confirmado: `druse.contacto@gmail.com`. No inferir la identidad legal desde el usuario de GitHub.
2. Ajustar derechos, procedimiento y plazos al país confirmado; identificar quién responderá las solicitudes y definir la conservación de los correos. Si opera en Colombia, la política debe contemplar los datos identificativos y de contacto exigidos por el régimen aplicable, así como finalidades, derechos, atención y vigencia.
3. Confirmar el proveedor final de alojamiento y sus condiciones de tratamiento y conservación. GitHub informa del registro de IP por seguridad; su declaración cubre también operaciones internacionales. No inventar un plazo de borrado o una base de legitimación que el titular no haya revisado.
4. Antes de ofrecer un instalador: definir licencia/condiciones de uso y revisar por separado el tratamiento de la aplicación, actualizaciones, soporte, conexiones y proveedores opcionales. La web no debe prometer que ningún dato sale del equipo sin auditar esos flujos.
5. Completar el aviso de `landing/legal.html`, retirar la indicación de borrador y actualizar su fecha cuando la información esté confirmada. Mantener un historial de cambios. `noindex` limita indexación, no impide el acceso público.

## Si se añaden formularios, marketing o analítica

Documentar primero los datos, finalidad, destinatarios, conservación y fundamento aplicable. Los recursos que requieran consentimiento no deben cargarse antes de otorgarlo. Rechazar o retirar debe ser tan accesible como aceptar. No condicionar el acceso a consentimientos opcionales, no usar casillas preseleccionadas ni entender la navegación como aceptación. El gestor actual controla únicamente la preferencia visual: no es una plataforma de consentimiento para herramientas futuras.

## Fuentes consultadas

- [GitHub Pages: recogida de datos](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection): el servicio registra IP por seguridad.
- [Declaración de privacidad de GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- [Política de privacidad de Google](https://policies.google.com/privacy?hl=es): proveedor del buzón de contacto.
- [Ley 1581 de 2012, Colombia](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981): referencia condicionada a que corresponda esta jurisdicción. Contempla derechos, autorizaciones y atención de consultas y reclamos.
- [Decreto 1377 de 2013](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=53646), artículo 13: contenido de políticas; sus disposiciones se compilaron en el Decreto 1074 de 2015.
- [AEPD: guía de cookies](https://www.aepd.es/guias/guia-cookies.pdf) y [criterio de presentación de aceptación y rechazo](https://www.aepd.es/preguntas-frecuentes/17-internet-y-redes-sociales/FAQ-1707-importancia-de-las-cookies-en-la-proteccion-de-datos). Se utilizan como referencia de diseño de las opciones, sin afirmar que sustituyan la normativa del país de operación.
