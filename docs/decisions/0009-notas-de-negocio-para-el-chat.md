# ADR 0009 — Notas de negocio persistentes y permiso por proveedor

- **Fecha:** 2026-10-16
- **Estado:** aceptada
- **Entrega:** 1.6.0, fase C del [plan de contexto del chat](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

El catálogo describe estructura, pero no explica reglas como «los importes no
incluyen IVA». Las preferencias guardan documentos completos; usarlas para
notas independientes haría que editar una sustituyera también las demás.

## Decisión

1. Guardar cada nota en `ai_business_notes`, mediante `IAiBusinessNoteStore`.
   La migración local 10 añade la tabla y el permiso de proveedores. Cada nota
   conserva conexión, base, texto, activación, fecha UTC y formato de referencia
   versionado. La API acepta hasta 8000 caracteres y pone la fecha en servidor.
   Las referencias de formatos posteriores no se interpretan ni sobrescriben;
   se pueden listar y eliminar. No se adjuntan al chat.
2. Las notas generales tienen referencia nula. Las de objetos conservan el ID
   que entrega el catálogo, esquema, nombre, clase y, opcionalmente, columna.
   Se comparan exactamente, sin buscar nombres parecidos. Los identificadores
   de algunos motores derivan del nombre: recrear un objeto con la misma
   identidad no se puede distinguir de conservarlo. Tampoco se detecta cambiar
   el destino de un perfil manteniendo su ID; las notas pertenecen al perfil.
3. No aplicar borrado en cascada al eliminar una conexión. «Mostrar notas de
   todas las conexiones» permite recuperar las huérfanas. Una referencia ausente
   queda visible como pendiente; una columna sin metadatos se muestra sin
   comprobar. Cambiar el ámbito y guardar vincula expresamente la nota a la
   base, tabla o columna elegida en el origen actual. Crear o vincular exige
   una conexión guardada; el texto de una nota huérfana sigue siendo editable.
4. `ShareBusinessNotes` es un permiso independiente por proveedor, inicialmente
   falso incluso al migrar perfiles. Además requiere permiso de contexto.
   Cambiarlo usa un endpoint propio y otra clave de conversación en memoria;
   una petición o reintento preparado con otro valor recibe conflicto antes de
   llamar al proveedor. El servidor filtra también notas del historial.
5. Adjuntar solamente notas activas de la conexión/base actual. Las de tablas o
   columnas requieren selección incluida, identidad exacta y detalle releído;
   si falta la columna, no se envían. Desactivar el esquema excluye también las
   notas de esos objetos. El servidor vuelve a comprobar permiso, formato,
   activación, propietario y nombre calificado entre las tablas del contexto;
   la comprobación de identidad y columnas pertenece al catálogo del cliente.
6. Guardar una copia profunda de las notas en cada pregunta. Editar, desactivar
   o eliminar afecta a preguntas futuras; el historial y los reintentos
   conservan la copia de entonces. El permiso del proveedor controla su reenvío.
   Las conversaciones siguen siendo de sesión; las notas sí sobreviven al
   reinicio. No se guardan filas ni credenciales como parte del catálogo.
7. Describir las notas en una sección de conocimiento aportado por la persona,
   separada de los hechos del catálogo y de las instrucciones del asistente.
   Pedir al modelo señalar contradicciones sin alterar la estructura declarada.
   Esta separación expresa la procedencia; no garantiza la conducta del modelo.

## Consecuencias

El editor muestra qué notas acompañarán la siguiente pregunta y permite
excluirlas sin borrarlas. La carga es diferida; si falla al preparar una
pregunta con permiso, se conserva el borrador para corregir o reintentar.
Cambiar de base, cancelar o cerrar el panel invalida la preparación pendiente.

La vista previa completa, el presupuesto total y los límites de historial
siguen en la fase D. El límite individual de texto no constituye ese presupuesto.
