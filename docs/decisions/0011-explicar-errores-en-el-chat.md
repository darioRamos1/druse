# ADR 0011 — Errores de ejecución como adjuntos revisables

- **Fecha:** 2026-10-16
- **Estado:** aceptada
- **Entrega:** 1.8.0, primer incremento de la fase E del [plan de contexto](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

Copiar un error al chat pierde su consulta y procedencia. Leer el editor al pedir
una explicación puede adjuntar otra consulta: la persona suele editarla después
del fallo. Los mensajes de los controladores también pueden contener secretos.

## Decisión

1. Capturar SQL ejecutado, conexión estable, alias de base, motor, versión y fecha
   UTC al iniciar la ejecución. Asociarlos al resultado mostrado y su identificador.
   La acción «Explicar este error» solo aparece en fallos con procedencia conocida
   que corresponda a la conexión y base actuales. Funciona también al ejecutar una
   selección; no reconstruye el SQL a partir del editor ni del subrayado del error.
2. La acción abre un borrador con un adjunto editable. SQL y diagnóstico se pueden
   revisar, ocultar o retirar antes de preparar el envío. El código y las posiciones
   conservan su relación con la ejecución original, aunque el texto se edite. No
   adjuntar el SQL posterior del editor, filas, mensajes adicionales, sesiones,
   rutas de archivos ni perfiles de conexión. Cambiar de base o conexión retira el
   adjunto pendiente. El historial conserva las copias originales de cada turno.
3. Añadir `executionError` como categoría del contexto, con identificador, fecha,
   SQL, mensaje, código, línea y posición. La procedencia es `context.source`.
   Congelar la copia al preparar la pregunta, exigir revisión y confirmación y
   retirarla del siguiente borrador después de enviar. Los datos recibidos del
   controlador y los editados son referencias, nunca instrucciones ni herramientas.
4. Aplicar `AiErrorRedaction` en el servidor tanto al adjunto actual como al
   histórico, antes de componer el texto, medirlo, mostrarlo o enviarlo al proveedor.
   Quitar líneas con parámetros reconocibles de conexión, URI de motores/JDBC,
   cabeceras de autorización y credenciales en formatos clave/valor, JSON y SQL.
   El filtro omite líneas enteras cuando encuentra una cadena de conexión: puede
   perder detalle útil, que se ve en la revisión. Si agota su tiempo, oculta el
   diagnóstico completo. No basta para detectar todo dato sensible; la interfaz
   exige revisar el texto final. SQL y errores pueden contener valores privados.
5. Reutilizar el permiso de contexto: `nothing` excluye errores actuales e
   históricos; `schema` y `schemaAndRows` admiten este adjunto explícito. La pantalla
   bloquea preparar mientras haya un error adjunto y el permiso sea `nothing`.
   El servidor verifica la configuración vigente en cada envío/reintento. Revocar
   permisos cambia la conversación y evita reutilizar respuestas anteriores.
6. Añadir `MaxErrorBytes`, 16384 bytes UTF-8 por defecto, a `AiChat:Defaults` y a las
   políticas por proveedor descritas en ADR 0010. Exponer `errorBytes` y su límite
   en la revisión. También cuenta en contexto, historial y entrada. Comprobar cada
   adjunto histórico, bloquear con 413 los excesos y exigir nueva revisión con 409
   si cambia el adjunto respecto al hash. No recortar diagnósticos por tamaño.

## Consecuencias y alcance

El borrador, la petición original y los recibos permanecen en memoria junto a la
conversación. La petición local puede contener el diagnóstico sin limpiar; el
texto confirmado por el servidor es el que recibe el proveedor. No se registra ni
persiste el adjunto en notas o archivos. El origen capturado y la lista explícita
de campos evitan transportar credenciales del perfil. La limpieza del diagnóstico
es una segunda barrera para secretos que haya incluido el controlador o la persona.

No se ejecuta SQL desde el chat. Adjuntar filas con selección, ocultación de
columnas y permiso de datos, y adjuntar planes de ejecución siguen pendientes.

## Validación

Pruebas de contrato servidor para permisos, filtrado actual e histórico,
procedencia, coincidencia exacta entre revisión y proveedor, hash y límites sin
vista previa. Pruebas frontend de edición, confirmación, retirada al cambiar de
base, revocación, copia inmutable y reintento. Recorrido Chromium con consulta
fallida real en SQLite y composición real del servidor; se simula únicamente la
respuesta de IA. Capturas en español e inglés, temas claro/oscuro y panel estrecho.
El barrido general incluye el nuevo adjunto. Otros motores y el recorrido nativo
Tauri/WebView2 quedan sin comprobar en esta entrega.

Resultado: 343 pruebas frontend en 16 archivos, 35 de integración de IA/notas y
8 recorridos E2E correctos. TypeScript, guarda de idiomas y compilación de
producción correctos; continúa el aviso previo del paquete inicial superior a
500 kB. Vitest se ejecutó con `vmThreads` y los objetos Web Streams/Fetch de Node
en la configuración local ignorada, por el fallo de arranque de workers en este
entorno Windows. No se cambiaron dependencias ni la configuración del repositorio.
