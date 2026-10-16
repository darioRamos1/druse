# ADR 0007 — Conversaciones por base y contexto por pregunta

- **Fecha:** 2026-10-16
- **Estado:** aceptada
- **Fase:** A del [plan de contexto del chat](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

El chat conservaba una única conversación global. Cambiar de base o proveedor
reenviaba el historial anterior; el aviso de contexto se calculaba desde el
editor presente, aunque una pregunta anterior hubiera compartido otro SQL.
Reintentar necesitaba volver a escribir y enviar la pregunta.

## Decisión

1. Mantener conversaciones en memoria identificadas por conexión, base y motor,
   junto con perfil, modelo, permisos y destino del proveedor. No normalizar
   nombres de bases a minúsculas. Los cambios de modelo, permisos o destino
   seleccionan otra conversación.
2. Guardar en cada pregunta una copia del origen, proveedor, modelo, fecha y
   contexto preparado. Separar SQL y esquema en el contrato HTTP. Las categorías
   de relaciones y notas se incorporarán con sus fases funcionales.
3. Asociar cada suscripción de respuesta a su conversación de origen. Cambiar
   de base no redirige los fragmentos entrantes; cancelar y reiniciar afectan
   únicamente a la conversación visible.
4. Componer el contexto en el servidor y aplicar allí los permisos vigentes.
   Una discrepancia de modelo o divulgación respecto de la petición devuelve
   conflicto antes de invocar al proveedor. Los mensajes de sistema solo los
   genera el servidor.
   El contexto se compone dentro del mensaje de la pregunta: los adaptadores de
   Anthropic y Gemini reúnen los mensajes de sistema en una cabecera y perderían
   la asociación con cada pregunta si se enviara como instrucciones de sistema.
5. Emitir un evento SSE `context` con el texto preparado para el proveedor antes
   de la respuesta. Es una confirmación de composición del servidor; no demuestra
   recepción por el servicio remoto. Solo `done` y `error` terminan el flujo.
6. Reintentar sustituye el último turno fallido de respuesta, conserva la pregunta
   y su contexto y vuelve a pasar por la validación del servidor. El historial
   de continuación omite las parejas fallidas y las respuestas vacías, y conserva
   el contexto de cada pregunta que sí participó.

## Consecuencias y límites

Las conversaciones sobreviven a cerrar el panel y a cambiar de base durante
la sesión, pero se pierden al cerrar Druse. Esta entrega no persiste mensajes,
resultados ni notas de negocio. El tamaño de historial y contexto queda para
la fase D, por lo que sigue creciendo en memoria durante la sesión.

El contrato de `/api/ai/chat` cambia de contexto de texto a contexto tipado;
frontend y backend se distribuyen juntos. Los clientes que implementen ese
contrato deben enviar el modelo y los permisos con los que prepararon la petición.

El número 0006 permanece reservado por el plan de diagramas entidad-relación.
