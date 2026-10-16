# ADR 0008 — Contexto del chat a partir de una selección explícita del catálogo

- **Fecha:** 2026-10-16
- **Estado:** aceptada
- **Entrega:** 1.5.0, fase B del [plan de contexto del chat](../planes/plan-contexto-chat-2026-10-16.md)

## Contexto

El chat elegía hasta 40 relaciones conocidas del explorador y cargaba sus
columnas al abrirse. Esto no permitía controlar qué tablas compartir ni
incorporaba claves foráneas o índices. El índice del autocompletado no es el
contrato adecuado para describir restricciones compuestas de una tabla.

## Decisión

1. `AiCatalog` mantiene una selección por conexión y base, independiente de la
   expansión del explorador y del proveedor de IA. El botón, las menciones `@`
   y el menú del explorador incorporan objetos a la misma selección.
2. El selector recorre los nombres del catálogo usando `getDatabases` y
   `getChildren`, con control de ciclos y cancelación al cambiar de origen.
   Solo los objetos elegidos usan `getColumns` y, si son tablas,
   `getTableStructure`. Las vistas únicamente leen sus columnas.
3. Conservar nombres exactos de conexión, base, esquema, objeto y clase en la
   identidad. Escapar identificadores en la descripción SQL. No recortar una
   selección explícita ni las columnas de una clave compuesta.
4. Usar restricciones e índices declarados por el motor. Las tablas destino de
   claves foráneas son sugerencias, sin expansión automática ni inferencia por
   nombres de columnas.
5. Invalidar al reconectar y al refrescar el catálogo del explorador, incluido
   el refresco del diseñador. Releer la selección antes de cada pregunta para
   recoger también cambios de DDL hechos fuera de Druse. El resultado de una
   lectura pertenece a la sesión y revisión que la inició.
6. Si cambia la base, la selección o la sesión durante la preparación, conservar
   el borrador y abortar el envío. Un error descarta el detalle antiguo del
   objeto. Enviar el resto requiere aceptar explícitamente el contexto parcial;
   el asistente recibe un aviso que identifica las estructuras ausentes.
7. Conservar la versión real recibida al abrir la sesión. Para motores cuya
   capacidad `usesFilePath` es verdadera, resolver la ruta al alias único del
   catálogo cuando sea inequívoco; si hay varios, exigir una base identificable.
   Los componentes no se ramifican por nombre de motor.

## Consecuencias y límites

La selección se conserva en memoria al cerrar el panel o cambiar de base,
pero no sobrevive a cerrar Druse. Persistir conocimiento de negocio corresponde
a la fase C. Los límites de tamaño e historial corresponden a la fase D.

El formato de contexto es una descripción de metadatos para el modelo, no DDL
destinado a ejecutarse. No incluye filas ni habilita ejecución automática.
Ante un catálogo parcialmente inaccesible se muestran los objetos disponibles
y el error de la rama; no se afirma que la lista esté completa.
