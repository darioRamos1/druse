# Plan de mejora del contexto del chat — 16 de octubre de 2026

**Estado:** propuesto, pendiente de implementación.

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
estimaciones anteriores no cubren esta ampliación. Crear este plan no cierra
DRU-11 ni cambia el comportamiento de la aplicación.

## Situación actual comprobada en el código

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

Quedan para una segunda entrega: adjuntar filas, errores y planes de ejecución.
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

- [ ] Definir un contexto tipado con origen, motor, base, esquema, SQL opcional,
  objetos, relaciones, notas y avisos de omisión.
- [ ] Asociar cada conversación a conexión/base y perfil/modelo. El identificador
  de sesión sirve para validar lecturas, pero no para identificar notas persistidas.
- [ ] Registrar por turno proveedor, modelo, fecha y contexto realmente enviado.
- [ ] Componer y validar las categorías en backend antes de llamar al proveedor;
  devolver un resumen de lo enviado que coincida con la interfaz.
- [ ] Al cambiar base, proveedor o modelo, conservar los turnos en su conversación
  de origen. Una respuesta en curso permanece asociada al origen.
- [ ] Añadir reintento con la misma copia de contexto, sin duplicar la pregunta;
  volver a comprobar los permisos vigentes antes de reenviar.

**Aceptación:** una respuesta de la base A no aparece como respuesta de la B;
editar SQL o notas mientras llega una respuesta no altera el contexto registrado;
un cambio de proveedor no reenvía silenciosamente el historial anterior.

### Fase B — Selección de tablas y lectura de relaciones

- [ ] Crear el selector por conexión/base, con búsqueda, selección múltiple y
  acceso por botón, `@` y menú del explorador.
- [ ] Obtener objetos del catálogo sin exigir expandir antes el árbol. Cargar
  estructura detallada únicamente de los seleccionados, con cancelación.
- [ ] Reutilizar `getTableStructure` para columnas, claves primarias, foráneas e
  índices; incluir valores predeterminados cuando estén disponibles.
- [ ] Incluir motor y versión cuando se conozca, base y esquema activo cuando
  exista. No deducir la versión del servidor a partir del controlador.
- [ ] Mostrar tablas referenciadas por claves foráneas como sugerencias para
  añadir; no expandir automáticamente toda la red de relaciones.
- [ ] Invalidar metadatos al cambiar la estructura o reconectar. Evitar que una
  lectura iniciada en una base termine asociada a otra.
- [ ] Ante permisos insuficientes u objetos eliminados, indicar qué falta y
  permitir quitar el objeto o continuar explícitamente con contexto parcial.

**Aceptación:** seleccionar una tabla no expandida incorpora sus columnas; dos
tablas homónimas de esquemas diferentes no se confunden; las claves compuestas
conservan el orden y las parejas de columnas; no se inventan relaciones ausentes.

### Fase C — Conocimiento de negocio por base

- [ ] Añadir notas generales de la base y notas asociadas a tablas o columnas.
  Cada nota contiene texto, ámbito y fecha de modificación.
- [ ] Persistirlas en el almacenamiento local existente mediante un contrato
  versionado. Revisar si preferencias ofrece tamaño y operaciones suficientes;
  si no, usar un repositorio específico con migración.
- [ ] Incluir únicamente notas generales activadas y notas de los objetos
  seleccionados; mostrar cuáles se compartirán.
- [ ] Definir el comportamiento al renombrar/eliminar objetos o conexiones: no
  reasignar notas por coincidencia de nombre; mostrar las referencias pendientes.
- [ ] Mantener las notas como conocimiento aportado por la persona, separado de
  los hechos del catálogo y de las instrucciones internas del asistente.

**Aceptación:** las notas sobreviven a reiniciar Druse y reconectar, quedan
aisladas por conexión/base y se pueden excluir sin borrarlas. Una nota que
contradice el catálogo no cambia la estructura declarada como real.

### Fase D — Vista previa, límites y cierre de la primera entrega

- [ ] Mostrar el contexto que se enviará antes de la primera pregunta y permitir
  consultarlo por turno después. Corregir el indicador actual para que el pasado
  no se calcule desde la selección presente.
- [ ] Establecer límites configurables y validados en servidor para tamaño por
  sección, contexto total e historial. El recuento de caracteres/bytes puede ser
  exacto; cualquier estimación de tokens debe identificarse como aproximada.
- [ ] Reservar espacio para pregunta y respuesta según las capacidades conocidas
  del proveedor. Si se desconocen, usar un límite conservador documentado.
- [ ] Ante exceso, proponer quitar objetos, reducir historial o iniciar otra
  conversación. No cortar silenciosamente tablas elegidas ni claves compuestas.
- [ ] Al reducir historial, señalar qué turnos dejan de acompañar la pregunta;
  conservar la conversación visible. No añadir resúmenes automáticos en esta entrega.
- [ ] Distinguir bloques SQL de otros lenguajes antes de ofrecer insertar o
  reemplazar código, según el pendiente original de DRU-11.

**Aceptación:** lo visto en la vista previa y lo registrado para el proveedor
coinciden; el tamaño tiene un límite comprobable; ningún bloque JSON ofrece
reemplazar SQL. Las fases A–D juntas constituyen la primera entrega funcional.

### Fase E — Adjuntos de ejecución, segunda entrega

- [ ] «Explicar este error» adjunta consulta y error revisables, con procedencia
  de la ejecución; excluir credenciales y cadenas de conexión de los diagnósticos.
- [ ] «Analizar estas filas» permite elegir filas y columnas y aplicar límites
  antes de componer el contexto. Nunca adjuntar resultados automáticamente.
- [ ] Permitir ocultar columnas antes de enviar; mostrar nulos, tamaños y recortes
  sin cargar innecesariamente binarios o valores grandes.
- [ ] Incorporar planes de ejecución cuando exista soporte comprobado; no
  ejecutar consultas ni generar un plan con ejecución desde el asistente.

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
