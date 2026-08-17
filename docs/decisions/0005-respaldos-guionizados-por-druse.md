# ADR 0005 — Los respaldos los guioniza Druse, no las herramientas del motor

- **Fecha:** 2026-08-17
- **Estado:** aceptada
- **Fase:** posterior al MVP (respaldos y restauración)

## Contexto

Se quiere una herramienta de respaldo personalizable: elegir esquemas, tablas y
objetos, y decidir por separado si cada uno se lleva sus datos.

Hay dos formas de construirla, y no son variantes de lo mismo:

1. **Invocar las herramientas nativas** — `pg_dump`, `mysqldump`,
   `BACKUP DATABASE`, `dbexport`.
2. **Generar el guion desde el catálogo** que Druse ya sabe leer en los cuatro
   motores.

La primera da respaldos fieles y restaurables, avalados por el fabricante. Pero
exige que los binarios estén instalados y que su versión encaje con la del
servidor, cada uno se configura distinto, y la personalización queda limitada a
las opciones que sus banderas ofrecen. `BACKUP DATABASE` además escribe en el
disco *del servidor*, no en el del usuario, lo que no encaja con una aplicación
de escritorio que se conecta a máquinas ajenas.

## Decisión

### 1. Druse guioniza; lo nativo queda como adaptador posterior

El respaldo se construye leyendo el catálogo y escribiendo SQL con el escritor de
cada proveedor, tras un puerto `IDatabaseScripter` al lado de `ITableDesigner`.

Se elige así porque:

- **No hay nada que instalar.** La aplicación funciona recién descargada, contra
  cualquier servidor al que ya se conecta.
- **Es lo único que sostiene la selección fina.** «Toda la estructura sin datos,
  salvo estas tres tablas, y de `pedidos` solo el último año» no es un juego de
  banderas de `pg_dump`: es una selección que hay que resolver objeto a objeto.
- **Los cuatro motores se comportan igual** porque el contrato es el mismo, como
  ya ocurrió con el diseñador de tablas.
- **El resultado es legible y versionable.** Un `.sql` se revisa en un diff; un
  volcado binario no.

El contrato deja sitio para un adaptador que delegue en las herramientas nativas
cuando existan, sin que la interfaz ni los casos de uso cambien.

### 2. El guion lo escribe el proveedor, nunca el cliente

`IDatabaseScripter` no acepta SQL ya escrito. Recibe la selección y devuelve las
instrucciones. Es la misma regla que `ITableDesigner`, y por el mismo motivo:
aceptar instrucciones hechas convertiría este camino en una vía para ejecutar
cualquier cosa saltándose el análisis de riesgo (plan §12).

La condición `WHERE` que el usuario escribe por tabla es la única entrada de
texto libre, y pasa por `SqlSafetyAnalyzer` dentro de la consulta que arma Druse.

### 3. Se restaura en el mismo motor del que se sacó

El manifiesto guarda motor y versión de origen, y restaurar comprueba que
coinciden. Si no, se rechaza con su motivo.

Traducir dialectos —tipos, identidad, secuencias, sintaxis de restricciones— es
una función entera por sí sola y con pérdidas inevitables. Prometerla a medias
sería peor que no tenerla: el usuario confiaría en una copia que no es una copia.

El formato del artefacto se diseña, aun así, para no cerrar esa puerta: la
estructura viaja como objetos descritos, no solo como texto SQL ya escrito.

### 4. El artefacto lleva manifiesto versionado

Todo respaldo incluye un `manifest.json` con la versión de Druse, la del propio
formato, el origen, el contenido y **los avisos**: qué tablas se limitaron, qué
columnas se excluyeron, qué garantía de consistencia dio el motor.

El campo de versión de formato existe para que un Druse futuro sepa leer los
artefactos viejos o se niegue con un mensaje claro, en vez de fallar a mitad de
una restauración.

Los avisos van dentro del archivo y no solo en la pantalla que lo generó: quien
encuentra el respaldo medio año después no vio esa pantalla.

### 5. El archivo lo escribe el proceso local, no el navegador

La carpeta se elige con el selector nativo del envoltorio (`IFilePicker`) y el
proceso local escribe ahí por streaming, sin materializar la tabla en memoria ni
pasar el contenido por el navegador.

Bajar un respaldo de varios gigabytes como descarga del navegador lo obliga a
caber en memoria dos veces. En desarrollo, sin envoltorio, se cae a la descarga
con un tope de tamaño declarado.

## Consecuencias

**A favor**

- Funciona sin instalar nada y contra los cuatro motores por el mismo camino.
- La personalización llega hasta la fila y la columna.
- El resultado se lee, se revisa y se versiona.
- La restauración se prueba de verdad: se respalda, se aplica en una base limpia
  y se comparan las estructuras releídas.

**En contra**

- **No hay respaldo binario ni recuperación a un punto en el tiempo.** Esto no
  sustituye a la estrategia de respaldo del servidor, y la interfaz tiene que
  decirlo.
- Cada tipo raro —geometrías, JSON, binarios— es un literal que hay que escribir
  bien en cuatro dialectos. Es donde aparecerán los errores.
- Un respaldo guionizado es más lento y más grande que uno binario.
- La consistencia depende de que el motor dé una instantánea. Donde no la dé, el
  límite se declara en el manifiesto en lugar de disimularse.
