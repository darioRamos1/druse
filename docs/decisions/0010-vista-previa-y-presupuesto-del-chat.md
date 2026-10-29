# ADR 0010 — Vista previa del envío y presupuesto de contexto

- **Fecha:** 2026-10-16
- **Estado:** aceptada
- **Entrega:** 1.7.0, fase D del [plan de contexto del chat](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

Poder elegir tablas y notas no permite comprobar el texto final ni evita superar
la capacidad del proveedor. La composición pertenece al servidor, donde también
se filtra el contexto de preguntas anteriores por los permisos del perfil.

## Decisión

1. `POST /api/ai/chat/preview` valida la conversación y prepara el mismo texto que
   `/api/ai/chat`, sin pedir claves ni invocar al modelo. Devuelve contexto,
   mensajes completos, límites, tamaños, reservas, incidencias y un hash. El chat
   presenta esta revisión antes de cada envío; volver a editar conserva el
   borrador. Cambiar de origen o proveedor invalida la preparación pendiente.
2. Congelar la pregunta, sus adjuntos y el historial antes de revisarlos. Confirmar
   usa esa copia, aunque después cambie el SQL abierto. El hash SHA-256 incluye
   petición normalizada, perfil, destino, instrucciones y política. El servidor
   recalcula y rechaza con 409 si algo cambió. Es una comprobación de coherencia,
   no una firma ni una autorización. Clientes que omitan el hash siguen pasando
   las validaciones de permisos, conversación y tamaño.
3. Medir bytes UTF-8 exactos del texto compuesto, incluyendo instrucciones,
   cabeceras y contexto del historial. La tabla de la vista previa distingue
   SQL, estructura, notas, contexto actual, historial, entrada y pregunta.
   Las secciones de cada pregunta anterior también se validan; no pueden eludir
   límites al moverse al historial. Un límite adicional de 1 MiB controla la
   petición JSON normalizada. Los bytes de texto no son el tamaño HTTP ni los
   tokens facturados por el proveedor.
4. Estimar tokens como `ceil(bytes de entrada / 3) + 32 por mensaje`. Reservar
   además la parte no usada de la reserva de pregunta y la reserva de respuesta.
   Son aproximaciones, no un tokenizador. Los conectores actuales no suministran
   capacidades verificadas; todos usan por defecto un presupuesto conservador.
   El operador puede declarar otra capacidad por perfil. La reserva de respuesta
   es contable: no impone un límite de generación a APIs o programas de consola.
5. No cortar automáticamente tablas, restricciones, notas ni historial. Un exceso
   aparece en la vista previa y bloquea confirmar; el servidor también lo rechaza
   con 413 aunque se eluda la interfaz. Se propone quitar objetos, reducir
   historial o empezar otra conversación. Los tokens aproximados complementan
   los límites exactos de bytes; no garantizan que cualquier modelo acepte la
   petición.
6. Reducir historial solo por elección explícita, conservando parejas completas
   de pregunta y respuesta. Mostrar qué preguntas dejan de acompañar el envío;
   conservarlas visibles y guardar sus índices omitidos en el turno nuevo. Los
   fallos no cuentan como parejas respondidas. Reintentar reutiliza el mismo
   envío revisado, incluso su historial, y vuelve a pasar la validación servidor.
7. Ofrecer insertar o reemplazar únicamente en bloques etiquetados `sql`,
   `sql-insert` o `sql-replace`. Los demás lenguajes y los bloques sin etiqueta
   solo ofrecen copiar. Una etiqueta incompleta durante streaming no se trata
   como SQL. Admitir finales de línea LF y CRLF y bloques todavía abiertos.

## Configuración

Los límites se leen de `AiChat:Defaults` en la configuración de .NET. Un perfil
puede declarar su política completa en `AiChat:Providers:<guid del perfil>`;
los campos omitidos de esa política usan los valores del contrato, no los de
`Defaults`. También se pueden proporcionar por variables de entorno, usando
doble guion bajo, por ejemplo `AiChat__Defaults__MaxSchemaBytes=24576`.

| Campo | Valor por defecto |
| --- | ---: |
| `MaxSqlBytes` | 16384 |
| `MaxSchemaBytes` | 32768 |
| `MaxNotesBytes` | 16384 |
| `MaxContextBytes` | 49152 |
| `MaxHistoryBytes` | 32768 |
| `MaxInputBytes` | 65536 |
| `MaxQuestionBytes` | 8192 |
| `MaxHistoryTurns` | 20 |
| `WindowTokens` | 16384 |
| `QuestionReserveTokens` | 1024 |
| `ResponseReserveTokens` | 2048 |
| `CapacityKnown` | `false` |

Los límites de bytes admiten 1–1048576, el historial 0–100 preguntas y la ventana
1024–1000000 tokens. Ambas reservas son positivas y su suma debe ser menor que
la ventana. Una configuración fuera de rango es un error del servidor; no se
sustituye silenciosamente. Cambiar la configuración exige revisar el envío otra
vez. No se deduce la capacidad a partir del nombre del modelo.

## Consecuencias

La vista previa es una operación local adicional. Guarda el texto preparado en
memoria con la conversación; no persiste el historial ni crea resúmenes. Las
notas siguen su contrato independiente. La primera entrega A–D queda completa;
adjuntar filas, errores y planes pertenece a la fase E.
