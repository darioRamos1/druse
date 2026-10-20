# ADR 0013 — Planes estimados revisados en el chat

- **Fecha:** 2026-10-19
- **Estado:** aceptada
- **Entrega:** 1.10.0, tercer incremento de la fase E del [plan de contexto](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

Druse todavía no dispone de una API para obtener planes. Incorporar planes al
chat no autoriza al asistente a ejecutar consultas, solicitar métricas reales ni
generar planes con ejecución. El editor ya permite obtener explícitamente un
plan de SQLite con `EXPLAIN QUERY PLAN`.

SQLite devuelve cuatro columnas con identificadores, padre, auxiliar y detalle.
Su documentación advierte que el formato puede cambiar. Interpretar el texto de
los operadores como un contrato estable daría una falsa garantía de compatibilidad.

## Decisión

1. Declarar `aiPlanFormat` en las capacidades del motor. Solo SQLite anuncia
   `sqlite-query-plan`. El shell consulta esa capacidad; ningún componente decide
   por el nombre del motor qué botón mostrar.
2. Ofrecer «Analizar este plan» en un resultado correcto de una ejecución manual
   cuyo SQL comience por `EXPLAIN QUERY PLAN`, con un solo conjunto, columnas
   `id,parent,notused,detail`, identificadores enteros, entre 1 y 200 nodos y sin
   truncamiento. No reconocer comentarios iniciales, lotes con varios conjuntos,
   otros formatos ni salidas distintas. No interpretar el detalle de los operadores.
3. Capturar SQL, fecha, ejecución, conexión, base y versión del resultado, aunque
   el editor haya cambiado después. Exigir el mismo origen activo. La acción abre
   una revisión local, sin llamar a la base ni al modelo. No adjuntar filas reales
   ni añadir automáticamente el SQL que esté ahora abierto en el editor.
4. Permitir editar SQL y texto para excluir información sensible. Identificar
   claramente las copias editables y su origen. Mostrar que el plan es estimado y
   no contiene tiempos ni filas reales. La revisión final de ADR 0010 presenta el
   contenido exacto y el destino antes de confirmar el envío.
5. Añadir `executionPlan` como categoría independiente. Exigir permiso de
   estructura (`schema` o `schemaAndRows`) tanto en interfaz como en servidor.
   Un plan actual o histórico con `nothing` causa 403; un perfil desactualizado
   causa 409. Validar formato, motor, identificador, fecha y texto no vacío también
   en peticiones directas. La API acepta copias editadas; no certifica que un
   cliente arbitrario haya ejecutado realmente el SQL indicado.
6. Contar todo el bloque compuesto en UTF-8 con `MaxPlanBytes`, 16384 por defecto,
   además del contexto, historial y entrada. Comprobar también planes históricos.
   Mostrar `planBytes` y su límite. Un exceso bloquea el envío con 413, aun sin
   vista previa; no recortar el plan automáticamente. El hash incluye su contenido.
7. Congelar la copia revisada en cada turno y reintento. Mantenerla al volver desde
   la revisión, invalidar preparaciones al editar/quitar, y retirarla tras enviar
   o cambiar conexión/base. Consumir la referencia transitoria del shell. Los
   adjuntos de error, filas y plan se sustituyen entre sí al solicitarlos.
8. Tratar SQL y detalle como datos sin autoridad. No habilitar herramientas,
   ejecutar recomendaciones, generar planes adicionales ni inventar métricas.
   Los planes permanecen en memoria con el chat, sin convertirse en notas.

## Uso

En una pestaña conectada a SQLite, ejecutar manualmente, por ejemplo:

```sql
EXPLAIN QUERY PLAN SELECT * FROM clientes WHERE nombre = 'Ana';
```

Pulsar «Analizar este plan» sobre el resultado, revisar las copias, escribir la
pregunta y abrir la revisión final. Solo «Enviar al proveedor» comparte el plan.
Otros motores continúan ofreciendo el selector de muestras cuando corresponde.

## Verificación y límites

Las pruebas cubren reconocimiento conservador, copia inmutable, reintento,
historial, permisos, presupuestos, hash y edición sin envío automático. El
recorrido Chromium utiliza un archivo SQLite sintético y composición real del
servidor; solo se simula la inferencia. El barrido incorpora ambos idiomas, temas
y panel estrecho. Se comprobó SQLite 3.53.3.

TypeScript y guarda de idiomas correctos; 359 pruebas frontend en 18 archivos y
63 de integración de IA/notas correctas. Compilación de producción correcta, con
el aviso conocido del paquete inicial (822,57 kB frente al presupuesto de 500 kB).
Vitest utilizó la configuración local ignorada de `vmThreads` y Web Streams/Fetch
de Node descrita en ADR 0011.

Los 10 recorridos anteriores de tablas, notas, revisión, errores y muestras
pasaron en ambos idiomas. Pasaron también los dos recorridos nuevos de planes y
los dos del barrido específico: 14 recorridos correctos. Se revisaron las seis
capturas del adjunto y la vista previa, en español/inglés, claro/oscuro y ancho
reducido. El barrido restaura el ancho normal antes de volver a los resultados,
porque a 900 px el asistente se presenta como un panel superpuesto.

Quedan pendientes soporte de planes de otros motores, pruebas con proveedores
externos y validación nativa Tauri/WebView2. No se añade generación de planes ni
se cambia la instalación existente durante el desarrollo.

## Referencias

- [SQLite: EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html): finalidad,
  tabla cruda y advertencia sobre cambios de formato.
- [SQLite: EXPLAIN](https://www.sqlite.org/lang_explain.html): diferencia entre
  describir la operación y ejecutar la sentencia subyacente.
