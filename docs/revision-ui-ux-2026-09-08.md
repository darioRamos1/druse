# Revisión de UI y UX de Druse — 8 de septiembre de 2026

## Alcance y conclusión

Revisión del frontend Angular actual, sus estilos y los planes visuales existentes. Se levantaron el frontend y la API local con un directorio de datos temporal separado. Se inspeccionaron en navegador, a 1280 × 720 y escala 100 %, el editor inicial, el formulario de conexión, Preferencias, la paleta y el asistente. Se observaron los temas oscuro y claro.

No se conectaron motores de bases de datos ni se ejecutaron consultas. Los hallazgos de resultados con datos, conexiones guardadas y trabajos interrumpidos se basan en código; requieren validación con esos estados antes de implementar. La API se inició con los binarios locales existentes; esta revisión no certifica su correspondencia con todo el código backend actual. No se evaluó el envoltorio Tauri en ejecución.

La dirección recomendada es conservar la identidad de Druse —Inter, JetBrains Mono, superficies sobrias y acento índigo— y mejorar la jerarquía, la legibilidad y la claridad de las acciones. La mayor oportunidad está en el espacio de trabajo y el primer flujo de conexión.

## Lo que conviene conservar

- Tokens centralizados y temas claro y oscuro que se aplican a la interfaz.
- Paneles ajustables, contexto por pestaña y acceso a todas las pestañas abiertas.
- Paleta de comandos, búsqueda de objetos, atajos y ayudas SQL existentes.
- Pies fijos de los diálogos, validaciones junto al campo y restauración del foco al cerrarlos.
- Estados de ejecución, cancelación y error ya diseñados: mejorar su continuidad sin duplicarlos.

## Prioridades

### 1. Alta: corregir la legibilidad de las ayudas

**Comprobado en navegador.** En el formulario oscuro, las ayudas de base de datos y cifrado usan texto `rgb(94, 106, 128)` sobre `rgb(17, 22, 33)`, a 10,5 px. Su contraste calculado es **3,32:1**. Las versiones de motores no seleccionados tienen aproximadamente **3,44:1**.

Subir la luminosidad del texto secundario y llevar las ayudas importantes a 12–13 px. La densidad puede mantenerse compacta sin usar un gris tan tenue. Validar ambos temas y las variantes personalizables. WCAG establece 4,5:1 para texto normal, con excepciones que no convierten estas ayudas informativas en texto deshabilitado. [Referencia: contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Ubicación:** `frontend/src/app/features/connections/connection-dialog/connection-dialog.scss`, líneas 147 y 272; tokens de texto en `frontend/src/styles/_tokens.scss`.

### 2. Alta: simplificar las barras para dar espacio al SQL

**Comprobado en navegador.** Sin asistente, la barra del editor mide **72,8 px** a 1280 × 720: Filas y Timeout bajan a otra fila. El editor queda con unos **210 px de alto**, mientras el panel de resultados vacío ocupa 322 px. La barra superior conserva acciones frecuentes y ocasionales con una presencia similar.

Propuesta: agrupar Abrir/Guardar/Guardar como en Archivo; mantener Nueva consulta, búsqueda y Asistente accesibles; dar prioridad visual a Ejecutar y al destino de la consulta; agrupar opciones de ejecución; mostrar Cancelar al ejecutar. Conservar visibles las acciones de Commit y Rollback cuando exista una transacción. Ofrecer maximizar editor/resultados y un diseño inicial que aproveche el panel vacío.

La compactación actual evita perder acciones, pero llega de forma brusca: al abrir el asistente, el editor pasa a 625 px de ancho y casi todas las etiquetas desaparecen. Usar un menú de acciones secundarias antes de convertir toda la barra en iconos.

**Ubicación:** `frontend/src/app/layout/top-bar/`; `frontend/src/app/features/query-editor/editor-toolbar/`; `frontend/src/app/layout/app-shell/`.

### 3. Alta: aclarar y acortar el formulario de conexión

**Comprobado en navegador.** El formulario requiere desplazamiento para llegar a cifrado, SSH, entorno y persistencia. Informix aparece como dos motores y produce cinco tarjetas en una cuadrícula de dos columnas. El encabezado dice que la contraseña «no se guarda todavía», pero «Recordar la contraseña» está marcado y explica dónde se guardará.

Propuesta: conservar a la vista motor, servidor, puerto, base, credenciales, entorno y solo lectura. Mover los detalles de cifrado y SSH a una sección desplegable con un resumen visible de la configuración vigente. Agrupar Informix y permitir elegir su protocolo dentro de ese motor. Cambiar «Ver las mías» por «Buscar bases de datos» y hacer que el texto de persistencia refleje la opción elegida y el momento de guardado.

**Ubicación:** `frontend/src/app/features/connections/connection-dialog/connection-dialog.html`, líneas 43, 175, 263, 279, 413 y 471.

### 4. Alta: completar la interacción del explorador con teclado

**Hallazgo de código.** Reconectar, desconectar, editar y eliminar conexiones son elementos `span` con manejador de clic, dentro del botón de la conexión. No son controles independientes accesibles por teclado. El manejador de los objetos contempla Enter y Espacio, pero no la navegación del árbol con flechas.

Propuesta: un menú de acciones por conexión con botones reales; flechas arriba/abajo para recorrer, derecha/izquierda para expandir y contraer; foco visible y objetivos de clic más amplios. Los iconos de acción actuales tienen cajas de 19 px. Validar que toda acción pueda completarse con teclado. [Referencia: funcionalidad por teclado](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html).

**Ubicación:** `frontend/src/app/features/connections/connections-sidebar/connections-sidebar.html`, líneas 96–124; `connections-sidebar.ts`, línea 506; `connections-sidebar.scss`, línea 353.

### 5. Media: orientar mejor la primera sesión

**Comprobado en navegador.** Sin conexiones, aparecen el editor vacío, numerosos controles deshabilitados y un panel que invita a ejecutar SQL. La acción útil está principalmente en la barra y el lateral.

Propuesta: un estado inicial central con «Conecta tu primera base de datos», botón Crear conexión y acción secundaria Abrir SQL. Después de conectar, ofrecer Abrir una tabla o Nueva consulta. Retirar esta ayuda al empezar a trabajar. La paleta también debería distinguir las acciones disponibles de las que necesitan una sesión o una transacción.

**Ubicación:** `frontend/src/app/layout/app-shell/`; `frontend/src/app/features/query-results/results-panel/results-panel.html`; `frontend/src/app/layout/command-palette/`.

### 6. Media: unificar los atajos y los nombres

**Comprobado en navegador y código.** Ejecutar muestra `⌘⏎`, Ejecutar actual muestra `⇧⌘⏎` y Comentar muestra `⌘/`, mientras los tooltips y la paleta anuncian Ctrl. También conviven Query 1 y Timeout con etiquetas en español.

Propuesta: usar una fuente común de atajos adaptada a Windows/Linux o macOS; llamar a las pestañas nuevas «Consulta 1»; usar «Tiempo límite». Cambiar dinámicamente Ejecutar actual a «Ejecutar selección» cuando exista selección, y aclarar «Ejecutar todo» para el documento completo.

**Ubicación:** `frontend/src/app/features/query-editor/editor-toolbar/editor-toolbar.html`, líneas 12, 25, 26, 105 y 294.

### 7. Media: explicar el alcance de filtros y exportación

**Hallazgo de código y documentación.** Filtros opera sobre las filas mostradas; Exportar vuelve a ejecutar la consulta para obtener más filas. El tooltip del filtro lo aclara, pero el menú CSV dice «Todas las filas del resultado» y no explica esa nueva ejecución.

Propuesta: distinguir «Exportar filas visibles» y «Exportar consulta completa», o explicar claramente el único alcance disponible. Mostrar «Filtrando sobre las filas cargadas» al activar filtros. Evitar que una exportación parezca corresponder a una vista filtrada si no lo hace. Conservar los límites y protecciones existentes.

**Ubicación:** `frontend/src/app/features/query-results/results-panel/results-panel.html`, líneas 48 y 158; sección Exportar de `README.md`.

### 8. Media: dar continuidad a las operaciones largas

**Hallazgo de código.** Hay progreso en la barra de estado, pero el botón de trabajos interrumpidos llama directamente a `jobs.dismissInterrupted()`: el clic descarta el aviso.

Propuesta: abrir un panel Actividad con el estado, la operación afectada, el detalle y la acción de recuperación que realmente soporte cada operación. Separar «Ver detalle» de «Descartar aviso». Esto amplía el UX-010 ya pendiente en `PLAN_MEJORAS_DRUSE.md`.

**Ubicación:** `frontend/src/app/layout/status-bar/status-bar.html`, línea 119.

## Ajustes posteriores

- Organizar Preferencias en Apariencia, Editor y Acerca de; actualmente Acerca de ocupa el primer bloque antes de los ajustes visuales.
- Hacer redimensionable el asistente y ofrecer contraer el explorador, para recuperar ancho sin perder el chat.
- Mantener nombre de conexión, base y una etiqueta textual de Producción junto a Ejecutar. Ya existen señales de entorno; reforzar su lectura sin eliminar contexto útil para distinguir conexiones.
- Revisar los tres puntos decorativos de control de ventana de la barra superior: parecen controles pero son `span` sin acción. Confirmar primero cómo se presentan junto al marco nativo de Tauri.

## Orden de implementación sugerido

1. Contraste, coherencia de atajos y texto de contraseña; accesibilidad de las acciones del explorador.
2. Barra superior, barra del editor, tamaños iniciales y primera conexión.
3. Alcance de exportación, actividad y organización de preferencias.

Para las siguientes iteraciones: revisar 900, 1024, 1280 y 1440 px, escalas 100 % y 125 %, ambos temas y estados con conexión, transacción y resultados reales. Aprovechar el barrido existente; reservar las nuevas pruebas para comportamientos como teclado, alcance de exportación y recuperación de operaciones. Las propuestas visuales deben validarse con capturas y tareas reales de uso.

## Primera entrega implementada

- **Archivo:** Abrir SQL, Guardar y Guardar como se agrupan en un desplegable. Se conserva el acceso por teclado; Escape devuelve el foco y salir del menú lo cierra.
- **Editor:** Ejecutar conserva su etiqueta en ventanas estrechas; la acción de selección cambia de nombre según el estado; Cancelar aparece durante la ejecución. Filas y Tiempo límite comparten un panel con selectores nativos que permite ajustar ambos sin ejecutar SQL. El contexto incluye una etiqueta textual para Producción.
- **Conexión:** cuatro familias de motores, con SQLI y DRDA dentro de Informix. Entorno y Solo lectura preceden a las opciones avanzadas. Cifrado y SSH se pueden plegar sin perder valores; los errores de SSH vuelven a mostrar esa sección. Se corrigieron los textos de guardado y búsqueda de bases.
- **Legibilidad y nombres:** ayudas del formulario a 12 px con el token de texto terciario, pestañas nuevas «Consulta», «Tiempo límite» y atajos de las barras adaptados a la plataforma.
- **Escala:** se corrigieron la altura del espacio de trabajo y los límites de los diálogos para compensar el zoom. Al 125 %, la versión anterior desbordaba verticalmente 190 px en una ventana de 760 px; con el ajuste, los botones de pie permanecen dentro de la ventana.

### Validación de la entrega

- En el estado inicial, sin conexión ni asistente, la barra del editor mide **42 px** a 900, 1024, 1280 y 1440 px de ancho y escala 100 %, sin desbordamiento horizontal. Frente a los 72,8 px iniciales a 1280 px, recupera unos **31 px** para el editor.
- Se inspeccionaron el formulario y los menús en temas claro y oscuro, los protocolos de Informix, la conservación de valores al plegar y el cierre con Escape. La ayuda de base de datos en el tema oscuro pasó de **3,32:1 a 6,07:1** de contraste medido; esto no constituye una auditoría completa de accesibilidad.
- Se comprobó la escala 125 % a 900 y 1280 px: el diálogo y su pie caben en la ventana. Se restauró la escala de la sesión de prueba.
- Pruebas unitarias del frontend: **872 aprobadas**. Compilación de producción y comprobación de tipos de la suite E2E correctas. Se actualizaron los selectores E2E y se añadió una regresión para la escala; la suite E2E completa no se ejecutó en esta entrega.
- Se utilizó una API local con datos temporales. No se ejecutaron consultas contra motores reales ni se validó Tauri en ejecución.

### Pendiente de siguientes entregas

Distribución inicial de resultados, alcance de filtros y exportación, panel de actividad y organización de Preferencias. La fuente común de atajos se aplica por ahora a las barras; queda extenderla a la paleta y demás ayudas. Las acciones del explorador y la primera sesión se abordaron en la segunda entrega.

## Segunda entrega — 9 de septiembre de 2026

- **Acciones de conexión:** reconectar, desconectar, editar y eliminar son botones dentro de un menú. El disparador tiene nombre accesible, foco visible y un objetivo de 28 × 26 px. Las acciones no propagan el clic a la fila; las incompatibles con una conexión en curso quedan deshabilitadas.
- **Árbol con teclado:** un punto de entrada por Tab; arriba/abajo recorren filas visibles; Inicio/Fin llevan a los extremos; derecha despliega o entra en hijos; izquierda pliega o vuelve al padre. Enter abre tablas y vistas; Espacio conserva la expansión. Se exponen nivel y posición entre hermanos para lectores de pantalla.
- **Menús de objetos y conexiones:** Mayús+F10 abre las acciones de la fila. Las flechas, Inicio y Fin recorren el menú; Escape lo cierra y restaura el foco. Pulsar fuera o sacar el foco también lo cierra. La posición usa el tamaño real del menú y respeta el zoom y los límites de la ventana.
- **Primera sesión:** el panel de resultados vacío invita a crear una conexión o abrir SQL. La ayuda desaparece cuando hay conexiones, historial o SQL en alguna pestaña. Al comenzar a escribir se retira durante la sesión, incluso si después se borra el texto.

### Validación de la segunda entrega

**881 pruebas unitarias aprobadas**, compilación de producción correcta, comprobación de tipos E2E y formato correctos. Las pruebas añadidas cubren navegación, jerarquía, foco, independencia de acciones y la integración de la bienvenida con el formulario.

En navegador se comprobaron la bienvenida en ambos temas a 1280 y 900 px, su retirada al escribir y borrar SQL, el recorrido entre conexiones con flechas, el menú con Mayús+F10, la apertura de Editar conexión con teclado y el regreso del foco con Escape. El menú de conexión se revisó también a 900 px y escala 125 %.

Se crearon dos perfiles ficticios, sin contraseñas, exclusivamente en el directorio temporal de esta entrega. No se abrieron sesiones contra motores reales. Los nodos de tablas y esquemas se validaron con pruebas de componente; queda pendiente el barrido E2E completo con motores y Tauri.

## Tercera entrega — 9 de septiembre de 2026

- **Alcance de filtros:** al filtrar se indica cuántas de las filas cargadas coinciden, que los filtros son locales y que no se aplican al exportar. Hay un botón para limpiarlos y el contador del pie refleja el mismo alcance. El botón de Filtros marca cuántos hay puestos aunque su fila esté recogida.
- **Alcance de exportación:** el menú advierte de que se vuelve a ejecutar el SQL original, sin los filtros locales ni el límite de filas del editor. Las etiquetas dan los topes reales: un millón de filas en CSV, 200 000 filas o dos millones de celdas en Excel. El pie deja de prometer un total que el motor no siempre entrega.
- **Menús de resultados:** copiar y exportar se recorren con flechas, Inicio y Fin; Escape devuelve el foco al botón. Se colocan midiendo el menú ya pintado, respetan la escala y los bordes de la ventana, y se cierran al pulsar fuera, al cambiar de resultado, al ejecutar y al redimensionar.
- **Actividad:** el aviso de trabajos interrumpidos ya no se descarta al pulsarlo. Actividad abre el detalle de los últimos veinte respaldos, restauraciones y traslados —estado, destino, fechas y qué revisar si quedó a medias— y ocultar los avisos de la sesión es una acción aparte. Si la API no responde se conserva lo que sabía el arranque, con Actualizar para reintentar. Cierra con Escape y bloquea los atajos de fondo. Cubre el UX-010 del plan.

### Validación de la tercera entrega

**892 pruebas unitarias aprobadas**, compilación de producción correcta, comprobación de tipos de la suite E2E y formato correctos. Las pruebas añadidas cubren el recuento de filtros, el alcance anunciado en el menú de exportar, el recorrido con teclado de ambos menús, la apertura de Actividad sin descartar avisos y su cierre con Escape.

No se ejecutaron consultas contra motores reales ni se validó Tauri en ejecución; la suite E2E completa tampoco se ejecutó en esta entrega, aunque sus selectores están al día. El barrido de capturas todavía no incluye el diálogo de Actividad ni el aviso de alcance de los filtros.

La comprobación manual utilizó una API de prueba con datos ficticios. Actividad se revisó en oscuro a 1280 px y en claro a 900 px con escala 125 %: el diálogo quedó entre los píxeles 20 y 700 de una ventana de 720 px, con el pie visible y sin desbordamiento horizontal. Ocultar avisos conservó los cuatro registros mostrados y llevó el foco a Cerrar; Escape lo devolvió a Actividad. En resultados, filtrar Bogotá mostró correctamente tres coincidencias entre cinco filas cargadas, tanto en el aviso como en el contador del pie. Tras el último ajuste de foco se repitieron las 17 pruebas de Actividad y resultados, todas aprobadas, y la compilación de producción terminó correctamente con 418,54 kB iniciales.

### Pendiente

Distribución inicial de resultados, organización de Preferencias, el asistente redimensionable y el explorador contraíble. La fuente común de atajos sigue aplicándose solo a las barras: falta la paleta y la hoja de atajos. Y queda el barrido E2E completo, con motores levantados y las capturas nuevas de esta entrega.

## Cuarta entrega — mejoras publicadas por separado

### Preferencias organizadas

Apariencia reúne tema, escala y colores; Editor agrupa letra e imagen de fondo; Acerca de contiene versión, actualizaciones y diagnóstico. Las pestañas admiten flechas e Inicio/Fin y conservan los valores al cambiar de sección. El diálogo abre Apariencia y mantiene visibles las acciones de cierre.

Validación: cuatro pruebas de componente aprobadas y compilación de producción correcta. En navegador se revisaron Apariencia a 1280 px y la navegación entre las tres secciones a 900 px con escala 125 %. El tamaño de letra elegido se conservó al volver a Editor y el pie quedó dentro de la ventana.

### Distribución de editor y resultados

La altura inicial de resultados se adapta al espacio disponible después de las barras. El límite del tirador reserva espacio para seguir escribiendo y se recalcula al cambiar el tamaño de la ventana o de los avisos. Intro o doble clic en el separador restablece el reparto automático. Los arrastres convierten la distancia de pantalla a píxeles CSS para respetar el zoom. La bienvenida se compacta cuando falta altura, conservando sus acciones visibles.

Validación: pruebas del cálculo de tamaños, del tirador con zoom y de su integración con el shell aprobadas (35 casos entre las tres suites). A 900 × 720 px y escala 125 %, el editor inicial midió 301,5 px; al ampliar resultados al máximo conservó 200,25 px, sin desbordar la ventana. Crear conexión permaneció visible en el reparto automático.

### Explorador plegable

Un botón junto a la marca permite ocultar y recuperar el explorador en escritorio. Se conservan el ancho, el filtro y el componente con su árbol. Ctrl/Cmd+Mayús+E revela el panel y selecciona su filtro, respetando los diálogos abiertos; en móvil sigue abriendo el cajón existente.

Validación: 70 pruebas aprobadas entre shell, explorador y atajos; compilación de producción correcta. A 900 × 720 px y escala 125 % se comprobó que el panel desaparece del árbol accesible, el editor ocupa el ancho liberado y el atajo recupera el filtro «ventas» seleccionado y con foco. La barra superior conserva sus acciones visibles.

### Asistente redimensionable

El separador permite cambiar el ancho con arrastre o flechas y restaurarlo con Intro o doble clic. El tamaño se limita para conservar 360 píxeles CSS de editor; si ambos paneles no caben, el asistente se superpone. Al recuperar espacio vuelve a la distribución en columnas y al ancho solicitado. Cerrar conserva también el borrador sin enviar, y Escape desde el panel devuelve el foco a su botón.

Validación: 41 pruebas aprobadas entre distribución, separadores y shell, incluida la conservación del borrador; compilación de producción correcta. A 900 px y escala 125 %, plegar el explorador permitió pasar del asistente superpuesto a columnas, dejando 450 px físicos para el editor. Al ampliar a 1440 px recuperó los 495 px físicos elegidos para el asistente; Escape cerró el panel. No se enviaron preguntas a proveedores.

### Atajos por plataforma

La paleta y la hoja de ayuda usan la fuente común de etiquetas, incluidos ⌘, ⇧ y ⌥ en macOS. Se documentaron además las excepciones verificadas en el Monaco instalado: reemplazar con ⌘+⌥+F en macOS y las combinaciones de Linux para añadir cursores y duplicar líneas. Las etiquetas largas pueden ocupar dos líneas sin invadir la descripción.

Validación: 36 pruebas aprobadas entre etiquetas, paleta y hoja de ayuda, con casos de Windows, Linux y macOS; compilación de producción correcta. Se inspeccionó la hoja en tema claro a 900 × 720 px con escala 125 %, con cierre visible y desplazamiento del contenido. La ejecución nativa de los atajos de macOS y Linux queda pendiente; las combinaciones se contrastaron con el código de Monaco incluido en las dependencias.

### Cierre de validación de la cuarta entrega

- **912 pruebas del frontend aprobadas**, en 68 suites, y compilación de producción correcta (425,24 kB iniciales).
- **23 pruebas de Rust/Tauri aprobadas** después de cargar el entorno MSVC con `build/scripts/msvc-env.ps1`. Esto no valida la interfaz dentro de WebView2 ni los diálogos nativos.
- Comprobación de tipos E2E correcta. El barrido incluye ahora las tres secciones de Preferencias, Actividad, alcance de filtros y exportación, asistente ampliado y explorador plegado, además de 1280 px entre sus tamaños de captura.
- La API y la revisión manual usaron datos temporales. Docker Desktop se intentó iniciar, pero su motor siguió sin estar disponible (`dockerDesktopLinuxEngine` ausente); no se ejecutaron la suite E2E ni el barrido automático con motores reales. Las nuevas capturas automáticas quedan pendientes de esa ejecución.
- UX-007 se marca completado con las medidas del editor documentadas arriba. Permanecen pendientes la revisión visual de Tauri y sus controles decorativos de ventana, y la comprobación nativa de las combinaciones de macOS/Linux. Se conserva el contexto de conexión y base junto a Ejecutar.

Mejoras publicadas individualmente: `dd12d41` Preferencias, `b378202` resultados adaptables, `ddb03c8` explorador plegable, `127d20f` asistente redimensionable y `d31d411` atajos por plataforma.

## Validación con Docker — 10 de septiembre de 2026

Docker vuelve a estar disponible y se levantaron los contenedores de pruebas de PostgreSQL, SQL Server y MySQL. El primer arranque E2E falló antes de ejecutar casos porque la API de la vista previa bloqueaba sus DLL en Windows. La configuración ahora compila la API y sus referencias en `%TEMP%\druse-e2e-build`, conservando los datos E2E en su carpeta independiente. El typecheck pasó y ambas API respondieron simultáneamente en 5188 y 5299; la vista previa no se detuvo.

Los recorridos E2E se actualizaron para abrir Opciones avanzadas antes de elegir el cifrado de PostgreSQL y esperar el final de la consulta mediante la respuesta HTTP y la recuperación del botón Ejecutar. Cancelar ahora desaparece al terminar, por lo que esperar que siguiera visible y deshabilitado daba falsos fallos. Diagramas y migraciones comparten la nueva espera; el diagrama también espera la respuesta antes de continuar.

**53 pruebas E2E aprobadas en 3,3 minutos**, sin reintentos. Cubren conexión y consultas reales, diagramas, teclado, escala 125 %, cuadrícula en PostgreSQL y SQL Server y migraciones entre ambos motores. El único caso omitido es el barrido visual, que se activa por separado. El typecheck también pasó. MySQL se levantó, pero esta suite de interfaz no lo ejercita; Informix y la interfaz nativa de Tauri no se validaron en esta ejecución.
