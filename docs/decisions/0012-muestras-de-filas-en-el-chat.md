# ADR 0012 — Muestras de resultados con selección y ocultación explícitas

- **Fecha:** 2026-10-19
- **Estado:** aceptada
- **Entrega:** 1.9.0, segundo incremento de la fase E del [plan de contexto](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

El chat puede explicar errores, pero todavía no puede analizar una muestra de
resultados. Adjuntar la cuadrícula completa expondría columnas privadas y podría
superar la capacidad del proveedor. La selección para borrar filas y los filtros
visuales tienen otra finalidad y no constituyen consentimiento para compartir.

## Decisión

1. Ofrecer «Analizar estas filas» en un resultado correcto con procedencia
   conocida y correspondiente a la conexión/base actual. Capturar el conjunto
   visible, identificador de ejecución, fecha y origen; cambiar el editor después
   no cambia la procedencia. Abrir un selector local con cero filas y columnas
   elegidas. No adjuntar automáticamente SQL, filas, perfiles ni sesiones.
2. Elegir en el chat, independientemente de la selección, filtros y orden de la
   cuadrícula. Paginar de diez en diez en el orden original de la ejecución;
   mostrar una vista local abreviada de hasta tres columnas. No consultar más
   filas ni cargar contenido adicional. Avisar si el resultado alcanzó su límite
   de lectura: la muestra solo describe lo ya cargado, no toda la consulta.
3. Permitir excluir columnas por completo o compartir su nombre/tipo con valores
   ocultos. Una columna excluida no aporta ni metadatos ni valores al envío. Una
   celda oculta no aporta valor ni tamaño original. Omitir el contenido de las
   columnas binarias sin recorrerlo ni decodificarlo, incluidos sus posibles
   nulos. No inferir que un valor omitido equivale a un nulo.
4. Usar celdas tipadas: `text`, `null`, `masked`, `binary` y `truncated`. El texto
   vacío es distinto de `null`. Conservar como texto los valores numéricos del
   contrato de resultados para evitar pérdida de precisión. Identificar columnas
   por ordinal y filas por índice de origen, ambos desde cero; admitir nombres
   repetidos de columnas con ordinales distintos.
5. Admitir hasta 50 filas y 32 columnas elegidas. Para textos de más de 1024 bytes
   UTF-8, calcular un prefijo sin partir caracteres y mostrar el tamaño original.
   Contar sin crear otra copia completa en memoria. Exigir aceptar los recortes
   antes de preparar el envío y restablecer esa aceptación si cambia la selección.
   La abreviación de 96 caracteres en la tabla local es solo presentación; la
   vista previa final muestra el contenido exacto que se comparte.
6. Añadir `rows` al contexto de la pregunta, con procedencia, conjunto, número de
   filas disponibles, límite de lectura y selección saneada. Congelar una copia
   profunda al preparar la revisión. Mantener la selección al volver a editar o
   ajustar historial; quitarla al cambiar de conexión/base o después de enviar.
   Cambiar una selección mientras se prepara invalida esa revisión. Cada turno y
   reintento conservan su propia copia. La muestra no se convierte en una nota.
   Presentar el selector en la zona central desplazable del chat para mantener
   visibles la pregunta y su botón de revisión. Consumir la referencia transitoria
   del shell: quitar o enviar el adjunto no debe retener un resultado anterior allí.
7. Exigir `schemaAndRows` en la interfaz y en el servidor. Una muestra actual o
   histórica con otro permiso causa 403; no eliminarla silenciosamente dejando
   respuestas derivadas de datos. Un perfil cambiado respecto a la petición causa
   409. Las conversaciones se separan por permiso y destino, según ADR 0007.
   Cambiar de permiso no borra lo ya recibido por el proveedor.
8. Validar también peticiones que eludan la interfaz: dimensiones, índices únicos
   y válidos, estructura rectangular, tipos de celda, límites UTF-8 y aceptación
   del recorte. Prohibir `value`/`originalBytes` en celdas ocultas, binarias y nulas.
   Rechazar con 400 una muestra mal formada antes de llamar al modelo.
9. Añadir `MaxRowsBytes` a las políticas de ADR 0010, con 32768 bytes por defecto,
   y `rowsBytes` a la revisión y recibo. Medir el texto compuesto en UTF-8, no solo
   valores o filas. Contabilizar también contexto, historial, entrada y reservas.
   Un exceso bloquea con 413 aun sin vista previa; cambiar la muestra tras revisar
   cambia el hash y exige nueva revisión. No recortar filas ni columnas por tamaño.

## Consecuencias

La muestra viaja como JSON tipado dentro de una sección de datos de referencia,
sin autoridad para cambiar instrucciones ni ejecutar SQL. La persona debe revisar
valores y proveedor; el permiso de filas no sustituye esa revisión. Se muestran el
tamaño JSON de la selección local y el tamaño exacto del texto compuesto final.

Los resultados originales permanecen locales. Solo los valores elegidos y
ocultados forman parte de la copia del turno, que vive en memoria con la
conversación. No se guarda la muestra en notas, archivos o registros. Un proveedor
sin permiso de datos no puede recibirla por la vía de adjuntos ni por su historial.
El texto que una persona escriba por su cuenta sigue siendo su pregunta explícita.

Los planes de ejecución siguen pendientes. No se habilitan herramientas para
ejecutar consultas, generar planes con ejecución ni solicitar filas adicionales.

## Validación

Pruebas de selección vacía, exclusión sin leer valores, binarios, ocultación,
precisión numérica, UTF-8, nulos, vacíos, límites, permiso, copias inmutables y
reintentos. Contrato de servidor con peticiones directas, historial, hash,
revocación y presupuestos. Recorrido Chromium con SQLite real y composición real
del servidor, simulando únicamente la respuesta de IA. Capturas en español/inglés,
claro/oscuro y ancho reducido; el barrido general incorpora el selector.

Otros motores de servidor, proveedores externos y Tauri/WebView2 quedan sin
comprobar en esta entrega. La instalación existente no se modifica al desarrollar.

Resultado: 352 pruebas frontend en 17 archivos, 55 de integración de IA/notas y
10 recorridos E2E correctos. TypeScript y guarda de idiomas correctos. Compilación
de producción correcta, con el aviso conocido del paquete inicial superior a
500 kB (819,14 kB). Se revisaron las capturas del selector y de la revisión en ambos
idiomas y temas. Vitest utilizó la configuración local ignorada de `vmThreads` y
objetos Web Streams/Fetch de Node descrita en ADR 0011.
