# Plan de mejora del contexto del chat — 16 de octubre de 2026

**Estado:** fase A implementada en 1.4.0, fase B en 1.5.0, fase C en 1.6.0 y
fase D en 1.7.0. Primera entrega A–D implementada. Fase E implementada en
1.8.0–1.10.0 con errores, muestras y planes estimados de SQLite; validaciones
nativas y de otros motores/proveedores pendientes.

## Objetivo

Poder preguntar sobre una base de datos aportando las tablas relevantes, sus
relaciones y las reglas de negocio que el catálogo no explica. Antes de enviar,
la persona debe poder ver y ajustar el contexto; después, consultar qué recibió
el asistente en esa pregunta.

Ejemplo de uso: seleccionar `clientes` y `facturas`, guardar la regla «la cartera
excluye facturas anuladas» y pedir «calcula la cartera vencida por cliente». El
asistente recibe el dialecto SQL, las columnas y relaciones reales, además de
esa regla, sin necesitar que se pegue todo en cada pregunta.

Este documento desarrolla [DRU-11 del plan de interfaz y funcionalidad](plan-ui-funcionalidad-2026-10-02.md#dru-11--continuidad-y-contexto-del-chat).
Amplía su alcance con selección de metadatos y conocimiento de negocio. Sus
estimaciones anteriores no cubren esta ampliación. La primera entrega funcional
comprende A–D; la fase E amplía los adjuntos de ejecución.

## Situación inicial comprobada en el código

| Pieza | Comportamiento actual | Limitación |
| --- | --- | --- |
| `ai-context.ts` | Describe hasta 40 tablas y 60 columnas por tabla; prioriza las que tienen columnas conocidas | La selección no se basa en la pregunta ni en una elección explícita |
| `AppShell.aiContext` | Compone SQL abierto y estructura desde el índice del explorador | El nombre de la base se muestra en la interfaz, pero el contexto compuesto no incorpora explícitamente motor, base y esquema activo |
| `AppShell.warmSchema` | Al abrir el chat intenta cargar columnas de hasta 40 relaciones conocidas, una por una | Depende de lo que el explorador ya conoce y puede leer metadatos que no interesan |
| `AiPanel` | Permite incluir o excluir SQL y estructura completos | No permite elegir tablas individuales ni revisar el texto completo antes de enviar |
| `AiStore` | Conserva una conversación global durante la sesión | El historial puede acompañar preguntas de otra base o de otro proveedor |
| `AiEndpoints.Compose` | Añade el contexto como texto; lo omite si el perfil solo admite la pregunta | No distingue categorías dentro del contexto para aplicar permisos más precisos |
| `getTableStructure` y `TableStructure` | Ya ofrecen estructura con claves e índices | El contexto del chat usa `KnownRelation`, que no contiene las claves foráneas |

La inspección fue de código; este plan no implica validación visual ni pruebas
de motores. Las rutas de referencia están al final.

## Alcance y decisiones iniciales

| Aspecto | Decisión propuesta |
| --- | --- |
| Primera entrega | Selector de tablas, motor/base/esquema, relaciones declaradas, notas de negocio, vista previa y conversación por base |
| Entrada principal | Botón «Añadir contexto»; `@` como acceso rápido al mismo selector |
| Identidad de objetos | Conexión guardada, base, esquema y nombre; conservar identificadores y reglas de mayúsculas de cada motor |
| Relaciones | Usar claves foráneas declaradas; las relaciones manuales se pueden describir en notas y se identifican como aportadas por la persona |
| Persistencia | Notas y selección recordada por conexión guardada y base; sin guardar automáticamente filas ni transcripciones en disco |
| Acceso a la base | Lecturas de metadatos mediante los servicios existentes; ninguna ejecución de SQL por parte del modelo |
| Compatibilidad | Reutilizar capacidades y proveedores; sin condicionales por motor en los componentes |
| Dependencias | Reutilizar infraestructura actual; justificar cualquier dependencia nueva antes de incorporarla |

La segunda entrega añade filas, errores y planes de ejecución; su cierre
y los límites comprobados están registrados en la fase E.
Quedan fuera del alcance: agentes que ejecutan consultas, indexación vectorial,
recorrer toda la base al abrir el chat, relaciones inferidas automáticamente y
sincronización de notas entre equipos.

## Experiencia propuesta

1. Al abrir el chat se indica la conexión y base de la conversación.
2. «Añadir contexto» abre una búsqueda de tablas y vistas de esa base, aunque
   sus columnas no estén cargadas. Permite seleccionar varias y desmarcarlas.
3. Escribir `@` abre esa misma búsqueda. Una mención resuelta referencia el
   objeto; escribir un nombre en texto libre no lo añade silenciosamente.
4. Se muestran elementos quitables: «SQL actual», tablas elegidas y «Notas de
   negocio». Desde el explorador se ofrece «Añadir al chat».
5. «Notas de esta base» permite guardar reglas generales y notas de tablas o
   columnas. Las notas deben poder editarse, eliminarse y excluirse del envío.
6. «Ver contexto» muestra el contenido exacto preparado, su tamaño aproximado,
   las partes omitidas y los metadatos que no pudieron cargarse.
7. Al enviar se fija una copia del contexto y la procedencia en el turno. Cambiar
   la selección después solo afecta a preguntas futuras.
8. Al volver a otra base se recupera su conversación en memoria. Un cambio de
   proveedor abre una conversación separada, identificada en el panel.

La primera pregunta debe poder hacerse sin configurar notas ni seleccionar
tablas. El SQL sigue siendo opcional. Una tabla sugerida desde el SQL solo se
comparte cuando se incorpora a la selección visible.

## Fases de implementación

### Fase A — Contrato, aislamiento y copia del contexto

- [x] Definir un contexto tipado con origen, motor, base, SQL opcional, esquema
  y nombres de tablas. Las relaciones, notas y avisos se incorporan con B–D.
- [x] Asociar cada conversación a conexión/base y perfil/modelo. El identificador
  de sesión sirve para validar lecturas, pero no para identificar notas persistidas.
- [x] Registrar por pregunta proveedor, modelo, fecha y contexto preparado,
  con confirmación de composición del servidor.
- [x] Componer y validar las categorías en backend antes de llamar al proveedor;
  devolver un resumen de lo enviado que coincida con la interfaz.
- [x] Al cambiar base, proveedor o modelo, conservar los turnos en su conversación
  de origen. Una respuesta en curso permanece asociada al origen.
- [x] Añadir reintento con la misma copia de contexto, sin duplicar la pregunta;
  volver a comprobar los permisos vigentes antes de reenviar.

**Aceptación:** una respuesta de la base A no aparece como respuesta de la B;
editar SQL o notas mientras llega una respuesta no altera el contexto registrado;
un cambio de proveedor no reenvía silenciosamente el historial anterior.

**Entrega del 16 de octubre de 2026 — 1.4.0.** El contexto de cada pregunta
conserva SQL y esquema por separado, origen, proveedor, modelo y fecha. El
servidor confirma su composición y rechaza modelos o permisos desactualizados.
Cada base/proveedor conserva su conversación en memoria, con suscripciones
independientes y reintento de la última respuesta fallida sin duplicar la pregunta.
El contexto histórico acompaña a su pregunta dentro del mensaje de usuario para
mantener la asociación también con Anthropic y Gemini. La decisión está en
[ADR 0007](../decisions/0007-contexto-del-chat-por-pregunta.md).

**Verificación:** TypeScript de aplicación y E2E, guarda de idiomas, 102 pruebas
del frontend (IA, gateway, novedades y shell), 12 de integración de IA y dos
recorridos Chromium en español e inglés. Se revisaron las capturas de los dos
temas, incluido el panel a 900 px de ventana, con proveedores simulados. El
barrido general reutiliza el mismo recorrido; no se ejecutó entero porque
requiere PostgreSQL. No se verificaron inferencias externas, motores de servidor
ni Tauri/WebView2.

El arranque de trabajadores `forks` de Vitest agotó su tiempo en este equipo.
Las pruebas se ejecutaron correctamente con una configuración temporal ignorada
en `frontend/.angular/chat-vitest.config.mjs`, usando `pool: 'threads'`,
`maxWorkers: 1`, `testTimeout: 20000` y `hookTimeout: 30000`, pasada a
`ng test --runner-config=.angular/chat-vitest.config.mjs`. No se cambió la
configuración del proyecto.

**Siguiente paso tras esa entrega:** fase B, selector de tablas y lectura detallada de relaciones.
La vista previa antes de preguntar, las notas y los límites de historial
permanecen pendientes en sus fases. Las conversaciones se pierden al cerrar Druse.

### Fase B — Selección de tablas y lectura de relaciones

- [x] Crear el selector por conexión/base, con búsqueda, selección múltiple y
  acceso por botón, `@` y menú del explorador.
- [x] Obtener objetos del catálogo sin exigir expandir antes el árbol. Cargar
  estructura detallada únicamente de los seleccionados, con cancelación.
- [x] Reutilizar `getColumns` y `getTableStructure` para columnas, claves primarias, foráneas e
  índices; incluir valores predeterminados cuando estén disponibles.
- [x] Incluir motor y versión cuando se conozca, base y esquema activo cuando
  exista. No deducir la versión del servidor a partir del controlador.
- [x] Mostrar tablas referenciadas por claves foráneas como sugerencias para
  añadir; no expandir automáticamente toda la red de relaciones.
- [x] Invalidar metadatos al cambiar la estructura o reconectar. Evitar que una
  lectura iniciada en una base termine asociada a otra.
- [x] Ante permisos insuficientes u objetos eliminados, indicar qué falta y
  permitir quitar el objeto o continuar explícitamente con contexto parcial.

**Aceptación:** seleccionar una tabla no expandida incorpora sus columnas; dos
tablas homónimas de esquemas diferentes no se confunden; las claves compuestas
conservan el orden y las parejas de columnas; no se inventan relaciones ausentes.

**Entrega del 16 de octubre de 2026 — 1.5.0.** El botón «Añadir contexto», las
menciones `@` y «Añadir al chat» del explorador comparten una selección por base.
Se eliminó la selección y carga automática de hasta 40 tablas. La descripción
incluye columnas completas, valores predeterminados, claves compuestas, claves
foráneas, índices y restricciones declaradas. Las referencias se sugieren para
añadirlas manualmente; no se infieren relaciones ni se comparten filas.

El catálogo del chat tiene su propio ciclo de lecturas, sin depender de que las
ramas del explorador estén abiertas. Las revisiones del explorador invalidan
el detalle y cada envío lo relee para recoger DDL externo. Cambiar de origen o
selección durante esa preparación impide enviar y conserva el borrador. Los
fallos requieren quitar el objeto o aceptar expresamente el contexto parcial.

La versión del servidor se toma de la respuesta de apertura, sin deducirla del
controlador. La base del chat sigue la pestaña activa; para motores basados en
archivo se resuelve el alias único del catálogo mediante sus capacidades. Así
la ruta de SQLite al conectar y su alias `main` no se confunden.

**Verificación:** TypeScript de aplicación y E2E, guarda de idiomas, 291 pruebas
del frontend y 12 de integración de IA. Los recorridos Chromium de la fase A
siguen pasando en español e inglés. Otros dos recorridos usan SQLite real con
123 tablas/vistas, una clave foránea compuesta, un índice descendente y valores
predeterminados: abrir el selector no pide columnas, y seleccionar dos tablas
solo lee sus detalles. Se revisaron las capturas en ambos idiomas y temas,
incluida la ventana de 900 px. El barrido general incorpora el selector mediante
el mismo soporte; no se ejecutó entero porque requiere PostgreSQL.

Los proveedores de IA se simularon; no se verificaron inferencias externas,
motores de servidor ni Tauri/WebView2. Vitest se ejecutó con la configuración
temporal de un trabajador descrita en la fase A. La selección permanece en
memoria durante la sesión; las notas persistentes, la vista previa completa
antes de enviar y el presupuesto de contexto siguen pendientes. La decisión
está en [ADR 0008](../decisions/0008-seleccion-de-tablas-para-el-chat.md).

**Siguiente paso tras la fase B:** fase C, conocimiento de negocio por base.

### Fase C — Conocimiento de negocio por base

- [x] Añadir notas generales de la base y notas asociadas a tablas o columnas.
  Cada nota contiene texto, ámbito y fecha de modificación.
- [x] Persistirlas en el almacenamiento local existente mediante un contrato
  versionado. Revisar si preferencias ofrece tamaño y operaciones suficientes;
  si no, usar un repositorio específico con migración.
- [x] Incluir únicamente notas generales activadas y notas de los objetos
  seleccionados; mostrar cuáles se compartirán.
- [x] Definir el comportamiento al renombrar/eliminar objetos o conexiones: no
  reasignar notas por coincidencia de nombre; mostrar las referencias pendientes.
- [x] Mantener las notas como conocimiento aportado por la persona, separado de
  los hechos del catálogo y de las instrucciones internas del asistente.

**Aceptación:** las notas sobreviven a reiniciar Druse y reconectar, quedan
aisladas por conexión/base y se pueden excluir sin borrarlas. Una nota que
contradice el catálogo no cambia la estructura declarada como real.

**Entrega del 16 de octubre de 2026 — 1.6.0.** «Notas» abre un editor de reglas
generales y notas de tablas/vistas o columnas seleccionadas. Cada nota se guarda
en SQLite por separado, con fecha UTC, activación, propietario y referencia
versionada. El permiso de compartir se concede por proveedor y comienza
desactivado, también para perfiles existentes. Editar un proveedor conserva
ese permiso; cambiarlo aísla el historial y el servidor rechaza peticiones
preparadas con otro valor.

Solo se adjuntan notas activas de la conexión/base actual y de objetos incluidos
con detalle comprobado. Excluir el esquema excluye las notas de sus objetos.
Cada pregunta conserva una copia profunda; editar o desactivar notas cambia
las preguntas futuras. Las notas se describen como conocimiento de la persona,
separado del catálogo, pidiendo señalar las contradicciones.

Los objetos ausentes y las conexiones eliminadas dejan notas visibles,
pendientes de vinculación manual. «Mostrar notas de todas las conexiones» permite
recuperarlas. El formato desconocido se conserva y no se comparte ni sobrescribe.
Los límites de identidad y el reparto de comprobaciones entre cliente y servidor
están documentados en [ADR 0009](../decisions/0009-notas-de-negocio-para-el-chat.md).

**Comprobaciones:** compilación de backend y frontend, tipado y catálogo de
idiomas, 300 pruebas del frontend, 31 pruebas unitarias de persistencia y
validación, y 16 de integración de notas/contexto. Cuatro recorridos de navegador
usan SQLite real y chat simulado: comprueban selección, persistencia, permisos,
columnas y tablas renombradas y notas de conexiones eliminadas, sin cuentas
ni inferencias externas.
Las capturas se revisaron en español e inglés, con temas claro y oscuro.
La compilación de producción mantiene el aviso conocido de presupuesto inicial.
No se validaron Tauri/WebView2 ni respuestas de modelos externos.

**Siguiente paso tras la fase C:** fase D, vista previa completa y límites de contexto e historial.

### Fase D — Vista previa, límites y cierre de la primera entrega

- [x] Mostrar el contexto que se enviará antes de la primera pregunta y permitir
  consultarlo por turno después. Corregir el indicador actual para que el pasado
  no se calcule desde la selección presente.
- [x] Establecer límites configurables y validados en servidor para tamaño por
  sección, contexto total e historial. El recuento de caracteres/bytes puede ser
  exacto; cualquier estimación de tokens debe identificarse como aproximada.
- [x] Reservar espacio para pregunta y respuesta según las capacidades conocidas
  del proveedor. Si se desconocen, usar un límite conservador documentado.
- [x] Ante exceso, proponer quitar objetos, reducir historial o iniciar otra
  conversación. No cortar silenciosamente tablas elegidas ni claves compuestas.
- [x] Al reducir historial, señalar qué turnos dejan de acompañar la pregunta;
  conservar la conversación visible. No añadir resúmenes automáticos en esta entrega.
- [x] Distinguir bloques SQL de otros lenguajes antes de ofrecer insertar o
  reemplazar código, según el pendiente original de DRU-11.

**Aceptación:** lo visto en la vista previa y lo registrado para el proveedor
coinciden; el tamaño tiene un límite comprobable; ningún bloque JSON ofrece
reemplazar SQL. Las fases A–D juntas constituyen la primera entrega funcional.

**Entrega del 16 de octubre de 2026 — 1.7.0.** El servidor compone una vista
previa sin invocar al proveedor. El chat muestra la pregunta, el contexto real,
el historial incluido y los tamaños antes de confirmar. Una copia inmutable y
un hash ligado a perfil, destino, contenido y política impiden enviar una
revisión que cambió. Cada turno conserva lo revisado y la confirmación del
servidor, además del historial elegido; reintentar reutiliza esa copia.

Se validan bytes UTF-8 por sección, contexto, historial, pregunta y entrada
completa, más número de preguntas y presupuesto estimado con reservas. Los
límites se configuran en servidor, globalmente o por perfil. Los conectores
actuales no informan capacidades verificadas: se aplica el presupuesto
conservador documentado en [ADR 0010](../decisions/0010-vista-previa-y-presupuesto-del-chat.md).
La estimación de tokens y la reserva de salida son orientativas; no se afirma
un recuento del modelo ni se limita su generación. Los excesos bloquean la
confirmación y reciben 413 en servidor aunque se omita la vista previa.

El historial solo se reduce por elección explícita, con parejas completas,
indicando qué preguntas quedan fuera y conservándolas en pantalla. Los bloques
sin etiqueta, JSON, Python y otros lenguajes ofrecen copiar; las acciones del
editor solo aparecen para etiquetas SQL explícitas, también durante streaming.

**Comprobaciones:** tipado, guarda de idiomas y 314 pruebas del frontend,
incluidas novedades, catálogo, notas, cancelación, selección, historial,
reintento y transporte SSE; 30 pruebas de integración para permisos, notas,
composición, límites por sección, UTF-8 y cambios posteriores a una revisión.
Los seis recorridos de navegador usan SQLite real, composición real del servidor
para notas/vista previa y respuestas simuladas. Se revisaron capturas en ambos
idiomas, en temas claro/oscuro y con una ventana de 900 px. La compilación de
producción conserva el aviso conocido de presupuesto del paquete inicial.

**Siguiente paso:** fase E, adjuntos de ejecución revisables. Quedan pendientes
las comprobaciones nativas en Tauri/WebView2, otros motores de servidor y las
inferencias con proveedores externos; no se simulan como verificadas.

### Fase E — Adjuntos de ejecución, segunda entrega

- [x] «Explicar este error» adjunta consulta y error revisables, con procedencia
  de la ejecución; excluir credenciales y cadenas de conexión de los diagnósticos.

**Primer incremento implementado el 2026-10-16 (1.8.0):** acción desde el resultado
fallido, copia del SQL ejecutado y su origen, adjunto editable, revisión explícita,
filtrado de credenciales reconocibles en el servidor y límite propio aplicado
también al historial. Cambiar de base retira el borrador adjunto y revocar el permiso
de contexto bloquea su envío. Véase [ADR 0011](../decisions/0011-explicar-errores-en-el-chat.md).
Comprobado con fallos reales de SQLite y respuesta de IA simulada en Chromium;
otros motores y Tauri/WebView2 quedan pendientes. La fase E continúa abierta:

- [x] «Analizar estas filas» permite elegir filas y columnas y aplicar límites
  antes de componer el contexto. Nunca adjuntar resultados automáticamente.
- [x] Permitir ocultar columnas antes de enviar; mostrar nulos, tamaños y recortes
  sin cargar innecesariamente binarios o valores grandes.

**Segundo incremento implementado el 2026-10-19 (1.9.0):** selector explícito de
filas y columnas del conjunto visible, exclusión y ocultación de valores,
distinción entre nulos/vacíos/binarios y recorte UTF-8 de textos grandes aceptado
por la persona. La revisión y el historial conservan la muestra elegida; el servidor
exige permiso de datos y aplica límites de forma y tamaño a los adjuntos actuales
e históricos. Véase [ADR 0012](../decisions/0012-muestras-de-filas-en-el-chat.md).
El recorrido de esta entrega utiliza SQLite y Chromium con inferencia simulada.
La fase E continúa abierta por la integración de planes:

- [x] Incorporar planes de ejecución cuando exista soporte comprobado; no
  ejecutar consultas ni generar un plan con ejecución desde el asistente.

**Tercer incremento implementado el 2026-10-19 (1.10.0):** «Analizar este plan»
reconoce un resultado completo de `EXPLAIN QUERY PLAN` obtenido manualmente en
SQLite. Conserva origen y SQL de la ejecución y permite editar las copias antes
de revisar el envío. No genera planes ni ejecuta consultas desde el chat. El
servidor aplica permiso de estructura, límite propio, hash y control del historial.
Véase [ADR 0013](../decisions/0013-planes-estimados-en-el-chat.md). La integración
de adjuntos de esta fase queda implementada para el soporte comprobado de SQLite;
planes de otros motores, proveedores externos y validación nativa Tauri/WebView2
siguen pendientes y no se consideran verificados.

Comprobación de 1.10.0: SQLite 3.53.3 con inferencia simulada en Chromium,
359 pruebas frontend, 63 de integración y 14 recorridos E2E correctos. Capturas
revisadas en español/inglés, claro/oscuro y ancho reducido. TypeScript, idiomas y
compilación de producción correctos; persiste el aviso conocido de tamaño inicial.

**Aceptación:** adjuntar filas exige el permiso de datos del proveedor y selección
explícita. Las filas compartidas quedan registradas en el turno, en memoria, y
no se guardan como notas. Un cambio posterior de permiso bloquea su reenvío.

## Permisos y composición

- El backend sigue siendo la autoridad sobre la divulgación: «solo pregunta»
  excluye contexto adjunto; «estructura» admite metadatos y SQL según el contrato
  vigente; «estructura y filas» permite además adjuntos de resultados.
- Las notas de negocio requieren una elección explícita para compartirlas con
  el proveedor. El permiso de esquema no basta por sí solo para activarlas.
  Registrar esta elección por perfil y respetarla también al reintentar.
- Una reducción de permisos debe aplicarse al historial reutilizado: si contiene
  respuestas o adjuntos derivados de contexto ahora prohibido, iniciar una
  conversación limpia y explicar el motivo, sin prometer poder borrar lo ya enviado.
- Notas, nombres de objetos y comentarios del catálogo se tratan como contexto
  aportado, sin autoridad para cambiar permisos o habilitar herramientas.
- SQL y notas pueden contener valores sensibles; la vista previa debe mostrar
  su contenido real. No afirmar que compartir estructura garantiza ausencia de datos.

## Verificación y definición de terminado

| Nivel | Casos necesarios |
| --- | --- |
| Composición | Contexto vacío, selección estable, identificadores especiales, claves compuestas, tipos, omisiones y límites |
| Estado del chat | Cambio de base/proveedor/modelo, respuesta en curso, reintento, cancelación y copia inmutable por turno |
| Persistencia | Reinicio, aislamiento por base, renombrados, eliminación y migración del formato de notas |
| Backend | Filtrado de categorías, permisos reducidos, solicitudes que eluden la interfaz y exceso de tamaño |
| Catálogo | Permiso denegado, estructura incompleta, caché invalidada y respuesta tardía de otra sesión |
| Interfaz | Selector con teclado, `@`, eliminación de contexto, vista previa, estados vacíos y errores |
| Recorrido completo | Base de prueba con clientes/facturas, FK compuesta y dos esquemas con nombres repetidos |

Para cada entrega con cambios visibles:

1. Ejecutar las pruebas de las piezas tocadas y las comprobaciones exigidas
   por `AGENTS.md`: TypeScript, guarda de idiomas y pruebas de novedades.
2. Añadir el flujo al barrido `e2e/tests/barrido.spec.ts` y revisar capturas con
   datos sintéticos en los dos temas y en panel estrecho. Probar español e inglés.
3. Validar metadatos con los motores disponibles y anotar explícitamente qué
   motores y recorrido nativo Tauri/WebView2 quedan sin comprobar.
4. Comprobar una base con cientos de tablas: abrir el chat no debe leer la
   estructura completa; las peticiones deben limitarse a lo seleccionado.
5. Subir versión una vez por tarea con el script oficial, añadir novedades en
   ambos idiomas y hacer commit de los archivos de la tarea, sin push ni PR.

El plan documental no cambia versión ni añade novedades. Las decisiones que
se confirmen al implementar se registrarán en `docs/decisions/`.

## Orden, esfuerzo y seguimiento

| Orden | Fase | Estimación inicial |
| --- | --- | --- |
| 1 | A — Contrato y conversaciones | 2–3 días |
| 2 | B — Selector y metadatos | 3–5 días |
| 3 | C — Notas de negocio | 2–3 días |
| 4 | D — Vista previa y cierre | 2–3 días |
| 5 | E — Adjuntos de ejecución | 3–5 días, aparte de integrar planes aún no disponibles |

La primera entrega se estima en **9–14 días de trabajo de una persona**, con
pruebas de cada fase; no es una fecha comprometida. Reajustar tras la fase A y
la comprobación de los contratos de catálogo y persistencia. B y C dependen de
A; D integra A–C; E comienza tras cerrar la primera entrega.

Al cerrar una fase, registrar implementación, pruebas, límites y pendientes en
este documento. DRU-11 solo se cierra cuando se verifiquen sus criterios
originales y los de las fases A–D.

## Referencias del código

- [Composición actual del esquema](../../frontend/src/app/core/ai/ai-context.ts).
- [Panel y composición del contexto](../../frontend/src/app/features/ai/ai-panel/ai-panel.ts).
- [Conversación y envío](../../frontend/src/app/core/ai/ai-store.ts).
- [Contexto y carga inicial desde el shell](../../frontend/src/app/layout/app-shell/app-shell.ts).
- [Índice del explorador](../../frontend/src/app/core/workspace/explorer-store.ts).
- [Contratos de estructura y catálogo](../../frontend/src/app/shared/models/workspace.ts).
- [Gateway de estructura y preferencias](../../frontend/src/app/core/application-gateway/application-gateway.ts).
- [Composición del lado servidor](../../backend/src/Druse.Host.LocalApi/Endpoints/AiEndpoints.cs).
- [Permisos de divulgación](../../backend/src/Druse.Domain/AiProviderProfile.cs).
- [Estructura completa de tablas](../../backend/src/Druse.Domain/TableStructure.cs).
- [Servicio de metadatos](../../backend/src/Druse.Application/Metadata/MetadataService.cs).
