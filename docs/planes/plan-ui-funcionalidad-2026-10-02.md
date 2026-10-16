# Plan de mejoras de interfaz y funcionalidad — 2 de octubre de 2026

## Objetivo y alcance

Hacer que el trabajo cotidiano con Druse sea más fiable y ágil: conservar lo
que se está editando, entender qué se va a ejecutar, recuperar el contexto y
leer resultados sin depender tanto del ratón. Se propone mejorar la interfaz
actual de forma incremental, conservando su diseño y sus protecciones.

Revisión del código de la versión **1.2.1**, sobre el commit **e00b493**.
La revisión inicial se registró sin implementar las propuestas. **DRU-01 y
DRU-02 están implementadas en 1.2.2; DRU-03 y DRU-04, en 1.2.3; DRU-05 y
DRU-07, en 1.3.0**. Las demás
siguen pendientes; los límites de verificación se registran en cada entrega.
Complementa el [plan de mejoras existente](PLAN_MEJORAS_DRUSE.md), la
[revisión de interfaz anterior](../revisiones/revision-ui-ux-2026-09-08.md) y el
[plan de idiomas](plan-idiomas.md). Sus pendientes históricos requieren volver
a comprobarse antes de incorporarlos a un ciclo nuevo.

Se revisaron editor y pestañas, conexiones y explorador, resultados y edición
de filas, historial, importación, IA, preferencias y actividad. La revisión
combina lectura del código, inspección visual de la aplicación en navegador y
pruebas existentes con datos aislados.

### Evidencia y límites

- **10 pruebas E2E de SQLite pasaron**: conexión, catálogo, compositor,
  diseñador, ayudas del editor, fondos y resultados con muchas columnas.
- **235 pruebas de frontend pasaron**, repartidas entre 7 archivos de IA,
  resultados y `WorkspaceStore`.
- Se inspeccionaron visualmente la pantalla inicial y Preferencias → Apariencia
  y Resultados, a 1280 × 720, en tema oscuro. Esto no equivale a un barrido de
  todos los diálogos, temas, escalas y anchos.
- La prueba de IA de esta misma sesión reprodujo el rechazo de `gpt-6.1-sol`
  mediante Codex CLI **0.150.1** con la sesión de ChatGPT de este equipo. Está
  cubierto por el commit e00b493. Ese resultado no establece la disponibilidad
  del modelo en otras cuentas, versiones del CLI o en la API.
- Docker no estaba disponible. No se repitieron los recorridos de PostgreSQL,
  SQL Server, MySQL/MariaDB, Informix u Oracle, ni se validó Tauri/WebView2.
- Los hallazgos marcados **Código** son comportamientos o riesgos identificados
  por lectura; necesitan su caso de regresión antes de implementar el arreglo.
  **Visual** indica inspección directa; **Reproducido** indica prueba real.

## Lo que conviene conservar

Druse ya tiene paneles redimensionables y maximizables, explorador plegable con
teclado, paleta de comandos, pestañas recuperables, ayudas de SQL, contexto de
conexión por pestaña, etiquetas de entorno y modo de solo lectura. También
dispone de confirmación de operaciones destructivas, vista previa de cambios,
cancelación, historial de actividad, preferencias por secciones y traducción
español/inglés.

No se propone volver a construir esas funciones. Las mejoras siguientes
completan comportamientos que todavía pueden resultar confusos o costosos.

## Prioridades y tamaño

**P1:** proteger el trabajo y la confianza en lo que se confirma.
**P2:** reducir fricción en tareas frecuentes.
**P3:** ampliar capacidades una vez estabilizados los flujos anteriores.

Los tamaños son días de trabajo de una persona, con implementación y pruebas,
sin fecha comprometida. Deben reajustarse tras reproducir cada caso y comprobar
los motores implicados. No se identificó un bloqueo de publicación P0 mediante
este recorrido limitado.

| ID | Mejora | Prioridad | Evidencia | Tamaño |
| --- | --- | --- | --- | --- |
| DRU-01 | Proteger ediciones pendientes de la cuadrícula | P1 | Implementado y probado en 1.2.2 | Cerrado |
| DRU-02 | Invalidar vistas previas de importación desactualizadas | P1 | Implementado y probado en 1.2.2 | Cerrado |
| DRU-03 | Editar valores sin ambigüedad ni pérdida de formato | P1 | Implementado y probado en 1.2.3 | Validación nativa pendiente |
| DRU-04 | Distinguir sesión de IA y respuesta válida del modelo | P1 | Implementado y probado en 1.2.3 | Validación nativa pendiente |
| DRU-05 | Historial con búsqueda fiable, filtros y paginación | P2 | Código | 2–4 días |
| DRU-06 | Recuperar resultados al volver a una pestaña | P2 | Código | 3–5 días |
| DRU-07 | Recorrer la cuadrícula con teclado y ayudas traducidas | P2 | Código | 2–3 días |
| DRU-08 | Inspeccionar el valor completo de una celda | P2 | Código | 2–3 días |
| DRU-09 | Ordenar, ocultar y fijar columnas | P2 | Código; propuesta | 3–5 días |
| DRU-10 | Mantener fluidez con muchos resultados | P2 | Código; requiere medición | 4–6 días |
| DRU-11 | Dar continuidad y contexto explícito al chat de IA | P2 | Código | 3–5 días |
| DRU-12 | Priorizar legibilidad en las preferencias | P2 | Visual + código | 2–3 días |
| DRU-13 | Consultar el detalle de operaciones largas desde Actividad | P2 | Código | 3–5 días |
| DRU-14 | Consultar planes de ejecución SQL | P3 | Propuesta | 5–8 días |
| DRU-15 | Ajustar y reutilizar correspondencias de importación | P3 | Código; propuesta | 3–5 días |

## Fase 1 — Proteger el trabajo y aclarar lo que se confirma

### Primera entrega — 1.2.2, 2 de octubre de 2026

- **DRU-01:** confirmación antes de cambiar o cerrar la pestaña activa, abrir
  otra consulta o archivo, cambiar de conexión o base, desconectar, reconectar,
  modificar el SQL o reejecutarlo. Cancelar conserva los cambios y su contexto;
  cerrar una pestaña inactiva conserva el resultado visible. Los atajos y las
  acciones del explorador pasan por la misma protección. El editor restaura el
  SQL aceptado también al cancelar «Deshacer», «Rehacer» y cambios programáticos.
- Mientras se guardan celdas se bloquean nuevos cambios y cambios de contexto
  que descartarían esas celdas. Las vistas previas tardías de celdas descartadas
  se ignoran; modificar otra celda retira el SQL previamente analizado.
- **DRU-02:** el análisis se vincula al archivo, las cuatro opciones de lectura,
  la tabla y la sesión. Cambiar cualquier entrada o reconectar exige analizar
  otra vez. Cerrar el diálogo invalida respuestas pendientes. Las entradas se
  bloquean durante las operaciones; el cierre permanece disponible durante el
  análisis y se bloquea durante la escritura.
- Verificación: TypeScript, guarda de idiomas y **286 pruebas de frontend** en
  diez archivos, incluidas novedades y las áreas afectadas; **12 E2E de SQLite**,
  incluidas dos regresiones nuevas.
  Se inspeccionaron las capturas del análisis vigente y del análisis invalidado.
  El barrido incorpora la captura de importación pendiente de analizar.
- Límites: verificación de navegador con Chromium y SQLite. Queda pendiente
  comprobar estos recorridos en Tauri/WebView2 y con los demás motores. No se
  modificó el contrato de importación ni se sustituyó la validación del backend.

### Segunda entrega — 1.2.3, 2 de octubre de 2026

- **DRU-03:** escribir `NULL` conserva texto; la acción «Establecer NULL» pone
  un nulo y borrar texto pone una cadena vacía. Abrir y salir de la celda no
  genera una edición. Los controles nativos solo se usan si pueden representar
  el valor completo; zona, fracciones, números grandes y texto multilínea
  conservan su entrada de texto. Enter termina sin reabrir; Escape cancela y
  Tab permite llegar a la acción de nulo sin perder el borrador. Volver al
  valor original elimina el cambio pendiente.
- El conversor conserva enteros de 64 bits, precisión decimal representable y
  marcas de tiempo con offset y siete decimales. Si `decimal.TryParse` o la
  conversión temporal exigirían redondeo, se rechaza antes de parametrizar.
  Esto no amplía la precisión de .NET ni cambia las reglas de escala o rango
  del motor y la columna de destino. Los alias de tipos de motores se prueban
  en el conversor; la escritura real comprobada en este entorno es SQLite.
- **DRU-04:** configuración local, sesión, versión del CLI y catálogo se muestran
  separados de la respuesta. «Probar respuesta» usa el modelo escrito, un
  prompt mínimo sin SQL, esquema ni filas, y explica que consume uso. Se puede
  cancelar; éxito exige texto y evento terminal, y desaparece al cambiar la
  configuración, cuenta o consultar otra vez la sesión. El resultado vive
  solo en el diálogo y muestra proveedor, modelo, versión y momento.
- Los errores anidados de Codex se extraen como mensaje legible, con causas
  distintas para modelo rechazado, autenticación, cuota y red. El detalle sigue
  disponible para copiar en configuración y chat; se omite la clave del perfil.
  Un error conserva el modelo elegido. Una cuenta propia aún sin perfil no
  se muestra como autenticada usando la sesión del equipo. Los nombres
  sugeridos se muestran traducidos.
- Verificación: TypeScript, guarda de idiomas, **296 pruebas de frontend** en
  diez archivos, **696 pruebas unitarias de backend correctas y 14 omitidas**
  por sus condiciones existentes, y **7 pruebas HTTP/SSE de integración** con
  proveedor simulado, incluida cancelación que llega al proveedor.
- Navegador: **13 E2E de SQLite y un E2E de diagnóstico de IA**. Se comprueba la
  escritura real de texto `NULL`, vacío y nulo mediante vista previa y
  confirmación, sin alterar offset, fracción ni los números de las demás
  columnas. IA reproduce catálogo con 6.1 anunciado, rechazo, respuesta válida
  y cambio de modelo, sin inferencias externas. Se inspeccionaron las capturas
  de celda y diagnóstico en ambos temas; IA también a 900 × 760 y 1440 × 960.
  El barrido incorpora estas interfaces con un proveedor simulado.
  Una recarga del servidor durante una captura interrumpió el caso del
  diseñador; se repitió con los archivos estables y pasó.
- Límites: siguen pendientes Tauri/WebView2 y escritura en otros motores.
  El rechazo real anterior de 6.1 con Codex CLI 0.150.1 y esta cuenta no se
  declara resuelto: la entrega permite comprobarlo y entenderlo sin sustituir
  el modelo. No se repitió una inferencia externa ni se cambió el CLI o la cuenta.
- Referencias de la comprobación de Codex: [estado de autenticación](https://learn.chatgpt.com/docs/auth)
  y [modo no interactivo y eventos JSONL](https://learn.chatgpt.com/docs/non-interactive-mode).

### DRU-01 — Ediciones pendientes de la cuadrícula

**Hallazgo.** `selectTab`, `closeTab` y `createTab` llaman a
`clearDisplayedResult`, que descarta las ediciones. `updateSql` también las
descarta. La confirmación de cierre de `AppShell` mira el SQL sin guardar de la
pestaña, pero no los cambios de celdas. Incluso cerrar una pestaña distinta de
la activa pasa por la limpieza global.

**Propuesta.** Centralizar la protección de los cambios pendientes antes de
cambiar de pestaña, conexión o base, cerrar, reejecutar o modificar el SQL que
los originó. Ofrecer conservar el contexto actual o descartar explícitamente.
Guardar debe seguir el flujo existente de vista previa y confirmación del SQL;
ningún cambio de contexto debe escribir en la base automáticamente.

**Aceptación.** Editar una celda y pulsar otra pestaña no pierde el cambio sin
una decisión explícita. Cancelar conserva celda, SQL y selección. Cerrar otra
pestaña no borra el resultado activo. Cubrir también paleta y atajos.

**Fuente:** [WorkspaceStore](../../frontend/src/app/core/workspace/workspace-store.ts),
[AppShell](../../frontend/src/app/layout/app-shell/app-shell.ts).

### DRU-02 — Vista previa de importación vinculada a sus opciones

**Hallazgo.** Cambiar el archivo limpia la vista previa; cambiar separador,
codificación, cabeceras o representación de nulos no la limpia. «Importar» puede
seguir habilitado con un resumen calculado bajo otras opciones. El backend
revalida antes de insertar, pero eso no asegura que el resumen visto sea el
mismo que se confirma.

**Propuesta.** Invalidar el análisis al cambiar cualquier entrada. Identificar
el análisis por archivo, opciones y destino, descartar respuestas antiguas y
exigir un resumen actualizado para confirmar. Deshabilitar cambios de entradas
mientras se ejecuta la importación. Evaluar una identificación del análisis en
el contrato si la comprobación del frontend no basta para vincular confirmación
y ejecución.

**Aceptación.** Analizar un CSV y cambiar `,` por `;` deshabilita «Importar» hasta
analizar de nuevo. Una respuesta tardía del análisis anterior no rehabilita el
botón. El servidor mantiene su validación y su operación transaccional.

**Fuente:** [diálogo de importación](../../frontend/src/app/features/import/import-dialog/import-dialog.ts),
[plantilla](../../frontend/src/app/features/import/import-dialog/import-dialog.html),
[ImportService](../../backend/src/Druse.Application/Rows/ImportService.cs).

### DRU-03 — Fidelidad de los valores editados

**Observación adicional durante la primera entrega.** Pulsar Enter dentro del
editor de una celda confirma el valor y vuelve a abrir el campo: el evento llega
también al manejador de la celda. Se reprodujo en Chromium durante la regresión
de DRU-01; la prueba usa Tab para finalizar la edición. Corregir la propagación
del teclado se incorpora a esta tarea pendiente.

**Hallazgo.** El editor transforma la cadena exacta `NULL` en un nulo. No hay
una acción explícita para distinguirla del texto literal «NULL». Además,
`datetimeOffset` usa `datetime-local`, y su comprobación de formato solo valida
el comienzo del valor: una fecha con zona puede entrar en un control que no
representa esa zona. Este segundo caso necesita reproducción en navegador y
WebView2 antes de afirmar una pérdida concreta.

**Propuesta.** Separar «Establecer NULL» del texto. Elegir un control nativo solo
cuando pueda representar el valor entero sin pérdida; conservar entrada de
texto para zona horaria, precisión o rango no compatibles. Abrir y cerrar un
editor sin cambios nunca debe producir una modificación.

**Aceptación.** Diferenciar `NULL`, cadena vacía y texto «NULL». Conservar fechas
con offset y fracciones, decimales de alta precisión y enteros grandes. Añadir
casos por motor a las pruebas de conversión y una prueba de navegador del control.

**Fuente:** [ResultsGrid](../../frontend/src/app/features/query-results/results-grid/results-grid.ts),
[edición de celdas](../../frontend/src/app/features/query-results/results-grid/results-grid.html).

### DRU-04 — Comprobación y diagnóstico de IA

**Hallazgo.** El catálogo local puede anunciar un modelo que rechaza la
petición. `ProbeAsync` del CLI inspecciona instalación y sesión; no envía una
pregunta. «Probar» puede comunicar éxito antes del rechazo observado con 6.1.
El error real de Codex llega además como JSON dentro de una cadena.

**Propuesta.** Mostrar por separado instalación, sesión, catálogo y última
respuesta comprobada. Mantener una comprobación local sin gastar cuota y
nombrarla claramente. Ofrecer «Probar respuesta» como acción explícita, con
indicación de que consume uso, prompt mínimo y posibilidad de cancelar.
Extraer el mensaje legible del error anidado; dejar el detalle técnico para
copiar. Mostrar proveedor, modelo y versión del CLI en el diagnóstico.

El catálogo indica disponibilidad anunciada, no compatibilidad comprobada.
Un rechazo observado debe asociarse a cuenta, versión y momento, y caducar o
invalidarse al cambiar esa información. No sustituir el modelo automáticamente.

**Aceptación.** Una sesión válida con modelo rechazado nunca aparece como
«modelo comprobado». Distinguir modelo no admitido, sesión ausente, cuota y
fallo de red mediante proveedores simulados. La comprobación local no genera
inferencias. Verificar streaming y cancelación en el contrato HTTP/SSE.

**Fuente:** [LocalCliProvider](../../backend/src/Druse.Infrastructure/Ai/LocalCliProvider.cs),
[CliTranscript](../../backend/src/Druse.Infrastructure/Ai/CliTranscript.cs),
[diálogo de proveedores](../../frontend/src/app/features/ai/ai-provider-dialog/ai-provider-dialog.ts).

## Fase 2 — Facilitar la consulta y la lectura

### Tercera entrega — 1.3.0, 2 de octubre de 2026

- **DRU-05:** búsqueda con espera de 250 ms y cancelación de la lectura anterior;
  solo la revisión vigente puede actualizar lista, carga y error. Los filtros
  se conservan al salir y volver al historial. Conexión y base admiten texto
  literal; se combinan con días locales completos y resultado correcto/fallido.
  La búsqueda general también encuentra el nombre de la base.
  Los filtros adicionales se agrupan en una sección desplegable con recuento
  de filtros activos para dejar espacio a la lista en ventanas pequeñas.
- Se cargan páginas de 100 entradas con una fila adicional para saber si queda
  otra página. El cursor usa fecha e identificador para desempatar ejecuciones
  simultáneas y evitar los desplazamientos de OFFSET. Las consultas nuevas se
  recuperan al actualizar. Vaciar cancela lecturas pendientes y borra el
  historial completo, incluso cuando hay filtros. Hay estado de carga, error y
  reintento; un intervalo invertido se rechaza antes de pedirlo al servidor.
- Cada entrada muestra su base y permite desplegar el SQL original completo.
  Abrir una pestaña conserva conexión y base; ninguna de estas acciones ejecuta
  SQL. El contrato de lista de `/api/history` sigue disponible para los clientes
  anteriores. Se actualizó OpenAPI con los filtros y la ruta de prueba de
  respuesta de IA de la entrega anterior. La prueba del contrato encuentra el
  repositorio también al compilar en una carpeta temporal aislada.
- **DRU-07:** una celda o cabecera participa en Tab; las flechas, Inicio/Fin y
  Control/Comando + Inicio/Fin recorren los datos. Mayús amplía un rectángulo;
  Control/Comando + Espacio selecciona columna y Mayús + Espacio, fila. El
  tamaño seleccionado se anuncia y el foco tiene un contorno propio.
- F2 o Intro abre el editor; sus flechas conservan el cursor de texto. F3 abre
  el filtro de la columna y Escape regresa a la primera coincidencia o a la
  cabecera si no quedan filas. Filtrar limpia la selección anterior para no
  copiar otras filas por posición. El avance carga el siguiente bloque al
  cruzar la fila 500. F4 desde una cabecera permite ajustar su ancho y volver
  con Escape. Alt + Supr solo señala la fila editable para el flujo existente
  de vista previa y confirmación de borrado. Ayudas traducidas y modificadores
  adaptados a la plataforma; los controles de filtro y «Mostrar más» siguen
  siendo accesibles en el recorrido de Tab.
- Verificación: TypeScript de aplicación y E2E, guarda de idiomas y **305
  pruebas de frontend** en ocho archivos; **10 pruebas del almacén de historial**
  con SQLite, incluido el recorrido de 537 entradas con el mismo instante y una
  inserción entre páginas; **18 pruebas de integración correctas y tres
  omitidas** por requerir PostgreSQL, incluidos HTTP de historial y OpenAPI.
- Navegador: **14 recorridos de SQLite y dos del historial**. El historial se
  comprueba en español e inglés con 537 entradas simuladas, filtros combinados,
  respuesta antigua retrasada, fallo/reintento y borrado. Desplegar SQL y abrir
  una pestaña no envían consultas. La cuadrícula usa una consulta real de SQLite
  con 502 filas: selección y copia, Control + Fin, F3, filtro vacío, Escape,
  salida con Tab y ajuste de ancho por teclado. La edición real con F2 conserva
  las comprobaciones de texto NULL, vacío y nulo de la entrega anterior.
- Capturas: historial y cuadrícula a 1440 × 960 en oscuro y 900 × 760 en claro;
  el barrido incorpora SQL completo y selección con teclado. La primera pasada
  nueva encontró dos problemas del arnés: un selector de etiqueta que incluía
  las opciones del desplegable y los saltos CRLF del portapapeles de Windows.
  Se corrigieron y los casos nuevos se repitieron. La inspección de la ventana
  pequeña motivó agrupar los filtros; se repitió la comprobación tras ese ajuste.
- Límites: quedan pendientes lector de pantalla y Tauri/WebView2. La navegación
  con Control/Comando + Fin sigue acumulando el DOM hasta la última fila del
  resultado cargado; no sustituye el trabajo de medición y ventana de filas de
  DRU-10. Los filtros de historial se comprueban sobre el SQLite local, sin
  depender del motor donde se ejecutó el SQL. No se repitió inferencia externa
  ni se declara resuelto el rechazo de 6.1.

### DRU-05 — Historial útil y búsqueda sin carreras

**Hallazgo.** Cada pulsación solicita el historial y cada respuesta reemplaza
la lista sin comprobar si pertenece al término actual. Una petición antigua
puede terminar después de la nueva. El almacén limita la consulta a 500 entradas;
la interfaz no ofrece recorrido de entradas anteriores ni filtros por fecha,
base o resultado.

**Propuesta.** Aplicar una pausa corta a la búsqueda y cancelar o ignorar las
respuestas superadas. Añadir carga/error visibles, filtros por conexión, base,
fecha y éxito/error, y paginación estable. Mostrar el SQL completo al abrir una
entrada. La reutilización ya existe y debe conservar conexión y base.

**Aceptación.** Al escribir y borrar deprisa con respuestas HTTP fuera de orden,
la lista corresponde siempre al término visible. Navegar un historial de más
de 500 entradas sin duplicados. Mostrar la base en entradas de conexiones con
varias bases. No ejecutar SQL al abrir un detalle.

**Fuente:** [QueryHistory](../../frontend/src/app/features/query-history/query-history/query-history.ts),
[loadHistory](../../frontend/src/app/core/workspace/workspace-store.ts),
[SqliteQueryHistoryStore](../../backend/src/Druse.Persistence.Sqlite/SqliteQueryHistoryStore.cs).

### DRU-07 — Teclado y accesibilidad de la cuadrícula

**Hallazgo.** Todas las celdas y cabeceras usan `tabindex="0"`; no hay recorrido
de celdas con flechas. En un resultado grande, Tab tiene que atravesar muchos
controles. Algunas ayudas de selección y borrado están escritas directamente
en español, fuera del catálogo de traducciones.

**Propuesta.** Un punto de entrada a la cuadrícula, flechas para moverse,
Inicio/Fin y selección con Mayús; Tab debe permitir salir sin recorrer todo el
resultado. Separar el modo de navegación del de edición. Traducir ayudas,
adaptar modificadores a la plataforma y anunciar selección y cambios.

**Aceptación.** Recorrer, editar, copiar y salir de la cuadrícula sin ratón.
Verificar foco tras filtrar y cargar filas. Revisar con lector de pantalla,
español, inglés y WebView2; no interceptar las flechas dentro de un editor activo.

**Fuente:** [plantilla de ResultsGrid](../../frontend/src/app/features/query-results/results-grid/results-grid.html),
[ResultsGrid](../../frontend/src/app/features/query-results/results-grid/results-grid.ts).

### DRU-08 — Inspector de celdas

**Hallazgo.** Los valores largos se recortan con elipsis y se exponen en `title`.
El doble clic edita cuando es posible y copia en otro caso; no hay un espacio
dedicado a leer texto multilínea o JSON completo.

**Propuesta.** Añadir «Ver valor completo» en menú y teclado, con tipo,
longitud, copia y vista de texto. Formatear JSON válido sin cambiar el original.
Mantener la lectura como acción inicial y la edición como paso explícito.

**Aceptación.** Leer JSON, saltos de línea, Unicode, cadena vacía y nulos sin
modificar nada. Copiar el valor original íntegro. Acotar el trabajo de formateo
para valores grandes y abrir/cerrar con foco restaurado.

**Fuente:** [ResultsGrid](../../frontend/src/app/features/query-results/results-grid/results-grid.ts),
[plantilla](../../frontend/src/app/features/query-results/results-grid/results-grid.html).

### DRU-12 — Preferencias centradas en la legibilidad

**Observación.** Las secciones ya están organizadas y Resultados tiene vista
previa. En la inspección visual, la imagen de fondo aparece antes del tamaño
y tipo de letra; colores y decoración añaden desplazamiento a ajustes de uso
frecuente. Los colores personalizados se comparten entre temas y la propia
pantalla advierte que pueden dejar de leerse al cambiar de tema.

**Propuesta.** Poner primero letra, densidad y sombreado; reunir colores y fondo
en personalización avanzada. Mantener una vista previa cercana a los controles.
Ofrecer un preajuste de lectura amplia y comprobar contraste cuando se cambian
colores o se introduce una imagen, con una acción para recuperar los valores
legibles del tema. No bloquear una personalización elegida deliberadamente.

**Aceptación.** Ajustar el tamaño de las celdas sin pasar por la decoración.
Verificar temas claro/oscuro, escalas 100/125/150 %, anchos 900/1024/1440 y
ventanas de poca altura. Restaurar por sección, sin perder ajustes de otra.

**Fuente:** [preferencias](../../frontend/src/app/features/settings/settings-dialog/settings-dialog.html),
[estilos](../../frontend/src/app/features/settings/settings-dialog/settings-dialog.scss),
[vista previa](../../frontend/src/app/features/settings/grid-preview/grid-preview.ts).

## Fase 3 — Mantener el contexto y trabajar con más datos

### DRU-06 — Resultados por pestaña

**Hallazgo.** `ExecutionStore` conserva un único resultado. Cambiar de pestaña
lo limpia, por lo que volver a una consulta obliga a ejecutarla otra vez aunque
el usuario solo quisiera comparar resultados.

**Propuesta.** Conservar en memoria un resultado por pestaña, con SQL ejecutado,
conexión, base, instante, conjunto seleccionado y estado de presentación.
Marcarlo como resultado anterior si cambia el SQL; invalidarlo al cambiar de
origen. Limitar la memoria por bytes y expulsar los resultados menos recientes.
No guardar filas automáticamente en disco.

**Aceptación.** Ir de A a B y volver recupera el resultado de A sin consulta.
Una respuesta tardía queda vinculada a su pestaña de origen. Exportar utiliza
el SQL y origen asociados a ese resultado. Aplicar DRU-01 antes de conservar
ediciones; estas nunca pueden trasladarse a otras filas por posición.

**Fuente:** [ExecutionStore](../../frontend/src/app/core/workspace/execution-store.ts),
[WorkspaceStore](../../frontend/src/app/core/workspace/workspace-store.ts).

### DRU-09 — Ordenación y organización de columnas

**Hallazgo.** La cabecera selecciona columnas y ofrece ajuste de ancho; no
implementa una ordenación interactiva ni ocultación o fijación. Son acciones
útiles para comparar valores y leer tablas anchas.

**Propuesta.** Añadir orden ascendente/descendente/sin orden desde una acción
distinta de seleccionar; ocultar y recuperar columnas, y fijar columnas clave.
Ordenar según el tipo, con una política explícita para nulos. Identificar
columnas por posición además del nombre, pues una consulta puede repetir nombres.

**Aceptación.** Diferenciar orden numérico y textual; conservar valores e
identidad de filas al filtrar, copiar o editar. Mostrar que la ordenación es
local y respetar el alcance ya explicado por exportación. No añadir `ORDER BY`
automáticamente al SQL del usuario. Depende de DRU-07 y se integra con DRU-06.

**Fuente:** [cabeceras y selección](../../frontend/src/app/features/query-results/results-grid/results-grid.html),
[copias](../../frontend/src/app/features/query-results/results-grid/copy-formats.ts).

### DRU-10 — Rendimiento de resultados grandes

**Hallazgo.** La cuadrícula añade bloques de 500 filas al DOM y conserva todas
las anteriores al pulsar «Mostrar más». El backend admite hasta 100 000 filas.
Es una limitación estructural; esta revisión no midió una congelación concreta.

**Propuesta.** Medir primero 500, 10 000 y 100 000 filas con 10 y 50 columnas.
Si las mediciones lo justifican, mantener solo una ventana de filas renderizadas.
Conservar selección y copia sobre los datos cargados, no sobre el DOM. Evaluar
paginación de servidor después: las consultas arbitrarias requieren un contrato
de cursor y una política de consistencia, no añadir `LIMIT/OFFSET` a ciegas.

**Aceptación.** En la misma máquina de referencia, registrar memoria, número de
nodos y latencia de desplazamiento/filtro antes y después. Objetivo inicial:
menos de 2 000 celdas renderizadas en el recorrido de referencia y respuesta
p95 inferior a 100 ms en navegación local; ajustar solo con evidencia. Mantener
cancelación y claridad sobre truncamiento. Integrar DRU-07 y DRU-09.

**Fuente:** [renderedRows y showMore](../../frontend/src/app/features/query-results/results-grid/results-grid.ts),
[límite de consultas](../../backend/src/Druse.Application/Queries/QueryService.cs).

### DRU-11 — Continuidad y contexto del chat

**Desarrollo del alcance:** el [plan de contexto del chat del 16 de octubre](plan-contexto-chat-2026-10-16.md)
detalla selección de tablas, relaciones, notas de negocio y fases de entrega.
Sigue pendiente de implementación; su alcance ampliado tiene estimación propia.

**Hallazgo.** La conversación es global, crece sin un presupuesto visible y
permanece al cambiar de proveedor. Los turnos no registran proveedor, modelo,
base ni contexto enviado. Un fallo aparece como texto sin acción de reintento.
El contexto de esquema limita tablas y columnas, pero no el total de la
conversación. El separador de bloques admite también bloques sin lenguaje como
SQL, por lo que conviene distinguir código de otros formatos.

**Propuesta.** Registrar procedencia y contexto por turno; indicar el cambio de
base/proveedor y permitir una conversación nueva. Reintentar una pregunta
fallida conservando el contexto original y sin duplicarla. Seleccionar las
tablas a compartir y consultar el resumen antes de enviar. Acotar historial y
contexto por tamaño, explicando qué se omite; no afirmar un recuento exacto de
tokens sin un método adecuado para el proveedor. Solo ofrecer inserción SQL en
bloques identificados como SQL. Conservar el control actual de divulgación.

**Aceptación.** Cambiar de base no presenta respuestas anteriores como si
pertenecieran a la nueva. Cambiar de proveedor hace explícito qué conversación
se enviará. Reintentar tras un fallo produce un solo turno de usuario y conserva
el contexto elegido. Un bloque JSON no ofrece reemplazar la consulta. La IA
sigue sin ejecutar SQL automáticamente. Depende de DRU-04.

**Fuente:** [AiStore](../../frontend/src/app/core/ai/ai-store.ts),
[AiPanel](../../frontend/src/app/features/ai/ai-panel/ai-panel.ts),
[composición de esquema](../../frontend/src/app/core/ai/ai-context.ts).

### DRU-13 — Actividad con detalle recuperable

**Hallazgo.** Actividad ya muestra trabajos, estado, asunto y fechas, y permite
actualizar. `JobSummary` no incluye motivo del fallo, advertencias ni referencia
al resultado detallado. Después de cerrar un diálogo de operación, el resumen
puede no bastar para saber qué revisar.

**Propuesta.** Ampliar el registro durable con resultado resumido, advertencias,
tablas afectadas y referencia segura al artefacto. Abrir el detalle desde
Actividad, filtrar por estado y facilitar copiar un diagnóstico sin secretos.
Ofrecer reanudación solo donde el servicio y el artefacto ya la soporten y
después de revalidar origen/destino. No reiniciar restauraciones o transferencias
automáticamente ni asumir que son idempotentes.

**Aceptación.** Consultar la causa de un fallo tras cerrar y volver a abrir
Druse. «Completado con advertencias» permite leerlas. Un trabajo interrumpido
explica lo que quedó a medias y las acciones disponibles. Mantener las
protecciones actuales de cancelación, transacción y cierre.

**Fuente:** [Actividad](../../frontend/src/app/features/activity/activity-dialog/activity-dialog.html),
[JobSummary](../../frontend/src/app/core/application-gateway/application-gateway.ts),
[RunningJobsService](../../frontend/src/app/core/jobs/running-jobs.service.ts).

## Fase 4 — Ampliar funciones a partir de necesidades concretas

### DRU-14 — Planes de ejecución SQL

**Propuesta.** Incorporar una acción «Ver plan estimado» y una vista de tabla o
árbol que muestre operadores, estimaciones y avisos de índices cuando el motor
los provea. Declarar la capacidad por proveedor, siguiendo la arquitectura
existente. Empezar con PostgreSQL y SQL Server, validando permisos y semántica;
conservar una vista del resultado original para los formatos no normalizables.

**Aceptación.** El plan estimado no ejecuta una modificación. Un eventual plan
real debe ser una acción distinta que explique que ejecuta la consulta y pase
por las mismas protecciones de Druse. Manejar múltiples instrucciones y
permisos insuficientes. Implementar con documentación oficial y pruebas de
motores reales durante esa tarea; no declarar una sintaxis universal.

**Punto de integración:** [capacidades de motores](../../backend/src/Druse.Domain/EngineCapabilities.cs),
[barra del editor](../../frontend/src/app/features/query-editor/editor-toolbar/editor-toolbar.ts).

### DRU-15 — Correspondencias de importación editables

**Hallazgo.** La vista previa muestra el emparejamiento automático por nombre
en una tabla de lectura. Archivos con cabeceras diferentes requieren preparar
el archivo fuera de Druse.

**Propuesta.** Permitir elegir destino e ignorar columnas desde la vista previa,
conservar la sugerencia automática por nombre y guardar perfiles de lectura y
correspondencia por estructura. Un perfil recordado es una sugerencia: cualquier
cambio de archivo, esquema o mapeo obliga a analizar otra vez. Comprobar primero
qué soporte de correspondencia explícita ya ofrece el contrato.

**Aceptación.** Importar una cabecera `nombre_cliente` a una columna `nombre`
con vista previa y confirmación. Rechazar destinos duplicados o incompatibles
cuando proceda. Detectar columnas obligatorias y cambios de esquema. Conservar
la importación transaccional. Depende de DRU-02.

**Fuente:** [correspondencias de importación](../../frontend/src/app/features/import/import-dialog/import-dialog.html),
[ImportService](../../backend/src/Druse.Application/Rows/ImportService.cs).

## Ejecución y seguimiento

1. **Primera entrega:** DRU-01 y DRU-02; añadir casos de navegador antes de
   modificar los flujos de edición y confirmación.
2. **Segunda entrega:** DRU-04 y DRU-03. Comprobar el diagnóstico de IA con
   proveedores simulados y los controles de datos con WebView2.
3. **Siguiente ciclo de uso diario:** DRU-05, DRU-07, DRU-08 y DRU-12.
4. **Continuidad y volumen:** DRU-06, DRU-09, DRU-10, DRU-11 y DRU-13,
   respetando sus dependencias y dividiendo cada función en entregas pequeñas.
5. **Funciones nuevas:** DRU-14 y DRU-15 según los casos de uso prioritarios.

La fase 1 suma aproximadamente **6–11 días**; la fase 2, **8–13**; la fase 3,
**16–26**; la fase 4, **8–13**. Son tamaños orientativos, no un calendario.
Cada mejora debe poder evaluarse y publicarse por separado, sin esperar a
completar todo el plan.

| Indicador | Estado revisado | Objetivo |
| --- | --- | --- |
| Descartes de celdas al cambiar de contexto | El código limpia ediciones | Ningún descarte sin decisión explícita |
| Análisis de importación tras cambiar opciones | Sigue visible | Confirmación solo del análisis vigente |
| Prueba local de Codex | Inspecciona instalación/sesión | Estados separados y sin éxito de modelo no comprobado |
| Búsquedas de historial superadas | Pueden reemplazar la lista | Solo la búsqueda vigente actualiza la vista |
| Resultados al volver a otra pestaña | Se limpian | Recuperación en memoria con origen y límite |
| Navegación por celdas | Múltiples paradas de Tab | Entrada/salida breve y recorrido con flechas |
| Resultados grandes | DOM acumulativo de 500 en 500 | Presupuesto medido de nodos, memoria y respuesta |
| Advertencias de un trabajo pasado | Resumen sin detalle | Detalle consultable desde Actividad |

### Definición de terminado por entrega

- Caso reproducible y prueba que proteja el comportamiento observado.
- Pruebas del área y comprobaciones de `AGENTS.md`: TypeScript, guarda de idiomas
  y pruebas de novedades para cambios visibles.
- Recorrido E2E con datos aislados; proveedor de IA simulado para no depender
  de cuenta, red o cuota. Motores reales para cambios en escritura o planes.
- Si hay interfaz nueva, añadir captura al barrido y mirarla en ambos temas,
  tamaños de ventana y escalas; incluir teclado y foco.
- Validar en Tauri/WebView2 los comportamientos que el navegador no acredita.
- Mantener confirmaciones, solo lectura, validación transaccional, procedencia
  del SQL y preferencias de divulgación de IA.
- Aplicar versión, novedades en español/inglés y commit según `AGENTS.md`, una
  subida de versión por tarea. La documentación de este plan no sube versión.
- Registrar aquí o en la bitácora qué criterio pasó, qué evidencia se obtuvo y
  qué quedó pendiente; una casilla histórica no sustituye una comprobación actual.

Estado inicial: **DRU-01 a DRU-15 pendientes**. Estado tras las tres primeras
entregas: **DRU-01 a DRU-05 y DRU-07 implementadas; DRU-06 y DRU-08 a
DRU-15 pendientes**.
La comprobación nativa y de otros motores de las entregas implementadas sigue
pendiente y se mantiene explícita arriba.
