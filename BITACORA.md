# Bitácora de seguimiento — Druse

> Documento vivo. Se actualiza **al final de cada sesión de trabajo**.
> El plan maestro (alcance, arquitectura, fases) vive en `PLAN_TRABAJO_DRUSE.md`.
> Esta bitácora responde solo a tres preguntas: **qué se hizo**, **en qué estado quedó** y **qué toca retomar**.

---

## 1. Estado actual

| Campo | Valor |
| --- | --- |
| Última sesión | **056** — 2026-09-11 |
| Fase activa | **Migración de datos entre tablas:** fases 1, 2 y 3 cerradas; la **4** cerrada: la pasada de varias tablas, lo que cada tabla hace distinto y las migraciones guardadas (ver «Qué toca retomar»). **Respaldos y restauración:** Fases A–E cerradas. La **F** tiene backend, interfaz, CSV, selector de archivos, restaurar en una base nueva y **el ciclo entero por HTTP en los cuatro motores**; le falta repetir a mano el respaldo real que encontró el error de los índices de expresión. **Motores nuevos:** plan escrito (`docs/plan-nuevos-motores.md`), **fase 0 cerrada** en la 048 —las fugas de dialecto que se le escapaban a un motor nuevo— **fase 1 cerrada** en la 049 —Oracle— y **fase 2 cerrada** en la 050 —SQLite—. El plan de motores nuevos queda cerrado: **seis motores sobre el mismo contrato**; en la **052** se cerró lo que SQLite dejaba declarado y sin resolver —la reconstrucción de una tabla ya no se lleva sus disparadores, sus condiciones, las vistas que la miraban ni las filas de las tablas hijas—, en la **053** que tampoco rompa a las tablas que la referencian, y en la **054** que **lo rechazado se pueda ir a ver**: con el motivo viaja la consulta que enseña las filas culpables, y en la **055** lo que le quedaba a Oracle —**un guion con varias instrucciones se ejecuta entero**, que era trabajo de Druse y no del proveedor— más las pruebas que el plan pedía en su §9, que destaparon el aviso de fechas que le faltaba a SQLite. **Diagramas entidad-relación:** plan escrito y **Fase A** (lectura del catálogo en lote, cuatro motores) y **Fase B** (colocación determinista y lienzo) implementadas; falta cerrar la A contra los cuatro motores y ver el barrido de capturas |
| Fases 0–6 | ✅ Cerradas. |
| Fase 7 | 🟡 **11/12.** El ciclo de instalación está probado sobre este equipo; solo falta arrancar en una máquina sin herramientas de desarrollo. |
| Fase 8 | ✅ **7/7.** Tres motores sobre el mismo contrato y primera beta preparada. |
| ¿Compila el backend? | Sí — 0 advertencias, 0 errores |
| ¿Compila el envoltorio? | Sí — recompilado en la 037 con `build/scripts/msvc-env.ps1` cargado antes; sin él, `cargo` falla en `vswhom-sys` por elegir el MSVC equivocado. **Sus pruebas ya son 17**, con las dos que vigilan la CSP y las cuatro de `DRUSE_DATA_DIR` |
| ¿Pasan las pruebas? | En la **056**: **las 54 del contrato de SQLite en verde por primera vez**, y con los seis motores delante —Informix levantado— **394 de 395 contractuales**, **653 unitarias**, **182 de integración** y las **3 de SQLite de punta a punta**. El único rojo es el `DATE` de Informix por SQLI de la 039, que no es de este trabajo y por fin se pudo reproducir. En la **055**: **653 unitarias**, **182 de integración** y las **2 de Oracle de punta a punta** en verde, y **389 de 395 contractuales**. Los seis rojos son de SQLite y **son hallazgos, no regresiones**: su fixture llevaba desde la 050 diciendo que el motor no respondía —una reentrada en su propio `Lazy`— y sus 54 pruebas se saltaban enteras. Arreglado eso, se vio además que **la cancelación no cortaba nada** (285 s con un plazo de 1 s). El frontend no se tocó y su suite no se repitió. En la **054**: **602 unitarias**, **388 contractuales**, **182 de integración** —con los cuatro contenedores levantados— y las **3 de SQLite de punta a punta**, que son las que ven el rechazo por donde se usa. Del frontend, **933 de 936** en la segunda pasada: tres rojos por tiempo —`app`, `query-builder` y `results-grid`—, cuatro en la primera, y **los cuatro archivos verdes al ejecutarlos solos**, `table-designer` incluido. En la **053**, el backend entero sí: **597 unitarias**, **388 contractuales**, **180 de integración**, sin advertencias de compilación, y **las 61 de punta a punta (1 saltada, el barrido)**. El **frontend dio 922 de 932**, todas por tiempo agotado en montajes pesados y con la suite tardando el doble que ayer: la máquina tenía los cuatro contenedores, Druse abierto y ~4 GB libres de 16. La 053 **no toca frontend**, y esa misma suite salió entera en verde en la 052. El barrido no se repitió: esta sesión no cambia nada que se vea. En la **052**: **594 unitarias**, **388 contractuales** —las 54 de SQLite entre ellas—, **180 de integración**, **932 del frontend**, **61 de punta a punta** (1 saltada, el barrido) y el **barrido limpio**, sin errores de consola y sin advertencias de compilación. Esas cuentas del frontend y del e2e incluyen las pruebas de los tres commits de interfaz que el usuario metió en `main` durante la sesión. En la **051**: **571 unitarias**, **180 de integración**, **914 del frontend**, **56 de punta a punta** y el barrido limpio. En la **050**: **388 contractuales** —las 54 de SQLite entre ellas—, **567 unitarias**, **177 de integración**, **914 del frontend** y la **suite de punta a punta entera (56)**, con el barrido limpio. En la **049**: **334 contractuales** —las 280 de antes más las 54 de Oracle— contra PostgreSQL, MySQL, SQL Server y Oracle reales; **567 unitarias**, **177 de integración**, **913 del frontend**, la **suite de punta a punta entera (55)** y el **barrido** limpio. En la **048**, las cuatro suites del repositorio: **565 unitarias**, **177 de integración** y **279 contractuales** con PostgreSQL, MySQL y SQL Server levantados —Informix no—, **913 del frontend**, **35 de punta a punta** y el **barrido entero** con la consola limpia y ningún hallazgo. Los rojos del camino fueron de tiempo, distintos en cada pasada y verdes al ejecutar su archivo solo. `docs/api/openapi.json` no cambió: `/api/engines` no declara el cuerpo de su respuesta, así que ampliar su DTO no toca el contrato publicado. En la **047**: **859 del frontend** —las 815 de siempre más 44 de las piezas que salieron de `WorkspaceStore`— y la **suite de punta a punta entera en verde**: 52 pasadas, 1 saltada, 0 fallos, contra PostgreSQL y SQL Server reales. Los rojos que salieron por el camino eran de tiempo, en el frontend, y de **servidores de e2e levantados desde la sesión anterior**, que `reuseExistingServer` reutiliza. En la **046**: **740 del backend** —563 unitarias y las 177 de integración, con PostgreSQL, MySQL y SQL Server levantados—, **815 del frontend** y el **barrido entero** con la consola limpia y un solo hallazgo, que no es un defecto. Del e2e, 43 en verde; las cuatro de SQL Server esperaban a su contenedor, que se levantó en esta sesión. Las **23 del envoltorio** son de la 042 y siguen valiendo. Las contractuales salen verdes **sin los motores delante**: sin `DRUSE_REQUIRE_ENGINES=1` cada prueba termina sin comprobar nada cuando el servidor no responde. El `DATE` de Informix por SQLI de la 039 sigue sin repetirse: hace falta ese contenedor |
| ¿Hay aplicación de escritorio? | **Sí.** Instalador NSIS y ZIP portable, en dos variantes: con Informix y sin él. Desde la 038 **se actualiza sola** —o lo hará: ver el aviso del repositorio privado en §9—. El MSI dejó de generarse: `tauri.conf.json` solo declara `nsis`, que es lo que necesita el actualizador. En la **040** se regeneraron los instaladores y **la variante completa quedó instalada y abierta en este equipo**, con el arreglo del envoltorio dentro. Siguen **sin firma Authenticode**: SmartScreen en cada equipo |
| Motores | **PostgreSQL, SQL Server, MySQL/MariaDB, Oracle, SQLite e Informix**, sobre el mismo contrato. Desde la **048** cada uno declara sus `EngineCapabilities` y **un motor nuevo no compila hasta decir qué familias de datos guarda**; lo siguiente es Oracle, con el plan en `docs/plan-nuevos-motores.md` y el procedimiento en `docs/como-anadir-un-motor.md`. Informix tiene **dos entradas**: por DRDA con el driver de IBM (puerto 9089) y por **SQLI**, su protocolo nativo, con el puente JDBC (9088). Cambia por dónde se entra; el SQL, el catálogo y los tipos son los mismos |
| Trabajo a medias | **Nada sin commitear.** `PLAN_MEJORAS_DRUSE.md` lleva marcadas las fases 0 a 5 salvo lo grande —**FE-001 y FE-002 cerradas en la 047**: `WorkspaceStore` partido en seis piezas—, FE-003, BE-001, BE-002, A11Y-005 más BKP-006, SEC-007, PERF-004 y PERF-005. Sin comprobar: las contractuales de la lectura en lote contra los cuatro motores desde la 039, **el multicursor dentro de la ventana empaquetada**, y de antes —**el diálogo del sistema y el selector de carpeta siguen sin verse abrir**, y **el actualizador no puede funcionar mientras el repositorio sea privado** (ver §9) |
| Bloqueantes | Ninguno para seguir programando. Sí para dar por buenos cuatro motores y cuatro funciones: ver «Qué toca retomar». |
| Git | El **PR #9 se fusionó** (sesión 022). Se trabaja en `feat/respaldos-y-restauracion`, con todo subido: las 024–027 en `1452a6c`, las 028–031 en `640151c`, las 032–036 de `d3ac0d5` a `35d192e`, la 037 de `4ba8cce` a `20727eb`, la **038** en `a455be7`, `4c6f74a`, `55711f0` y `93f7f26`, la **039** hasta `5c2d09b`, y la **040** en `80da9f6`, `03c3478`, `a04c706`, `117b15f`, `2946156` y `2d52c8e`, la **041** en `64c2adf`, `203b771`, `6d31a86`, `5a924c6`, `8bcf83a`, `f4f683e` y `f65cd73`, la **042** en `0ae38fa`, `120485f`, `2a6f151` y `837cbb6`, la **043** de `ebf42ac` a `fd9432d`, la **044** de `7e60185` a `e98422e`, la **045** de `dc7b97e` a `ba3d866`, y la **046** de `c9de27f` a `90e03c7`, ya sobre `main`, y la **048** en `3509bb7`, `5d337cc`, `0c5507f`, `a04af7d` y `de80c8a`, y la **049** en `52efd09`, `eee2656`, `84a84d2`, `148adb1` y `be3a27d`, y la **050** en `10c8349`, `d6e8cd2`, `f03f3b8`, `8744c9e`, `9372132` y el de la documentación, y la **054** en `5f70c41`, `ad0af20`, `6226acb`, `0382018` y el de la documentación |
| Integración continua | 🔴 **Parada, y no por el código.** GitHub aborta los jobs en dos segundos: «recent account payments have failed or your spending limit needs to be increased». Hasta resolver la facturación, ningún PR podrá pasar los checks. Lo que sí cambió en la **041**: cuando vuelva a correr, **ejecutará pruebas de verdad** —hasta ahora el job del backend terminaba en verde sin ejecutar ninguna—, y publicar exige que el commit tenga su ejecución de CI en verde. |

### Qué toca retomar en la próxima sesión

#### Lo primero, desbloquear el actualizador

**El repositorio es privado y el actualizador apunta a sus Releases**, así que
hoy no puede funcionar en ningún equipo: GitHub devuelve 404 a quien no está
autenticado, y ese 404 ni siquiera se distingue de «no hay versión nueva». Es
una decisión que hay que tomar antes de repartir nada: repositorio público, o
publicar los artefactos en otro sitio.

#### Lo que deja abierta la 056

1. **El `DATE` de Informix por SQLI**, que por fin se reprodujo: un `INSERT` con
   `'2026-08-17 00:00:00'` en una columna `DATE` da «String to date conversion
   error», y por DRDA la misma prueba pasa. Es el respaldo de datos, así que hoy
   **un respaldo de Informix por SQLI no se puede volver a cargar** si lleva
   fechas. El contenedor quedó levantado: se puede atacar ya.
2. **Merece la pena mirar las otras fixtures como se miró la de SQLite.** Aquella
   llevaba desde la 050 diciendo que el motor no respondía y nadie lo vio, porque
   sin `DRUSE_REQUIRE_ENGINES=1` eso es una suite verde.
3. **La consulta de diagnóstico sigue siendo solo de SQLite.** Es lo que ya decía
   la 054 y no ha cambiado: el `Diagnostic` es del contrato, y PostgreSQL, MySQL,
   SQL Server y Oracle rechazan por lo mismo sin decir dónde mirar.
4. **De Oracle quedan los dos que no son trabajo de Druse**: ODP.NET no expone el
   desplazamiento del error de sintaxis, y los procedimientos que viven dentro de
   un paquete no salen en el árbol.
5. **La integración continua sigue sin verse correr.** `DRUSE_REQUIRE_ENGINES=1`
   está puesto desde hace tiempo y nadie lo ha visto fallar ni pasar, porque
   GitHub aborta los jobs por la facturación.

_Cerrados en la 055: el guion con varias instrucciones de Oracle, las pruebas de
cadena de conexión de los dos motores nuevos, las del traductor de tipos de
SQLite y el aviso de fechas que faltaba._

#### Lo que deja abierta la 054

1. **La consulta se ofrece solo donde se sabe escribir, que hoy es SQLite.** El
   `Diagnostic` es del contrato, no del motor: PostgreSQL, MySQL, SQL Server y
   Oracle rechazan por lo mismo —una condición que los datos incumplen, una columna
   que deja de admitir nulos— y ahí el aviso sigue sin decir dónde mirar. Es el
   mismo trabajo, motor a motor, y el sitio ya existe.
2. **El botón cierra el diseñador, y con él lo que hubiera escrito sin aplicar.**
   Es la decisión que se tomó —la pestaña queda detrás del diálogo— pero quien
   estaba a mitad de un cambio grande lo pierde. Vale la pena verlo con alguien
   delante antes de darlo por bueno.

_Cerrados en la 054: la consulta que enseña las filas, la medición de las dos
comprobaciones y la carrera del registro de trabajos._

#### Lo que deja abierta la 052

1. **Las condiciones de comprobación se escriben desde el diseñador**, y eso es
   nuevo en SQLite: conviene probarlo a mano, con la aplicación delante, contra un
   archivo con datos de verdad. El mensaje que sale cuando los datos no cumplen ya
   está cubierto por pruebas desde la 053.

#### Lo que deja abierta la 051

1. **Pulsar los dos botones nuevos dentro de Druse instalado.** El diálogo del
   sistema es una ventana modal y ninguna prueba puede conducirlo; lo demás está
   cubierto, pero esto hay que mirarlo con la aplicación empaquetada delante.
2. **Lo que cada motor deja declarado y sin resolver**, en los §7 y §8 del plan:
   de Oracle, el lote de varias instrucciones —que es una función de Druse y no
   del proveedor—, la posición del error de sintaxis y los paquetes en el árbol.
   **Lo de SQLite se cerró en la 052.**
3. **La compilación ligera podría dejar fuera más que Informix.** Con seis
   motores, `IncludeInformix` se queda corto como idea: quien solo usa SQLite y
   PostgreSQL carga hoy con los clientes de Oracle, SQL Server y MySQL. Medir
   antes de decidir.
4. **El contenedor de Oracle tarda**: dos minutos la primera vez. SQLite no
   necesita ninguno.

#### Lo que deja abierta la 047

1. **`AppShell`** (FE-003), con sus 1.488 líneas: extraer la coordinación de
   diálogos y comandos. Es lo mismo que se acaba de hacer con el almacén, y el
   patrón vale igual: dejar la plantilla llamando a lo de siempre.
2. **De la fase 7 quedan tres**: UX-006 y UX-010 son decisiones que hay que ver
   con alguien delante —si la base debe decirse dos veces a pantalla ancha, y si
   el aviso de trabajos interrumpidos sube de sitio— y **UX-007** sí es trabajo:
   cuatro filas de cromo antes del SQL dejan seis líneas de editor en una
   pantalla de 720 px.

#### Lo que deja abierta la 045

1. **A11Y-005**, que no es programar: navegar Druse entero con lector de pantalla.

#### Lo que deja abierta la 044

1. **PERF-004 y PERF-005**: medir la memoria de una exportación XLSX grande, y
   revisar el turno por sesión para que un respaldo largo no congele la
   navegación.
2. **La fase 7 del plan**, recién escrita: nueve cosas de interfaz vistas en las
   capturas y ninguna arreglada todavía.
3. **Las fases 5 y 6**: contrato HTTP y accesibilidad, y distribución.

#### Lo que deja abierta la 043

1. **SEC-007**: elegir la CA y el certificado de cliente de una conexión. Hoy
   `VerifyCA` y `VerifyFull` validan contra el almacén de confianza del sistema,
   que no sirve para una CA propia.
2. **Las fases 4 a 6 del plan de mejoras**: observabilidad y límites de recursos,
   contrato HTTP y accesibilidad, y distribución.

#### Lo que deja abierta la 042

1. **El aviso al cerrar, en la aplicación instalada.** Se vio salir en la ventana
   de `cargo tauri dev`, que es el mismo WebView2; el instalador no se ha
   regenerado con esto dentro.
3. **El apagado ordenado contra la API empaquetada.** Al probarlo, la de
   `shells/desktop-tauri/api` era anterior a la ruta y contestó 404: hay que
   volver a publicarla ahí para que el camino bueno se ejerza de verdad.

#### Lo que deja abierta la 041

1. **El `DATE` de Informix por SQLI** (BKP-006 del plan de mejoras): el único
   rojo de las contractuales de la 039, y reproducirlo necesita ese contenedor.
2. **La fase 2 del plan de mejoras**: cerrar Druse durante un respaldo o una
   restauración sigue sin preguntar nada, y los trabajos largos no sobreviven a
   un reinicio ni se marcan como interrumpidos.
3. **La carpeta de destino, vista en la aplicación empaquetada.** La casilla de
   sobrescribir se comprobó en Chromium con el barrido; el selector de carpeta
   del sistema sigue sin verse abrir, que es lo de siempre.

#### Lo que deja abierto la 040

Dos comprobaciones y una decisión:

1. **Los cursores múltiples, dentro de la ventana empaquetada.** La prueba de
   punta a punta corre en Chromium; el WebView2 no se ha probado, y es la clase
   de cosa que aquí ya ha fallado solo empaquetada.
2. **Los atajos nuevos, en uso real.** `Alt+←` es «atrás» en muchos programas y
   `F5` es «recargar» en el navegador: si alguno estorba, qué tecla significa
   qué está en `core/shortcuts/shortcuts.ts` y moverlo es un renglón y su
   prueba.
3. **La firma Authenticode.** Los instaladores se regeneran e instalan bien,
   pero sin firma cada equipo enseña SmartScreen.

#### Y ver abrirse el diálogo del envoltorio

Sigue de la 037: el puente con el proceso Rust estaba cortado y ya no lo está,
pero **el diálogo del sistema no se ha visto abrir**. Empaquetar, exportar un
resultado y comprobar que aparece el selector de Windows. Lo mismo con el de
carpeta de los respaldos.

#### Informix por SQLI: lo que le falta

Funciona y pasa 49 de las 51 del contrato, pero:

1. **Nadie ha conectado a un Informix de verdad por ahí.** Lo probado es el
   contenedor; el servidor que motivó todo esto es de un tercero. Hasta que
   alguien lo abra, lo que hay es una función comprobada contra un laboratorio.
2. **El código de error** llega como el del driver (`-79716`) en vez del de
   Informix (`-201`).
3. **Una prueba de respaldo** falla sin diagnosticar.
4. **El peso y la licencia**, en §9.

#### Los tres temas del árbol ya están anotados

Quedaron descritos en la entrada «036b» de §5. **Ninguno se ha verificado a mano
en la aplicación levantada**: lo que los cubre son sus pruebas.

La validación general de motores **ya está hecha** (037): los cuatro levantados y
802 pruebas en verde sin ninguna omitida.

#### El plan visual queda cerrado (sesión 024, revalidado en la 026–027)

No queda nada de él: los diez hallazgos de §3 y los cuatro puntos del editor
están hechos y ahora tienen regresiones donde faltaban, incluidos los cuatro que
quedaban —el degradado de las listas, la barra del editor en una fila a 900 px,
el ancho inicial de las columnas sacado de los valores y los **fragmentos
guardados**—. El detalle está en
`docs/plan-mejoras-visuales.md` y en la entrada de §5.

Dos cosas quedan dichas, ninguna bloqueante:

1. **Con una transacción abierta, la barra del editor vuelve a envolver a 900 px.**
   Es a propósito: Commit y Rollback son las dos palabras que no puede sustituir
   ningún icono.
2. **Los contenedores de prueba habían desaparecido.** `docker ps -a` salió vacío
   y con ellos se fue el escenario sembrado en la 022g. PostgreSQL se volvió a
   levantar, pero **`druse_test` viene limpia**: hay que resembrarla antes de
   retomar la comprobación de perfiles de respaldo, y volver a levantar SQL
   Server, MySQL e Informix antes de dar por buena una pasada con
   `DRUSE_REQUIRE_ENGINES=1`.

#### Migración de datos: la fase 4 está cerrada

Quedan tres cosas menores, ninguna bloqueante:

De la migración **no queda nada pendiente**: las cuatro fases están cerradas y
comprobadas de punta a punta, incluidas cinco direcciones entre motores contra
servidores de verdad.

Lo único que se dejó fuera a propósito está escrito en el plan: **vaciar y cargar
en pasada** —vaciar exige escribir el nombre de cada tabla, y con seis marcadas
serían seis confirmaciones— y **crear en el destino las tablas que faltan** desde
la pasada, que se hace de una en una porque es una decisión con tipos y clave
primaria.

El plan completo, con el porqué de cada decisión y lo aprendido en las cuatro
fases, está en `docs/plan-migracion-de-datos.md`.

#### Respaldos: lo que le falta a la Fase F

Ya solo una cosa:

1. **Repetir a mano el respaldo grande que falló** (sesión 022l): el de
   `empresa_estado_financiero`, ahora que los índices sobre expresiones se
   guionizan. Es el único caso real que ha pasado por la pantalla de punta a
   punta, y encontró un error que ninguna prueba veía. **No se puede hacer desde
   aquí**: esa base no está en los contenedores, es de un servidor propio.

Los otros dos puntos se cerraron en la sesión 022m. El ciclo entero
—respaldar, inspeccionar, aplicar y comprobar— corre por HTTP en los cuatro
motores, y con él la base nueva y el rechazo de la que ya existe. De paso destapó
que en MySQL e Informix el respaldo **perdía la estructura de todas las tablas**,
y que en MySQL restaurar «en otra base» escribía en la de origen: los dos
arreglados y con prueba.

Lo demás de la Fase F está hecho: `RestoreService`, la inspección del artefacto,
el rechazo por motor y versión de formato, la vista previa de lo que se ejecuta y
lo que se sobrescribe, el progreso, la parada con reanudación desde la
instrucción que falló, y **los datos en CSV**.

**Ojo: el escenario de pruebas ya no está.** En la sesión 024 `docker ps -a`
salió vacío y el contenedor se volvió a crear desde cero, así que **todo lo que
sigue hay que resembrarlo**. Se deja escrito porque describe el caso que hace
falta reconstruir. En
`druse-pg-test` quedó el esquema `tienda` de la sesión 022g: `cat_paises`,
`cat_monedas` y `cat_estados_pedido` con 4, 4 y 5 filas —los catálogos que sin
datos no sirven—, `clientes`, `pedidos`, `pedido_lineas` y `facturas` con 10.000
filas de «producción», y `movimientos` con tres millones para ver el progreso con
calma. Está en `druse_test` y su copia restaurada en `druse_test_secondary`, y en
la aplicación hay una conexión guardada, **«Contenedor de pruebas»**, apuntando al
puerto 55440. Es exactamente el caso del §1 y sirve tal cual para probar los
perfiles: guardar uno, reabrirlo y comprobar que reproduce el mismo respaldo.

Ojo a una cosa al reconciliar: si se quiere probar un perfil que nombra tablas
desaparecidas, `movimientos` es la que se puede borrar sin tocar el caso del §1.

Lo que sigue sin verse funcionar de los respaldos es **el selector nativo de
carpeta**. Dos cosas que esta bitácora daba por ciertas eran falsas: que aquí no
se puede compilar Rust —sí se puede, cargando antes `build/scripts/msvc-env.ps1`—
y que el diálogo estaba «sin probar». En la 037 se vio el motivo de verdad: la
CSP del envoltorio no dejaba pasar `ipc.localhost`, así que **cada `invoke` moría
en silencio** y ese diálogo no podía abrirse de ninguna manera. Está arreglado y
la consola ya no da errores, pero **abrirse, todavía no se le ha visto**. Fuera
del envoltorio la ruta se escribe a mano y el respaldo funciona igual.

Y dos detalles anotados en el plan de la función, ninguno urgente: la cabecera
del manifiesto no se escribe al principio del `.sql` —solo al final—, y cuando el
respaldo termina con el asistente cerrado, nada avisa: el indicador desaparece y
hay que reabrirlo para ver el resumen.

Y aparte, lo que ya venía. Ya no queda nada a medias: las transacciones manuales se cerraron en la sesión
020 y los 44 archivos sueltos se repartieron en cuatro commits temáticos. Lo que
falta es **comprobar contra servidores de verdad** lo que se escribió a ciegas,
y en la sesión 021 esa lista se acortó bastante.

**Docker sí está en este equipo.** Lo que decía esta bitácora era falso: Docker
Desktop está instalado y los contenedores de PostgreSQL, SQL Server y MySQL ya
existían. Basta arrancar el escritorio, levantarlos con
`./build/scripts/test-db.ps1` y ejecutar `dotnet test`, y la suite entera corre
contra motores reales: **126 contractuales y 68 de integración, ninguna
saltada**. Es lo primero que hay que hacer al empezar cualquier sesión que toque
un proveedor.

**Y ya no queda ningún motor a ciegas.** Informix se levantó en la sesión 021 y
pasa el contrato entero: `DRUSE_REQUIRE_ENGINES=1` con los cuatro motores da
**426 en verde**. Costó nueve arreglos, empezando por uno que hacía imposible
cualquier conexión.

Lo que sigue sin comprobarse de Informix es lo que ninguna prueba contractual
toca: el diseñador a mano desde la interfaz y la importación de archivos.

1. **Túnel SSH contra un servidor SSH real.** Lo probado llega hasta el error de
   red: la librería intenta conectar y el mensaje vuelve bien escrito. Falta el
   camino feliz —abrir el túnel, conectar la base por dentro y cerrarlo al cerrar
   la sesión— con los tres métodos: contraseña, clave privada y segundo factor.
   Vale cualquier bastión: una EC2, una VM o un equipo con el puerto 22 abierto.
2. ~~**DDL contra los cuatro motores.**~~ Cerrado en la sesión 023m: renombrar
   columnas, cambiar tipos, cambiar la clave primaria y añadir o quitar una
   foránea se ejecutan ya contra los cuatro, y destaparon que en Informix no se
   podía cambiar la clave primaria. Y el `ALTER` a medias quedó cubierto en la
   023n: un cambio que falla dice **cuál** instrucción falló y si lo anterior
   quedó aplicado, que es lo que separa «no se pudo» de «tu tabla ya no es la que
   era».
2.b ~~**Informix entero.**~~ Hecho en la sesión 021: el contrato completo corre
   contra el contenedor de IBM y ahora también en integración continua. Queda
   solo lo que el contrato no cubre en ningún motor —usar el diseñador a mano e
   importar archivos—.
3. **La autenticación de Windows con una cuenta de dominio.** Lo comprobado es
   que la petición llega al driver de SQL Server; falta una conexión que abra de
   verdad contra un servidor que acepte logins de Windows.
3.b **El ciclo de una transacción manual contra los cuatro motores.** Lo probado
   es real pero sobre SQLite: abrir, escribir, deshacer y comprobar que no queda
   nada. Contra los motores de verdad falta ver **tres cosas que solo se ven
   ahí**: que expandir el árbol con la transacción abierta no falle en SQL Server
   —de eso va que los lectores de catálogo lleven la transacción—, que dos
   pestañas de la misma conexión compartan de verdad la transacción, y que el
   temporizador la deshaga y suelte los bloqueos. Para lo último no hace falta
   esperar quince minutos: `Transactions:IdleTimeoutMinutes` acorta la espera al
   arrancar la API.

Y lo que ya venía de antes, sin cambios:

4. Lo único que impide dar el MVP por terminado **necesita otro equipo**:
   - instalar, actualizar y desinstalar de verdad, para validar el ciclo completo;
   - arrancar en una máquina sin .NET ni Node, que es el criterio que demuestra
     que el paquete se basta solo.
5. ~~Artefactos de Linux y macOS.~~ Montados en la sesión 021: un job por
   plataforma publica la API, compila el frontend y empaqueta con Tauri, dejando
   el `.deb`, el `.AppImage` y el `.dmg` descargables de cada ejecución. Sin
   firmar ni notarizar: sirven para probar, no para repartir.
6. **Probar la edición de filas y la importación a mano**, sobre una tabla de prueba.
7. **Recoger los registros de la API en un archivo.** Al ocultar su consola (D-26)
   se perdió el único sitio donde se veían. Mientras no haya que diagnosticar en
   campo no corre prisa, pero es lo primero que hará falta el día que algo falle
   en el equipo de otro.

### Ideas que quedaron sobre la mesa

- **Agente SSH / Pageant.** Se pidió y no está: SSH.NET no habla con el agente
  —comprobado por reflexión sobre el ensamblado, ni público ni interno—, así que
  ofrecerlo habría sido prometer algo que falla al conectar. Soportarlo exige
  hablar el protocolo del agente por named pipe e implementar una `Key` que
  delegue la firma, con su parte criptográfica.
- **Editar el resto de un perfil ya conectado** sin cerrar su sesión: hoy los
  cambios se guardan, pero la conexión abierta sigue con los datos anteriores.
- **Modificar una clave foránea sin quitarla y volver a crearla.** Hoy el
  diseñador solo deja crearlas y quitarlas: ningún motor las cambia en su sitio,
  igual que con los índices, pero ahí sí se automatizó el par borrar-crear. Para
  las claves no se hizo porque afectan a los datos de otra tabla y el par a
  ciegas puede dejar filas huérfanas entre una instrucción y la siguiente.
- **Índices sobre expresiones** (`LOWER(email)`) y `CONCURRENTLY` en PostgreSQL,
  que es lo que permite crear un índice sin bloquear la tabla en producción.
- **Un chat que ayude a escribir SQL.** Se habló y no se empezó. Lo que decide el
  diseño no es qué modelo se use, sino que **el asistente necesita el esquema
  para servir de algo**, y mandar los nombres de tablas y columnas de las bases
  de la empresa a un tercero es una decisión de cumplimiento, no técnica. La vía
  que lo evita es un modelo local (Ollama) con el proveedor detrás de un
  contrato, igual que los motores, para poder cambiarlo después. Y una regla que
  no debería negociarse: **el SQL que genere la IA pasa por el mismo
  `SqlSafetyAnalyzer` y las mismas confirmaciones** que el escrito a mano.
- **Transacción por pestaña** en vez de por conexión. Se descartó para esta
  entrega porque exige abrir una conexión física por pestaña, pero es lo más
  intuitivo si algún día molesta que todas las pestañas compartan transacción.

### Lo que el navegador no puede enseñar

Tres fallos ya han venido de lo mismo: **funciona en `ng serve` y se rompe en el
ejecutable**. La hoja de estilos que se quedaba en `media="print"`, la API que
no se encontraba al cambiar de origen, y exportar sin guardar nada.

La causa siempre es una de estas tres, y ninguna existe en desarrollo:

- **La CSP.** El servidor de Angular no manda ninguna; la ventana empaquetada sí.
- **El origen.** Empaquetada, la aplicación se sirve desde `http://tauri.localhost`.
- **Las capacidades del WebView.** No hay gestor de descargas ni acceso a disco.

Así que **cualquier función que toque una de las tres hay que probarla
empaquetada**. Para la CSP hay un atajo que ya funcionó una vez: servir el `dist`
compilado con un servidor estático que devuelva la CSP exacta del envoltorio.

### Dos trampas de este equipo, para no repetirlas

- **Compilar con la API en marcha falla**, y el error habla de archivos
  bloqueados. Hay que parar `Druse.Host.LocalApi` antes de `dotnet build`.
- Peor todavía: si `dotnet run` no puede reemplazar los binarios, **sigue vivo el
  proceso anterior** y las pruebas contra la API responden con el código viejo.
  Pasó una vez y dio un falso negativo que costó rato entender. Ante cualquier
  resultado que no cuadre al probar a mano, comprobar primero que no haya un
  `Druse.Host.LocalApi` antiguo escuchando.

**El visto bueno visual ya está dado** (sesión 011, con la extensión de Chrome por fin conectada): la pantalla reproduce el mockup. Lo único ausente es la pestaña «Plan de ejecución», que está fuera del MVP.

---

## 2. Cómo retomar (prompt de arranque de sesión)

```text
Lee BITACORA.md y PLAN_TRABAJO_DRUSE.md, y revisa el mockup de referencia
docs/mockups/druse-main.html.

Antes de escribir código:
1. Confirma la fase activa y las tareas pendientes según la bitácora.
2. Verifica el estado real del repositorio (no confíes solo en la bitácora):
   `git status` y `git log` antes de nada.
3. Lee «Qué toca retomar»: las correcciones 028–030 están verificadas y solo
   falta integrarlas antes de volver a los motores reales.
4. Propón únicamente los cambios de la siguiente tarea pendiente.

Al terminar: ejecuta compilación y pruebas, resume archivos modificados y
actualiza el checklist del plan y esta bitácora.
```

---

## 3. Identidad del proyecto

| Campo | Valor |
| --- | --- |
| Nombre | **Druse** (sin sufijo «Studio») |
| Origen | Una *drusa* es la costra de cristales que tapiza el interior de una geoda: la estructura que aparece al abrir la piedra. Metáfora de explorar el esquema de una base de datos. |
| Raíz de namespaces | `Druse.*` |
| Solución | `backend/Druse.slnx` |
| Ejecutable | `druse.exe` |
| Raíz del repositorio | `P:\Proyectos\Trabajo\DB STUDIO\druse` |
| Nombre anterior | ~~Quarzo Studio~~ — descartado en la sesión 001 |

**Verificación de colisiones (sesión 001).** Candidatos comprobados antes de fijar el nombre:

| Candidato | Resultado |
| --- | --- |
| **Druse** | ✅ Elegido. Sin colisiones encontradas en software. |
| Geode | ❌ Apache Geode: base de datos distribuida en memoria, proyecto top-level de la ASF (antes GemFire). Colisión directa en el mismo dominio. |
| Facet | ❌ Paquete NuGet `Facet` activo (source generator de DTOs), versión 5.x. |
| Kyanite | ⚠️ Saturado: un lenguaje, una librería de inferencia en Rust, Kyanite Labs. |
| Shard | ✅ Libre como nombre de app, pero «sharding» satura el término en bases de datos. |
| Lazuli | ✅ Casi libre; solo un paquete Python nicho en PyPI. |

Pendiente cuando haya presencia pública: reservar dominio, organización de GitHub y el identificador `druse` en NuGet/npm.

---

## 4. Entorno verificado

| Herramienta | Versión | Estado |
| --- | --- | --- |
| .NET SDK | 10.0.302 | OK |
| Node.js | v24.16.0 | OK |
| npm | 11.12.1 | OK |
| Git | 2.50.0.windows.2 | OK |
| Angular | 22.1.0 (CLI 22.1.3) | OK |
| TypeScript | 6.0.2 | OK |
| Vitest | 4.1.10 | OK — es el runner por defecto de Angular 22 |
| Rust / cargo | 1.97.1 | OK |
| MSVC Build Tools | 14.44.35207 + SDK 10.0.26100 | OK — el enlazador que Rust necesita en Windows |
| Tauri CLI | 2.11.4 | OK |

Pendiente de verificar cuando toque: Docker (pruebas de integración con contenedores), instancias PostgreSQL y SQL Server de prueba (Fases 2 y 4).

---

## 5. Registro de sesiones

### Sesión 056 — 2026-09-11 · Los seis rojos de SQLite

Los seis que dejó a la vista la 055 al descubrir que el contrato de este motor no
se estaba ejecutando. **Los seis cerrados**, y cuatro eran defectos de verdad.

#### Restaurar una base con relaciones se caía entera

El peor, y el que se pidió primero. El guion de respaldo escribe las tablas y
cuelga las claves foráneas después, con la tabla a la que apuntan ya creada. En
SQLite eso no existe: no hay `ALTER TABLE … ADD CONSTRAINT`, y una clave foránea
solo puede declararse dentro del `CREATE TABLE`. El guion moría en la primera con
«near "FOREIGN": syntax error», y con él la restauración completa.

`ScripterCapabilities` gana `AddsForeignKeysAfterwards`. Donde es falso las claves
viajan dentro de la tabla y no se escriben aparte. Cambia **cuándo** se comprueban
—la tabla nombra a otra que quizá aún no existe— y ahí este motor ayuda: no valida
la referencia al crear sino al escribir filas, que es cuando el guion ya creó
todas las tablas.

#### Y tres cosas que se perdían por el camino

- **Los nombres de las restricciones.** Una de unicidad se releía como
  `sqlite_autoindex_pedidos_1` y una clave foránea como `fk_pedidos_0`. No son
  nombres: son lo que el catálogo tiene a mano. El de verdad está en el texto del
  `CREATE TABLE`, donde ya se leían las condiciones desde la 052, y **se perdía de
  verdad**: el diseñador reconstruye la tabla desde lo que sepa de ella, así que
  una restricción que entró como `uq_pedidos_codigo` salía con el nombre de su
  índice interno.
- **La clave primaria se enseñaba como opcional.** `PRAGMA table_info` dice que
  una `INTEGER PRIMARY KEY` admite nulos y no es cierto: insertarle un nulo genera
  el número siguiente. No se generaliza a toda clave primaria porque una `TEXT
  PRIMARY KEY` **sí** los admite —un agujero histórico de SQLite— y decir lo
  contrario sería la mentira simétrica.
- **Un `CREATE TABLE` decía haber escrito una fila.** El driver contesta con el
  contador de cambios de la conexión, que una instrucción de definición no pone a
  cero. Quien restauraba veía filas escritas donde solo se creó una tabla vacía.

#### Y dos que no eran defectos

Una contraseña equivocada no falla donde no hay identidad, y un host inexistente
no falla donde el destino es un archivo. Saltarlas habría sido perder cobertura,
así que se conserva lo que se quiere comprobar y se cambia lo que depende del
motor: **el destino que no existe** sale ahora de `ProfileToNowhere()` —un host que
no resuelve, o una ruta que no está—, que en SQLite es además la prueba que
sostiene su decisión de fondo: abrir no crea. La de la contraseña se pregunta solo
donde hay identidad, y con lo que el proveedor ya declara en sus capacidades.

#### Estado

**Las 54 del contrato de SQLite en verde por primera vez.** Con los seis motores
delante —Informix levantado en esta sesión— son **394 de 395**, más **653
unitarias**, **182 de integración** y las **3 de SQLite de punta a punta**.

El rojo que queda **no es de este trabajo y ya estaba escrito**: es el `DATE` de
Informix por SQLI de la 039, que llevaba desde entonces sin poder reproducirse por
no tener el contenedor. Levantado, reaparece: un `INSERT` con `'2026-08-17
00:00:00'` en una columna `DATE` da «String to date conversion error». Por DRDA la
misma prueba pasa, así que es del transporte SQLI y no del respaldo.

### Sesión 055 — 2026-09-11 · El guion que Oracle no sabía ejecutar

Lo que el plan de motores dejaba declarado y sin resolver, empezando por lo único
de Oracle que era trabajo de Druse y no límite del proveedor.

#### Pegar dos consultas y pulsar Ejecutar

En los otros cinco motores el guion entero viaja en un comando y ellos lo
encadenan. Oracle no: `SELECT 1 FROM DUAL; SELECT 2 FROM DUAL` responde
`ORA-00911`, porque el punto y coma es de SQL*Plus y no viaja al servidor. El
plan lo decía desde la 049 —«partir el texto es una función de Druse que hoy no
existe»— y esa función es la que faltaba.

La escribe `OracleScript`, con el mismo criterio que ya usan el lector de
respaldos y «Ejecutar actual»: el punto y coma solo separa cuando está fuera de
un literal, de un identificador citado y de un comentario. Se le añade lo que
allí no hacía falta porque no se sabía de qué motor venía el texto:

- **El literal alternativo `q'[…]'`**, que existe justo para escribir textos
  llenos de comillas y de puntos y coma: es donde más daño haría cortar mal.
- **Los bloques PL/SQL no se parten**: ahí el punto y coma es del lenguaje, y lo
  que los termina es la barra sola en su línea. Uno sin barra se lleva el resto
  del guion, que es lo que hacen SQL*Plus, SQL Developer y DBeaver.

Del ejecutor, tres decisiones que se ven desde la pantalla: el tope de filas es
del guion entero —dos instrucciones no dan derecho al doble—, las filas tocadas
se suman, y cuando algo falla el error dice **cuál** de las instrucciones fue y
que las anteriores ya corrieron, porque aquí no hay vuelta atrás automática. Con
una sola instrucción el mensaje no se toca: es el que se ve casi siempre.

Al exportar se manda la primera instrucción, que es lo que ya hacían los demás
motores sin que nadie lo hubiera escrito.

#### Y un aviso que a SQLite le faltaba

Las pruebas que pedía el plan —cadena de conexión y traductor de tipos, MOT-043—
destaparon un hueco que no era de hoy: **el traslado no avisaba de que se pierden
las fechas**. El traductor preguntaba por el booleano, el JSON, los
identificadores y la zona horaria, y con eso bastaba para cinco motores, porque
todos guardan fechas. SQLite es el primero que no tiene ninguna: lo que llega se
guarda como texto o número y al releerlo nadie sabe que era una fecha.

El arreglo va en el traductor y mira lo que el motor declara de sí mismo, no en
una excepción para SQLite: el motor que alguien añada mañana y que tampoco guarde
fechas hereda el aviso sin tocar nada. Y se pregunta antes que por la zona
horaria, porque decir que se pierde el huso cuando se pierde la fecha entera
sería quedarse muy corto.

Las de la cadena de conexión sujetan lo que más fácil se deshace sin querer: de
Oracle, que el destino sea un servicio o un SID y que exigir cifrado cambie el
protocolo; de SQLite, que **abrir no cree el archivo** —el valor de fábrica del
driver sí lo crea, y una ruta mal escrita dejaría una base vacía donde el usuario
se equivocó al teclear—.

#### Y lo gordo: SQLite no estaba probándose

Al poner `DRUSE_REQUIRE_ENGINES=1` para dar por cerrada esa tarea del plan, SQLite
dijo que **no estaba disponible**. No era el motor: era su fixture. La
comprobación de disponibilidad **es** la fábrica del `Lazy` que guarda la ruta del
archivo, y para armar su perfil preguntaba por esa misma ruta, así que se
preguntaba a sí misma; el `Lazy` contesta a eso con una excepción, la fixture la
recogía como «SQLite no responde» y **las 54 pruebas del contrato se saltaban
enteras**. Verde, sin comprobar nada, desde que el motor entró en la 050.

Arreglada la reentrada, salieron dos cosas:

**La cancelación de SQLite no funcionaba.** El ejecutor registraba
`SqliteCommand.Cancel()`, con un comentario que decía que detrás estaba
`sqlite3_interrupt`. No lo está: ese método del driver **no hace nada**. Una
consulta con un plazo de un segundo tardó **285 segundos** en darse por vencida,
que es lo que tardó en terminar sola. Ahora se llama a `sqlite3_interrupt` sobre
la conexión —la función de la biblioteca nativa, que sí corta— y las dos pruebas
tardan dos segundos en total. Visto desde la aplicación, esto es un botón de
cancelar que no cancelaba.

**Y quedan seis rojos de verdad**, que nadie había visto nunca:

| Prueba | Qué pasa |
| --- | --- |
| `RespaldaLaEstructuraDeUnaTablaYLaVuelveACrear` | El guion escribe `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY`, que **SQLite no admite**. Restaurar una estructura con claves foráneas falla |
| `AplicaUnaInstrucciónDelArtefactoYCuentaSusFilas` | Un `CREATE TABLE` dice que escribió 1 fila; el contrato pide 0 |
| `CreaIndicesYRestriccionesYLosVuelveALeer` | Un índice creado no se vuelve a leer como se pidió |
| `ListaTablasYSusColumnas` | Algo que el contrato pide que sea falso llega verdadero |
| `ConexionAUnHostInexistente_FallaConMensajeUtil` | Aquí no hay host: el perfil apunta a un archivo y conecta igual. La prueba no aplica y hay que declararlo |
| `ConexionConCredencialesMalas_FallaSinRevelarLaContrasena` | Lo mismo con la contraseña: no hay ninguna que dar |

Los dos últimos son declaraciones que faltan; el primero es un defecto de
producto. **No se arreglan en esta sesión**: son trabajo suyo, y dejarlos a la
vista vale más que otro verde que no comprueba nada.

#### Estado

**653 unitarias** —51 más— y **182 de integración** en verde, las **2 de Oracle
de punta a punta** con el guion ejecutándose desde el editor de la aplicación
levantada, y **389 de 395 contractuales**: los seis rojos son los de SQLite de
arriba, que **son hallazgos y no regresiones** —esas pruebas no se ejecutaban—.
Las 7 nuevas de `OracleBatchTests` corren contra el servidor de verdad,
comprobado con `DRUSE_REQUIRE_ENGINES=1`. La captura
`21-oracle-guion-de-varias` entra en el barrido y **está mirada**: las dos
pestañas de resultados, en el orden del guion.

El frontend no se toca en esta sesión, así que su suite no se repitió.

De paso, una cosa que el barrido enseña y que no es de este trabajo: el pie del
panel de resultados dice «1 filas obtenidas».

### Sesión 054 — 2026-09-11 · Lo que se rechaza, y dónde está

Los tres puntos que dejó abierta la 053. El primero era el que valía: un aviso
correcto que no servía para nada.

#### «Hay filas que no cumplen» no dice cuáles

La 053 dejó el diseñador diciendo por qué no se puede aplicar un cambio, y ahí se
paraba: quien lo lee sabe que hay filas que incumplen la condición que acaba de
escribir, y para encontrarlas tiene que escribir la consulta a mano, con el
diálogo abierto por delante. **La consulta la sabe escribir quien rechazó**, que
es el único que sabe qué miró.

Así que el error viaja con ella. `QueryError` lleva un `Diagnostic` —SQL listo
para ejecutar, no una plantilla—, la API lo pasa en sus dos rechazos de 409, y el
diseñador ofrece «Ver las filas que lo impiden», que abre una pestaña **de esa
misma conexión y esa misma base** y cierra el diálogo. Cerrarlo no es un descuido:
la pestaña queda detrás, así que dejarlo abierto sería un botón que aparenta no
hacer nada.

Cinco motivos saben convertirse en consulta, y tres detalles decidían si vale:

- **La consulta corre sobre la tabla de hoy, no sobre la que se pedía.** El motor
  nombra la columna por como iba a llamarse y el cambio se deshizo entero: escrita
  con ese nombre fallaría con «no such column» delante de quien intenta arreglar
  algo. El renombrado se deshace antes de escribirla.
- **`NOT (condición)` y no `condición = 0`.** Una condición que da nulo **se
  cumple** en SQLite, y `NOT` de un nulo sigue siendo nulo: la consulta deja fuera
  exactamente las filas que el motor dejó pasar.
- **La fila con la clave foránea vacía no sale.** También cumple, y señalarla
  sería mandar a corregir algo que no está mal.

Los repetidos se enseñan agrupados y contados, no como filas sueltas: con las
filas delante todavía habría que emparejarlas a ojo para ver cuáles chocan.

Y cuando lo que no cuadra son las definiciones —la clave de la tabla de al lado
que se quedaría apuntando a una columna que desaparece— no hay filas culpables, así
que lo que se abre es `pragma_foreign_key_list` de esa tabla, que es lo que hay
que mirar.

#### Lo que costaban las dos comprobaciones

Medido, que era lo que pedía la 053. Dos tablas de 1.500.000 filas, 62 MB, con la
hija entera referenciando a la madre: encontrar las tablas que referencian, 0 ms;
`foreign_key_check` de la reconstruida, 9 ms; **de la hija, 350 ms**; la
reconstrucción entera, 2.596 ms. Con 300.000 + 300.000 eran 69 ms de 705.

El **11 %** y el **14 %**, y lo que crece es el recorrido de las hijas —unos 4,3
millones de filas por segundo en las dos medidas—, no el de la tabla que se
cambia. Es la décima parte de una operación que ya copia todas las filas: no hay
nada que optimizar, y lo que había que saber es que no se dispara.

#### El registro de trabajos iba un paso por detrás

El rojo intermitente de la 053 era un fallo de verdad, y no solo del respaldo. Un
trabajo largo deja rastro en dos sitios —el estado en memoria que mira la pantalla
de progreso y el registro en SQLite, que es lo que sobrevive a cerrar Druse— y el
final se publicaba **antes** de anotarlo. Entre las dos escrituras quedaba un
instante en el que la operación decía «terminado» y el registro decía «en marcha»:
visto desde la interfaz, un respaldo acabado que sigue corriendo y que no se va a
mover nunca más.

El hueco no se cierra —son dos almacenes— pero sí se elige de qué lado cae.
`QueuedJob` lleva ahora un `Announce` que se ejecuta **después** de que el
registro quede escrito, y los tres trabajos —respaldo, restauración y traslado—
guardan su final ahí en vez de publicarlo desde dentro. Lo peor que se ve es un
trabajo que tarda unos milisegundos de más en decir que acabó, que es lo que de
verdad estaba pasando.

La prueba que lo sujeta no depende de ganar la carrera: comprueba el orden en que
se llama a cada cosa.

#### Estado

**602 unitarias**, **388 contractuales**, **182 de integración** y las **3 de
SQLite de punta a punta**, que son las que ven esto por donde se usa: el rechazo,
el botón, la pestaña que se abre con la consulta dentro y la fila que sale al
ejecutarla. Del frontend, **933 de 936** en la segunda pasada —tres rojos por
tiempo, `app`, `query-builder` y `results-grid`; cuatro en la primera, y **los
cuatro archivos verdes al ejecutarlos solos**, `table-designer` incluido—, con
los cuatro contenedores levantados.

La función nueva añade su captura al barrido —`19-sqlite-rechazo-con-consulta`,
que la prueba de punta a punta saca con `DRUSE_BARRIDO=1`— y **está mirada**: el
aviso entero se lee sin cortarse, y debajo el botón con la frase que avisa de que
se abre en otra pestaña y cierra el diálogo.

El trabajo salió en cinco commits temáticos sobre `main`: el contrato y el
proveedor de SQLite, la interfaz del diseñador, la prueba de punta a punta, la
carrera del registro de trabajos y esta documentación.

### Sesión 053 — 2026-09-11 · Lo que la reconstrucción rompía en la tabla de al lado

Los dos puntos que dejó abierta la 052, y el segundo resultó ser un fallo de
verdad y no la precaución teórica que yo había escrito.

#### El paso 10 no era opcional

La 052 anotó que `PRAGMA foreign_key_check` —el último paso del procedimiento que
documenta SQLite— no estaba, «pero hoy no hace falta porque la reconstrucción
conserva las claves tal cual». **Sí hacía falta**, y lo que faltaba era mirar el
otro lado de la relación: las claves de la tabla reconstruida se conservan, pero
las de **las tablas que apuntan a ella** no las conserva nadie.

Dos caminos, ninguno raro:

- **Renombrar o borrar una columna a la que apunta la clave foránea de otra
  tabla.** La otra sigue diciendo `REFERENCES clientes (id)`; si `id` deja de
  llamarse así, esa frase ya no señala a nada y **cualquier escritura en esa otra
  tabla** falla desde entonces con «foreign key mismatch». La reconstrucción decía
  que había ido bien.
- **Añadir una clave foránea que los datos de hoy no cumplen**, que es lo que hace
  cualquiera al ordenar una base que creció sin relaciones declaradas. Como la
  reconstrucción trabaja con las claves apagadas, la tabla se quedaba con una
  relación que su propio contenido incumple.

Y no se podía arreglar añadiendo el pragma a la lista de instrucciones, que es lo
que yo había supuesto: **lanza en el primer caso y devuelve filas en el segundo**,
así que ejecutado entre las demás se tragaría el segundo sin que nadie leyera su
respuesta. Va en una comprobación aparte, dentro de la transacción y antes de
confirmar, que es el único momento en que todavía puede impedir algo. Se miran la
tabla y las que la referencian, no la base entera.

De paso se cayó una creencia que yo mismo había escrito: **un cambio de tipo no
descoloca a las hijas**. Al comparar, el motor aplica la afinidad de la columna
madre al valor de la hija, así que un `'900'` de texto que pasa a ser el número
`900` sigue casando. La prueba que lo daba por roto no fallaba, y la respuesta
correcta era cambiar la prueba, no el código.

#### «CHECK constraint failed» no explica nada

El otro punto era mirar qué se ve al poner una condición que los datos de hoy ya
incumplen. Lo que se veía era el mensaje del motor tal cual: *CHECK constraint
failed: ck_cantidad*. Es verdad y no sirve, porque quien lo lee **acaba de escribir
esa condición** y va a creer que la escribió mal, cuando lo que pasa es que la
tabla no la cumple.

El mismo error significa otra cosa según dónde salga —al insertar una fila habla
de esa fila—, así que la traducción no puede vivir en el normalizador, que es
común a todo. Vive donde se sabe en qué paso de la reconstrucción se estaba, y
cubre los tres casos que sacan a la luz los datos que ya había: la condición que no
se cumple, los nulos de una columna que deja de admitirlos y los repetidos de una
que pasa a ser única. El mensaje del motor se conserva al final, que es lo que se
puede buscar.

#### Estado

Tres pruebas nuevas, las tres sobre casos que antes pasaban en silencio.
**597 unitarias**, **388 contractuales**, **180 de integración** y **las 61 de punta a punta (1 saltada, el barrido)**,
sin advertencias de compilación.

Dos rojos que **no son de este trabajo** y conviene no perder de vista:

- **El frontend dio 922 de 932**, y los diez son «Test timed out in 5000ms» o
  «Hook timed out in 10000ms» en montajes pesados —`App`, `AppShell`,
  `ConnectionDialog`—. **El recuento cambia en cada pasada** —16, 11, 10, 11—, que
  es la firma de un problema de tiempos y no de un fallo determinista; la suite
  tarda además el doble que ayer, cuando salió entera en verde. La máquina tenía
  los cuatro contenedores levantados, Druse abierto y unos 4 GB libres de 16. Se
  descartó de paso al sospechoso obvio: excluir `monaco-loader.spec.ts` —que acaba
  de estrenar temporizadores falsos— deja los mismos once rojos. Este trabajo no
  toca una sola línea del frontend.
- **`BackupEndpointTests.UnRespaldoQuedaAnotadoEnElRegistroDeTrabajos` falló dos
  veces** y después pasó seis seguidas, tres de ellas con el código de esta sesión
  guardado aparte para compararlo. Lee el trabajo como `Running` justo después de
  que el respaldo respondiera: es una carrera entre la respuesta y el registro. No
  es del diseñador de tablas, pero **si se ve desde la interfaz es un respaldo
  terminado que sigue diciendo que va en marcha**, así que queda anotado abajo.

### Sesión 052 — 2026-09-10 · La reconstrucción que se llevaba por delante lo que no se veía

Tocaba el punto 2 de lo que dejó abierta la 051: de SQLite, que reconstruir una
tabla no conserva sus disparadores ni las vistas que la miraban, y que sus
condiciones de comprobación no se pueden leer. Escribir la prueba que lo
demostrara **encontró tres cosas peores que las dos documentadas**.

#### Lo que la prueba encontró

Era una sola prueba: una tabla con un índice, una vista, un disparador y filas,
se le cambia el tipo a una columna, y los cuatro tienen que seguir. No llegó a
comprobar nada, porque el cambio **falló entero**:

> SQLite Error 1: 'error in view resumen: no such table: main.clientes'

Desde la versión 3.25, el motor valida todas las vistas y disparadores de la base
al renombrar una tabla. A mitad de la reconstrucción esas vistas apuntan a algo
que ya se borró, y el renombrado aborta. **Con una vista delante, cambiar el tipo
de una columna no funcionaba**, y eso no estaba escrito en ninguna parte.

La segunda salió de preguntarse qué más pasa por ese `DROP TABLE`: con las claves
foráneas encendidas ejecuta un borrado implícito, y ese borrado **dispara las
cascadas de quien la referencia**. Cambiarle el tipo a una columna de la tabla de
clientes borraba todos sus pedidos, sin aviso, dentro de la misma transacción que
se confirma sola. Es la clase de pérdida que nadie atribuye jamás a su causa.

Y la tercera es la otra limitación documentada, que resultó ser la misma: las
condiciones de comprobación no se leían, y **lo que no se lee no se puede volver a
escribir**, así que la reconstrucción también se las llevaba. Una condición que
desaparece no rompe nada el día que se pierde: deja entrar meses después la fila
que existía para impedir.

#### Lo que hubo que hacer

- **Pedir el modo antiguo del renombrado** —`legacy_alter_table`— solo durante el
  borrado y el renombrado, que es cuando las vistas cuelgan de nada.
- **Apagar las claves foráneas, y fuera de la transacción.** Es el paso 1 del
  procedimiento que documenta SQLite, y el pragma que las apaga **no hace nada
  dentro de una transacción**: puesto entre las instrucciones del cambio se
  habría ejecutado sin efecto y nadie lo habría notado. Hizo falta un enganche en
  el diseñador base para poder preparar la conexión antes de abrirla; los otros
  cinco motores no pagan ni una consulta por él. Con una transacción manual del
  usuario abierta, la reconstrucción ahora **se para y dice por qué** en vez de
  seguir con la cascada armada. `defer_foreign_keys`, que sí se puede dentro, se
  probó y no sirve: retrasa la comprobación de las restricciones, y una cascada no
  es una comprobación sino una acción.
- **Leer los disparadores antes de tirar la tabla** y volver a escribirlos tal
  cual, que es mientras todavía existen.
- **Leer las condiciones de comprobación del `CREATE TABLE`**, que es el único
  sitio donde SQLite las guarda. Con eso la capacidad pasa a verdadera: el
  diseñador ya las enseña y las deja escribir, porque ahora lo que se escribe se
  vuelve a ver.

El orden de la reconstrucción cambió por un motivo que no se ve: la tabla nueva
recupera **siempre** el nombre de la vieja, y el renombrado que pidiera el usuario
va al final, aparte. Los índices y los disparadores se reescriben con su texto
original, que nombra la tabla de antes; una vez puestos, **el renombrado final lo
hace el motor y arrastra con él las vistas y los disparadores**, que es lo que no
se puede hacer a mano sin ponerse a interpretar su texto.

#### Leer un `CHECK` sin interpretar SQL

Lo que hace el lector nuevo no es entender SQL, y la distinción importa porque
entenderlo a medias inventaría condiciones —que la siguiente reconstrucción
escribiría de verdad en la tabla—. Busca la palabra `CHECK`, cuenta paréntesis y
copia la expresión **sin entenderla**. Lo que sí sabe es dónde no mirar: dentro de
una cadena, de un identificador citado o de un comentario, porque un `CHECK`
escrito ahí es texto. Las dieciséis pruebas que lo rodean son casi todas de eso.

#### Lo que se vio con Druse levantado

La prueba de punta a punta abre el diseñador sobre una tabla del archivo de
verdad: la pestaña **Restricciones marca 1** y enseña `ck_nombre` con su
expresión, que no sale de ningún catálogo sino del texto. Después del cambio
siguen en pie las filas de la tabla hija, la vista, el disparador y la condición
—comprobada por lo que rechaza, no por lo que dice el catálogo—. La captura
`18-sqlite-reconstruccion.png` se toma aquí y no en el barrido porque aquel
recorrido trabaja sobre PostgreSQL.

De paso salieron tres detalles de interfaz que la prueba destapó: el campo del
nombre de una columna y el del valor por omisión **no tenían nombre accesible**,
al revés que todos los demás controles de esa fila, y el «Cambios aplicados» no se
anunciaba.

#### Un hueco que abrí yo

Los pragmas no entran en la transacción. Si una instrucción de la reconstrucción
falla, lo escrito se deshace pero los dos ajustes se quedarían puestos: con las
claves foráneas apagadas el resto de la sesión escribe relaciones que nadie
comprueba, y con `legacy_alter_table` encendido el siguiente renombrado de
cualquier tabla deja de arrastrar sus vistas. Se restauran los dos pase lo que
pase, y hay una prueba que provoca el fallo a mitad para comprobarlo.

#### Estado

**Siete pruebas nuevas de reconstrucción, dieciséis del lector de condiciones y
una de punta a punta.** Todo en verde: **594 unitarias**, **388 contractuales**
—las 54 de SQLite entre ellas—, **180 de integración**, **932 del frontend**,
**61 de punta a punta** (1 saltada, que es el barrido) y el **barrido limpio**,
con la consola sin errores. Compilación sin advertencias.

Conviene saberlo para leer los números: **mientras esta sesión trabajaba entraron
en `main` tres commits de interfaz del usuario** —la paleta, el maximizado y la
barra compacta—, así que las cuentas del frontend y del e2e incluyen sus pruebas,
no solo las de aquí. Las suites se repitieron enteras después de ellos.

### Sesión 051 — 2026-09-10 · Lo que le faltaba a SQLite para poder empezar

Las dos cosas que la 050 dejó anotadas, y que juntas son la diferencia entre
«el motor funciona» y «se puede usar»: elegir el archivo sin escribir la ruta a
mano, y **poder crear uno**, que con SQLite es la única forma de empezar.

#### Crear es lo contrario de abrir, y por eso va aparte

Druse sigue sin crear un archivo al abrirlo: una ruta mal escrita tiene que decir
que no está, no dejar una base vacía en el disco y una conexión que parece
funcionar. Lo que se añade es la otra mitad, como operación propia
—`CreateDatabaseAsync`— con su capacidad, `CanCreateDatabase`.

**Solo la declaran los motores que son un archivo.** No es falta de ganas: un
`CREATE DATABASE` en un servidor lleva detrás media docena de decisiones que
cambian según el motor —codificación, cotejo, espacio de tablas, plantilla— y
ofrecerlo como un botón sin ellas crearía bases que después hay que rehacer. Los
demás lanzan, a propósito: un «no hice nada» silencioso lo dejaría pasar.

Tres decisiones, cada una con su prueba:

- **No machaca lo que ya está.** Vaciar una base con un botón que pone «crear»
  sería borrarla sin avisar.
- **Lo que crea es una base, no un archivo vacío.** Es la trampa del motor: abrir
  en modo de creación deja el archivo a cero bytes hasta la primera escritura, y
  un archivo de cero bytes no se puede abrir después. Se escribe la cabecera a
  propósito.
- **No conecta después.** Quien crea una base quiere ver que está antes de
  abrirla.

#### Dos botones y no uno

«Examinar…» y «Crear una nueva» abren **diálogos distintos del sistema**: el de
abrir no deja nombrar un archivo que todavía no existe, y el de guardar deja
escribir cualquier cosa. Es la misma distinción que ya se hacía al restaurar un
respaldo.

El comando va en el envoltorio, como los del respaldo y por lo mismo: la página
no puede pedir que se escriba en un sitio concreto, y eso es lo que impide que
esto sea una vía para dejar archivos donde le apetezca. Solo aparecen dentro de
la aplicación de escritorio; en el navegador la ruta se sigue escribiendo a mano.

#### Lo que no se pudo comprobar automáticamente

**El diálogo nativo no se puede conducir desde una prueba**: es una ventana modal
del sistema. Lo que sí quedó cubierto es todo lo demás —el proveedor con cuatro
unitarias que no necesitan servidor, el endpoint con tres de integración, y que
los botones no aparezcan fuera del escritorio, en la de punta a punta— y el
envoltorio compila. Pulsar los dos botones dentro de Druse instalado sigue siendo
cosa de mirarlo.

**Pruebas.** **571 unitarias** —cuatro nuevas—, **180 de integración** —tres
nuevas—, **914 del frontend**, **56 de punta a punta** y el barrido limpio.
`docs/api/openapi.json` sí cambió esta vez, con la ruta nueva: su prueba lo dijo
y se regeneró.

**Archivos.** `SqliteCreateDatabaseTests.cs`, `CreateDatabaseEndpointTests.cs`
(nuevos); `EngineCapabilities.cs`, `IDatabaseProvider.cs`,
`SqliteDatabaseProvider.cs`, `ConnectionService.cs`, `DatabaseEndpoints.cs`,
`Contracts.cs`, `ContractMapper.cs`, `openapi.json`, `backups.rs`, `main.rs`,
`desktop-host.ts`, `application-gateway.ts`, `http-application-gateway.ts`,
`workspace-store.ts`, `workspace.ts`, `connection-dialog.{ts,html,spec.ts}`,
`sqlite.spec.ts` y el plan.

**Estado al cerrar.** Commiteado en `main`, en tres commits temáticos.

### Sesión 050 — 2026-09-10 · SQLite, el motor que no es un servidor

Fase 2 del plan de motores nuevos, y la última. **El contrato pasó entero a la
primera: 54 de 54.** No fue suerte: es lo que dejaron hechas la fase 0 y Oracle.

#### Lo que rompía, y por qué el plan lo puso el segundo

SQLite no es «un motor más pequeño»: es el que no encaja. No hay host, ni puerto,
ni usuario, ni contraseña, ni transporte que cifrar, ni servidor intermedio por el
que pasar. Lo que el perfil llama base de datos es **la ruta de un archivo**.

Se resolvió con dos capacidades nuevas —`RequiresDatabase` y `UsesFilePath`— y no
con condicionales: el formulario pierde medio contenido porque el motor lo dice,
no porque el componente sepa qué motor es. En pantalla, el campo se llama
«Archivo», no hay usuario ni contraseña, y donde estaban las opciones avanzadas no
hay nada, porque no hay nada que decidir.

#### La reconstrucción de tabla, que obligó a una costura

`ALTER TABLE` en SQLite hace cuatro cosas: renombrar la tabla, renombrar una
columna, añadirla y quitarla. **Cambiar un tipo, tocar la clave primaria o añadir
una restricción no están.** Eso se hace creando otra tabla, copiando las filas,
borrando la vieja y renombrando.

Y para escribir esa tabla nueva hay que saber cómo es la de ahora, que es justo lo
que el cambio no dice: el cambio dice qué se toca, no lo que se queda. De ahí
`ITableDesigner.DescribeAlterAsync`, que es lo mismo que `DescribeAlter` pero con
la sesión delante. Los otros cinco motores no la reescriben. Va entera en una
transacción porque **aquí el DDL sí se deshace**, que es de los pocos sitios donde
pasa.

#### Un fallo que solo apareció con la aplicación levantada

Reabrir una conexión guardada **pedía contraseña a un motor que no tiene
usuarios**. SQLite conectaba la primera vez y no volvía a conectar nunca más. El
contrato no lo veía —va por debajo de la API—, las pruebas del navegador tampoco,
y la de punta a punta solo lo vio **a la segunda ejecución**, cuando ya había un
perfil guardado. El endpoint ahora pregunta al motor si tiene identidad antes de
pedirla.

Es exactamente el motivo por el que estas cosas se miran con Druse levantado.

#### Lo demás que es suyo

- **Su candado de solo lectura es el más fuerte de los seis**: no es un modo que
  el servidor haga cumplir, es que el archivo se abre sin permiso de escritura.
- **El tipo de una columna no obliga a nada**: una `INTEGER` acepta el texto
  `hola`. Por eso declara cuatro familias —texto, entero, decimal y binario—, que
  son las que sobreviven al viaje de ida y vuelta. Ni booleano, ni fecha, ni hora,
  ni marca de tiempo, ni identificador único.
- **No tiene procedimientos**, así que su árbol enseña dos carpetas y no cuatro:
  enseñarlas vacías diría que la base no tiene ninguno.
- **Las condiciones de comprobación no se leen.** Las admite y no las devuelve: no
  hay `PRAGMA` que las enseñe. Por eso el diseñador tampoco las ofrece.
- **Druse no crea el archivo.** Una ruta mal escrita tiene que decirlo, no dejar
  una base vacía en el disco.

#### Lo que costó cero

`Microsoft.Data.Sqlite` **ya viajaba en el paquete**: la persistencia local de
Druse es SQLite. Es el único de los seis proveedores cuya dependencia no había que
traer, y el instalador no engorda.

**Pruebas.** **388 contractuales** —las 334 de antes más las 54 de SQLite— contra
PostgreSQL, MySQL, SQL Server, Oracle y un archivo; **567 unitarias**, **177 de
integración**, **914 del frontend** y la **suite de punta a punta entera: 56 en
verde**, con una nueva propia de SQLite que **no necesita ningún contenedor**: se
crea su archivo con `node:sqlite`. El barrido, limpio y sin hallazgos.

**Archivos.** `Druse.Provider.Sqlite/` entero (9 archivos, 2.240 líneas),
`SqliteFixture.cs`, `e2e/tests/sqlite.spec.ts` (nuevos); `DatabaseEngine.cs`,
`EngineCapabilities.cs`, `ITableDesigner.cs`, `TableDesignerBase.cs`,
`ConnectionProfileValidator.cs`, `ConnectionService.cs`, `TableDesignService.cs`,
`StorageEndpoints.cs`, `DatabaseEndpoints.cs`, `Contracts.cs`,
`ContractMapper.cs`, `ProviderContract.cs`,
`DatabaseProviderContractTests.cs`, `ArchitectureRulesTests.cs`, los cinco
archivos de dialecto del frontend, `_tokens.scss`, `engine-badge.ts`,
`workspace.ts`, `connection-dialog.{ts,html,spec.ts}`, `README.md`, el plan y el
README del e2e.

**Estado al cerrar.** Commiteado en `main`, en seis commits temáticos:
`10c8349` lo que las abstracciones tuvieron que aprender —que un motor puede no
ser un servidor—, `d6e8cd2` el proveedor, `f03f3b8` el arreglo de la contraseña
que se pedía de más, `8744c9e` las pruebas, `9372132` la interfaz y este mismo
con la documentación. Con esto, el plan de motores nuevos queda cerrado: seis
motores sobre el mismo contrato.

### Sesión 049 — 2026-09-10 · Oracle, y las tres cosas suyas que nadie ve venir

Fase 1 del plan de motores nuevos. El proveedor son **2.860 líneas** y las pasa
enteras el mismo contrato que los otros cuatro: **54 de 54, sin una sola
comprobación relajada**.

#### Lo que costó, que no fue el catálogo

El lector de `ALL_*` es la mitad del código y salió casi a la primera. Lo que
costó fueron tres cosas que no aparecen en ninguna guía de «cómo conectar a
Oracle»:

1. **El punto y coma no viaja.** `SELECT 1 FROM DUAL;` se rechaza con
   `ORA-00911`: el terminador es de SQL*Plus, no del protocolo. Pero un guion de
   respaldo **sí** se parte por él, y lo que se le enseña al usuario antes de
   aplicar un cambio de tabla es lo que él escribiría. Así que se escribe con
   punto y coma y se quita al mandarlo, con una costura nueva en
   `TableDesignerBase.ToCommand`: son diez plantillas las que componen
   instrucciones, y bastaba olvidarse de una.

2. **La caja de los identificadores.** Los otros cuatro proveedores citan todo
   porque allí es gratis. En Oracle citar además fija la caja: citarlo todo
   produciría tablas llamadas `clientes` que **ningún informe ni ningún SQL*Plus
   sabe consultar**, porque preguntan por `CLIENTES`. `OracleIdentifier` cita solo
   lo que lo necesita y pliega lo demás, como SQL Developer y DBeaver. Costó
   varias vueltas: el primer intento citaba todo y dejaba el `CHECK` de una tabla
   apuntando a una columna que no existía.

3. **El `ALTER SESSION` se queda pegado al pool.** El explorador se asoma a otro
   esquema con `SET CURRENT_SCHEMA`, y eso viaja con la conexión cuando vuelve al
   pool: la siguiente consulta que la tomara resolvía sus tablas en el esquema
   ajeno y fallaba con «la tabla no existe» hablando de una que sí está. Cuatro
   rojos intermitentes que pasaban en aislado. Ahora cada sesión vuelve a su
   esquema y fija sus formatos de fecha nada más abrirse.

#### Lo que Oracle obligó a arreglar fuera de su carpeta

Cuatro cosas, y las cuatro eran huecos de verdad:

- **`BackupIsolation.Serializable`**: su driver rechaza `RepeatableRead` con
  `ORA-50002`, y lo que él llama serializable es justo lo que un respaldo
  necesita —lecturas consistentes que no bloquean a quien escribe—. De paso, un
  nivel rechazado ya no tumba el respaldo entero.
- **`ColumnValueParser`** no conocía `NUMBER` ni `RAW`, que son *los* tipos
  numérico y binario de Oracle: una columna de enteros se clasificaba como texto
  y el respaldo la escribía entrecomillada.
- **`IProviderFixture.Stored` y `HasEmptyStrings`**: dos hechos que no se pueden
  fingir. Oracle pliega a mayúsculas lo que no va citado, y `''` **es** `NULL`.
- **`DateOnly` y `TimeOnly`** los rechaza ODP.NET con «Value does not fall within
  the expected range», que no dice ni qué valor ni por qué.

#### El árbol de Oracle

No hay varias bases dentro de una conexión: hay esquemas, que **son** usuarios.
El primer nivel enseña los esquemas donde los demás motores enseñan bases, y
debajo cuelga uno de su mismo nombre. Es lo mismo que se hace en MySQL al revés
—allí la base es el esquema— y es lo que permite que el explorador se comporte
igual en los cinco. Se ve en la captura del e2e: `E2E Oracle → DRUSE → DRUSE →
Tables`.

#### Lo que queda declarado, no resuelto

- **Un lote con varias instrucciones no se ejecuta de una vez.** Oracle no
  encadena con punto y coma, y partir el texto es una función de Druse —no del
  proveedor— que hoy no existe.
- **No se dice dónde falló un error de sintaxis**: el servidor sabe el
  desplazamiento, ODP.NET no lo expone.
- **Los paquetes no salen en el árbol.**
- **Sin booleano** salvo en 23ai: se traduce a `NUMBER(1)` y el traslado lo avisa.

**Pruebas.** **334 contractuales** —las 280 de antes más las 54 de Oracle— contra
PostgreSQL, MySQL, SQL Server y Oracle reales; **567 unitarias**, **177 de
integración**, **913 del frontend** y la **suite de punta a punta entera: 55 en
verde**, con una nueva propia de Oracle que conecta, explora y baja hasta sus
carpetas. El barrido de capturas, limpio y sin hallazgos: Oracle sale con su
distintivo morado y sus versiones.

**Un guardarraíl que hizo su trabajo.** `ArchitectureRulesTests` falló al añadir
el proyecto, antes de que nadie pudiera colarle una referencia de más. Y el
frontend no compiló hasta rellenar los cinco registros exhaustivos que dejó la
fase 0 —distintivo, nombre, versiones, familia, transporte, orden, color,
dialecto del formateador, palabras clave, plantillas y tabla de `sql-writer`—,
que es exactamente para lo que se hicieron.

**Archivos.** `Druse.Provider.Oracle/` entero (13 archivos, 2.860 líneas),
`OracleFixture.cs`, `e2e/tests/oracle.spec.ts` (nuevos); `DatabaseEngine.cs`,
`ColumnValueParser.cs`, `TableScript.cs`, `TableDesignerBase.cs`,
`DependencyInjection.cs`, `ProviderContract.cs`,
`DatabaseProviderContractTests.cs`, `ReadOnlySessionTests.cs`,
`ArchitectureRulesTests.cs`, `TypeTranslationTests.cs`, `test-db.ps1`,
`test-db.sh`, los cinco archivos de dialecto del frontend, `_tokens.scss`,
`engine-badge.ts`, `workspace.ts`, `README.md` y el plan.

**Estado al cerrar.** Commiteado en `main`, en cinco commits temáticos:
`52efd09` lo que Oracle obligó a absorber en las abstracciones, `eee2656` el
proveedor, `84a84d2` las pruebas con su contenedor, `148adb1` la interfaz y este
mismo con la documentación. Lo siguiente es la fase 2, SQLite.

### Sesión 048 — 2026-09-10 · Un motor nuevo ya no puede colarse sin decir lo que es

Se pidió un plan para añadir motores «que se puedan usar en todas las
funcionalidades». Está en `docs/plan-nuevos-motores.md` —Oracle y SQLite, con la
lista de dieciocho funciones que hay que recorrer antes de dar un motor por
terminado— y esta sesión ejecuta su **fase 0**: cerrar lo que hoy se le escapa a
un motor nuevo, antes de añadir ninguno.

#### Lo que se encontró al mirar

La arquitectura aguanta bien: seis contratos, un registro que los localiza y
**ni un `switch` por motor en los casos de uso**. Pero fuera de esa frontera
había tres fugas, y las tres fallan **en silencio**:

1. **`TypeTranslator.Keeps` terminaba en `_ => true`.** Un motor recién añadido
   heredaba la respuesta más optimista posible: el asistente de traslado diría
   «traducción exacta» al llevar un booleano a un motor sin booleanos, y la
   pérdida se descubriría después de copiar. En esa pantalla **el aviso es el
   producto**, no el tipo propuesto.
2. **`sql-writer.ts` tenía cuatro `switch` con `default` de PostgreSQL**, y
   `informixsqli` no aparecía en ninguno. No era una preparación para el futuro:
   **estaba roto hoy**. Una conexión por el protocolo nativo de Informix recibía
   `LIMIT` al final —que su servidor rechaza— y un `DEFAULT VALUES` que no
   admite.
3. **La lista de motores del diálogo estaba escrita a mano y `getEngines()` no
   lo llamaba nadie.** El endpoint existía, el gateway lo exponía y ningún
   componente lo consumía; por eso la compilación ligera, la que se hace sin
   Informix, seguía ofreciéndolo en el formulario y fallaba al conectar.

#### Lo que se hizo

**`EngineCapabilities`**, en el dominio y publicada por `IDatabaseProvider`. Dice
lo que el motor necesita —servidor, usuario, servidor lógico, identidad del
sistema, túnel, cifrado—, si sus sesiones de solo lectura son una frontera real,
y **qué familias de datos guarda con un tipo propio**. Esa última es `required`:
un motor que no la declare **no compila**, en vez de contestar que lo conserva
todo. El precedente era `IndexCapabilities`, que ya dibujaba el formulario de
índices sin que ningún componente supiera contra qué estaba conectado.

Con eso, tres sitios dejaron de nombrar motores: el traductor de tipos, el
validador de perfiles —la identidad de Windows y el `INFORMIXSERVER` los contesta
ahora el proveedor— y el diálogo de conexión, que pide la lista a
`/api/engines` y dibuja cada motor con lo que este declara.

**`sql-dialects.ts`**, tabla exhaustiva con las cuatro reglas que cambian al
escribir SQL: comillas, límite de filas, truncado de fechas e `INSERT` sin
columnas. Sin rama por omisión: el motor que falte no compila. Informix aparece
dos veces, una por transporte, apuntando al mismo dialecto —que es exactamente lo
que faltaba—. `buildCall` perdió también su `default`.

**Dónde vive cada cosa.** Las capacidades dicen lo que el motor *es* y viajan por
la API; **la sintaxis del SQL no viaja**: vive donde se escribe, en el diseñador
de cada proveedor y en la tabla del navegador. Mandar `TOP {n} ` por HTTP sería
enviar plantillas de texto para que las rellene otro.

Y se decidió **no declarar lo que nadie lee todavía**: «tiene esquemas», «tiene
procedimientos» y «tiene varias bases» entran con Oracle y SQLite, que es cuando
el árbol tendrá que preguntarlo.

#### Lo que se ve

El formulario quedó igual salvo en un sitio: **el marcador de «Base de datos»
ahora es la base desde la que el motor pregunta qué bases hay**, así que MySQL lo
tiene vacío —conecta sin nombrar base— donde antes proponía `mysql`, que es su
catálogo interno y no lo que nadie quiere abrir. Decidido con el usuario dejarlo
vacío: el texto de debajo ya explica qué significa.

Las tarjetas siguen agrupando Informix en una sola con sus dos protocolos, pero
ya no por un literal en la plantilla: por `ENGINE_FAMILIES`. Y volver a pulsar la
tarjeta estando en DRDA sigue sin devolver a SQLI.

**Pruebas.** Backend: **565 unitarias** (dos nuevas: un motor inventado que
declara que no guarda booleanos **sí** avisa, y si declara que sí, no se inventa
el aviso), **177 de integración** y **279 contractuales** contra PostgreSQL,
MySQL y SQL Server levantados. Frontend: **913**, con la prueba que fija que el
protocolo de Informix no cambia el SQL. E2E: **35 en verde** y el **barrido
entero** con la consola limpia y ningún hallazgo. Los rojos del camino fueron de
tiempo, distintos en cada pasada y verdes al ejecutar su archivo solo: el de §9.

`docs/api/openapi.json` **no cambió**: `/api/engines` no declara el cuerpo de su
respuesta, así que ampliar el DTO no toca el contrato publicado.

**Un tropiezo conocido.** El heredoc de Python convirtió `\n` en saltos reales al
insertar expectativas en un spec, tal y como está anotado: con la herramienta de
edición directa salió a la primera.

**Y otro que costó una compilación**: el `dotnet run` del API de desarrollo
llevaba levantado desde la sesión anterior y bloqueaba los DLL del host. Se
compiló a un directorio aparte con `-p:BaseOutputPath=` para seguir sin tocarlo,
y al final se paró con permiso para cerrar la integración.

**Archivos.** `EngineCapabilities.cs`, `sql-dialects.ts`,
`docs/como-anadir-un-motor.md` y `docs/plan-nuevos-motores.md` (nuevos);
`IDatabaseProvider.cs`, los cuatro `*DatabaseProvider.cs`, `TypeTranslator.cs`,
`ConnectionProfileValidator.cs`, `ConnectionService.cs`,
`SavedConnectionService.cs`, `Contracts.cs`, `ContractMapper.cs`,
`DatabaseEndpoints.cs`, `workspace.ts`, `engine-badge.ts`, `workspace-store.ts`,
`connection-dialog.{ts,html,scss}`, `sql-writer.ts`, cinco specs y `README.md`.

**Estado al cerrar.** Commiteado en `main`, en cuatro commits temáticos:
`3509bb7` las capacidades del motor con el traductor y el validador, `5d337cc` la
lista de motores que sale de la API, `0c5507f` la tabla de dialectos con el
arreglo de SQLI, y este mismo con la documentación. El plan queda con la fase 0
marcada y Oracle como lo siguiente.

### Sesión 047 — 2026-09-08 · El almacén de tres mil líneas empieza a tener dueños

Siguiendo el plan de mejoras por donde quedó: FE-001 y FE-002, la extracción que
el propio plan daba por imposible de hacer a medias.

#### Lo que había

`WorkspaceStore` eran **3.372 líneas** y dentro cabía todo: las conexiones y sus
sesiones, las transacciones manuales con su reloj, las pestañas del editor con
su guardado con retardo, el árbol del explorador, la ejecución, la edición de
filas, la importación y las palabras con las que se cuenta cada fallo. Tocar
cualquier cosa obligaba a leerlo entero para saber qué más se movía.

#### Cuatro piezas fuera, y la fachada intacta

`errors.ts` fue lo primero —`describeError`, `isSessionLost` y los mensajes por
código HTTP—: las piezas nuevas necesitan las mismas palabras, y duplicarlas era
garantizar que un día dijeran cosas distintas del mismo error. Luego
`NoticeStore` (el aviso que se le está diciendo al usuario, uno y del último que
habló), `ConnectionStore` (las conexiones, la sesión viva de cada una y cuál
está activa), `TabStore` (las pestañas y el trabajo sin ejecutar, con el
guardado que las protege de un cierre inesperado) y `TransactionStore` (las
transacciones, su reloj de medio minuto y el aviso de la que se deshizo sola).

**Ningún componente se tocó.** `store.tabs()`, `store.transaction()`,
`store.beginTransaction()` y las demás siguen donde estaban, y por eso las 815
pruebas del frontend pasaron sin cambiar una sola expectativa. Eso es lo que
contradice al plan: la extracción **sí** se puede hacer por partes, siempre que
la fachada no se mueva.

Dos decisiones que hicieron falta. El reloj de las transacciones necesitaba el
`sessionId` de cada conexión abierta, y lo buscaba en el registro de conexiones;
ahora lo guarda junto al estado y se refresca solo, sin conocer nada del resto.
Y quien abre, confirma o deshace no notifica desde dentro: los mensajes de éxito
hablan de la conexión activa, que esa pieza no conoce, así que sube el error y
es el almacén quien decide si fue una sesión perdida —que se cuenta de otra
manera— o cualquier otra cosa.

#### Un valor por defecto que estuvo a punto de perderse

Abrir un archivo `.sql` heredaba la conexión y la base de donde se estaba
trabajando, y no porque nadie lo hubiera escrito: salía del valor por defecto de
un parámetro de `createTab`. Al mover el método, ese defecto se quedaba fuera y
el archivo abría sin conexión, que es abrirlo sin poder ejecutarlo. Ahora se
pasa explícito y hay una prueba que lo dice.

#### Y el árbol, con el nudo que lo bloqueaba

El explorador era el bloque grande que quedaba, y tenía un nudo: **es quien
primero descubre que una sesión se perdió** —es lo que más habla con la API—
pero contarlo exige marcar la conexión, olvidar su transacción y ofrecer
«Reconectar», que no es suyo. Si llamara a quien sí sabe hacerlo, y ese otro
llamara al explorador para vaciar el árbol, las dos piezas se necesitarían
mutuamente.

La salida es un manejador que el área de trabajo instala al construirse
—`reportSessionLossWith`—: el árbol avisa hacia arriba sin conocer a nadie, y en
la otra dirección recibe `forget(connectionId)`, igual que las transacciones.
Con eso salen 655 líneas más: las raíces por conexión, los hijos que se piden
una sola vez, las columnas con su tipo y el precalentado del catálogo. El
almacén queda en **2.344 líneas**, menos de la mitad de lo que medía por la
mañana.

Lo que dependía del contexto se pasa ahora por parámetro: `buildSchemaIndex`
recibe sobre qué conexión y qué base va, porque eso lo sabe la pestaña activa.
La fachada pública no cambia; los valores por defecto se siguen resolviendo en
el almacén.

#### Y la ejecución, que cierra la lista

La última pieza es la que decide qué se ve: el resultado, de dónde salió, si algo
está corriendo, si se pidió pararlo y qué operación quedó esperando
confirmación. `ExecutionStore` guarda todo eso y **genera el identificador de
ejecución**, que es lo que hace posible cancelar: si lo pusiera el servidor solo
llegaría con la respuesta, cuando ya no queda nada que cancelar.

Lo que no hace es interpretar: `run` lanza lo que falle, porque distinguir un
409 que pide confirmación de una sesión perdida —y saber si la pestaña sigue
siendo la misma cuando la respuesta llega— es del área de trabajo. Esa
comprobación es la que evita pintar en una pestaña el resultado de otra, y sigue
donde estaba.

Con esto **FE-001 y FE-002 quedan cerradas**. El almacén termina en **2.293
líneas** de las 3.372 con las que empezó el día, y lo que sigue dentro es
coordinación —qué pasa al conectar, al cambiar de base, al perder una sesión— más
la edición de filas, la importación y el diseñador de tablas, que son funciones
enteras y no estado repartido.

**Verificado.** La suite de punta a punta entera contra PostgreSQL y SQL Server
reales, **tres veces**: tras las cuatro primeras piezas, tras el explorador y
tras la ejecución. **52 en verde y 1 saltada, 0 fallos** las tres. Es la
comprobación
que importa aquí, porque un refactor sin cambio visible solo se puede desmentir
usando la aplicación: conectar, explorar, ejecutar, cambiar de pestaña, migrar
tablas y cerrar.

**Pruebas.** **859 del frontend** —las 815 de antes más 44 nuevas de las piezas
extraídas—, todas en verde. Por el camino hicieron
falta repeticiones: cinco rojos en tres pasadas distintas, ninguno repetido, y
todos verdes al ejecutar su archivo solo. Es el rojo por tiempo que ya está
anotado en §9, agravado por lanzar `tsc` en paralelo.

**Un ayudante de las pruebas que fallaba por ambigüedad.** `ejecutar()` espera a
la respuesta del servidor y después comprueba que «Cancelar» esté deshabilitado,
pero **mientras el panel de «Consulta en curso» sigue pintado hay dos botones con
ese nombre** —el suyo y el de la barra— y Playwright falla por ambigüedad en vez
de esperar. Solo se ve cuando la máquina va cargada y el pintado llega tarde, y
se lee como un fallo del producto. Ahora espera primero a que ese panel se vaya.

**Y un aviso que costó media hora**: la segunda pasada del e2e dio cuatro fallos
en el editor —«druse_test» no aparecía en el árbol— justo después de tocar el
explorador, que es lo peor que puede pasar. No era el código: **la API y el
servidor de desarrollo llevaban levantados desde la sesión anterior**, y
`reuseExistingServer` los reutiliza. Con los dos procesos reiniciados y
`%TEMP%\druse-e2e-datos` vaciada, las 52 pasan. Antes de creerse un rojo del
e2e, comprobar de cuándo son los servidores.

**Archivos.** `errors.ts`, `notice-store.ts`, `connection-store.ts`,
`tab-store.ts`, `transaction-store.ts`, `explorer-store.ts`, `execution-store.ts`
y sus cinco specs (todos nuevos), `workspace-store.ts` (3.372 → 2.293 líneas) y
`PLAN_MEJORAS_DRUSE.md`.

**Estado al cerrar.** Commiteado en `main`.

### Sesión 046 — 2026-09-07 · El llavero que falla, lo que no cabía y la cuadrícula que nadie podía leer

Siguiendo el plan de mejoras por donde quedó: lo que se podía cerrar entero y
comprobar.

#### Un llavero que falla se llevaba por delante lo que sí se había guardado

Guardar una conexión son **dos escrituras sin transacción común**: el perfil a
SQLite y la contraseña al almacén del sistema. La segunda puede fallar sola —el
llavero bloqueado, una sesión sin escritorio, una política de empresa— y hasta
ahora subía como excepción: el cliente recibía un 500 y el perfil se había
guardado igual, así que el usuario creía que no se guardó nada y volvía a
crearlo.

La compensación no es deshacer el perfil, sino dejarlo todo en el estado que
Druse ya sabe tratar: perfil guardado, sin secreto, y **dicho en voz alta**. Es
lo mismo que pasa en una máquina sin almacén, que aquí es de primera clase. Las
reglas viven en un solo sitio —`SecretWriter`— y las usan las conexiones y los
proveedores de IA: si no se pudo escribir no queda nada escrito, si no se pudo
retirar se avisa (y solo si de verdad seguía ahí), y un fallo al consultar no
tumba nada. Al borrar el orden es el contrario, y a propósito: la clave del
secreto se deriva del identificador del perfil, así que borrar el perfil antes
dejaría en el llavero una contraseña que ya nadie sabe nombrar.

#### Tres cosas que el barrido reportaba en cada ejecución

Medidas en la aplicación levantada, antes y después. La **barra de estado**
desbordaba 151 px a 1.024 y 275 a 900, y lo resolvía cortando la última palabra
por la mitad —«Última eje…»—: ahora hay un orden de descarte escrito, primero
las palabras que acompañan a los datos y por último la posición del cursor,
mientras que contra qué se trabaja no se suelta nunca. El **buscador global**
perdía su hueco más deprisa que su texto —a 1.024 quedaban 93 px para un rótulo
de 230— y por debajo de 1.280 px es solo su icono. Y el **tipo de la columna** se
cortaba en las cabeceras estrechas y en las anchas se iba al borde derecho
pareciendo de la siguiente: ahora la cabecera se mide a sí misma y por debajo de
150 px no lo enseña.

De camino: el diagrama era el único diálogo que no cerraba con Escape, y el
círculo de color de preferencias escondía 26 px para agrandar su área de clic.
El propio barrido aprendió a distinguir **recortar de cortar**: un texto con
puntos suspensivos y sitio para leerse es una decisión, no un hallazgo.

#### Nada de fuera entra ya por una etiqueta que otro puede mover

`actions/checkout@v4` y `mssql/server:2022-latest` son punteros ajenos: quien los
controle cambia lo que ejecutan los runners —con los secretos delante— sin que
aquí cambie una línea. Las seis acciones van por SHA y las tres imágenes de
servicio con etiqueta y digest, comprobados contra sus registros. `dtolnay/rust-toolchain`
necesitó además `toolchain: stable` explícito: fijada por SHA ya no puede deducir
el canal del nombre de la rama. Y entra Dependabot en la misma tanda, porque
«fijado» se convierte en «olvidado» en unos meses.

#### El modo estricto cabía, y la cuadrícula no se podía leer

`strict` y `strictTemplates` estaban por activar y el plan los daba por
incrementales y ruidosos. Activados de golpe, el frontend compiló **sin un solo
error**: salieron cuatro avisos de `??` y `?.`, tres ciertos y uno que delataba
un tipo que mentía —un `Record` promete que toda clave existe y devuelve
`undefined` igual—.

La cuadrícula de resultados eran divs con aspecto de tabla: sin `role="grid"` por
encima, las filas y celdas no son nada para un lector de pantalla. Ahora dice su
tamaño —el total de verdad, contando las filas que aún no se han pintado—, cada
celda dice dónde está, y la cabecera y el asa se manejan con el teclado: Intro y
Espacio seleccionan la columna, las flechas la ensanchan y Mayúsculas va de 64 en
64. Ajustar una columna era lo único que exigía arrastrar el ratón.

#### Y el tope del XLSX contaba lo que no era

«200 000 filas caben holgadamente» era una corazonada, y estaba puesta en la
magnitud equivocada. Medido —diez columnas de texto, en este equipo— la memoria
va lineal con las **celdas**: 72 MB de montón vivo con 10 000 filas, 200 MB con
50 000, 370 MB con 100 000 y **732 MB con 200 000**, reservando 3,1 GB por el
camino. Unos 370 bytes por celda. Con cuarenta columnas, el mismo tope en filas
pedía cerca de 3 GB y el proceso moría a mitad. Ahora el límite cuenta celdas
—dos millones— y el pico se queda en unos 730 MB sea cual sea la forma de la
tabla. La medición se pide con `DRUSE_MEDIR_XLSX=1`; la cuenta del tope se
comprueba siempre.

**Verificado.** El barrido entero, con la consola limpia y **un solo hallazgo**
—que la base de pruebas no tiene procedimientos, que no es un defecto—; a 1.440,
1.024 y 900 px nada desborda. Las capturas de los tres anchos revisadas a ojo.
Y el camino crítico contra PostgreSQL, con su conexión guardada y borrada.

**Pruebas.** 815 del frontend, **563 unitarias** del backend y **177 de
integración de 177**, con PostgreSQL, MySQL y SQL Server levantados. Del e2e: 43
pasaron en una pasada completa y las cuatro de SQL Server, que entonces fallaban
por no tener su contenedor, pasan ahora en 1,2 minutos con él levantado. **La
pasada completa final quedó a medias**, parada a petición: lo comprobado son los
archivos por separado, todos en verde.

Un aviso para la próxima: cuatro de esos fallos no eran del código sino del
estado acumulado en `%TEMP%\druse-e2e-datos` tras varias pasadas del barrido
—agotaban los cuatro minutos de tiempo máximo—. Vaciar esa carpeta los devolvió
a verde; conviene borrarla cuando las pruebas empiecen a ir lentas.

**Archivos.** `SecretWriter.cs` (nuevo), `SavedConnectionService.cs`,
`SavedAiProviderService.cs`, `Contracts.cs`, `status-bar.*`, `top-bar.*`,
`results-grid.*`, `editor-toolbar.*`, `diagram-panel.html`,
`settings-dialog.scss`, `tsconfig.json`, `.github/workflows/*`,
`.github/dependabot.yml` (nuevo), `docs/decisions/0004-*.md`, `barrido.spec.ts`,
`test-db.ps1`, `XlsxResultExporter.cs` y `XlsxMemoryTests.cs` (nuevo).

**Estado al cerrar.** Commiteado en `main`.

### Sesión 045 — 2026-09-07 · El contrato, el foco y una migración que se repetía

Fase 5 del plan de mejoras: lo que se podía cerrar sin abrir un frente grande.

#### El contrato HTTP no estaba escrito en ninguna parte

El gateway de Angular llama a rutas literales escritas a mano. Renombrar una en el
backend **no rompe ninguna compilación**: rompe la aplicación en marcha, y solo
cuando alguien pulsa ese botón.

Ahora el documento OpenAPI vive en `docs/api/openapi.json` —81 rutas, 48 esquemas—
y dos pruebas lo sujetan: que lo publicado y lo guardado digan lo mismo, y que
cada ruta que llama la interfaz exista en el contrato. Se comparan por su forma y
no por el nombre del parámetro: el servidor declara `{sessionId}` y el cliente
escribe `${id}`, y hablan del mismo hueco.

#### Los diálogos se abrían y el foco se quedaba detrás

Con `Tab` se recorrían los botones de la barra superior sin verlos, y al cerrar
el foco se quedaba en el cuerpo del documento. Una directiva se encarga de las
tres partes —entrar, quedarse y volver— en los trece diálogos, aplicada por la
clase que ya comparten.

#### Una migración que se repetía en cada arranque

El `UPDATE` que movía los perfiles de SQL Server a «certificado y nombre»
—escrito ayer mismo— corría cada vez que se abría Druse: quien después eligiera a
conciencia solo cifrado se lo encontraba cambiado de vuelta. Ahora se lee
`user_version`, los pasos que tocan datos se aplican una sola vez, y todo va
dentro de una transacción.

Y la barra de estado llama a cada motor por su nombre: se escribía con un
condicional de tres ramas, así que una conexión Informix decía «MySQL 14».

#### Y las contractuales dejaban basura

`DROP PROCEDURE nombre()` busca la sobrecarga sin parámetros y la que crean tiene
dos: no borraba nada y con `IF EXISTS` tampoco se quejaba. Doce procedimientos se
habían ido acumulando en la base de pruebas y salían en el barrido de capturas.

**Verificado.** En la aplicación real: al abrir Preferencias el foco entra en el
diálogo y al cerrar con Escape vuelve al botón que lo abrió. El barrido recorre
los trece diálogos con la consola limpia. Y tras ejecutar la contractual del
procedimiento, la base queda sin rastro.

**No hecho.** Lo que queda de la fase 5 es lo grande: **FE-001 a FE-003** son
extracciones de `WorkspaceStore` y `AppShell` que no se pueden hacer a medias;
**FE-004** es incremental y ruidoso; **BE-001 y BE-002**, lo mismo en el backend.
**A11Y-001 a A11Y-003** tocan la cuadrícula de resultados, el componente más
delicado que hay, y **A11Y-005** no es programar: es sentarse con un lector de
pantalla.

**Pruebas.** 1.005 del backend —552 unitarias, 174 de integración de 177 y 279
contractuales— y **801 del frontend**, con el barrido entero en verde.

**Archivos.** `ApiContractTests.cs`, `docs/api/openapi.json`, `DruseDatabase.cs`,
`shared/a11y/dialog-focus.ts` y los trece diálogos, `workspace-store.ts`,
`engine-badge.ts`, `PostgreSqlFixture.cs` y sus pruebas.

**Estado al cerrar.** Commiteado en `main`.

### Sesión 044 — 2026-09-07 · Un fallo en el equipo del usuario deja de perderse

Fase 4 del plan de mejoras: observabilidad y límites. Y, de camino, una fase 7
nueva en el plan —interfaz— que no estaba y hacía falta.

#### La API registraba en una consola que no existe

El envoltorio arranca la API sin ventana —una consola de ASP.NET delante de Druse
sería peor— y con ella se iba el único sitio donde se veían los registros. El
directorio de registros llevaba desde el principio en `AppPaths`, **vacío**.

Ahora hay registro en archivo con rotación por tamaño y unos pocos archivos
conservados. Se escribe a mano: son un archivo, un candado y un contador de
bytes, frente a una dependencia más dentro del instalador.

**Y no puede llevar secretos.** Cada línea pasa por un saneado, y no como opción
sino como único camino: los drivers ponen la cadena de conexión entera en sus
mensajes de error, con la contraseña dentro. El token de la API tampoco pasa.
Cada línea dice además de qué operación es —sin eso, un respaldo y una consulta a
la vez dejan un registro que no se puede separar—.

Encima de eso, el **paquete de diagnóstico**: un botón en Preferencias que
descarga un zip con los registros y un resumen de versión y sistema. Lo que lleva
está pensado para poder enseñarlo; si hubiera que revisarlo antes de mandarlo, no
lo mandaría nadie.

#### Tres límites que no limitaban

- **El tope de filas se aplicaba a cada resultado.** Una pulsación de «Ejecutar»
  con diez `SELECT` y un tope de 500 traía cinco mil filas a la memoria del
  proceso y del navegador. Ahora el presupuesto es del lote, y lo que se queda
  fuera se marca: un resultado vacío sin marca se lee como «no devolvió nada».
- **El CSV de importación se leía entero** y se recortaba después. Con dos gigas,
  el proceso se caía antes de mirar el límite. Ahora se lee fila a fila y se corta
  al llegar.
- **Un `.xlsx` es un zip**, y ClosedXML lo carga entero: dos megas de archivo con
  veinte gigas dentro tumban Druse. Se mira el índice antes de abrirlo.

#### Y una fase que faltaba en el plan

Preguntado si el plan cubría UX/UI, la respuesta era **no**: solo accesibilidad y
refactor de frontend. Mirando las capturas del barrido de la 042 apareció una real
y arreglada —el `overviewRuler` de Monaco es un `<canvas>` y no hereda el fondo:
en el tema claro dejaba una franja negra pegada al borde derecho— y nueve más
anotadas en la **fase 7** del plan: tipos de columna que se cortan, la barra de
estado recortada a 900 px, `Ln/Col` dicho dos veces, «~ filas» sin número.

**Verificado.** Con la API real: el archivo de registro aparece con las líneas del
arranque y el token no está dentro; `/api/diagnostics` responde 401 sin token y
devuelve el zip con `resumen.txt` y `logs/druse.log` con él. La franja del editor
se comprobó levantando la aplicación y llegando al elemento por el DOM.

**No hecho.** **PERF-004**: medir la memoria de una exportación XLSX grande, que
es medir y no programar. **PERF-005**: aflojar el turno por sesión, que es lo que
hoy impide que dos operaciones se pisen en la misma conexión.

**Pruebas.** 1.002 del backend —551 unitarias, 172 de integración de 175 y 279
contractuales— y **795 del frontend**.

**Archivos.** `Diagnostics/{FileLogger,LogRedaction,LogScope,DiagnosticPackage}.cs`,
`Program.cs`, los cuatro `*QueryExecutor.cs`, `CsvTableFileReader.cs`,
`XlsxTableFileReader.cs`, `druse-theme.ts`, `settings-dialog.*` y sus pruebas.

**Estado al cerrar.** Commiteado en `main`.

### Sesión 043 — 2026-09-07 · Las promesas de seguridad que no cumplía nadie

Fase 3 del plan de mejoras, entera salvo una tarea. Todo lo de aquí eran cosas
que la pantalla prometía y nadie cumplía.

#### «Solo lectura» no impedía escribir

Marcar la conexión como solo lectura hacía **una** cosa: que el analizador de SQL
rechazara el texto si contenía `INSERT`, `UPDATE` y unas cuantas palabras más. Es
un análisis léxico, y hay escrituras que no ve.

Ahora, donde el motor tiene sesiones de solo lectura, Druse las pide al abrir:
`SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` en PostgreSQL y `SET
SESSION TRANSACTION READ ONLY` en MySQL. SQL Server e Informix no tienen nada
equivalente y **eso se dice** en vez de disimularse: la sesión expone si la
protección es del motor, y el diálogo de conexión cambia su texto según el caso.

La prueba que lo demuestra es una función de PostgreSQL que hace `INSERT` por
dentro: llamada con un `SELECT`, el analizador la aprueba —y hace bien, lo que
hay dentro está en el servidor— y el motor la rechaza. La tabla queda vacía.

#### «Cifrado verificado» no verificaba nada

Era la etiqueta de `require`, y en PostgreSQL y MySQL `require` **solo cifra**:
acepta un certificado autofirmado, caducado o de otro dominio. Ahora los modos son
cinco, significan lo mismo en los cuatro motores y cada uno dice de qué protege.

SQL Server era el raro: allí `require` sí ponía `TrustServerCertificate` en falso.
Al pasar a la semántica común esos perfiles habrían perdido la comprobación sin
que nadie se enterase, así que la migración de la base local los mueve a
`VerifyFull`, que es lo que ya hacían.

#### Restaurar aplicaba lo que hubiera en la ruta

Entre inspeccionar y aceptar cabía cualquier cosa. Ahora la inspección devuelve
una huella del artefacto y la restauración la exige: sin ella no se aplica nada, y
si no coincide tampoco. **No es un hash del contenido** —leer gigabytes otra vez
sumaría minutos a cada restauración— sino un resumen de qué archivos lo forman,
cuánto ocupan y cuándo se tocaron; está escrito qué detecta y qué no.

Y el catálogo del destino deja de mentir: cuando no se puede leer, se dice, en
lugar de devolver «no hay colisiones», que en la pantalla se lee igual que «no se
sobrescribe nada».

#### Lo que estaba abierto en el disco

El directorio de datos y la base local se creaban en Unix con permisos legibles
para cualquier cuenta de la máquina: ahí están las conexiones del usuario, su
historial y **el token de la API local**. Ahora quedan en `700` y `600`, con los
`-wal` y `-shm` incluidos.

Y un CSV exportado podía ejecutarse al abrirlo: las hojas de cálculo interpretan
como fórmula lo que empiece por `=`, `+`, `-` o `@`, y ese texto viene de la base.
Al exportar para mirar sale como texto; **en los respaldos no**, porque ese CSV
vuelve a una base y tiene que salir tal cual entró.

**Verificado.** Contra PostgreSQL y MySQL de verdad: el `SELECT … INTO` que el
analizador deja pasar, la función con efectos laterales, el `CREATE TABLE` por el
ejecutor, y los modos de cifrado —exigirlo contra un servidor sin TLS falla, que
es la única forma de saber que la opción llega al driver—. La huella se comprobó
restaurando sin ella y con una de antes de tocar el archivo: las dos veces se
planta y la tabla del artefacto no llega a existir.

**No hecho.** **SEC-007**: elegir la CA y el certificado de cliente. Y de SEC-004
quedan fuera `COPY FROM` y `LOAD DATA`, que no viajan como una instrucción más
—usan su propio protocolo— y exigen montar ese camino aparte.

**Pruebas.** 980 del backend con PostgreSQL y MySQL levantados —547 unitarias, 159
de integración de 162 y 274 contractuales— y **792 del frontend**.

**Archivos.** Los cuatro proveedores, `IDatabaseProvider.cs`, `ConnectionProfile.cs`,
`RestoreService.cs`, `ArtifactFingerprint.cs`, `CsvResultExporter.cs`,
`AppPaths.cs`, `DruseDatabase.cs`, contratos, `connection-dialog.*`,
`restore.store.ts` y sus pruebas.

**Estado al cerrar.** Commiteado en `main`.

### Sesión 042 — 2026-09-07 · Cerrar Druse con trabajo en marcha, y la API que ya no muere a la fuerza

Fase 2 del plan de mejoras: el ciclo de vida de las operaciones largas. Entra
entera la **primera entrega**; de la segunda solo lo que no dependía del
rediseño.

#### Cerrar ya no tira el trabajo sin preguntar

Con una transacción abierta, cerrar preguntaba. Con un respaldo, una restauración
o un traslado en marcha, no: se cerraba y el trabajo moría dentro del proceso,
dejando un artefacto a medias con pinta de terminado o una base a medio escribir.

Ahora la interfaz declara qué hay en marcha —«un respaldo», «una restauración»,
«un traslado de datos»— igual que ya declaraba las transacciones, y el envoltorio
lo nombra en el aviso. `transactions.rs` pasó a `pending_work.rs`, que es lo que
guarda ahora: las dos cosas que no se pueden perder al cerrar. Con las dos, manda
el trabajo.

Y «Cancelarlo y cerrar» **no cierra de inmediato**: pide a la interfaz que
cancele, espera a que la API lo confirme y solo entonces destruye la ventana. Si
no para en treinta segundos, no se cierra. Actualizar sigue la misma regla, pero
ahí no se pregunta: se dice que no y se explica qué está corriendo.

#### La API se apaga, no se mata

`stop()` la mataba siempre, y matarla **se salta `ApplicationStopping`**: ahí es
donde cierra las sesiones contra las bases del usuario y sus túneles SSH. Es
decir, cada cierre normal de Druse cortaba esas conexiones de golpe.

Ahora se le pide el apagado por HTTP —`POST /api/shutdown`, con el token, que es
la ruta más destructiva que tiene— y se espera hasta diez segundos; matarla queda
para cuando no responde. La petición se escribe a mano sobre un socket: es una
petición sin cuerpo a `127.0.0.1`, y esto corre dentro del cierre de la ventana,
donde no hay runtime asíncrono.

#### Un traslado «todo o nada» que falla no copió nada

El contador sumaba cada lote escrito, también dentro de la transacción, así que al
fallar el resultado decía «se copiaron 40.000 filas» mientras el motor las estaba
deshaciendo. Ahora se cuentan aparte las filas sin confirmar: se enseñan mientras
corre, cuentan al confirmar y se descuentan —con un aviso— al fallar o cancelar.

**Verificado.** El aviso se vio salir en la ventana de verdad: se levantó la API
y Angular con `DRUSE_DATA_DIR` aislado, `cargo tauri dev` con el puerto de
depuración del WebView, y desde CDP se declaró un trabajo en marcha y se pidió
cerrar. Salió el diálogo con su texto, y al aceptarlo la interfaz canceló, llamó a
`confirm_close` y la ventana se cerró.

**Y mirarlo enseñó algo que las pruebas no decían**: el envoltorio pidió el
apagado y recibió **404**, porque el binario de `shells/desktop-tauri/api` era de
una compilación anterior a la ruta. Esperar diez segundos a esa API no sirve de
nada, así que ahora se lee el código de la respuesta: si no es 2xx, se mata sin
esperar. De paso quedó comprobado que el token viaja bien —un token malo habría
dado 401 antes de llegar al enrutador—.

#### Y los trabajos largos dejan de colgar de la petición que los pidió

Cada endpoint lanzaba su `Task.Run` y se iba. Ese hilo se llevaba **los servicios
del scope de la petición HTTP** —el de respaldo, el de conexiones, los almacenes
de SQLite— y los seguía usando durante horas, con ese scope ya cerrado. Ahora hay
una cola con un `BackgroundService`: cada trabajo recibe su propio scope y un
token que se cancela también al apagar la API. **No se serializan**: arrancan en
cuanto llegan, como antes; lo que cambia es que alguien los conoce y los espera.

Y quedan anotados en SQLite —qué era, sobre qué, cuándo y cómo acabó; ni
credenciales, ni SQL, ni filas—. Al arrancar, lo que siga figurando «en marcha»
se marca **interrumpido**: si nadie escribió su final, el cierre anterior se lo
llevó por delante. La barra de estado lo dice al volver a abrir, con el detalle
en el tooltip, y se descarta al pulsarlo.

Qué hacer con uno de esos no lo decide Druse: un respaldo se repite, una
restauración se reanuda con `ResumeFrom` y un traslado depende de si era «todo o
nada». Está escrito en `JobKind` y en el plan de respaldos.

**Comprobado con la API de verdad**: se dejó un trabajo «en marcha» en la base,
se mató el proceso y al reabrir apareció como interrumpido en `/api/jobs`, con su
línea en el log. Y el aviso se vio en la barra de estado del navegador, con su
texto y su tooltip, y desapareció al pulsarlo. **No entra en el barrido de
capturas**: para que salga hay que dejar un trabajo a medias en la base, y eso el
barrido no lo puede fabricar sin escribir en el SQLite por su cuenta.

**Pruebas.** 964 del backend con PostgreSQL levantado —539 unitarias, 158 de
integración de 161 y 267 contractuales—, **792 del frontend** y **23 del
envoltorio**, con `fmt` y `clippy` limpios.

**Archivos.** `shells/desktop-tauri/src/{pending_work.rs,api_process.rs,main.rs,updates.rs}`,
`Program.cs`, `DependencyInjection.cs`, `Jobs/JobRunner.cs`,
`Abstractions/IBackgroundJobs.cs`, `SqliteJobStore.cs`, `DruseDatabase.cs`, los
tres endpoints de trabajos largos, `Transfers/TransferService.cs`,
`core/jobs/running-jobs.service.ts`, `core/files/pending-work.service.ts`,
`desktop-host.ts`, `application-gateway.ts`, `status-bar.*`, `app-shell.ts` y sus
pruebas.

**Estado al cerrar.** Commiteado en `main`.

### Sesión 041 — 2026-09-07 · El CI que no probaba nada y el respaldo que no volvía igual

Sesión de las dos primeras fases de `PLAN_MEJORAS_DRUSE.md`, escrito en la 040 y
todavía sin commitear al empezar.

#### El comando de pruebas del backend no ejecutaba ninguna

`dotnet test backend/Druse.slnx` terminaba **correctamente** sin ejecutar una
sola prueba. Desde el SDK 10.0.400 el comando solo entra en los proyectos que se
declaran de prueba con `IsTestProject`, y ninguno de los tres lo hacía. Con la
propiedad puesta, la misma orden pasa de **cero a 870**: 521 unitarias, 82 de
integración y 267 contractuales.

Eso es lo peor que puede pasarle a un check: quedarse verde sin comprobar nada.
Para que no se repita en silencio, `build/scripts/check-tests.ps1` lee los TRX de
la pasada y rompe el job si falta una suite, si alguna no descubrió pruebas o si
el total no llega al mínimo; de paso deja el recuento en el resumen del job.

Con eso, el resto de la fase 0: `-m:1` en el backend —la carrera de IKVM—, el
puerto 9088 de Informix publicado con `DRUSE_TEST_IFX_SQLI_PORT` (sin él las
pruebas del transporte SQLI se omitían calladas), `npm run typecheck` en las
pruebas de punta a punta, y `cargo fmt --check`, `cargo clippy -- -D warnings` y
las 17 pruebas del envoltorio, que hasta ahora solo se lanzaban a mano. `cargo
fmt` cambió cinco archivos, en su propio commit.

Y publicar deja de poder hacerse a ciegas: `release.yml` pregunta por la última
ejecución de CI de ese commit y se planta si no terminó en verde. Lo único que
queda de la fase 0 es la facturación de GitHub, que no es código.

#### El respaldo pasa al formato 2, que es el primero reversible

Tres cosas impedían que un ida y vuelta devolviera lo que había, y las tres
pasaban sin decir nada:

1. **Los archivos se llamaban solo como la tabla.** `ventas.clientes` y
   `compras.clientes` compartían archivo: en una carpeta el segundo se escribía
   **a continuación** del primero y en un zip quedaban dos entradas con el mismo
   nombre, de las que quien lo abre ve una. Ahora cada entrada se nombra
   `esquema.tabla`, y al restaurar se resuelve primero por ese nombre y luego,
   si el destino no tiene ese esquema, por el corto —que es lo que permite
   restaurar en otra base—.
2. **En los CSV, el nulo y la cadena vacía se escribían igual**, y los dos
   volvían como cadena vacía. Se adopta la convención de `COPY ... WITH CSV`: el
   nulo en blanco, la cadena vacía con sus dos comillas. La exportación normal no
   cambia, que esa acaba en una hoja de cálculo.
3. **El manifiesto de una carpeta a medias era de relleno**: PostgreSQL, versión
   0.0.0, sin servidor ni base y siempre «cancelado». Una carpeta de SQL Server
   que había fallado se presentaba como una de PostgreSQL que alguien paró.

Los artefactos anteriores se siguen restaurando y sus blancos siguen siendo
cadena vacía —leerlos como nulos cambiaría datos ya guardados—, y la inspección
lo avisa. El aviso genérico que salía siempre que había CSV se quedó **solo para
esos**: desde el formato 2 no advierte de nada, y un aviso que no advierte enseña
a no leerlos.

#### Y deja de escribir encima de lo que había

- **La carpeta se reutilizaba en silencio.** Ahora se rechaza antes de tocar
  nada, con una casilla nueva en el asistente para decir que sí; entonces borra
  el respaldo anterior y **solo** el respaldo anterior, que la carpeta puede
  tener además cosas del usuario.
- **El archivo se creaba con su nombre definitivo.** Durante las horas que tarda,
  un `.sql` a medias tiene la pinta de uno terminado, y si fallaba, el bueno del
  día anterior ya no estaba. Se escribe como `.parcial` y solo recibe su nombre
  al estar entero.
- **`ResumeFrom` por encima del final** se saltaba todas las instrucciones y la
  restauración se daba por buena sin aplicar ni una. Se valida contra lo que trae
  el artefacto, que ya se contaba para la barra.

#### Lo que enseñó mirarlo

Con la casilla nueva en el barrido de capturas se vio que, con «Carpeta por tipo
de objeto» elegida, el campo del destino seguía proponiendo `respaldo-….sql`:
quien acepta la propuesta acaba con una carpeta llamada como un archivo. Un
renglón y su prueba.

Y el barrido no arrancaba: **`ciudad` y `accionista` no las creaba nadie**
—anotado en la 034 y nunca resuelto—, así que un contenedor recién levantado
dejaba el diagrama sin nada que dibujar. Ahora las siembra `test-db.ps1` al
crear PostgreSQL.

**Verificado.** 870 pruebas del backend descubiertas y ejecutadas por el comando
de siempre; con PostgreSQL levantado, **155 de 158 de integración** —las otras 3
son de motores que no estaban— incluido el respaldo y la restauración reales por
HTTP con nulos y cadenas vacías conservados; **787 del frontend**; **17 del
envoltorio**, con `fmt` y `clippy` limpios; y el **barrido entero en verde con la
consola limpia**, con la captura nueva `10b-respaldo-destino.png`.

**No hecho.** El `DATE` de Informix por SQLI (BKP-006) sigue abierto: reproducirlo
necesita ese contenedor y en esta sesión solo se levantó PostgreSQL. Ojo con las
contractuales: **las 267 salen verdes sin motores delante**, porque cuando el
servidor no responde cada prueba termina sin comprobar nada; solo
`DRUSE_REQUIRE_ENGINES=1` —lo que pone el CI— lo convierte en rojo.

**Archivos.** `.github/workflows/{ci,release}.yml`,
`build/scripts/{check-tests.ps1,test-db.ps1}`, los tres `.csproj` de pruebas,
`Backups/{BackupService,RestoreService,PreviewSink}.cs`,
`Infrastructure/Backups/{BackupSinks,BackupArchive}.cs`,
`Exports/CsvResultExporter.cs`, `Importing/{CsvRowReader,CsvTableFileReader}.cs`,
`Domain/Backup.cs`, contratos y endpoints de respaldo, `backup-dialog.*`,
`application-gateway.ts`, `e2e/tests/barrido.spec.ts`, y sus pruebas.

**Estado al cerrar.** Commiteado en `main`.

### Sesión 040 — 2026-09-01 · Los avisos que nadie leía, el envoltorio que no obedecía y el teclado

Sesión de cuatro temas, encadenados: se empezó por callar los avisos de la
compilación y se acabó encontrando un fallo del envoltorio que engañaba
pareciendo que funcionaba.

#### Los cuatro avisos del build, arreglados por su causa

Compilar el frontend daba cuatro avisos desde hacía tiempo. Se arreglaron los
cuatro **sin subir ningún techo**, salvo uno que se subió a conciencia y ya
saneado:

1. **El arranque pesaba 611 kB contra un presupuesto de 500.** La causa no era
   Angular: eran cinco diálogos —conexión, importar, migrar una tabla, migrar
   varias y el diseñador— que viajaban con la ventana aunque nadie los abriera,
   185 kB entre los cinco. Ahora van en `@defer`, que es lo que ya hacían los
   otros nueve del mismo archivo. **611.27 → 376.83 kB**, y el presupuesto se
   queda donde estaba.
2. **Tres estilos de componente pasaban de 8 kB.** `.backdrop` estaba copiado
   literalmente en catorce componentes, `.dialog` en doce, la base de `.btn` en
   once y la cabecera del diálogo en nueve: **10.9 kB de CSS repetido** que ahora
   viven en `styles/_shell.scss`. Manda el componente, que se pinta después y con
   más especificidad, así que las tres excepciones reales —el velo más borroso de
   la paleta, el cerrar con fondo de preferencias, el botón secundario del
   diseñador— siguen ganando sin `!important`.
3. **Dos «Not implemented: navigation to another Document» en cada pasada de
   pruebas.** Salían de las pruebas de exportación de `WorkspaceStore`, que
   usaban el `FileSaveService` de verdad: ese servicio crea un enlace y lo pulsa,
   y jsdom avisa. Ahora reciben un doble. El aviso no señalaba nada roto, y ese
   era el problema: un ruido fijo en la salida enseña a no leerla.
4. **`nearley`** queda declarado como dependencia CommonJS —lo carga
   `sql-formatter` y no hay versión ESM—, que es lo que Angular pide hacer.

Lo único que subió fue el presupuesto de estilo por componente, a **9.5 kB**, y
sobre un CSS del que ya se había quitado todo lo copiado: los tres que lo rozan
—el panel del asistente, el diálogo de proveedores y el compositor de consultas—
son pantallas densas cuyo CSS es suyo, y bajarlos exigiría partir los
componentes, que es otra conversación.

#### El envoltorio no obedecía a `DRUSE_DATA_DIR`

Se descubrió intentando mirar el ejecutable empaquetado sin tocar el Druse que el
usuario tenía abierto. **La API respeta esa variable desde que se montaron las
pruebas de punta a punta** —se descubrió entonces que creían correr aisladas y
estaban usando la base de verdad— pero el envoltorio de Tauri no la miraba:
calculaba el directorio de datos por la convención del sistema y ahí buscaba el
`endpoint.json`.

Con la variable puesta, cada mitad hacía una cosa. La API arrancaba perfectamente
y publicaba su punto de conexión donde se le pedía; el envoltorio lo esperaba en
el perfil del usuario, no lo veía nunca, y a los treinta segundos la ventana
moría con un `panic` de Tauri diciendo que **la API no había arrancado**. Había
arrancado, y estaba escuchando.

Y el modo de fallar no era lo peor: si en el perfil quedaba el `endpoint.json` de
otra instancia de Druse —la del usuario, abierta— la ventana nueva se conectaba a
**la API de esa otra**. Abría, parecía correcta, y estaba trabajando contra el
espacio que se creía aislado. Es el mismo engaño que la API documenta haber
sufrido, repetido en la otra mitad. **Pasó de verdad en esta sesión**, con una
ventana de prueba hablando con el espacio de trabajo real.

`data_directory` aplica ahora la misma regla que `AppPaths`: la variable manda, y
una ruta relativa se ignora en lugar de escribir en un sitio sorpresa. La
decisión vive en `resolve_data_directory`, aparte del entorno del proceso, para
poder probarla sin tocar variables globales que comparten todas las pruebas.
Cuatro pruebas nuevas; **el envoltorio pasa de 13 a 17**.

#### El diagrama, también de la base entera

«Ver diagrama…» solo salía sobre un esquema o una tabla. En PostgreSQL con todo
en `public`, o en MySQL —donde no hay esquema aparte de la base—, eso ya era el
mapa completo; pero en SQL Server e Informix una base tiene varios esquemas, y el
mapa de la base no se podía pedir sin abrirlos uno a uno.

El panel ya sabía hacerlo: `tablesUnder` desciende sola por carpetas **y por
esquemas**, y al abrir se pregunta siempre qué entra, así que ofrecerlo sobre una
base no dibuja trescientas cajas de golpe. Lo que hizo falta fue decir de qué
esquema es cada tabla, y se resuelve **distinto en cada sitio porque el problema
es distinto**:

- **En el selector**, el esquema delante de todas las filas en cuanto hay más de
  uno: elegir entre dos filas que ponen «orders» no es elegir.
- **En el lienzo**, solo en las cajas cuyo nombre se repite. La caja mide 218 px
  fijos; anteponerlo a todas cortaría nombres que hoy caben, a cambio de repetir
  un dato que allí no desempata nada.

Se vio dibujando una base con dos esquemas: **dos cajas «accionista» idénticas y
una flecha entre ellas que no se podía leer**. Esa comprobación —hecha creando un
esquema de prueba y borrándolo después— es la que trajo el cambio del lienzo, que
no estaba previsto.

Y la clave con la que se reconoce un diagrama guardado dice ahora de qué clase
es: `database:ventas` y `schema:ventas` son cosas distintas, y una base y un
esquema homónimos son lo corriente en MySQL.

#### El teclado: varios cursores, los atajos que faltaban y una hoja

**Varios cursores con Ctrl+clic.** Ya existían —Monaco los trae desde siempre—
pero con Alt, que es lo que usan VS Code y los que vienen de ahí; quien llega
desde Notepad++ prueba Ctrl, no ve nada y da por hecho que no están. Es una
opción de configuración, así que **ninguna prueba de componente la ve** —en ellas
Monaco es un doble— y se comprueba en `e2e/tests/editor.spec.ts` con el editor de
verdad cargado.

**Los atajos que faltaban**, y el más obvio era moverse entre pestañas:
`Alt+1..8` a la enésima, `Alt+9` a la última, `Alt+←/→` dando la vuelta por los
extremos, `Ctrl+F4` cerrar. Van con Alt y F4 a propósito: `Ctrl+Tab`, `Ctrl+W` y
`Ctrl+1` se los queda el navegador y no llegan a la página, y **un atajo que
funciona empaquetado y no en el navegador es peor que no tenerlo**. Además
`Ctrl+Shift+R` lleva el teclado a los resultados —enfocando una celda, no el
marco, porque de la celda cuelgan las flechas y el copiado—, `Esc` lo devuelve al
editor, `F5` repite la ejecución y `Ctrl+Shift+X` abre el menú de exportar. Con
un diálogo delante no actúa ninguno.

Qué tecla significa qué vive en `core/shortcuts`, como función pura y con once
pruebas. Ahí se comprueban los modificadores **enteros**: sin eso, `Ctrl+Alt+1`
—que en varios teclados es como se escribe un carácter— cambiaría de pestaña
mientras alguien escribe.

**Una hoja con todos, en F1.** Estaban repartidos entre el editor, el shell, el
explorador y los tooltips de media aplicación, y no había dónde verlos juntos. La
hoja es documentación, y una documentación que miente es peor que ninguna: una
prueba comprueba que los atajos globales que anuncia los atiende de verdad
`shortcutFor`.

**Dos cosas salieron del barrido y no de las pruebas:** Monaco se quedaba `F1`
para su propia paleta de comandos —hubo que registrarlo también dentro del
editor—, y la hoja no se cerraba con `Esc` porque el foco seguía en Monaco, que
tiene esa tecla para cancelar; ahora el diálogo toma el foco al abrirse.

**Ocho comandos nuevos en la paleta:** duplicar la pestaña, cerrar las demás,
copiar el nombre calificado, ver el diagrama de donde se trabaja, las tres de
transacción y la hoja de atajos. Las de transacción **sin atajo a propósito**:
confirmar o deshacer de un dedazo es de las pocas cosas de Druse que no se
deshacen.

#### Verificado

- **Compilación sin un solo aviso.** Arranque en **376.83 kB** (era 611.27).
- **779 pruebas del frontend en verde**, 40 nuevas en la sesión. Y **17 del
  envoltorio**, cuatro nuevas.
- **Backend recompilado con `-m:1`: 0 advertencias, 0 errores.**
- **`e2e`: las ocho del editor** —incluida la del multicursor con Monaco de
  verdad— y **el barrido entero**, con la consola del navegador limpia y dos
  capturas nuevas: `06b-atajos` y `20-mer-base-tablas`.
- **Las quince capturas de diálogos salieron idénticas píxel a píxel** antes y
  después del refactor de estilos. La barra de ediciones del panel de resultados
  no entra en el barrido y se fotografió aparte, con y sin el cambio: también
  idéntica.
- **Instaladores regenerados tres veces y la variante completa instalada y
  abierta**, comprobando que el binario instalado lleva el arreglo del envoltorio.

#### No hecho

- **El multicursor no se ha probado dentro de la ventana empaquetada.** La prueba
  de punta a punta corre en Chromium; es el mismo Monaco, pero es literalmente la
  clase de cosa que en este proyecto ya ha fallado solo empaquetada.
- **Los instaladores siguen sin firma Authenticode**: SmartScreen en cada equipo.
- **Los tres estilos por encima de 8 kB** siguen ahí, ahora bajo un techo de 9.5.
  Bajarlos de verdad exige partir el panel del asistente, el diálogo de
  proveedores y el compositor de consultas.
- **El diagrama de una base con varios esquemas no queda fotografiado en el
  barrido**: la base de pruebas tiene un solo esquema, y el segundo se creó y se
  borró en la sesión.

#### Archivos

`frontend/src/styles/_shell.scss` y `styles.scss`, diecinueve `*.scss` de
`features/**` y `layout/**`, `frontend/angular.json`,
`layout/app-shell/{app-shell.html,app-shell.ts,app-shell.spec.ts}`,
`core/workspace/workspace-store.spec.ts`,
`core/shortcuts/{shortcuts.ts,shortcuts.spec.ts}`, `layout/shortcuts-sheet/**`,
`layout/command-palette/*`, `features/query-editor/sql-editor/sql-editor.ts`,
`features/query-results/{results-grid,results-panel}/*`,
`features/diagram/{diagram-panel,diagram-canvas}/*` con su primer
`diagram-panel.spec.ts`, `features/connections/connections-sidebar/*`,
`shells/desktop-tauri/src/api_process.rs`, `e2e/tests/{barrido,editor}.spec.ts`.

### Sesión 039 — 2026-09-01 · El diagrama entidad-relación: se planifica, se lee y se dibuja

Sesión larga y de una sola cosa: el MER, del backlog al lienzo.

#### Lo que se decidió antes de escribir nada

El plan entero está en `docs/plan-mer-y-diagramas.md`, con seis fases y sus
criterios de salida. Nueve decisiones, todas del usuario salvo las que se
señalan:

1. **Leer y editar desde el diagrama**, no solo mirarlo. El diagrama es donde se
   ve el problema; mandar a otra pantalla para resolverlo parte el gesto.
2. **Las claves declaradas y las inferidas por nombre, señaladas aparte.** Sin
   inferencia, media base real sale como tablas sueltas —MyISAM y casi toda base
   heredada—; sin distinguirlas, el diagrama miente.
3. **Pestaña propia**, que es donde cabe un esquema de trescientas tablas.
4. **Cualquier objeto de la misma conexión** en el mismo lienzo.
5. **Siempre se pregunta qué tablas entran.** Trescientas de golpe son una tela
   de araña y una espera.
6. **SVG propio, sin dependencias nuevas.** El frontend solo depende hoy de
   Monaco y `sql-formatter`, y con SVG propio exportar sale casi gratis.
7. **Imagen, texto (Mermaid y DBML) y papel**, las tres sobre el mismo SVG.
8. **Pata de gallo**, que se lee sin leyenda (decidido aquí).
9. **Una conexión por diagrama** (decidido aquí): mezclarlas dibujaría relaciones
   que ningún motor puede comprobar.

Y una regla que gobierna el resto: **el diagrama guardado no contendrá ni una
columna ni un tipo.** Se guardan las decisiones del usuario —qué entra, dónde
está, qué descartó— y el esquema se relee del catálogo al abrirlo, marcando lo
que ya no existe. Un diagrama que enseña una columna borrada hace seis meses no
se mira.

#### Fase A — la lectura en lote

La mitad del backend ya estaba: `GetTableStructureAsync` devuelve
`DatabaseForeignKey` con columnas, destino y acciones en los cuatro motores, que
es literalmente una arista. Lo que faltaba era **leer muchas tablas de una vez**.

Se añadió `GetTableDetailsAsync` al contrato de metadatos, con implementación por
defecto que itera —solo para que un proveedor nuevo arranque— y **las cuatro
propias**, cada una con el filtro que su catálogo admite: `unnest(@schemas,
@names)` en PostgreSQL, `JOIN (VALUES (@s0,@n0), …)` en SQL Server, `IN` de
tuplas en MySQL y una cadena de `OR` de pares en Informix, que no admite ninguna
de las tres. En los cuatro se interpolan **solo nombres de parámetro**.

El coste pasa a ser fijo: 4 consultas en PostgreSQL y MySQL, 5 en SQL Server e
Informix, **sean dos tablas o sesenta**. Informix era el caso grave —gastaba unas
diez por tabla, porque su catálogo obliga a resolver números de columna, índices
y restricciones antes de decir nada—: de ~600 viajes a 5.

Los métodos de una sola tabla siguen existiendo y **delegan en el lote**, así que
hay un único SQL por cosa y no dos que se separan.

Encima: `MetadataService.GetSchemaGraphAsync` —un solo turno de sesión, agrupando
por base— y `POST /api/sessions/{id}/metadata/graph`, que devuelve las tablas
leídas y, aparte, **las que se pidieron y ya no están**.

**Un fallo encontrado de paso:** en `MySqlMetadataReader`, el `catch` que toleraba
servidores sin `CHECK_CONSTRAINTS` —MySQL anterior a 8.0.16, MariaDB anterior a
10.2— atrapaba `MySqlException`, pero `QueryAsync` ya la había convertido en
`DatabaseOperationException`. **Nunca se cumplía**, así que en un servidor viejo
leer la estructura de cualquier tabla fallaba entera. Ahora se reconoce por el
código ya normalizado.

#### Fase B — el lienzo

La colocación es lógica pura y probada, que era el riesgo del plan: capas por
profundidad de dependencia, orden por baricentro y desempate por nombre. **Es
determinista** —hay una prueba que le pasa el mismo esquema en orden inverso y
exige posiciones idénticas—, los ciclos no la cuelgan, y el trazo ancla en la
fila de la clave cuando esa columna se ve.

El lienzo copia la anatomía de la aplicación: barra de 42 px con botones de 28,
tres niveles de detalle, interruptor de sugeridas en color de advertencia,
insignia `N:M` en las tablas puente, leyenda fija y arrastre. **Ni un color
literal:** todo pasa por los tokens, así que el tema claro sale solo.

Se abre desde el menú del explorador sobre un esquema o una tabla, como una capa
sobre el shell —igual que el diseñador de tablas—. **No es todavía la pestaña
propia del plan:** una pestaña exige persistirla, que es la Fase C, y una pestaña
de diagrama guardada como pestaña de SQL vacía sería peor que no tenerla.

Antes de escribir el componente se hizo el diseño en un lienzo aparte, con la
paleta y las medidas sacadas de `_tokens.scss`, y se aprobó ahí.

#### Hecho

- Plan `docs/plan-mer-y-diagramas.md` y entrada en el backlog del plan maestro.
- Contrato en lote en los cuatro proveedores, con su servicio y su endpoint.
- `MetadataBatch`: reparto por tabla y composición, lo único común a los cuatro.
- Colocación determinista, lienzo, panel contenedor y entrada en el explorador.
- Prueba de punta a punta del diagrama y sus capturas en el barrido.
- **Fase C entera:** el selector de tablas —llega con todo marcado y no pregunta
  sobre una tabla suelta—, **traer vecinas**, que lee el esquema entero una vez
  y lo recuerda, porque las que apuntan a una tabla no están en el grafo que se
  dibujó —sale barato por la lectura en lote: el esquema completo cuesta las
  mismas cuatro consultas que dos tablas—, y el **guardado**: tabla `diagrams`,
  `user_version` 7 y `/api/workspace/diagrams`. Lo guardado es
  `{target, tables, positions}`, sin una columna ni un tipo, así que las tablas
  que ya no existen no vuelven al lienzo.
- **Olvidar**, que el plan no había previsto: sin ella, guardar era irreversible
  —el esquema se abriría siempre igual, sin forma de volver a elegir—.
- **Fase D:** las relaciones que el motor no declara, deducidas del nombre de las
  columnas, en `Application/Diagrams`. Ocho de sus dieciséis pruebas comprueban
  que **no** sugiere —nombres genéricos, tipos que no encajan, dos candidatas—,
  que es la mitad que importa: una línea falsa es peor que ninguna.
- **Fase E:** los gestos del lienzo. Doble clic en cabecera o columna, menú de la
  tabla, y aceptar una sugerencia, que **abre el `ALTER TABLE` en vez de
  ejecutarlo**. Al volver del diseñador el diagrama se relee, así que enseña lo
  que el motor tiene. Ninguna vía de escritura nueva.
- **Descartar una suposición**, que se guarda con el diagrama —y se puede
  recuperar—. Es la respuesta más frecuente, porque la mayoría de las
  suposiciones no serán ciertas.
- **Fase F menos el PDF:** SVG, PNG, Mermaid y DBML. Las supuestas viajan
  comentadas o no viajan, y hay una prueba que comprueba que **ninguna línea
  activa** las menciona. El SVG se redibuja en vez de copiar el DOM: un
  `foreignObject` con HTML no sobrevive al PNG ni se abre fuera del navegador.
- Tres arreglos que salieron de **mirar las capturas**, no de leer el código: la
  leyenda flotante tapaba la última tabla, el diálogo de selección heredaba el
  ancho del lienzo —filas de 1232 px para leer «ciudad»— y su alto era fijo.

#### Verificado

- **Backend:** compila con 0 advertencias. 500 unitarias verdes, 8 de ellas
  nuevas sobre el reparto en lote.
- **Frontend:** compila; el diagrama sale como carga perezosa de 69 kB. **23
  pruebas nuevas** —15 de colocación, 8 del lienzo— y las 86 de shell, explorador
  y diagrama juntas. La suite entera queda en 739.
- **Contractuales con los cuatro motores levantados y `DRUSE_REQUIRE_ENGINES=1`:
  266 de 267 en 12 min 12 s.** Las **diez nuevas de la lectura en lote pasan en
  los cinco fixtures** —PostgreSQL, SQL Server, MySQL, Informix por DRDA e
  Informix por SQLI—, comprobado además una a una. **La Fase A queda cerrada.**
- El único fallo es `InformixSqliContractTests.RespaldaLosDatosDeUnaTablaYLosVuelveACargar`:
  «String to date conversion error» al reinsertar un `DATE` guionizado como
  `'2026-08-17 00:00:00'`. Es **de los respaldos y no del diagrama**, y viene de
  antes: en la 038 ya fallaban dos por SQLI. Con esto queda una.

#### No hecho

- **El diagrama no se ha mirado en tema claro ni en los tres anchos.** El barrido
  lo fotografía en oscuro y a 1232 px; las variantes de tema y ancho que el resto
  de la aplicación sí tiene todavía no lo cubren.
- **La virtualización del lienzo**, que el plan pide: hoy se montan todos los
  nodos. Sirve para un esquema normal, no para trescientas tablas.
- **La pestaña propia.** El diagrama ya se guarda, así que nada la bloquea, pero
  sigue abriéndose como una capa sobre el shell.
- **El PDF paginado**, que es lo único que falta de la fase F: partir un esquema
  grande en hojas sin cortar ninguna caja por la mitad es problema propio.
- **Zoom y minimapa.** Hay arrastre del lienzo, pero no zoom, ni minimapa, ni ir
  a una tabla por su nombre. En un esquema mediano se echan de menos.
- **Nivel de detalle por tabla**: hoy es global, y el plan quería que cada caja
  pudiera romper el general.
- **Arrastrar de una columna a otra** para crear una clave foránea, y **plegar
  una tabla puente** a una sola línea `N:M`: hoy solo lleva su insignia.
- **Las vistas como contexto en gris**, que el plan contempla y no entran.
- La captura del DDL abierto desde el lienzo: el barrido fotografía el diagrama,
  no ese camino.
- **Ninguna captura demuestra el trazado**: la base de pruebas no declara una
  sola clave foránea, así que ahí no se ve ni una línea, ni una pata de gallo, ni
  un círculo de opcional. Lo cubren las unitarias, no una imagen.

#### Archivos

`backend/src/Druse.Domain/TableStructure.cs`,
`Druse.Database.Abstractions/{IDatabaseMetadataReader,MetadataBatch}.cs`,
los cuatro `Druse.Provider.*/*MetadataReader.cs`,
`Druse.Application/Metadata/MetadataService.cs`,
`Druse.Host.LocalApi/{Contracts,Endpoints}`,
`frontend/src/app/features/diagram/**`,
`core/application-gateway/*`, `core/workspace/workspace-store.ts`,
`features/connections/connections-sidebar/*`, `layout/app-shell/*`,
`shared/ui/icon/icon.ts`, `shared/models/workspace.ts`,
`e2e/tests/{diagrama,barrido}.spec.ts`, `docs/plan-mer-y-diagramas.md`.

### Sesión 022 — 2026-08-17 · El PR fusionado y el plan de los respaldos

Sesión de cierre y de planificación. No se escribió código de producto.

#### El PR #9, fusionado con los checks en rojo

Los catorce jobs del CI estaban en `FAILURE`, y no por una prueba caída: GitHub
los aborta **antes de arrancarlos**, en dos segundos, con «The job was not
started because recent account payments have failed or your spending limit needs
to be increased». Es facturación de Actions.

Con eso escrito, el PR se fusionó con `--admin`, porque esperar significaba
esperar a un pago y no a una corrección. **Queda anotado como bloqueante del
proyecto:** mientras la cuenta no se resuelva, ningún PR puede pasar los checks y
lo verde deja de ser una garantía. La última señal buena del CI es la de la
sesión 021.

Después, `main` al día y rama nueva: `feat/respaldos-y-restauracion`.

#### Lo que se planificó

Una herramienta de respaldo **personalizable**, pedida así: poder construir el
respaldo de lo que haga falta —esquemas, tablas, objetos— y elegir **con datos o
sin ellos**. El plan entero está en `docs/plan-respaldos-y-restauracion.md`; lo
estructural, en el ADR 0005.

Seis decisiones se tomaron antes de escribir nada, porque cada una cambia el
diseño completo:

1. **Guioniza Druse, no `pg_dump`.** El catálogo ya se lee en los cuatro motores.
   Guionizar no exige instalar nada y es lo único que sostiene una selección tan
   fina como «todo sin datos, salvo estas tres tablas, y de `pedidos` solo el
   último año». Las herramientas nativas caben después como adaptador.
2. **Con datos o sin ellos, en dos niveles:** un interruptor general que fija el
   valor por omisión, y el mismo interruptor por tabla, que gana cuando se toca.
3. **Los cuatro motores desde la primera fase**, con las mismas contractuales.
   Es lo que funcionó con el diseñador de tablas.
4. **El criterio de salida es la ida y vuelta**, no comparar cadenas de SQL:
   guionizar, ejecutar en una base limpia, releer la estructura con el mismo
   lector de metadatos y comparar. Solo eso comprueba que el respaldo sirva.
5. **Se restaura en el mismo motor**, comprobándolo contra el manifiesto. El
   formato queda preparado para no cerrar la traducción, que es otra función.
6. **Escribe el proceso local, por streaming.** Ni la tabla en memoria ni el
   respaldo pasando por el navegador.
7. **Progreso siempre a la vista, pedido expresamente.** Dos barras —global y del
   objeto en curso—, el paso y el objeto con nombre propio, cancelar siempre
   disponible, y cuatro estados terminales que se quedan en pantalla: correcto,
   correcto con avisos, fallido y cancelado. Nada de barras inventadas: donde el
   catálogo no da una estimación fiable, indeterminada con contador absoluto.
   Cerrar el asistente no interrumpe el trabajo. Sale como `operation-progress`
   reutilizable, porque hoy Druse no tiene ni progreso ni sistema de avisos y la
   exportación y la importación arrastran la misma carencia.

Y tres límites declarados desde el principio: no hay respaldo binario ni
recuperación a un punto en el tiempo —eso es del servidor, y la interfaz tendrá
que decirlo—, no hay respaldos programados, y un límite de filas puede dejar
filas huérfanas, cosa que se avisa y no se corrige sola.

### Sesión 038 — 2026-08-26 · Informix por su protocolo nativo, y Druse se actualiza sola

Segunda tanda del mismo día, y la más larga de todas. Cuatro commits: probar el
túnel a solas, el puente JDBC, Informix por SQLI y el actualizador.

#### Probar el túnel, aparte de probar la conexión

«Probar conexión» solo sabía decir sí o no, y con un servidor intermedio de por
medio eso tapa dos problemas que arregla gente distinta: que el bastión no te
deje entrar, y que desde él no se alcance el servidor de la base. El botón nuevo
—que aparece solo con el túnel marcado— dice **hasta dónde se llegó**:
`bastion`, `forward` o `complete`.

Abierto el reenvío se comprueba que su extremo local acepta un socket. Eso
demuestra el camino hasta el puerto del motor **sin hablar su protocolo**, así
que un «no» de la base no puede disfrazarse de «no» de la red.

#### Por qué Druse no conectaba a un Informix que DBeaver abre sin problema

Se reportó un `SQL30081N` contra un servidor de un tercero. La causa no era el
campo que faltaba: **Druse solo hablaba DRDA**, que exige un escuchador
`drsoctcp` que muchas instalaciones no levantan, mientras que DBeaver habla
**SQLI**, el nativo, que atiende cualquier Informix. El `sqlhosts` del contenedor
de IBM lo enseña de un vistazo:

    informix        onsoctcp    *488e28edd714    9088    ← SQLI
    informix_dr     drsoctcp    *488e28edd714    9089    ← DRDA

Dos protocolos, dos puertos y **dos nombres lógicos distintos**. Se comprobó
contra ese servidor que el driver .NET de IBM **no admite el `INFORMIXSERVER`
por ningún sitio**: `base@servidor`, `host:puerto/servidor` y la clave suelta
fallan cada uno con su error. Añadir la casilla sin más habría dado un campo que
solo sirve para romper la conexión.

#### El puente: JDBC traducido a .NET

El que sí habla SQLI es el driver JDBC de IBM, **de descarga libre en Maven
Central**. IKVM lo traduce a un ensamblado .NET al compilar, así que **no hace
falta Java** ni aquí ni en el equipo del usuario: lo que viaja es IL. Se resuelve
con `MavenReference`, de modo que no hay ningún binario de IBM versionado.

`Druse.Jdbc` son las cuatro clases de ADO.NET envolviendo `java.sql`. Con eso, el
proveedor de Informix reutiliza tal cual su catálogo, sus tipos y su diseñador.

**Tres cosas costaron y están donde toca:**

- El driver **4.50.3 no vale**: muere con `NumberFormatException: "150."` leyendo
  la versión de un Informix 15. El **15.0.0.1.1** conecta a la primera.
- **`Class.forName` no registra el driver bajo IKVM**: hay que registrar una
  instancia, o `getConnection` responde «No suitable driver found» aunque esté
  ahí, que es un mensaje que manda a revisar la URL.
- Informix rechaza un `?` suelto en la lista del SELECT con un «System or
  internal error». Los parámetros van en el WHERE.

#### Lo que destapó pasar el contrato

Empezó en 22 de 51 y acabó en 49. Ninguna de las causas era de las pruebas:

- **JDBC ejecuta una sentencia por statement.** Tres `INSERT` seguidos fallaban
  enteros. El puente parte el lote respetando lo que un `;` puede tener dentro
  sin ser separador.
- **Un `CREATE PROCEDURE` lleva `;` en la firma y en cada línea del cuerpo**, así
  que el partidor lo troceaba. El bloque va entero hasta su `END`.
- **Un booleano se leía distinto según el transporte**: `1` por DRDA —donde llega
  como SMALLINT y el tipo se pierde— y `true` por SQLI. El mismo dato de la misma
  columna no puede dar dos respuestas.
- El contrato exige que ejecutor y catálogo **declaren el mismo motor** que su
  proveedor, así que hay una instancia por transporte en lugar de compartirlas.

#### Cancelar no se puede, y así queda escrito

Comprobado contra el servidor con la consulta larga del contrato:
`Statement.cancel()` a los 3 s, `setQueryTimeout(5)` y cerrar la conexión desde
otro hilo **terminan los tres a los ~250 s**, que es lo que la consulta tardaba
igualmente. El driver llega a decir «exceeded timeout of 5 seconds», pero solo
cuando el servidor responde: el hilo se queda dentro del socket.

Elegido a propósito: **dejar de esperar**. Quien cancela recupera el control al
instante y la consulta se suelta; sigue viva en el servidor hasta que acabe y
esa conexión queda ocupada. Es un compromiso, no una victoria, y la alternativa
—una interfaz congelada— es peor. La tarea soltada se recoge igual: se observa
su excepción y se cierra lo que devuelva.

#### El actualizador (trabajo de Darío, con otra herramienta)

Actualizador de Tauri con firma minisign, servicio de estado en la interfaz, y
`release.ps1` con su workflow para construir las dos variantes, generar
`latest.json` y publicar la Release. Se revisó entero: **nada de lo existente se
rompió**.

Lo que está bien resuelto y no conviene perder: la clave privada no vive en el
repositorio, `release.ps1` comprueba que la firma pertenezca a la clave pública
antes de publicar, la variante se fija con `DRUSE_VARIANT` y `build.rs` invalida
la caché, el empaquetado sin clave sigue funcionando, y el candado de `ApiState`
se suelta antes de instalar porque el hook vuelve a tomarlo.

**Y lo que impide que funcione: el repositorio es privado.** Ver §9.

#### Verificado

- **450 unitarias, 158 de integración y 255 de 257 contractuales** con los cinco
  motores levantados y `DRUSE_REQUIRE_ENGINES=1`; **640 del frontend** y **13 del
  envoltorio**. Los cuatro motores de siempre: **206 de 206**.
- El puente, contra Informix real por SQLI: columnas por nombre y posición, que
  **un nulo no se confunda con cero** —en JDBC un entero nulo vuelve como 0 y hay
  que preguntar `wasNull()` después—, parámetros en su sitio, el error con su
  SQLSTATE y que cerrar el lector no tumbe la conexión.
- El «Probar túnel», contra la API levantada y con una E2E que recorre el
  formulario.

#### No hecho

- **Dos del contrato**, ninguna de comportamiento: el código de error llega como
  el del driver (`-79716`) en vez del de Informix (`-201`), y una de respaldo sin
  diagnosticar.
- **Nadie ha conectado aún a un Informix de verdad por SQLI**: lo probado es el
  contenedor. El servidor que motivó todo esto es de un tercero.
- El **peso** de IKVM no se ha medido con un publish recortado: la pieza es
  `IKVM.Java.dll`, unos 62 MB por plataforma.
- La suite E2E no se repitió.

**Archivos.** `Druse.Jdbc/*` (nuevo), `Provider.Informix/*`, `DatabaseEngine.cs`,
`ConnectionProfile.cs`, `ProviderRegistry.cs`, la persistencia, el diálogo de
conexión, y del actualizador `updates.rs`, `update.service.ts`, `release.ps1` y
el workflow.

**Estado al cerrar.** Todo subido: `a455be7`, `4c6f74a`, `55711f0` y `93f7f26`.

### Sesión 037 — 2026-08-26 · El ejecutable no tenía estilos, y exportar moría por un punto

Cinco commits, tres cosas distintas: coger filas en la cuadrícula, arreglar la
exportación y descubrir por qué la ventana empaquetada se veía como se veía.

#### Coger registros enteros arrastrando

La cuadrícula sabía coger un rectángulo de celdas y columnas desde la cabecera,
pero no filas. Ahora el número de fila hace con su fila lo que la cabecera hace
con su columna: pulsar, arrastrar, Control para sueltas y Mayúsculas para el
tramo. Copiar se lleva la fila con **todas** sus columnas.

La señal se llama `chosenRows` y no `selectedRows` porque ese nombre ya estaba
cogido —las filas señaladas para borrar, que van por número—. Estas van por
**posición entre las filas visibles**, igual que el rango de celdas: con un
filtro puesto los números dejan de ser consecutivos. Aquello marca, esto copia.

#### Exportar: tres fallos, uno de ellos el que se reportó

El reporte era «exportar una vista da error desde el portable». Reproduciendo se
encontró **un fallo real que no era ese**: exportar mandaba al motor el contenido
de la pestaña sin comprobar que devolviera filas, y una vista abierta con «Ver
DDL» lleva su `CREATE VIEW`. Si la vista existía, error; **y si no existía, la
creaba** y el archivo salía vacío con un «Exportado» encima. Se cerró: exportar
exige ahora algo que devuelva filas, y confirmar lo destructivo no lo convierte
en exportable.

Pero el error del usuario era otro, y solo se supo cuando llegó su traza:

    Invalid non-ASCII or control character in header: 0x00B7

`0x00B7` es «·», el separador de `nombre · DDL`. Ese título se propone como
nombre de archivo y acaba en `Content-Disposition`, que **solo admite ASCII**.
No era cosa de las vistas ni de un motor: **cualquier título con acentos lo
provocaba**, y en español eso es la mitad de los títulos. Se escriben ahora los
dos parámetros del RFC 6266, y el nombre de verdad viaja en `filename*`.

El tercero: los cuatro lectores de resultado dejaban pasar la excepción del
proveedor sin normalizar, así que cualquier fallo del motor al exportar salía
como «Se produjo un error inesperado». Ahora dice lo que dijo el motor.

**Lección, y va escrita porque costó:** se dio por confirmada una hipótesis sin
tener el mensaje de error, y era la causa equivocada. Reproducir *un* fallo por
la misma superficie no es reproducir *el* fallo.

#### La ventana empaquetada abría sin una sola regla de estilo

Lo enseñó una captura: todo apilado en una columna, sin barra lateral ni
pestañas. En el navegador se veía perfecta. Se conectó al WebView del ejecutable
por depuración remota —`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`—
y lo dijo él mismo:

    Applying inline style violates 'style-src 'self' 'unsafe-inline'
    'nonce-…''. Note that 'unsafe-inline' is ignored if either a hash
    or nonce value is present in the source list.

Tauri añade un nonce a `style-src`, y con un nonce presente **`'unsafe-inline'`
deja de valer**. Angular pinta los estilos de cada componente en un `<style>` que
inyecta en tiempo de ejecución, sin nonce: las quince bloqueadas, una sola
llegaba a ser hoja. Lo que despistaba es que la hoja externa **sí cargaba**, así
que desde fuera parecía que el CSS estaba puesto.

Y por el mismo camino apareció el segundo, que llevaba sesiones sin explicación:

    Connecting to 'http://ipc.localhost/api_connection' violates
    connect-src 'self' http://127.0.0.1:* http://localhost:*

`connect-src` no dejaba pasar el IPC de Tauri: **cada `invoke` moría en
silencio**. Eso es todo lo que depende del envoltorio —el selector de carpeta que
esta bitácora lleva sesiones anotando como «nunca se ha visto funcionar», el
diálogo de guardar una exportación, abrir un `.sql`—. No estaba sin probar: no
podía funcionar.

#### Verificado

- **433 unitarias** y **158 de integración** del backend, **627 del frontend** y
  las **10 del envoltorio**. Suite E2E: 42 de 44, con una saltada y
  `migracion.spec.ts:154`, que pasa al repetirla sola.
- Los cuatro casos de exportación, **a mano por HTTP contra SQL Server real**:
  el DDL de una vista que existe, el de una que no —comprobando que no queda
  creada—, un SELECT que el motor rechaza y un SELECT correcto.
- El nombre con «·» y el nombre con acentos, contra el motor: los dos dan 200.
- La CSP, **sobre el binario de verdad**: de 1 hoja de estilos activa a 15 de 15,
  de 3 hojas a 17, la barra lateral vuelve a medir 288 px en 1536, y no queda un
  solo error en consola.

#### La pasada con los cuatro motores, por fin

Levantados PostgreSQL, SQL Server, Informix y MySQL a la vez —los dos últimos
hubo que crearlos desde cero, no existían—, con `DRUSE_REQUIRE_ENGINES=1` para
que ninguna prueba pudiera saltarse por no encontrar su motor:

| Suite | Resultado |
| --- | --- |
| Contractuales | **206 / 206** |
| Integración | **158 / 158** |
| Unitarias | **438 / 438** |

**802 en verde y ninguna omitida.** Es la primera pasada así desde la sesión 023,
y cierra lo que §1 arrastraba como pendiente.

Con un matiz que conviene no perder: **la primera pasada dio tres rojos**, y los
tres eran de MySQL —la segunda base del contrato y las dos de restaurar—. Se
lanzó trece segundos después de crear su contenedor. Repetidas a solas, verdes;
y la pasada entera, repetida con el motor ya asentado, verde también. No era el
código: era pedirle trabajo a un servidor que todavía estaba levantándose.

#### De paso, lo que enseñó el `sqlhosts` de Informix

El contenedor de IBM trae las dos entradas, y explica de un vistazo por qué
Druse y DBeaver no piden los mismos datos:

    informix        onsoctcp    *488e28edd714    9088    ← SQLI
    informix_dr     drsoctcp    *488e28edd714    9089    ← DRDA

Dos protocolos, dos puertos y **dos nombres lógicos distintos**. Se aprovechó
para comprobar contra ese servidor si el driver .NET de IBM admite de alguna
forma el `INFORMIXSERVER` que DBeaver pide: **no**. Sin servidor lógico y contra
el 9089 abre —`version=12.10.0000`—; `base@servidor` responde «database name
SYSMASTER@INFORMIX_DR was not found»; `host:puerto/servidor` responde «The
service "9089/informix_" was not found»; y como clave suelta, el constructor la
rechaza con `Invalid argument`. No hay dónde ponerlo, y por DRDA no hace falta.
Apuntar al 9088 da `SQL30081N`, que es la familia del error que se reportó.

#### No hecho

- **El diálogo del sistema sigue sin verse abrir.** Se arregló lo que lo hacía
  imposible, no se comprobó que ya ocurra.
- Las 206 contractuales y la pasada con los cuatro motores: solo había PostgreSQL
  y SQL Server levantados.
- Se intentó una prueba E2E del rechazo al exportar un DDL y **se retiró**:
  exigía ejecutar el `CREATE VIEW` para habilitar el botón, cosa que falla si la
  vista ya existe, así que no habría demostrado lo que prometía.
- El empaquetado falló una vez con `os error 32` al parchear `druse.exe` para
  NSIS —el binario estaba tomado, con un `Blocking waiting for file lock` justo
  antes—. Se relanzó sin tocar nada.

**Archivos.** `results-grid/{results-grid.ts,html,scss,spec.ts}`,
`e2e/tests/interfaz.spec.ts`, `Queries/{ExportService,QueryService}.cs`,
`Endpoints/ExportEndpoints.cs`, los cuatro `*ResultReader.cs`,
`workspace-store.ts`, `application-gateway.ts`, `tauri.conf.json`,
`desktop-tauri/src/main.rs`.

**Estado al cerrar.** Todo commiteado y subido: `4ba8cce`, `d35d8f3`, `b0cba00`,
`9f59a2e`, `1c2e258`.

### Sesión 036b — sin fecha · Los tres temas que el árbol traía de más

No son una sesión: es el trabajo que apareció al repartir las 032–036 en commits
y que **ninguna entrada describía**. Se anota aquí para que el código no quede
sin explicación. Ninguno se ha visto funcionar en la aplicación levantada; lo que
los cubre son sus pruebas.

1. **Agrupar y resumir en el constructor.** GROUP BY, las cinco funciones de
   agregado con su `DISTINCT` y su alias, HAVING sobre esas mismas expresiones
   —repetidas y no por alias, porque no todos los motores admiten el alias ahí—,
   agrupación por día, mes, trimestre o año, y una lista ordenada de órdenes en
   lugar de una sola columna. Más `previewQuery`, que ejecuta diez filas sin
   tocar el resultado del editor.
2. **El progreso de la consulta y la cancelación.** El panel enseña el tiempo
   transcurrido y cambia el texto a los diez segundos —«la base sigue
   procesando» dice algo distinto de «esperando respuesta»—, y cancelar deshabilita
   el botón y pone «Cancelando…» hasta que el motor confirma.
3. **Capas y tokens.** Los z-index sueltos de cada componente pasaron a seis
   tokens ordenados en `_tokens.scss`, y se corrigieron cuatro tokens de color
   que no existían en ninguna parte: donde había respaldo se veía el respaldo, y
   donde no, el color heredado.

### Sesión 036 — 2026-08-25 · Las dos mejoras de la cuadrícula, contra SQL Server

Lo de las sesiones 034 y 035 se había comprobado solo contra PostgreSQL. Se
levantó el contenedor de SQL Server y se repitió allí lo esencial: copiar la
selección con formato y ajustar el ancho de las columnas.

**Funciona igual en los dos motores.** El entero de T-SQL sale sin comillas y el
`varchar` con ellas, que es lo que decide el tipo que clasifica el backend; un
`NULL` de T-SQL sale fuera del `IN`, como debe; y el ancho se arrastra y se
ajusta sin diferencia.

Apareció un caso que PostgreSQL no da: **una columna sin nombre**. T-SQL devuelve
así las que no llevan alias —`SELECT 42`—, y con un nombre vacío la condición
salía como `"" IN (42)`, que no se puede ejecutar y encima parece correcta de un
vistazo. Ahora se escribe `/* columna sin nombre */ IN (42)`, en la línea de lo
que ya hacía el escritor de consultas con lo que falta: se ve al pegarlo.

#### Verificado

- **21 de 21 pruebas E2E** de `interfaz.spec.ts` en verde, con los dos motores
  levantados: las 17 contra PostgreSQL y 4 nuevas contra SQL Server.
- **615 pruebas frontend**, 2 nuevas para la columna sin nombre.

#### Lo que costó, y que conviene saber

- **No se pueden solapar dos ejecuciones de Playwright.** Comparten puerto y
  carpeta de datos, así que cuando la primera termina se lleva por delante el
  backend de la segunda. Media tarde de fallos que parecían del producto —
  conexiones que no abrían, sesiones perdidas— eran esto.
- **Las pruebas de SQL Server necesitan abrir antes PostgreSQL.** La barra del
  editor solo deja elegir dónde se ejecuta cuando la pestaña ya apunta a alguna
  conexión: sobre una pestaña que nunca ha tenido ninguna, el chip se queda en
  «sin conexión» aunque haya un motor abierto. Es la misma secuencia que usa la
  prueba de migración.
- **`conectar` se conforma con ver `druse_test` en el árbol**, y las dos
  conexiones de prueba tienen una base con ese nombre: con los dos motores
  levantados puede dar por abierta la de PostgreSQL sin haberla pulsado. Se
  intentó cambiar por el estado de la fila —como hace `conectarSqlServer`— y
  resultó peor, así que se dejó como estaba. Queda anotado.
- **`ciudad` y `accionista` no las crea nadie.** La prueba del autocompletado
  tras un alias las necesita y no están en el repositorio ni en `test-db.ps1`;
  se recrearon a mano en el contenedor. Si alguien levanta los contenedores de
  cero, esa prueba falla hasta que existan.

**Archivos.** `results-grid/copy-formats.{ts,spec.ts}`, `e2e/tests/interfaz.spec.ts`.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 035 — 2026-08-25 · El ancho de las columnas se ajusta a mano

Los anchos los repartía el reparto inicial y ahí se quedaban. En una columna con
valores cortos y nombre largo —`identificador_de_la_operacion` con un `1`
debajo— el título salía cortado y no había forma de leerlo entero.

Ahora el borde derecho de cada cabecera se arrastra, y el doble clic sobre ese
mismo borde ajusta la columna a lo más largo que contenga, título incluido. El
asa sobresale tres píxeles por fuera del borde porque el borde es una línea de un
píxel y nadie acierta a darle; se ilumina al acercarse.

El ajuste automático usa la misma regla que el reparto del arranque —se sacó a
`fitColumnWidth`, en `column-widths.ts`— con dos diferencias: mira las filas que
están pintadas en vez de una muestra de sesenta, y admite hasta 900 px en lugar
de 320. El tope del reparto existe para que un texto largo no se lleve la
pantalla entera; cuando el ancho lo pide alguien expresamente, esconder las
columnas de al lado es justo lo que quiere.

Lo ajustado sobrevive a volver a ejecutar la consulta. Se guarda por **nombre de
columna**, y se olvida en cuanto el resultado trae otras columnas: ensanchar una
columna, reejecutar y encontrarla otra vez estrecha sería pedir el mismo trabajo
dos veces. Como el resultado que enseña el panel es uno solo para toda la
aplicación —no hay un resultado por pestaña—, la lista de columnas es lo que
distingue «la misma consulta» de «otra».

Y cuando aun así no cabe todo, lo que desaparece es el tipo de dato, no el
nombre. Antes pasaba lo contrario: `character varying` se quedaba entero pegado a
la derecha y el que salía con puntos suspensivos era el nombre, que es el dato
que hace falta para saber qué columna se está mirando. Se resuelve con un factor
de encogimiento desproporcionado en el tipo, así que cede todo su ancho antes de
que el nombre ceda el primer píxel.

#### Verificado

- E2E real contra PostgreSQL, con el ratón de verdad: arrastrar el asa ensancha
  la columna y el nombre deja de estar cortado —se compara `scrollWidth` con
  `clientWidth`, que es lo que distingue «entero» de «con elipsis»—; el doble
  clic la deja en lo justo, que es menos.
- E2E del caso contrario: estrechada a 130 px, el tipo se queda con ancho cero y
  el nombre conserva el suyo.
- **613 pruebas frontend** en verde, 14 nuevas: arrastre, suelo de 84 px, que el
  asa no seleccione la columna, el ajuste al contenido, que sobreviva a una
  reejecución y que se olvide al cambiar las columnas; más seis del cálculo.
- Build de producción correcto.

**Un fallo que encontró una prueba.** Al hacer que el reinicio del estado local
dependiera solo de la firma de columnas, dejó de ejecutarse cuando se reejecuta
la misma consulta: un `computed` no avisa si su valor no cambia, así que el
filtro y la selección de la ejecución anterior se quedaban puestos sobre filas
que ya no eran las mismas. Ahora se lee también el resultado entero.

**Archivos.** `results-grid.{ts,html,scss,spec.ts}`,
`core/application-gateway/column-widths.{ts,spec.ts}`,
`e2e/tests/interfaz.spec.ts`.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 034 — 2026-08-25 · Llevarse valores del resultado con el formato de destino

La cuadrícula solo dejaba coger **una** celda, y copiaba siempre igual: con
tabuladores. Llevarse una lista de identificadores a otra consulta era ir celda
por celda y escribir a mano las comas y las comillas.

Ahora se selecciona como en una hoja de cálculo. La cabecera coge la columna
entera —Control añade otra, Mayúsculas coge el tramo entre dos— y sobre las
filas se arrastra, o se pulsa con Mayúsculas, para coger un rectángulo. Los dos
modos se excluyen a propósito: pulsar una cabecera olvida el rango de celdas y
pulsar una celda olvida las columnas, porque una selección mixta no se puede ni
dibujar ni explicar.

Y se copia eligiendo a dónde va, desde el botón derecho sobre la selección o
desde «Copiar como» en la barra del panel:

- **Para Excel:** tabuladores con los nombres de columna arriba. Los NULL van
  como celda vacía, que es lo que representan; escribir la palabra dejaría un
  texto donde debe haber un hueco y estropearía las fórmulas de la columna. Lo
  que llevara tabuladores o saltos dentro sale entrecomillado.
- **Como condición IN:** `pais IN ('MX', 'ES')`, listo para pegar detrás de un
  `WHERE`. Sin repetidos, y con varias columnas sale una condición por columna
  unidas por `AND`.
- **Como lista de valores:** los valores separados por comas, sin tocar el orden
  ni quitar repetidos: eso es para pegar dentro de algo ya escrito.

Dos decisiones que no se ven pero cambian el resultado. Los NULL no pueden ir
dentro de un `IN` —`IN (NULL)` no es cierto ni para las filas nulas—, así que
cuando los hay salen aparte: `(estado IN ('activo') OR estado IS NULL)`. Y el
tipo de la columna manda sobre el contenido al decidir las comillas: un código
postal `01234` guardado como texto tiene que salir entrecomillado, porque sin
comillas el motor lo compararía como el número 1234 y no encontraría nada.

Seleccionar una columna se lleva **todas** las filas que pasan el filtro, no las
quinientas que están pintadas. Por eso el botón dice qué se lleva —«2 columnas ×
3 filas»—: sin verlo escrito, quien copia una columna de un resultado grande no
sabe qué acaba de coger.

Ctrl+C se queda como estaba mientras haya una sola celda: copia el valor tal
cual, sin encabezado. En cuanto hay más de una, sale con tabuladores.

#### Verificado

- E2E real contra PostgreSQL, **leyendo el portapapeles de verdad**: seleccionar
  la columna y copiar como `IN` da `pais IN ('MX', 'ES')` —sin el `MX` repetido—;
  dos columnas con Control dan la tabla con sus nombres arriba; y arrastrar de
  una fila a otra copia solo el bloque cogido.
- **599 pruebas frontend** en verde, 32 nuevas: 14 de los formatos —comillas,
  NULL, repetidos, nombres de columna con espacios, escape de tabuladores—, 15
  de la selección y 3 de la unión entre el panel y la cuadrícula.
- El portapapeles de Windows guarda CRLF y Chromium convierte al escribir: la
  prueba normaliza los saltos, porque eso no lo pone la aplicación y Excel ni lo
  nota al pegar.
- Build de producción correcto.
- Se levantó Docker y el contenedor de PostgreSQL para poder pasar la E2E.

**Archivos.** `results-grid/copy-formats.{ts,spec.ts}` (nuevos),
`results-grid.{ts,html,scss,spec.ts}`, `results-panel.{ts,html,spec.ts}`,
`e2e/tests/interfaz.spec.ts`, `e2e/support/druse.ts`.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 033 — 2026-08-25 · La ventana ya no abre vacía, y el ejecutable tiene icono

Al abrir Druse había un hueco de más de un segundo con la ventana en blanco: el
paquete de Angular tarda en evaluarse, y detrás vienen cinco lecturas contra el
proceso local —conexiones guardadas, historial, preferencias, fragmentos y las
pestañas de la sesión anterior— que iban poblando la interfaz a saltos.

Ahora hay una pantalla de carga con la marca de la aplicación, su nombre y una
barra de progreso. Vive en `index.html` y no en un componente, porque tiene que
existir **antes** que Angular; los estilos van en línea por lo mismo, y porque la
CSP del envoltorio prohíbe los scripts en línea pero no los estilos. Los colores
salen de los tokens con un respaldo detrás, que es el mismo color de fondo que
declara `tauri.conf.json`: así no hay salto entre la ventana y la página.

Quien la retira es `SplashScreen`, un servicio de `core/startup`. El shell agrupa
sus cinco lecturas en un `allSettled` y avisa al terminar; que una falle no deja
la pantalla puesta sobre una aplicación que por lo demás funciona. Se deja ver un
mínimo de 450 ms contados desde que abrió la ventana —si no, con la API caliente
aparecería y se iría en el mismo parpadeo— y hay un plazo de 12 s tras el cual se
va igual: es preferible una interfaz a medio poblar, donde se ve el error, que una
pantalla de carga eterna. Al final se retira del documento, no se queda invisible:
un elemento a pantalla completa transparente seguiría interceptando cada clic.

El icono era otro problema, y sin relación: el ejecutable portable salía **sin
icono**. `icons/icon.ico` tenía una sola imagen de 256x256 **a 4 bits** —16
colores, sin canal alfa—, así que el degradado de la marca quedaba en un gris
plano y en los tamaños que usa el Explorador no se veía nada. Se ha regenerado
desde `icon.png` con las siete medidas habituales a 32 bits, y el generador queda
en `build/scripts/iconos.ps1` para que la próxima vez que cambie la marca no se
repita el fallo.

De paso se corrigió lo anotado sobre compilar Rust en este equipo: **sí compila**,
siempre que antes se cargue `build/scripts/msvc-env.ps1`. Sin él, `cc-rs` elige el
MSVC de Visual Studio Insiders y `vswhom-sys` revienta.

#### Verificado

- E2E real: la pantalla cubre la ventana entera al arrancar, se lee la marca y se
  retira sola del documento. La prueba retrasa a propósito la lectura de
  preferencias, porque con todo caliente el arranque no dura ni un parpadeo.
- Sigue cubriendo con la interfaz al 80 %: el tamaño se aplica como `zoom` sobre
  el `body` y llega con las preferencias, o sea, mientras la pantalla aún está.
  Se cancela ese `zoom` en el propio elemento.
- **567 pruebas frontend** en verde, 5 de ellas nuevas para `SplashScreen`: el
  mínimo de permanencia, el plazo de seguridad, que no se repita la salida y que
  sin elemento en el documento no arme ningún temporizador.
- `abrir()` espera ahora a que la pantalla se retire, para que ninguna prueba se
  quede esperando a un clic interceptado.
- Build de producción correcto: el `<style>` en línea sobrevive a la optimización.
- Icono comprobado con `PrivateExtractIcons` a 16, 32, 48, 64, 128 y 256 px, en el
  `.ico` y dentro del `druse.exe` recompilado. Antes salía gris en todos.
- Envoltorio recompilado dos veces con el entorno de MSVC, sin errores.

**Archivos.** `frontend/src/index.html`, `core/startup/splash-screen.{ts,spec.ts}`,
`app-shell.ts`, `e2e/tests/interfaz.spec.ts`, `e2e/support/druse.ts`,
`shells/desktop-tauri/icons/icon.ico`, `build/scripts/iconos.ps1`.

**Estado al cerrar.** Verificado, sin commit. El ZIP portable de `target/portable`
sigue con el ejecutable del 24 de agosto: Druse estaba abierto desde esa misma
carpeta y no se tocó. Basta cerrarlo y volver a ejecutar `package.ps1 -Portable`.

### Sesión 032 — 2026-08-20 · Cada JOIN elige con qué tabla se relaciona

El constructor de consultas fijaba siempre el lado izquierdo de todos los JOIN
a `t0`, la tabla desde la que se abrió. Con tres tablas se podía expresar
`orders → customers` y `orders → addresses`, pero no una cadena como
`orders → customers → countries`: el segundo cruce solo ofrecía columnas de
`orders`.

Cada JOIN guarda ahora de qué relación anterior parte. En la condición `ON`, el
lado izquierdo tiene dos selectores: primero la tabla —con alias y nombre, por
ejemplo `t1 · public.customers`— y después una de sus columnas. Solo se ofrecen
la principal y los JOIN que ya aparecen antes: una tabla posterior todavía no
existe en ese punto del SQL.

La sección dejó además de ser una hilera de controles sin jerarquía. Cada cruce
es ahora una tarjeta numerada: arriba quedan el tipo y la tabla que entra; en el
centro se leen enfrentadas «Tabla existente» y «Tabla incorporada», con el `=`
entre ambas; y debajo viven aparte las columnas que se devolverán en el SELECT.
Sin cruces hay un estado vacío que explica el siguiente paso. A 640 px los dos
lados se apilan, en vez de encoger los nombres hasta volverlos ilegibles.

La referencia se guarda por el identificador estable del cruce, no por `t1` o
`t2`. Así, si se elimina un JOIN anterior, los alias se renumeran sin apuntar a
otra tabla por accidente. Si era justo la tabla usada por una condición, esta
vuelve a la principal y elige una columna válida. Cambiar la tabla de un JOIN
también corrige las condiciones posteriores que dependían de columnas que ya no
existen.

#### Verificado

- El segundo JOIN ofrece `t0` y `t1`, cambia sus columnas al elegir `t1` y genera
  `ON [t1].[name] = [t2].[name]`.
- Al quitar `t1`, el cruce restante vuelve a `t0`, se renumera como `t1` y no
  conserva una columna inexistente.
- **49 pruebas específicas** del constructor y el escritor SQL en verde.
- **543 pruebas frontend** en verde y typecheck E2E correcto.
- E2E real contra PostgreSQL: crea dos tablas, abre el constructor desde el
  árbol, comprueba ambos operandos en paralelo y apilados a 640 px, y limpia las
  tablas al terminar.
- Build de producción correcto. Siguen los avisos del bundle y `nearley`; el
  estilo del constructor queda en **9,98 kB**, por debajo del máximo de 10 kB y
  por encima del umbral de aviso de 8 kB.
- `git diff --check` limpio.

**Archivos.** `query-builder.{ts,html,scss,spec.ts}`, `sql-writer.spec.ts`,
`e2e/tests/interfaz.spec.ts`, `e2e/support/druse.ts`.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 031 — 2026-08-20 · Comentar fragmentos SQL seleccionados

El editor permite ahora comentar o descomentar la línea del cursor y todas las
líneas de una selección. La acción está a la vista en la barra, se encuentra
también como «Comentar/descomentar líneas» en la paleta y conserva el atajo
nativo de Monaco, `Ctrl+/`.

No se reescribe el texto a mano: se delega en `editor.action.commentLine`. Así
Monaco conserva la selección, los cursores múltiples y una sola operación de
deshacer. El resultado usa `-- `, que funciona igual en **PostgreSQL, SQL Server,
MySQL/MariaDB e Informix**, por lo que no hace falta una rama por motor.

#### Verificado

- Pruebas de componente de la barra y la paleta: ofrecen y emiten la acción.
- E2E real sobre Monaco: comenta dos líneas seleccionadas, las descomenta y
  vuelve a comentarlas con `Ctrl+/`.
- **541 pruebas frontend** en verde y typecheck E2E correcto.
- Build de producción correcto; siguen solo los avisos conocidos del bundle y
  `nearley`.
- `git diff --check` limpio.

**Archivos.** `sql-editor.ts`, `editor-toolbar.{ts,html,spec.ts}`, `icon.ts`,
`command-palette.{ts,spec.ts}`, `app-shell.{ts,html}`, `e2e/tests/interfaz.spec.ts`.

**Estado al cerrar.** Verificado, sin commit; comparte el árbol con 028–030.

### Sesión 030 — 2026-08-20 · Un SQL restaurado carga el esquema de su alias

El detalle que faltaba era «retomar algo de la vez pasada». La conexión y la base
ya quedaban bien después del switch, pero el SQL restaurado podía nombrar una
tabla de un esquema que no estuviera entre los 20 precargados.

Con `FROM archivo.expedientes e`, `aliasMap` sabía que `e` era
`archivo.expedientes`. Al escribir `e.`, el proveedor buscaba la tabla en el
índice, no la encontraba y devolvía una lista vacía. Nunca llamaba a
`loadRelations`, así que la única forma de desbloquearlo era exactamente la que
describió el usuario: ir al explorador y abrir `archivo` a mano.

Ahora, si el alias lleva esquema y la relación todavía no está cargada, el
autocompletado:

1. carga las tablas de ese esquema;
2. relee el índice producido por el store;
3. encuentra la tabla del alias;
4. carga sus columnas si todavía faltan;
5. devuelve las sugerencias en la misma pulsación.

No se precargan todos los esquemas a ciegas: una base corporativa puede tener
cientos. Se carga solo el que el propio SQL ya nombró.

#### Verificado

- Regresión exacta con índice sin relaciones, SQL restaurado y alias de
  `archivo.expedientes`: carga esquema y columnas.
- **130 pruebas específicas** de store y autocompletado en verde.
- **539 pruebas frontend** en verde.
- Build de producción correcto; siguen solo los avisos conocidos del bundle y
  `nearley`.
- `git diff --check` limpio.

**Archivos.** `sql-completion.{ts,spec.ts}`, además de las correcciones 028–029
que siguen en el mismo árbol.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 029 — 2026-08-20 · El switch lleva también su catálogo

Después de destapar el menú apareció el segundo fallo: elegir una conexión desde
la barra cambiaba correctamente el destino de ejecución, pero el autocompletado
podía quedarse sin tablas y columnas. Abrir la misma conexión desde el panel sí
funcionaba.

El contexto se perdía en tres puntos:

1. `schemaIndex` filtraba por conexión, pero mezclaba todas las bases cargadas de
   esa conexión.
2. Los callbacks de columnas y relaciones llegaban al store sin `connectionId`
   ni base, así que ante dos esquemas o tablas homónimos mandaba la primera rama
   del árbol.
3. `openSaved` y `useConnection` lanzaban el mismo precalentado, pero `_primed`
   solo decía «ya se inició»: el switch podía terminar antes de que hubiera una
   sola tabla disponible.

Ahora el índice entregado a Monaco contiene únicamente la conexión y base de la
pestaña activa. Las cargas diferidas pasan ese mismo par y la caché de
precalentado conserva la promesa en curso; `useConnection` la espera en vez de
dar el catálogo por listo. De paso, la pestaña que pidió el cambio se captura
antes de abrir una conexión lenta, para no reasignar otra si el usuario cambia de
pestaña durante la espera.

#### Verificado

- El spec del store exige relaciones de la conexión destino al terminar el
  switch y ausencia de esquemas de la base anterior en el índice activo.
- **104 pruebas del store** en verde.
- **538 pruebas frontend** en verde.
- Build de producción correcto; siguen solo los avisos conocidos del bundle y
  `nearley`.
- `git diff --check` limpio.

**Archivos.** `workspace-store.{ts,spec.ts}`, `app-shell.ts`, el plan visual y
esta bitácora. Comparte el árbol con la corrección de apilamiento de la sesión
028.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 028 — 2026-08-20 · Monaco tapaba el cambio de conexión

La captura lo mostraba: pulsar el chip `conexión · base` no enseñaba ninguna
lista. El menú sí se creaba y por eso las pruebas del componente pasaban, pero no
se podía ver ni pulsar.

La causa eran dos contextos de apilamiento:

- Monaco vive en `z-index: 6` para que sus sugerencias queden sobre resultados.
- La barra había quedado en `z-index: 3` al convertirla en contenedor CSS.

Aunque `.context__menu` usaba `z-index: 20`, un hijo no puede escapar del nivel 3
de su padre. Monaco quedaba delante e interceptaba todos los eventos. La barra
sube al nivel 10, por encima del editor y por debajo de modales y paleta.

La primera reproducción de Playwright confirmó el fallo con precisión: la opción
era visible para el motor de pruebas, pero el log decía
`monaco-editor subtree intercepts pointer events`. La regresión ya no se conforma
con `toBeVisible`: pulsa una opción y exige que el menú se cierre.

#### Verificado

- La E2E falla antes del cambio por intercepción de Monaco y pasa después.
- **538 pruebas frontend** en verde.
- Build de producción correcto; solo los avisos conocidos del bundle y `nearley`.
- `git diff --check` limpio.

**Archivos.** `editor-toolbar.scss`, `e2e/tests/interfaz.spec.ts`, el plan visual
y esta bitácora.

**Estado al cerrar.** Verificado, sin commit.

### Sesión 027 — 2026-08-20 · Los tipos de columna ya usan el lenguaje de Druse

Al crear o modificar una columna, el desplegable del tipo de dato era el único
control del diseñador que parecía venir de otra aplicación. La causa no estaba
en los tokens: era un `datalist`, cuyo menú lo dibuja Windows/Chromium fuera del
DOM y no admite estilos propios.

Se sustituyó por un **combobox editable de Druse**:

- usa las superficies, borde, sombra, tipografía monoespaciada, hover y selección
  del tema activo;
- filtra el catálogo de tipos que devuelve cada motor;
- se recorre con flechas, acepta con Enter y cierra con Escape;
- expone los roles y relaciones ARIA de `combobox`, `listbox` y `option`;
- sigue aceptando tipos libres como `DECIMAL(14,2)`, dominios y tipos definidos
  por el usuario; las sugerencias no se convirtieron en una lista cerrada;
- una lista vacía no bloquea el campo: explica que se puede escribir un tipo
  personalizado.

No se extrajo un componente compartido: por ahora el único caso que combina el
catálogo de tipos, filas editables y el estado `dropped` es el diseñador. El
autocompletado de JOIN se usó como referencia de interacción, no como dependencia.

#### Verificado

- **538 pruebas frontend**, 40 archivos, todas en verde.
- La prueba de componente cubre filtrado, flechas, Enter y tipo personalizado.
- Playwright abre el diseñador real contra PostgreSQL y comprueba superficie,
  borde, sombra, filtrado y escritura libre: **1 E2E en verde**.
- Build de producción correcto; siguen los avisos conocidos del bundle
  (564,62 kB frente a 500 kB) y de `nearley` no ESM.
- `git diff --check` sin errores, con el aviso informativo ya conocido de CRLF a
  LF en `backup-dialog.spec.ts`.

**Archivos.** `table-designer.{ts,html,scss,spec.ts}`, `interfaz.spec.ts`, el
plan visual y esta bitácora.

**Estado al cerrar.** Sin commit; comparte el árbol con las sesiones 024–026.

### Sesión 026 — 2026-08-20 · El plan visual se cierra con regresiones reales

Se pidió terminar `docs/plan-mejoras-visuales.md`, que la sesión 024 marcaba como
cerrado. Al contrastar cada afirmación con el CSS, las pruebas y el navegador
aparecieron dos huecos funcionales:

1. El diseñador había corregido `[hidden]` solo en `.rows`; `.columns` también
   declara `display: flex` y podía seguir visible al elegir otra pestaña. Ahora
   las cuatro secciones respetan el atributo y una prueba compara el `display`
   calculado antes y después de cambiar a Índices.
2. La cuadrícula ponía `text-overflow: ellipsis`, pero el `span` seguía con el
   `min-width` automático de flex. El padre podía cortarlo antes de que apareciera
   la elipsis. Con `min-width: 0` el texto sí encoge en su propia caja.

#### Lo que dejó de depender de mirar a ojo

- El respaldo prueba expresamente el `approximateRowCount` nulo: no vuelve a
  aparecer «~ filas» sin número.
- La paleta prueba sus tipos en español y que un nombre vacío llega al shell para
  que lo proponga desde el SQL.
- El autocompletado prueba que un fragmento guardado queda por delante de una
  plantilla de fábrica.
- Playwright mide la barra a 900 px, comprueba que Historial y Filtros no se
  solapan, abre el menú de filas por encima de Monaco y verifica que las etiquetas
  vuelven a verse a 1440 px.
- Playwright baja la paleta hasta el final y confirma que la máscara cambia, que
  es el comportamiento real del degradado y no solo la presencia de una clase.
- El ciclo del fragmento espera los `PUT` y `DELETE`, guarda solo la instrucción
  del cursor entre dos consultas, comprueba Ctrl+Z y vuelve a leer después de
  recargar. Las carreras anteriores podían dar un verde falso.
- El barrido manual vuelve a usar `Ctrl+K` desde Monaco y ya no confunde las
  etiquetas accesibles de un píxel con textos recortados.

#### Verificado

- **536 pruebas frontend**, 40 archivos, todas en verde.
- **15 pruebas de integración** de almacenamiento y fragmentos, todas en verde.
- **3 pruebas Playwright dirigidas**, juntas y en verde.
- Build de producción correcto; quedan los avisos conocidos del bundle
  (560,32 kB frente a 500 kB) y de `nearley` no ESM.
- `git diff --check` limpio, salvo el aviso informativo de que Git normalizará
  CRLF a LF en `backup-dialog.spec.ts` cuando vuelva a tocarlo.

Solo estaba levantado `druse-pg-test`. No se repitieron la suite E2E completa ni
las pruebas de los cuatro motores, así que esta sesión cierra el **plan visual**,
no sustituye la validación general de proveedores.

**Archivos de producto.** `table-designer.scss` y `results-grid.scss`.

**Pruebas y herramientas.** `table-designer.spec.ts`, `results-grid.spec.ts`,
`backup-dialog.spec.ts`, `command-palette.spec.ts`, `sql-completion.spec.ts`,
`e2e/tests/interfaz.spec.ts` y `e2e/tests/barrido.spec.ts`.

**Estado al cerrar.** Sin commit; comparte el árbol con las sesiones 024 y 025.

### Sesión 025 — 2026-08-20 · Las tablas sugieren un alias editable

Se pidió que el autocompletado no se limitara a insertar el nombre de la tabla,
sino que ayudara también con un alias. Se conserva la entrada anterior sin alias
y se añade una segunda opción: `users AS u`, `order_items AS oi`. Al elegirla se
inserta el nombre calificado —`public.order_items AS oi`— y Monaco deja `oi`
seleccionado para cambiarlo escribiendo, no obliga a aceptar la propuesta.

Las iniciales salen de las palabras del nombre, también en `snake_case` y
`camelCase`. La alternativa aparece en las sugerencias generales y después de
escribir un esquema; en ese segundo caso no duplica lo ya escrito:
`tpublico.` más la sugerencia produce `tpublico.usuarios AS u`.

No se tocó la resolución que ya existía. Después de insertar la opción nueva,
`u.` sigue llevando a las columnas de `users`, y quien no quiera alias conserva
la sugerencia original.

#### Verificado

- `npm test -- --watch=false --include="src/app/features/query-editor/sql-language/sql-completion.spec.ts"`:
  **24 pruebas en verde**, incluidas las dos nuevas para alias simple y compuesto.
- `npm run build`: correcto. Conserva los avisos anteriores del presupuesto del
  bundle y de `nearley` como dependencia no ESM.
- `git diff --check`: sin errores de espacios.

**Archivos.** `sql-completion.ts`, `sql-completion.spec.ts` y esta bitácora.

**Estado al cerrar.** No hay commit. Este cambio comparte el árbol con todo lo de
la sesión 024, que tampoco está integrado. Falta repetir la suite completa del
frontend antes de cerrar ambos trabajos.

### Sesión 024 — 2026-08-20 · Se cierra el plan visual, y el editor guarda fragmentos

Se retomó lo que quedaba a medias del plan de mejoras visuales. **Queda cerrado
entero**: los nueve hallazgos de §3 y los cuatro puntos de §4.

#### Lo que estaba a medias de la 023s

El primer punto ya no estaba: los siete archivos se habían commiteado en
`c01e025` y `100d2b3`. Los otros dos, hechos.

**El §4.3 decía una falsedad y ahora lo dice al revés:** el autocompletado **sí**
distingue alias. La lista vacía que lo hizo dudar venía de `public.clientes`,
que se había quedado sin columnas por una prueba anterior. El §4.2 queda marcado
como hecho.

#### §3.9 — la barra del editor, en una sola fila

Por debajo de **780 px de barra** los botones se quedan en icono. Lo que decide
no es el ancho de la ventana sino el de la propia barra
—`container: editor-toolbar / inline-size`—, porque el editor vive a la derecha
de un sidebar que se arrastra: a igual ventana la barra puede tener 900 px o 500.

Las etiquetas se retiran de la vista pero **siguen siendo el nombre accesible del
botón**, y el `title` dice lo mismo a la vista. «Iniciar transacción» estrenó
icono propio para poder quedarse mudo.

Un detalle que casi cuesta caro: contener el eje en línea **crea contexto de
apilamiento**, y sin `position: relative` y `z-index` los desplegables de
formato, base y timeout se habrían desplegado por detrás del editor.

**Medido en la aplicación levantada**, no deducido: a 900 px de ventana la barra
pasó de **73 px a 42** —una fila— y a 1440 px sigue con todas sus etiquetas.

#### §3.8 — las listas ya no cortan la fila

Un degradado corto al pie de la paleta, el historial y el árbol de tablas del
respaldo, con una clase global, `dr-scroll-fade`. **Solo pinta mientras queda
algo por debajo**: la máscara se anima con el propio desplazamiento
(`animation-timeline: scroll(self block)`), así que al llegar al final la última
fila se ve entera. Donde no haya soporte, no se aplica nada y la lista queda como
estaba.

No se hizo con desplazamiento por filas enteras porque las filas **no miden lo
mismo** en los tres sitios.

#### El ancho inicial de las columnas sale de los valores

Era lo que faltaba del §3.5. Antes lo decía el tipo y punto: 110 px para `id` y
220 para `descripcion`, cupiera lo que cupiera. Ahora se miran **las primeras 60
filas** y se cuenta el valor más largo. Medir el texto pintado exigiría pintarlo
antes —y el ancho se elige antes de existir la cuadrícula—, así que se cuenta en
caracteres por el avance del glifo, con suelo de 84 px y tope de 320. El reparto
por tipo se queda solo para el `SELECT` que no devuelve ninguna fila.

Comprobado en la aplicación: `id` salió con 84 px y `descripcion` con 320.

#### §4.4 — fragmentos guardados, de punta a punta

Lo que más se pide en un editor de SQL después del autocompletado. Se guardan en
la base local —tabla `sql_snippets`, `user_version` a 5— detrás de
`/api/workspace/snippets`, **de uno en uno**: son independientes entre sí, al
revés que las pestañas, y guardar uno no puede tocar los demás.

Todo pasa por la paleta, **sin diálogo nuevo**:

- **Guardar**: el nombre se pide en el propio campo de búsqueda —el usuario ya
  está escribiendo ahí— y, si lo deja vacío, lo pone la primera línea del SQL. Se
  guarda **lo mismo que ejecutaría «Ejecutar actual»**: la selección, o la
  instrucción del cursor.
- **Insertar**: entra donde esté el cursor y **por la pila de deshacer**, así que
  se quita con Ctrl+Z.
- **Borrar**: Shift+Supr, y **a la segunda**. No hay deshacer, y una lista que se
  recorre con las flechas no puede borrar a la primera. El atajo solo se anuncia
  cuando hay un fragmento marcado.

Y salen en el **autocompletado del editor**, por delante de las plantillas de
fábrica: estos los guardó el usuario y se escriben por el nombre que él les puso.

No se atan a ninguna conexión: el mismo `SELECT` sirve en pruebas y en
producción, y atarlo a un perfil obligaría a decidir qué hacer con él cuando ese
perfil se borra.

#### Verificado

**781 en backend** —422 unitarias, 206 contractuales y 153 de integración, cuatro
de ellas nuevas para el ciclo del fragmento: guardar, listar, reemplazar,
rechazar el que no tiene nombre o SQL y borrar—. **530 en frontend** (veinte
nuevas). Y **la prueba de punta a punta del ciclo entero** —guardar, insertar en
otra pestaña, borrar a la segunda y comprobar que no vuelve tras recargar— en
verde.

Lo visual, además, **mirado en la aplicación levantada**: barra a 900 y a 1440,
cuadrícula con un entero y un texto largo, y el degradado de la paleta.

#### Los contenedores de prueba ya no estaban

`docker ps -a` salió **vacío**: el `druse-pg-test` de las sesiones anteriores no
existe, y con él se fue el escenario sembrado en la 022g —el esquema `tienda`
con sus 10.000 filas y los tres millones de `movimientos`—. Se volvió a levantar
PostgreSQL con `test-db.ps1`, pero **la base viene limpia**: quien retome la
comprobación de perfiles de respaldo tendrá que volver a sembrarla.

**Archivos.** Backend: `SqlSnippet.cs`, `SqliteSqlSnippetStore.cs`,
`DruseDatabase.cs`, `IConnectionProfileStore.cs`, `Contracts.cs`,
`ContractMapper.cs`, `StorageEndpoints.cs`, `DependencyInjection.cs` y
`SecurityAndStorageTests.cs`. Frontend: `column-widths.ts` y su prueba,
`snippet.store.ts` y la suya, `application-gateway.ts`,
`http-application-gateway.ts`, `command-palette.{ts,html,scss,spec.ts}`,
`app-shell.{ts,html}`, `sql-editor.ts`, `sql-completion.ts`, `icon.ts`,
`editor-toolbar.{html,scss}`, `query-history.html`, `backup-dialog.html` y
`styles.scss`. Y `e2e/tests/interfaz.spec.ts`, `docs/plan-mejoras-visuales.md`.

### Sesión 023s — 2026-08-19 · El catálogo que no volvía a cargarse

Iba a ser la tercera tanda del plan visual y acabó en un fallo de los que se
notan todos los días.

**Lo que contó el usuario:** «hay momentos que el autocompletado no sirve, como
que se cambia el servidor, los esquemas o las tablas no cargaba». Es real, y la
causa está en una línea: lo precalentado se recordaba **por conexión**, no por
conexión y base. `primeSchemaIndexAsync` miraba `_primed.has(connectionId)` y se
iba. Con eso:

- cambiar de base en la misma conexión daba por hecho un catálogo que era el de
  la base anterior, y el de la nueva no se pedía **nunca**;
- tras un cambio de estructura, `loadDatabases` rehace el árbol entero con los
  hijos vacíos y el reprecalentado tampoco corría: explorador y autocompletado en
  blanco;
- al reconectar tras perder la sesión, lo mismo.

La única salida era cerrar y volver a abrir la conexión, que es justo lo que
describía el usuario.

**Arreglado.** La clave lleva la base (`conexión::base`); `forgetPrimed` borra lo
de una conexión en los cinco sitios donde su árbol se vacía o se rehace; y la
clave se retira si no había nodo que recorrer, porque si no un intento fallido
bloqueaba todos los siguientes.

**Comprobado en los dos sentidos.** La prueba nueva —«cambiar de base precalienta
el catálogo de la nueva»— falla si se vuelve a poner la clave vieja. Es la única
forma de saber que una prueba de regresión sirve para algo.

**Buscar y reemplazar** (§4.2 del plan visual): Monaco lo traía desde siempre con
`Ctrl+F` y `Ctrl+H` y nada en la interfaz lo decía. Ahora el editor expone
`openFind(replace)` y la paleta ofrece las dos entradas con su atajo.

**Y una prueba que no se quedó.** Intenté reproducir el cambio de base en la app
levantada: el cambio ocurre —el chip dice `druse_test_secondary`—, pero leer el
desplegable tecleando y borrando `tienda.` no daba resultado estable. Antes que
dejar una prueba dudosa en la suite, fuera; la cobertura del fallo se queda en la
unitaria, que sí está probada en ambos sentidos.

**Verificado.** **510 en frontend** (dos nuevas) y las **5 de `interfaz.spec.ts`**
en verde, con la del buscador incluida.

**Archivos.** `workspace-store.ts` y su prueba, `sql-editor.ts`,
`command-palette.ts`, `app-shell.{ts,html}`, `e2e/tests/interfaz.spec.ts`.

**Sin commitear.** Los siete archivos siguen en el árbol de trabajo.

### Sesión 023r — 2026-08-19 · Segunda tanda: las pestañas que no separaban nada

Tres más del plan visual, y la primera resultó ser un fallo con una causa que no
se ve mirando el código de Angular.

**Las pestañas del diseñador** —Columnas, Índices, Claves foráneas,
Restricciones— no filtraban: debajo se apilaban las cuatro secciones a la vez. La
lógica estaba bien; lo que fallaba es que `[hidden]` **solo vale `display: none`
en la hoja del navegador**, y `.rows { display: flex }` le ganaba. Una regla de
una línea, y el diálogo pasó de 660 a 360 píxeles de alto.

**El error de una consulta** se contaba dos veces: una banda arriba y el panel
abajo. Ahora se queda donde tiene contexto —el panel, con el código del motor y el
botón de copiar—, y la banda se reserva para lo que no cabe ahí: la sesión
perdida, la transacción abierta, la confirmación de algo destructivo. Con la
insignia de «Mensajes» y la palabra subrayada en el editor, nadie se pierde el
fallo por quitarlo de arriba.

Y **la rejilla de motores**, dos por dos: cuatro en tres columnas dejaban el
último solo con un hueco al lado.

**Verificado.** **508 en frontend** —una prueba cambió de bando: ahora afirma que
el error va al resultado y **no** al aviso— y **24 de punta a punta**. El barrido
relanzado confirma las tres en las capturas.

**Archivos.** `table-designer.scss`, `workspace-store.ts` y su prueba,
`connection-dialog.scss`, y el plan al día en `docs/plan-mejoras-visuales.md`.

### Sesión 023q — 2026-08-19 · Ejecutar el plan visual: cinco arreglos

Del plan de la sesión anterior salieron cinco a la calle: los dos de prioridad
alta, dos de forma y el del editor.

**La barra del panel de resultados** envuelve, como ya hacían las otras dos: las
pestañas no encogen y los controles bajan a la fila siguiente. A 900 px se lee
«Resultados · Mensajes · Historial» entero, que antes quedaba medio tapado por el
botón de filtros.

**«~ filas» sin número** era un `null` disfrazado: el catálogo devuelve nulo —no
ausente— para las tablas que no sabe estimar, y la comprobación solo miraba
`undefined`. Ahora, sin número no se escribe nada.

**Las celdas cortadas** llevan puntos suspensivos. Hizo falta envolver el valor en
su propio elemento: sueltos dentro de un contenedor flexible, los puntos no se
aplican. Queda pendiente lo otro que anota el plan —repartir el ancho inicial de
las columnas mirando los valores—.

**La paleta habla español**: `COMMAND` y `CONNECTION` eran los nombres internos
asomando en una interfaz que está en español entera. Traducidas las once.

Y del editor, **Ctrl+K ya llega desde dentro**. Monaco se queda con esa
combinación —la usa como principio de sus propios acordes—, así que el atajo que
anuncia la barra de arriba solo funcionaba con el foco fuera del editor, que es
donde menos tiempo se pasa. Lo destapó el propio barrido: la prueba tuvo que abrir
la paleta por su botón porque el atajo no llegaba.

El plan queda actualizado con lo hecho y con **una sección nueva del editor**: lo
que falta ahí es anunciar buscar y reemplazar —Monaco lo trae y nada lo dice—, que
el autocompletado distinga alias en consultas con varios JOIN, y fragmentos
guardados.

**Verificado.** **508 en frontend** y **24 de punta a punta**, con una nueva: que
Ctrl+K abre la búsqueda con el foco dentro del editor.

**Archivos.** `results-panel.scss`, `backup-dialog.html`, `results-grid` (plantilla
y estilos), `command-palette` (plantilla y componente), `sql-editor.ts` y
`app-shell.html`; el plan en `docs/plan-mejoras-visuales.md` y la prueba en
`e2e/tests/interfaz.spec.ts`.

### Sesión 023p — 2026-08-19 · Mirar la aplicación entera, y anotar lo que se ve

Segundo barrido, esta vez completo: dieciocho capturas —resultados, mensajes,
historial, el error de una consulta, el menú del árbol, la paleta, seis diálogos,
el asistente de migrar, los dos temas y tres anchos— con las medidas de desborde
y la consola. El resultado está en `docs/plan-mejoras-visuales.md`, ordenado por
lo que más molesta.

Nueve hallazgos, ninguno grave. Los dos primeros son de los que se arreglan en un
rato y se notan: **la barra del panel de resultados se pisa con sus pestañas** a
900 px —el mismo mal de las otras dos barras, en la única fila que quedó sin
revisar— y **«~ filas» sin número** en la lista del respaldo, que se lee como un
error de la aplicación cuando lo que pasa es que el catálogo no da estimación.

Después, tres de forma: las pestañas del diseñador no filtran nada —debajo se
apilan todas las secciones a la vez—, el error de una consulta se cuenta dos veces
—en una banda y en el panel, este con su código y su botón de copiar— y las celdas
cortadas no lo dicen, que sin puntos suspensivos no se distinguen de un valor que
acaba ahí.

Y cuatro menores: la paleta etiqueta en inglés (`COMMAND`, `CONNECTION`), la
rejilla de motores queda 3 + 1, tres listas con desplazamiento cortan la última
fila por la mitad, y a 900 px la barra del editor ocupa tres filas.

**Lo que se miró y está bien** también quedó escrito, que es la mitad del valor de
un barrido: la consola limpia en todo el recorrido, ningún botón sin nombre
accesible, y el tema claro aplicándose de verdad —comprobado midiendo los tokens
antes de tocar nada, porque la primera impresión sobre una captura decía lo
contrario—.

**La herramienta queda en el repositorio**, en `e2e/tests/barrido.spec.ts`, pero
**no corre con la suite**: no afirma nada y tarda casi un minuto. Se pide con
`DRUSE_BARRIDO=1` y las capturas salen donde diga `DRUSE_BARRIDO_DIR`.

**Verificado.** Las 23 de punta a punta siguen en verde, con el barrido saltado.

**Archivos.** `docs/plan-mejoras-visuales.md` y `e2e/tests/barrido.spec.ts`.

### Sesión 023o — 2026-08-19 · Barrido visual: cuatro cosas que se veían mal

Un recorrido con Playwright por las pantallas —capturas, medidas de desborde y
consola— y después mirarlas de verdad. Salieron cuatro, y una la había traído yo.

#### La franja pegada del editor dejaba pasar el texto

Es la que más molestaba, y la contó el usuario: bajando por un guion largo, la
primera línea se quedaba **escrita encima** del texto que pasaba por debajo.

Monaco pega arriba la línea que abre el bloque —un `WITH … AS (`, un `IN` largo—
y esa franja hereda el fondo del editor, que aquí es **transparente a propósito**
para que se vea el panel de la aplicación. Sin fondo propio, se leían las dos
cosas a la vez.

Se arregla en los estilos globales y no en el tema de Monaco: su widget no lee
`editorStickyScroll.background`, lo pinta con su propio CSS. Y global porque ese
DOM no lo genera Angular, así que los estilos del componente no lo alcanzan.

#### La barra del editor perdía controles al estrechar

Medido: a 1280 sobraban 179 píxeles y a 1024, **435**, con `overflow: visible` y
sin desplazamiento. Es decir, el selector de conexión, el límite de filas y el
tiempo máximo quedaban fuera de la ventana **sin forma de llegar a ellos**. Y una
parte era mía: el chip de filas de la sesión 023h fue el que colmó la barra.

Ahora envuelve: crece unos píxeles en lugar de esconder lo que no cabe.

#### La barra superior empujaba fuera el tema y las preferencias

Mismo mal, otra barra: la búsqueda ocupaba 420 píxeles fijos y lo demás se salía.
Ahora la búsqueda es lo que encoge —sigue sirviendo con dos palabras— y los
botones no se mueven. Su texto va en una línea con puntos suspensivos; antes se
partía en tres y se salía del propio campo.

#### Y ningún diálogo se cerraba con Escape

Nueve modales, todos con su fondo que cierra al pulsar fuera, y ninguno respondía
a Escape. Ahora los nueve hacen con Escape lo mismo que con el clic fuera.

#### Lo que se miró y no era

El tema claro parecía no aplicarse en las capturas. No era verdad: los tokens
resuelven a claro y el panel se pinta en `rgb(244, 246, 250)`. Se comprobó
midiendo antes de tocar nada, que es lo que evitó «arreglar» algo que funcionaba.

**Verificado.** **508 en frontend** y **23 de punta a punta**, con dos guardarraíles
nuevos: que Escape cierra, y que la franja pegada del editor tiene fondo opaco
—cualquier color con alfa deja pasar el texto de debajo—.

**Archivos.** `styles.scss` (la franja), `editor-toolbar.scss` (envolver),
`top-bar.scss` (qué encoge y qué no), los nueve diálogos y
`e2e/tests/interfaz.spec.ts`.

### Sesión 023n — 2026-08-19 · Un cambio que falla a mitad tiene que decirlo

Lo que quedaba del diseñador: qué pasa cuando el motor rechaza una de las
instrucciones de un cambio de tabla.

Hasta hoy, nada bueno. El error del driver salía sin pasar por el normalizador del
proveedor, así que llegaba a la pantalla como «se produjo un error inesperado» —un
500 genérico— y del resto no se decía nada. En tres motores da igual, porque
deshacen el DDL y no queda rastro. En MySQL no: confirma cada `ALTER` por su
cuenta, así que lo anterior **se queda**, y quien volvía al diseñador estaba
partiendo de una tabla que ya no era la que tenía delante.

Ahora el fallo lleva tres cosas: el motivo ya en limpio —el mismo normalizador que
usan las consultas, así que un error del diseñador se lee igual que uno del
editor—, **cuál** instrucción falló, y si lo aplicado se deshizo. Cuando no se
deshace, el mensaje lo dice con el número delante: es lo que cambia la siguiente
decisión, repetir el cambio entero o retomarlo desde ahí.

La prueba no nombra a ningún motor: compara con lo que cada proveedor promete en
`SupportsTransactionalDdl` y comprueba que **la tabla cuenta lo mismo que el
aviso** —donde se deshace no quedó la columna, donde no, está—.

**Verificado.** **780 en backend** (422 unitarias, **206** contractuales y 152 de
integración) con los cuatro motores. Las cuatro ejecuciones nuevas en verde, y las
de MySQL son las que enseñan la diferencia.

**Archivos.** `TableChangeFailedException`, `TableDesignerBase` (envuelve el fallo
y pregunta al proveedor cómo se lee), los cuatro diseñadores, el middleware del
host —un 409 con la instrucción y lo aplicado— y `DatabaseProviderContractTests`.

### Sesión 023m — 2026-08-19 · El resto del diseñador, contra los cuatro motores

Lo que quedaba del diseñador sin probar contra servidores de verdad: **renombrar
una columna y cambiarle el tipo**, **cambiar la clave primaria** y **añadir y
quitar una clave foránea** sobre una tabla que ya existe. Tres pruebas
contractuales nuevas, doce ejecuciones —cuatro motores cada una—, y salió lo que
se venía a buscar.

#### El fallo: en Informix no se podía cambiar la clave primaria

Diez de las doce pasaron a la primera. Las dos de Informix no, y una era un fallo
de verdad: soltar la clave primaria respondía «Unable to find CONSTRAINT
( 876_2116)».

El lector devolvía como nombre de la clave **el de su índice**, y en Informix la
restricción y su índice se llaman distinto: `u876_2116` la una y ` 876_2116` el
otro, **con un espacio delante** que el motor no acepta al soltarla. Como el
nombre que se lee es el que la pantalla usa para el `DROP CONSTRAINT`, cambiar la
clave primaria desde el diseñador era imposible en ese motor. Lo mismo pasaba con
las restricciones de unicidad, que se sueltan igual.

Ahora se lee el nombre de la restricción, y el del índice se conserva aparte solo
para marcar cuál lo sostiene. De paso arregla algo que nadie había visto: un
respaldo de esa tabla escribía la clave con el nombre del índice —espacio incluido
— y ese `CREATE TABLE` no se podía volver a ejecutar.

#### Y una diferencia que no es fallo

La otra de Informix era la prueba, no el motor: comprobaba las **columnas
referenciadas** de la foránea, y ese catálogo no las entrega junto a la clave.
Sacarlas costaría una consulta por cada foránea sobre una conexión que no admite
dos a la vez, y está decidido y escrito en su lector desde que se hizo. La prueba
ahora las comprueba cuando el motor las da, y lo dice.

**Verificado.** **776 en backend** (422 unitarias, **202** contractuales y 152 de
integración) con los cuatro motores levantados y sin saltarse ninguna. Las doce
ejecuciones nuevas —tres pruebas por cuatro motores— en verde.

**Archivos.** `DatabaseProviderContractTests` (las tres pruebas) e
`InformixMetadataReader` (el nombre de la clave primaria y el de la unicidad).

### Sesión 023l — 2026-08-19 · Las otras direcciones, y un aviso que no servía de nada

Lo que le quedaba a la migración eran pruebas, y de paso salió un fallo de la
pantalla.

#### A lo ancho, no solo a fondo

Lo cruzado se comprobaba a fondo en **una** dirección —PostgreSQL a SQL Server, con
los tipos que peor viajan— y las otras once solo con unitarias.
`CrossEngineDirectionsTests` añade cuatro más: PostgreSQL → MySQL, MySQL → SQL
Server, SQL Server → PostgreSQL y PostgreSQL → Informix.

Las tablas son sosas a propósito —un entero, un texto y un decimal—: lo que se
mira ahí no es la traducción de tipos raros, es que **el camino entero existe en
las cuatro esquinas**, porque cada par tiene su dialecto y el que no se prueba es
el que se rompe. Se apoya en el catálogo de motores que ya usaban los respaldos,
así que no hubo que inventar ninguna fixture.

Las cuatro pasaron a la primera, Informix incluido.

#### El aviso que mandaba hacer algo que no funcionaba

Al escribir las pruebas de componente del paso de tipos apareció: cuando una
columna no tiene equivalente, la pantalla dice «escríbeles un tipo a mano o
déjalas fuera; la tabla no se puede crear mientras estén así»… y escribir el tipo
**no desbloqueaba nada**. El botón miraba la traducción original y no lo que el
usuario acababa de escribir, aunque el proceso local sí acepta el tipo escrito y
lo prefiere al propuesto.

Ahora una columna con tipo a mano deja de contar como perdida, que es lo que su
propio aviso pedía.

**Verificado.** **764 en backend** (422 unitarias, 190 contractuales y 152 de
integración) con los cuatro motores levantados; **508 en frontend**, tres nuevas
del paso de tipos —lo que se traduce, lo que se pierde, y que el tipo escrito a
mano viaja con la petición—; y **21 de punta a punta**.

**Archivos.** `CrossEngineDirectionsTests`, `transfer-dialog.spec.ts` y
`transfer-dialog.ts` (el cómputo de las columnas sin equivalente).

### Sesión 023k — 2026-08-19 · Reconocer la fila por lo que la identifica de verdad

Lo que le quedaba a la pasada: **con qué se reconoce una fila que ya está**. Hasta
hoy usaba la clave primaria de cada destino y no había forma de cambiarla, aunque
el asistente de una tabla sí la dejaba elegir desde la fase 2.

Es de cada tabla y no de la pasada, porque cada una tiene la suya. Vacío sigue
significando la primaria del destino —lo que se quiere casi siempre—, y se escribe
otra cuando hay que sincronizar por una **clave de negocio**: el código del
artículo, el NIT, lo que identifica la fila en los dos entornos. El identificador
lo generó cada base por su cuenta, así que emparejar por él es lo que duplica
filas al sincronizar.

El campo aparece **solo en los modos que reconocen la fila**. En «añadir» sería
una pregunta sin respuesta posible, y un campo que no significa nada se rellena
igual. Lo que se escriba lo comprueba el proceso local contra el catálogo, como ya
hacía: sin unicidad detrás, «actualiza la que ya está» tocaría todas las que
coincidan.

Se guarda con el perfil, junto al modo y al filtro, por lo mismo que ellos: un
perfil que olvidara la clave volvería a emparejar por el identificador la próxima
vez, y eso duplica.

**Verificado.** **760 en backend** (148 de integración, una de ellas comprobando
que la clave sobrevive al ida y vuelta del perfil), **505 en frontend** —la clave
solo se ofrece donde significa algo, y viaja con su tabla— y **21 de punta a
punta**, dos vueltas seguidas. La nueva es la que importa: en el destino hay una
fila con el mismo código y **otro id**, se migra actualizando por el código, y al
final hay dos filas en vez de tres y el nombre viejo ya no está.

**Archivos.** `TransferProfile.cs` (`TransferTableOptions.KeyColumns`),
`TransferProfileContracts`, el gateway y el asistente de la pasada; pruebas en
`TransferProfileTests`, `transfer-set-dialog.spec.ts` y
`e2e/tests/migracion.spec.ts`.

### Sesión 023j — 2026-08-19 · Cruzar de motor, ahora por la pantalla

Lo último que le faltaba a la fase 3: migrar de PostgreSQL a SQL Server **desde la
aplicación**, y no solo por HTTP. Una prueba de punta a punta abre las dos
conexiones, migra una tabla con los tipos que peor viajan —identificador único,
JSON, marca de tiempo con zona, booleano y texto sin límite—, lee lo que la
pantalla promete, crea la tabla al otro lado, copia y cuenta las filas allí.

Y lo que promete se lee: el `uuid` se creará como `uniqueidentifier`, y del JSON
dice que el destino «deja de comprobar que lo sea y de poder consultarlo por sus
campos». Ese aviso es el producto de la fase, y hasta hoy nadie lo había visto en
pantalla.

#### Cuatro cosas que costaron, todas de la prueba

1. **El desplegable de conexiones se elige por el valor de la opción**, no por su
   etiqueta: la de la conexión de partida lleva pegado un «(esta misma)».
2. **El tipo propuesto vive en un campo editable**, así que no está en el texto de
   la tabla: se comprueba el valor del campo, que además es lo que se puede
   cambiar antes de crear.
3. **Las dos bases de prueba se llaman igual.** Dar por conectado el SQL Server
   porque aparece un `druse_test` en el árbol es dar por bueno el de PostgreSQL:
   se mira el estado de **su fila**. Y al terminar se desconecta, porque las demás
   pruebas bajan por el árbol buscando nombres.
4. **El explorador guarda lo que ya leyó.** Una tabla con nombre nuevo no aparece
   sin refrescar, así que la prueba reutiliza el nombre que las otras ya dejaron
   en el árbol y le cambia la forma.

**Verificado.** **20 de punta a punta**, dos vueltas seguidas en verde, con los dos
motores levantados. El backend y el frontend no se tocaron.

**Archivos.** `e2e/support/druse.ts` —los datos del SQL Server de pruebas,
`conectarSqlServer` y apuntar la pestaña a cualquier conexión— y
`e2e/tests/migracion.spec.ts`.

### Sesión 023i — 2026-08-19 · Migraciones guardadas, y cada tabla a lo suyo

Cierra la fase 4 de la migración: lo que quedaba era poder **repetir** una pasada y
poder **afinarla tabla por tabla**.

#### Un perfil guarda nombres, no sesiones

Es la regla del perfil de respaldo y aquí manda igual: lo que se guarda son la
conexión, la base, el esquema y las tablas, porque un perfil se reabre meses
después y para entonces la sesión con la que se creó hace mucho que se cerró. Al
abrirlo se resuelve contra **dos conexiones vivas**, que no tienen por qué ser las
de aquel día: repetir en otro entorno la misma migración es justo para lo que se
guarda.

La tabla local es espejo de `backup_profiles` —lo que se lista y se ordena en
columnas, lo que solo se usa entero en JSON— y buscar en el catálogo por nombre,
que ya hacían dos servicios, se movió a `CatalogLookup` tal cual estaba.

Abrirlo dice **las dos cosas a la vez**: lo que hoy se puede migrar y lo que no.
Negarse por una tabla que alguien borró obligaría a rehacer el perfil entero, y
abrirlo callando las ausencias haría creer que la pasada se llevó algo que no se
llevó.

#### Cada tabla a lo suyo

El modo de la pantalla pasa a ser **el de partida**, y debajo, plegado, cada tabla
puede llevar el suyo y su condición: de una se lleva el año en curso y de otra
todo. Con un detalle que evita un accidente: elegir en una tabla el mismo modo de
la pasada **no la separa del resto**, porque si contara como algo distinto,
cambiar después el modo general la dejaría atrás sin que nadie lo pidiera.

Y todo eso **se guarda con el perfil**. Olvidarlo sería peligroso: uno que
perdiera el filtro se llevaría la tabla entera la próxima vez.

#### Lo que costó fue la prueba, no el código

Dos veces por lo mismo. Playwright pulsaba la casilla *por dentro* de su etiqueta,
y ese clic puede llegar dos veces —uno del control y otro reenviado por la
etiqueta—, así que la marca se ponía y se quitaba y la pasada salía con una tabla
menos. Se pulsa la fila, que además es lo que hace una persona. Y el bloque de
tabla por tabla va plegado, así que la prueba lo abre antes de escribir en él.

**Verificado.** **760 en backend** (422 unitarias, 190 contractuales y 148 de
integración) con los cuatro motores; siete de perfiles, incluida la que comprueba
que el modo y el filtro de cada tabla sobreviven al ida y vuelta. **503 en
frontend**, con lo de cada tabla y lo que guarda el perfil. Y **19 de punta a
punta**: una guarda la migración, cierra el asistente, lo reabre y la lanza desde
la lista contando las filas; otra filtra una tabla dentro de la pasada y comprueba
que al destino llegan **dos y no tres**, que es lo que demuestra que la condición
por tabla llega hasta el motor.

**No hecho.** La clave de emparejamiento por tabla al actualizar —se queda en la
primaria de cada destino— y vaciar-y-cargar en pasada, que se deja fuera a
propósito. Y sigue pendiente lo de la fase 3: cruzar de motor desde la pantalla.

**Archivos.** `Druse.Domain/TransferProfile.cs`, `ITransferProfileStore`,
`SqliteTransferProfileStore` con su tabla en `DruseDatabase`,
`TransferProfileService`, `Application/Metadata/CatalogLookup.cs`,
`TransferProfileContracts` y las rutas `/api/transfers/profiles`; en la interfaz,
el gateway y el asistente de la pasada. Pruebas: `TransferProfileTests`,
`transfer-set-dialog.spec.ts` y `e2e/tests/migracion.spec.ts`.

### Sesión 023h — 2026-08-19 · Cuántas filas trae una consulta, elegido por quien mira

Las consultas traían **quinientas filas y punto**: el número estaba escrito en el
código del store, sin nada que tocar. El panel avisaba de que el resultado venía
recortado, que es la mitad de lo que hace falta; la otra mitad es poder subirlo.

#### Donde ya se ajusta el tiempo máximo

El límite es ahora un ajuste más de la barra del editor, al lado del tiempo de
ejecución y con la misma mecánica: se elige de una lista —100, 500, 1.000, 5.000,
10.000 y 100.000— y **se guarda en preferencias**, porque quien trabaja con tablas
grandes lo sube una vez y no quiere repetirlo en cada arranque.

Cien mil es el tope del proceso local, y se ofrece entero. Pedir más se ajusta en
el propio store: prometer doscientas mil en la barra y que el servidor devuelva
cien mil sería mentir sobre lo que se está viendo.

#### Y una casilla que se desmarcaba sola

Comprobándolo en la aplicación levantada apareció un fallo del asistente de la
pasada, recién estrenado: con la lista larga —el esquema de pruebas tiene noventa
y dos tablas—, una de las dos marcadas llegaba al plan sin marcar, y la pasada se
lanzaba con una tabla menos sin que nadie lo dijera.

La casilla **alternaba** el estado en cada evento, y alternar da por hecho que a
cada clic le corresponde un cambio. No siempre es así: un mismo clic puede llegar
dos veces —la casilla y su etiqueta— y entonces la marca se pone y se quita sin
que se vea. Ahora se toma el estado del evento, así que repetirlo no cambia nada.

**Verificado.** **498 en frontend**, tres nuevas del límite —el valor por omisión,
el elegido que se recuerda y el tope que no se puede pasar—, y **18 de punta a
punta**: la nueva ejecuta `generate_series(1, 900)` con quinientas, comprueba que
el panel dice «recortado», sube el límite a mil y vuelve a ejecutar para ver
900 de 900. La suite entera pasó dos veces seguidas después del arreglo de la
casilla, que antes fallaba una de cada dos.

**Archivos.** `workspace-store.ts` (la preferencia `query.maxRows`, el tope y su
uso al ejecutar), `editor-toolbar` (el chip y su menú), `app-shell` para
enlazarlos, `transfer-set-dialog` (la casilla), y las pruebas de las tres cosas
más `e2e/tests/editor.spec.ts`.

### Sesión 023g — 2026-08-19 · El aviso que llegaba tarde y dejaba el trabajo «en marcha» para siempre

El cuelgue intermitente que la sesión 023d dejó acotado **era un fallo de verdad**,
y no lentitud de la máquina: un traslado terminado se quedaba diciendo «en marcha»
hasta que alguien se cansaba de esperar. Es el mismo síntoma que dejó sin resumen
a una prueba de punta a punta en la sesión 023c.

#### Cómo se encontró

Poniéndole al tiempo de espera de la prueba **el último estado conocido**. Decía
«copiando», con todas las filas ya copiadas, la tabla dada por terminada y el
reloj parado en veintisiete milisegundos. Un trabajo lento sigue moviendo el
reloj; este no se movía. Lo que faltaba no era tiempo, era el aviso final.

#### Qué pasaba

Los avisos de progreso viajan por `Progress<T>`, que los entrega en el grupo de
hilos y **no garantiza el orden**. Los tres registros —traslado, respaldo y
restauración— guardaban a ciegas el último que llegara, así que un «en marcha»
rezagado podía pisar al «terminado» que ya se había guardado. A partir de ahí el
estado no se arreglaba solo: la barra no acababa nunca y el resumen no aparecía,
aunque el trabajo estuviera hecho y las filas en su sitio.

Por eso solo se veía con la máquina cargada —hace falta que dos avisos se crucen—
y por eso aparecía en pruebas distintas cada vez.

#### El arreglo

Terminar es definitivo: un estado terminal no se sustituye por uno en marcha. Y
entre dos avisos en marcha manda el que lleva más tiempo corrido, para que el
recuento no vaya hacia atrás delante de quien lo está mirando. La regla es la
misma en los tres registros, porque el fallo era el mismo en los tres.

**Verificado.** Cinco unitarias que reproducen el cruce —el aviso viejo llegando
después del final, el recuento que retrocede y el fallo que sí puede sustituir a
otro estado terminal— en el traslado, el respaldo y la restauración. Y la suite
entera, **753 en backend** (422 unitarias, 190 contractuales y 141 de
integración), en verde dos veces seguidas. La señal más clara es el reloj: las de
integración pasaron de 44 s a 16 s, porque ya nadie espera diez segundos a un
trabajo que había terminado.

**Archivos.** `TransferTracker`, `BackupTracker` y `RestoreTracker`;
`ProgressTrackerTests`; y en `TransferFlowTests`, el mensaje de espera agotada que
lleva el último estado, que es lo que destapó todo.

### Sesión 023f — 2026-08-19 · La pasada, ahora desde la pantalla

Lo que la sesión 023d dejó corriendo solo por HTTP ya se puede pedir desde Druse:
marcar varias tablas, elegir a dónde van y verlas copiarse en el orden que exigen
sus foráneas.

#### Un asistente aparte, no un modo del que había

`TransferSetDialog` vive al lado del de una tabla en vez de dentro. La razón es
que aquí **el destino no es una tabla sino el sitio donde viven las tablas**:
compartir pantalla obligaría a preguntar en cada paso cuál de los dos flujos se
está haciendo, y a llenar de condicionales una plantilla que ya es larga.

Sale del menú del esquema o de la carpeta —«Migrar tablas a…»—, que es donde se
mira cuando uno piensa «me llevo esto». Cuatro pasos: marcar, elegir sitio, ver el
plan, copiar.

#### Tres decisiones de la pantalla

1. **Empareja por nombre**, igual que las columnas: cada tabla del origen busca la
   que se llama igual al otro lado.
2. **Las que no están en el destino se dicen y se quedan fuera.** No se crean:
   crear una tabla es una decisión con tipos y clave primaria, y se toma de una en
   una en el otro asistente. Una pasada que crea a medias parece completa y no lo
   es.
3. **«Vaciar y cargar» no se ofrece aquí.** Vaciar exige escribir el nombre de la
   tabla, y con seis marcadas serían seis confirmaciones que no caben en una
   casilla. Se hace tabla a tabla, que es donde esa confirmación significa algo, y
   la pantalla lo dice en lugar de esconder el modo.

El orden se pide antes de confirmar y se enseña numerado, con los ciclos avisados
debajo. El progreso usa ya los dos niveles: «tabla 2 de 6» encima, y la barra de
la tabla en curso contra su estimación.

**Verificado.** **495 en frontend**, seis de ellas nuevas para este asistente: que
empieza con todas marcadas, que se puede quitar una, que empareja y enseña el
orden, que nombra las que faltan, que avisa del ciclo y que manda la pasada con lo
que se marcó. Y **en la aplicación levantada**, una de punta a punta que crea dos
tablas relacionadas en otro esquema, las migra desde el menú de la carpeta,
comprueba que el plan pone la padre primero y cuenta las filas de las dos tablas
del destino: **17 de punta a punta**, todas en verde.

**No hecho.** Los perfiles de migración, que son la otra mitad de la fase 4. Y en
esta pantalla, dos cosas que el plan pide y no están: **modo y filtro por tabla**
—hoy el modo es uno para toda la pasada— y elegir la clave de emparejamiento
cuando se actualiza, que se queda en la primaria de cada destino.

**Archivos.** `features/transfer/transfer-set-dialog/` (componente, plantilla,
estilos y pruebas), `transfer.store.ts` (`orderSet`, `startSet`, el avance por
tabla y el contador de tablas), el gateway (`orderTransferSet`, `runTransferSet` y
el progreso en dos niveles), `connections-sidebar` y `app-shell` para engancharlo,
y `e2e/tests/migracion.spec.ts`.

### Sesión 023e — 2026-08-19 · Conectar sin saberse el nombre de la base

Paréntesis en mitad de la fase 4, pedido al usarlo: al abrir una conexión, poder
**elegir entre las bases a las que se tiene acceso**, o dejar que Druse entre por
la primera.

Lo que había era una validación —«Indica la base de datos inicial.»— que no dejaba
conectar sin escribirla. Contra un servidor ajeno eso es pedir justo el dato que
se venía a buscar: la dirección y la clave se tienen; el nombre de la base, no.

#### Para preguntar hay que estar conectado a algo

Y ese algo es distinto en cada motor, así que lo dice cada proveedor:
`postgres` en PostgreSQL, `master` en SQL Server, `sysmaster` en Informix, y
**ninguna** en MySQL, que conecta sin base. Es el mismo sitio donde ya vivía el
puerto por omisión, y por la misma razón: es dato del dialecto, no del formulario.

Preguntar no cuesta permisos nuevos: el catálogo ya devolvía **solo las que el
usuario puede abrir** —`has_database_privilege` en PostgreSQL, `HAS_DBACCESS` en
SQL Server—, así que aquí no se comprueba nada, se elige.

#### Elegir, y qué hacer cuando no hay dónde

`DatabaseChoice` toma la primera que no sea del propio motor. Las del motor se
dejan para el final porque quien abre una conexión quiere ver sus datos, no el
catálogo del servidor; pero **si solo hay de esas, se usa una**: conectar a
`master` y dejar ver el explorador es mejor que negarse a abrir la conexión.

Y si preguntar falla, la sesión se queda como está. Un usuario con permiso para
entrar pero no para listar sigue teniendo una conexión que sirve, y perderla por
un listado informativo sería cambiar algo que funciona por nada.

#### En la pantalla

El campo sigue estando —quien sepa el nombre lo escribe— y ahora lleva al lado
«Ver las mías», que pregunta y llena la lista. Con una sola base la deja puesta,
que no hay nada que elegir. Debajo, la frase que hacía falta: **si se deja vacía,
se abre la primera a la que se tenga acceso**, para que vacío no parezca un
olvido. Cuando no se puede preguntar, ahí mismo se dice por qué en lugar de dejar
el botón mudo.

**Verificado.** Seis unitarias para la elección —solo bases del motor, ninguna,
mayúsculas, nombres vacíos— y tres de integración contra PostgreSQL, que además
de mirar la respuesta preguntan al motor con `SELECT current_database()`:
quedarse en la base de arranque y decir otra cosa se vería igual desde fuera. En
el frontend, cuatro casos nuevos del diálogo. Y **en la aplicación levantada**,
una de punta a punta que abre el formulario, pide las bases, deja el campo vacío y
comprueba que la conexión abre y el árbol enseña la base.

**Archivos.** `IDatabaseProvider` (`DefaultDatabase`, `SystemDatabases`) con los
cuatro proveedores, `ConnectionProfileValidator` —la base deja de ser
obligatoria—, `Connections/DatabaseChoice.cs`, `ConnectionService`
(`ListDatabasesAsync` y la elección al abrir), `DatabaseEndpoints`
(`POST /api/connections/databases`); en la interfaz, el gateway, el store y el
diálogo de conexión. Pruebas: `DatabaseChoiceTests`,
`ConnectionProfileValidatorTests`, `ConnectionDatabasesTests`,
`connection-dialog.spec.ts` y `e2e/tests/camino-critico.spec.ts`.

### Sesión 023d — 2026-08-19 · Varias tablas en una pasada, y en qué orden

Arranca la fase 4. Lo que entra es **el conjunto**: varias tablas trasladadas de
una vez, ordenadas por sus claves foráneas, con un progreso y una cancelación para
todas. Backend y puerta HTTP; la pantalla es lo siguiente.

#### La decisión, antes de escribir código

**«Todo o nada» sigue siendo por tabla, y la pasada se para en la primera que
falle.** Abarcar el conjunto entero con una transacción sería lo coherente cuando
hay foráneas de por medio, pero devuelve exactamente lo que la fase 1 evitó a
propósito —el registro del servidor creciendo hasta el final y las tablas
bloqueadas mientras dura—, ahora multiplicado por el número de tablas. Lo que
entró completo se queda, y el resumen dice cuántas pasaron y en cuál se paró, que
es de donde sale por dónde se retoma.

#### El orden se mira en el destino, no en el origen

Es el único lado que puede rechazar una escritura: si allí `pedidos` apunta a
`clientes`, copiar los pedidos primero falla por más ordenadas que estén en el
origen. `TransferOrder` es determinista —entre dos tablas que nadie obliga a
separar gana la que se pidió antes, porque un orden que cambia convierte cualquier
fallo a mitad en algo que no se puede reproducir—, ignora lo que apunta fuera del
conjunto y no trata como ciclo a la tabla que se apunta a sí misma, que es la
jerarquía de toda la vida. **Los ciclos se avisan y se copian sin ordenar.**

#### Lo que salió al construirlo

**Vaciar va antes de todo y en el orden contrario.** «Vaciar y cargar» sobre dos
tablas relacionadas falla siempre si se vacía la padre mientras la hija guarda
filas que la apuntan, así que el vaciado de la pasada se hace entero —de las hijas
hacia las padres— y después empieza la copia. El precio queda declarado: en una
pasada de varias tablas el vaciado ya no cae dentro de la transacción de su tabla.
Con una sola tabla nada de esto cambia.

**Una tabla es una pasada de una.** `RunAsync` construye un conjunto de un
elemento y sigue por donde siguen todos: dos caminos para lo mismo acaban siempre
con uno de los dos sin probar.

**El orden se pregunta antes de confirmar**, en `/api/transfers/set/order`. Quien
va a mover doce tablas quiere verlo en la vista previa, no enterarse por el aviso
de un traslado que ya empezó.

#### El cuelgue intermitente, acotado

Al ejecutar la suite apareció un traslado que se quedaba en «en marcha» y agotaba
los diez segundos que espera la prueba. **No es de la fase 4**: se reprodujo
guardando los cambios y ejecutando la misma clase en `HEAD`, donde también falla
—dos de diecinueve—. Es el mismo síntoma que quedó anotado en la sesión 023c,
cuando una prueba de punta a punta se quedó sin resumen en pantalla.

Lo que se sabe hasta ahora: no es un bloqueo permanente —subiendo el tope de
espera a cien segundos, la clase entera pasa dos veces seguidas y ninguna prueba
llega a diez—; no es agotamiento de conexiones —PostgreSQL admite cien y el pico
medido fue de treinta y cuatro—; y aparece más cuando hay varias clases corriendo
a la vez. Queda como lo primero que hay que mirar, con reproducción escrita.

**Resuelto en la sesión 023g**: no era lentitud, era el aviso de «terminado» que
un «en marcha» rezagado pisaba en el registro del progreso.

**Verificado.** **738 en backend** (410 unitarias, 190 contractuales y 138 de
integración) con `DRUSE_REQUIRE_ENGINES=1` y los cuatro motores. Nueve unitarias
nuevas para el orden —la cadena entera, el empate, lo que apunta fuera, la
autorreferencia y el ciclo— y seis de integración contra PostgreSQL: la padre
antes que la hija aunque se pidan al revés, **la misma pasada sin ordenar
rechazada por el motor** —que es lo que demuestra que ordenar sirve—, vaciar de la
hija hacia la padre, la pasada que se para diciendo cuántas tablas entraron, el
orden preguntado sin escribir nada y el ciclo dicho en lugar de inventado. El
frontend no se tocó, así que sus 485 siguen como estaban.

**No hecho.** La pantalla: hoy el asistente elige una tabla y una sola, así que la
pasada solo se puede pedir por HTTP. Y los perfiles, que son la otra mitad de la
fase.

**Archivos.** `Druse.Domain/DataTransfer.cs` (`DataTransferSetRequest`,
`TableRowsCopied`, `TablesDone`, `TablesTotal`),
`Application/Transfers/TransferOrder.cs`, `TransferService.cs` (`RunSetAsync`,
`OrderAsync`, `ClearAsync` y el estado en dos niveles), `TransferContracts.cs` y
`TransferEndpoints.cs` —`/api/transfers/set` y `/api/transfers/set/order`—.
Pruebas: `TransferOrderTests` y `TransferSetFlowTests`. La fase 4 en curso, con la
decisión y su porqué, en `docs/plan-migracion-de-datos.md`.

### Sesión 023c — 2026-08-19 · Cruzar de motor sin traducir en silencio

Fase 3 de la migración: **trasladar entre motores distintos**, que hasta ahora se
rechazaba a propósito, y **crear la tabla de destino** desde la estructura del
origen. De las cuatro fases quedan solo las varias tablas y los perfiles.

#### Dos preguntas, y no una tabla de todos contra todos

Lo difícil no era saber que un `uuid` se llama `uniqueidentifier` al otro lado.
Era poder decir, **antes de copiar nada**, qué deja de ser cierto en el destino.

La traducción no lleva equivalencias por par de motores: con cuatro serían doce
direcciones y crecerían al cuadrado. Se apoya en dos preguntas —qué familia es el
tipo, que el dominio ya sabía clasificar, y cómo llama este motor al tipo que
guarda eso, que es `ITableDesigner.TypeFor`—, y lo demás sale del propio texto del
tipo con `TypeFacets.Parse`: longitud, precisión, escala y si tenía límite. Cada
dialecto aporta una sola respuesta, no once.

#### Los avisos son el producto

Un JSON que llega a un motor sin JSON viaja entero, pero deja de validarse y de
consultarse por sus campos. Un identificador único sin tipo propio se guarda
escrito, con sus 36 caracteres. Una marca de tiempo con zona pierde el huso donde
no se guarda. Un texto sin límite que llega con tope cabe hoy y quizá no mañana.
Y una columna que guarda varios valores **no se traduce a la fuerza**: fuera de
PostgreSQL no hay dónde ponerla, y meterla como texto dejaría dentro la
representación del conjunto en vez de sus elementos, así que impide crear la
tabla hasta que se le escriba un tipo o se la deje fuera. El tipo escrito a mano,
en cambio, gana sin discusión: quien lo escribe sabe algo que el traductor no.

#### Lo que enseñó una prueba

La traducción **va por su propia ruta** y no dentro de la vista previa, porque se
pregunta antes de que la tabla exista, que es justo cuando sirve para decidir si
crearla. La vista previa compara dos tablas que ya están.

Y crear la tabla deja fuera tres cosas a propósito: índices y foráneas —por lo
mismo que en un respaldo—, **la identidad**, porque la tabla nueva existe para
recibir los valores del origen y una columna que los genera sola pelearía con
ellos, y **los valores por omisión**, que son expresiones del dialecto de origen
—`now()`, `GETDATE()`, `CURRENT`— y crearían una tabla que no compila.

**Verificado.** Todo vuelto a ejecutar al cerrar la fase: **723 en backend** (401
unitarias, 190 contractuales y 132 de integración) con `DRUSE_REQUIRE_ENGINES=1` y
los cuatro motores levantados, sin saltarse ninguna; **485 en frontend**; y **las
15 de punta a punta**, incluida la que crea la tabla desde el asistente y cuenta
las filas de la tabla nueva al final. Lo cruzado se comprueba contra motores de
verdad en `CrossEngineTransferTests` —PostgreSQL a SQL Server, con un tipo de cada
familia que da problemas al cruzar—, con el tipo escrito a mano ganando al
propuesto y la columna sin equivalente impidiendo crear la tabla.

**El fallo anotado en el commit anterior no se reprodujo.** «Repetir la copia
actualizando» se había quedado sin resumen en pantalla y falló por tiempo; aquí
pasa dos veces seguidas, sola y con la suite entera. Encaja con el nerviosismo ya
conocido de Playwright cuando hay un servidor de desarrollo levantado en
paralelo, y queda como sospecha, no como diagnóstico.

**No hecho.** Nadie ha migrado entre dos motores **desde la pantalla**: lo cruzado
está comprobado por HTTP, y la prueba de punta a punta del camino nuevo crea la
tabla dentro del mismo motor. `CrossEngineTransferTests` cubre una de las doce
direcciones posibles; las otras once solo están en unitarias. Y el paso de tipos
del asistente no tiene pruebas de componente en el frontend.

**Archivos.** `Druse.Domain/TypeFacets.cs` y `DataTransfer.cs` (`TypeOverrides`),
`Application/Transfers/TypeTranslator.cs` y `TransferService.cs`,
`ITableDesigner.TypeFor` con `TableDesignerBase` y los cuatro diseñadores,
`TransferContracts.cs` y `TransferEndpoints.cs` —las rutas
`/api/transfers/translation` y `/api/transfers/target`—; en la interfaz, el
gateway y el paso `types` del asistente. Pruebas: `TypeTranslationTests`,
`TransferPlanTests`, `CrossEngineTransferTests`, `TestServerFixture` y
`e2e/tests/migracion.spec.ts`. Documentación: la fase 3 cerrada y la 4 detallada
en `docs/plan-migracion-de-datos.md`.

### Sesión 023b — 2026-08-19 · Qué hacer con lo que ya está en el destino

Fase 2 de la migración: **actualizar la fila que ya está** (`Upsert`) y **añadir
solo lo que falta** (`SkipExisting`). Los dos modos ya viajaban en el contrato
desde la sesión anterior, rechazados a propósito; ahora funcionan en los cuatro
motores.

#### Un método más en el editor de filas, no un servicio aparte

`IRowEditor.WriteAsync` recibe el lote, qué hacer con lo que ya está y las
columnas que identifican la fila. `RowEditorBase` lo implementa una vez
—transacción, parámetros y recuento son iguales— y `InsertAsync` pasa a ser ese
mismo camino con «fallar si ya está», que es lo que siempre fue.

Cada motor pone su dialecto, y no son cuatro variantes de lo mismo: PostgreSQL y
MySQL lo dicen con una cláusula al final del `INSERT`; SQL Server e Informix
necesitan un `MERGE` entero. Informix además exige un `CAST` por valor, porque un
`?` suelto dentro del `SELECT` de origen no tiene de dónde deducir su tipo, y su
fila de origen sale de `sysmaster:sysdual`.

#### Las dos cosas que costaron

**El recuento no significa lo mismo en cada motor.** MySQL devuelve dos filas
afectadas cuando actualiza una. Se normaliza en la base: lo que se cuenta es *si
la fila se escribió*, y de ahí salen «entraron 900» y «ya estaban 4.100» como dos
números distintos.

**En MySQL, omitir tiene que ser `INSERT IGNORE`.** La forma elegante —`ON
DUPLICATE KEY UPDATE col = col`— parecía mejor y no sirve: MySqlConnector cuenta
por omisión filas *encontradas* y no *afectadas*, así que una fila que ya estaba
devolvía uno y se contaba como escrita. Lo destapó la contractual, no una
revisión. El precio es que `IGNORE` también degrada a aviso algún error de datos;
se asume porque los valores llegan convertidos contra los tipos del destino.

Y una diferencia que no se puede tapar: **MySQL no deja decir con qué clave se
choca**, reacciona ante cualquier restricción de unicidad de la tabla. Queda
escrito en el proveedor y en el plan.

#### La regla que evita el accidente

Las columnas que identifican la fila salen de la clave primaria del destino y se
pueden cambiar —sincronizar dos entornos suele hacerse por una clave de negocio—,
pero **tienen que estar respaldadas por la clave primaria, una restricción de
unicidad o un índice único**. Se comprueba contra el catálogo antes de escribir
nada, porque con una clave que se repite «actualiza la que ya está» toca todas las
que coinciden: no falla, no avisa, y deja el destino con filas que nadie pidió
cambiar. También se exige que la clave se copie: si no viaja, todas las filas se
parecerían en ella.

**Verificado.** **690 en backend** (371 unitarias, 190 contractuales y 129 de
integración) con `DRUSE_REQUIRE_ENGINES=1` y los cuatro motores levantados; las
20 contractuales nuevas comprueban en los cuatro que insertar dos veces falla, que
actualizar cambia sin duplicar, que omitir cuenta lo que dejó estar y que repetir
el traslado deja lo mismo que hacerlo una vez. **485 en frontend** y **14 de punta
a punta**, una de ellas repitiendo la copia dos veces contra la aplicación
levantada para ver que al final hay tres filas y no seis.

**Archivos.** `IRowEditor`, `RowEditorBase` y los cuatro editores de proveedor;
`RowEdit.cs` (`RowsSkipped`), `DataTransfer.cs` (`KeyColumns`),
`TransferService.cs`, `TransferContracts.cs`; en la interfaz, el gateway y el
asistente. Pruebas: `DatabaseProviderContractTests`, `TransferPlanTests`,
`TransferFlowTests`, `transfer-dialog.spec.ts` y `e2e/tests/migracion.spec.ts`.

### Sesión 023 — 2026-08-19 · Migrar los datos de una tabla a otra

Druse sabía llevar un archivo a una tabla (importar) y una tabla a un archivo
(respaldar). Faltaba lo de en medio, que es lo que se pide a diario: **pasar las
filas de una tabla a otra**, aunque estén en otro esquema, en otra base o al otro
lado de otra conexión —de desarrollo a producción, por ejemplo—, eligiendo qué
columnas viajan.

Es la fase 1 de cuatro. Cubre una tabla a otra, dentro del mismo motor, con
filtro de filas, añadir o vaciar-y-cargar, y progreso cancelable. Quedan el
upsert y omitir-existentes (2), la traducción de tipos entre motores y crear la
tabla destino (3), y varias tablas de una vez con migraciones guardadas (4).

#### Casi todo estaba ya escrito

El servicio nuevo se apoya en piezas que ya funcionaban: `SelectData` +
`OpenReaderAsync` para leer sin materializar, `RowBatchPlanner` para convertir,
`IRowEditor.InsertAsync` para escribir, `TableDataFilter` para el `WHERE`, el
patrón de `IBackupTracker` para el progreso que sobrevive a cerrar la ventana, y
`BeginDataLoad`/`EndDataLoad` para poder copiar los identificadores que genera el
motor. Lo genuinamente nuevo es el bucle que lee de una sesión y escribe en otra.

#### Las tres decisiones que cambian el resultado

**1. Se escribe por lotes, y cada lote se confirma.** Una transacción que abarque
millones de filas revienta el registro del servidor y bloquea la tabla mientras
dura. Troceando, lo copiado se queda y el resumen dice cuántas filas entraron —que
es la única pregunta que importa cuando algo falla a mitad—. Para una tabla
pequeña, donde dejarla a medias sería peor, está «todo o nada», que necesitó un
`IWriteScope` nuevo en `IRowEditor`: abre una transacción y **se la presta a la
sesión** con `Borrow`, de modo que los lotes se unan a ella en lugar de abrir la
suya. Es el mismo mecanismo que la instantánea de los respaldos.

**2. El lado que lee necesita su propia conexión.** Copiar entre dos esquemas de
la misma conexión es de lo más corriente, y ningún motor de estos admite un lector
abierto y un `INSERT` a la vez por el mismo cable. Cuando origen y destino
comparten sesión, se abre una auxiliar con la misma identidad —lo que ya hacía el
explorador para navegar otras bases—. Sin esto, el caso más común se quedaría
colgado. Y los turnos de las dos sesiones se piden **en orden de identificador**:
dos traslados cruzados entre las mismas conexiones se esperarían para siempre.

**3. Vaciar es un `DELETE`, no un `TRUNCATE`.** Aunque sea mucho más lento. MySQL
confirma la transacción en curso al truncar —con lo que «todo o nada» dejaría de
ser cierto justo en el modo que borra— y truncar falla en cuanto otra tabla
apunte a esta, que es lo normal en la tabla que uno quiere reemplazar.

**Y una que es de seguridad:** un valor que no cabe para el traslado entero,
diciendo la fila y la columna. Es lo contrario de importar, que enumera todos los
problemas para que se corrija el archivo: aquí no hay archivo que corregir, y
seguir metiendo filas dejaría en el destino una tabla que nadie sabe describir.
Vaciar el destino, además, exige escribir el nombre de la tabla.

#### Lo que solo se vio conduciendo la interfaz

Con las pruebas en verde, tres cosas que el código no decía:

- Los desplegables del emparejado salían **vacíos** aunque la columna sí tuviera
  pareja: en Angular, `[value]` sobre un `<select>` se aplica antes de que el
  `@for` haya creado sus `<option>`. Va en cada opción con `[selected]`.
- La vista previa decía «con condición, el catálogo no lo estima» **sin que
  hubiera condición**: lo que faltaba era el recuento del catálogo. Ahora
  distingue los dos casos.
- «No se copian 1 columnas». Concordancia.

**Verificado.** **659 en backend** (366 unitarias, 170 contractuales y 123 de
integración; 13 nuevas del traslado contra PostgreSQL real, incluidas dos
sesiones distintas, dos esquemas de la misma conexión, el troceado en lotes y
«todo o nada»), **483 en frontend** y **13 de punta a punta**, dos de ellas del
asistente: una copia tres filas y lo demuestra con un `COUNT(*)`, la otra
comprueba que vaciar no se puede pedir sin escribir el nombre.

**No hecho.** Las fases 2 a 4. `Upsert` y `SkipExisting` existen en el contrato y
el proceso local **los rechaza diciéndolo**, en lugar de caer en «insertar» y
duplicar filas sin que nadie lo pida. Lo mismo entre motores distintos.

**Archivos.** Backend: `DataTransfer.cs`, `Transfers/TransferService.cs`,
`ITransferTracker.cs`, `Transfers/TransferTracker.cs`, `TransferEndpoints.cs`,
`TransferContracts.cs`, y en las abstracciones `IRowEditor`, `RowEditorBase`,
`IDatabaseScripter` y `TableDesignerBase`. Frontend: `transfer.store.ts`,
`features/transfer/transfer-dialog/`, el gateway, el shell y la barra lateral.
Pruebas: `TransferPlanTests.cs`, `TransferFlowTests.cs`, `transfer.store.spec.ts`,
`transfer-dialog.spec.ts` y `e2e/tests/migracion.spec.ts`.

### Sesión 022p — 2026-08-18 · Playwright, y los dos fallos que destapó montarlo

Pruebas de punta a punta con Playwright: la aplicación entera —Angular, la API
local y un PostgreSQL real— por donde la usa una persona. **11 pruebas del
camino crítico**, en `e2e/`, levantando los servidores por su cuenta en puertos
propios (5188 y 4300) para no pisar los de `dev.ps1`.

Lo interesante no fueron las pruebas, sino lo que hizo falta para que
funcionaran.

**1. En Windows no se podían aislar los datos.** La API guarda conexiones,
historial y pestañas en la carpeta del usuario, así que unas pruebas que crean
conexiones escribirían dentro del Druse de quien las lanza. Lo obvio —arrancarla
con otro `APPDATA`— **no funciona**: `GetFolderPath` pregunta a la API del
sistema y esa variable le da igual. Se vio en vivo: el backend de las pruebas
escribió su `endpoint.json` en el perfil de verdad mientras el proxy, que es de
Node y sí respeta la variable, buscaba el token en la carpeta vacía. Ahora
`AppPaths` mira `DRUSE_DATA_DIR`, que además sirve para una instalación portable
o para dos perfiles en la misma máquina.

**2. El proxy del servidor de desarrollo tenía código muerto que engañaba.**
`proxy.conf.js` resolvía el puerto de la API en cada petición con `router`, y
**Vite no mira `router`**: solo usa `target`, que estaba fijo al 5177. No se
notaba porque la API arranca justo en ese puerto, así que acertaba por
casualidad; con la API en el 5188, todas las peticiones se iban al 5177 y volvían
502. Ahora el destino se decide al arrancar, y `DRUSE_API_PORT` manda sobre el
archivo —cuando el servidor de desarrollo y la API arrancan a la vez, el punto de
conexión todavía no existe—. `dev.ps1` y `dev.sh` lo pasan, con lo que su
parámetro `-ApiPort` funciona de verdad por primera vez.

**Y tres cosas más que solo se ven al conducir la interfaz:** el diálogo de
conexión propone «Cifrado» y el contenedor de PostgreSQL no tiene TLS, así que
hay que elegir «Sin cifrar»; un clic sobre una conexión ya desplegada la pliega,
de modo que solo se pulsa cuando sus bases no están a la vista; y la primera
celda de cada fila es el número de fila, no un dato —una prueba que la leyera
compararía contra «1», «2», «3» y pasaría dijera lo que dijera la consulta—.

**Qué cubren.** Arrancar, conectarse a un PostgreSQL real por el diálogo, ver
sus bases, ejecutar y leer las filas, varios conjuntos de resultados, un error
que no rompe la sesión; y del editor: «Ejecutar actual» con el cursor en cada
instrucción, el cursor pegado al `;`, `Ctrl+Enter` con la pestaña entera, el
subrayado exacto del error, el error de un fragmento en su sitio y la marca que
se borra al acertar.

**Verificado.** **11 de 11 en 1,9 minutos desde cero** —sin servidores previos y
con la carpeta de datos vacía, que es como correrá en CI— y **345 unitarias** de
backend tras el cambio de `AppPaths`. Comprobado además que el perfil real
siguió intacto: las cinco conexiones y las tres pestañas de siempre.

**Archivos.** `e2e/` entero (configuración, dos ficheros de pruebas, helpers y
README), `AppPaths.cs`, `SecretStoreTests.cs`, `proxy.conf.js`, `dev.ps1`,
`dev.sh`, `.github/workflows/ci.yml`, `.gitignore` y `README.md`.

### Sesión 022o — 2026-08-18 · Señalar dónde falló, no la línea entera

El editor ya marcaba el error de una ejecución, pero marcaba **la línea entera**
aunque el motor supiera la palabra exacta, y en dos de los cuatro motores no
marcaba nada.

**Lo primero fue preguntarle a cada motor qué sabe decir.** Una sonda con el
mismo `SELECT` roto en la tercera línea, contra los cuatro:

| Motor | Qué entrega |
| --- | --- |
| PostgreSQL | `position` = 17, el carácter exacto |
| SQL Server | `line` = 3, sin columna |
| MySQL | nada en campos; la línea va **dentro del mensaje**: «…at line 3» |
| Informix | nada: «A syntax error has occurred.» y punto |

**Con posición se subraya la palabra.** `executionErrorPlace` devuelve línea y
columna, y el editor marca la palabra que empieza ahí —`getWordAtPosition`— o el
carácter suelto si el error cae sobre un símbolo. Con solo línea se sigue
subrayando la línea entera: inventarse una columna sería señalar un sitio falso.

Hay un detalle que solo aparece con «Ejecutar actual»: lo que dice el motor es
relativo **al fragmento enviado**, no a la pestaña. La línea ya se desplazaba; la
columna también hace falta desplazarla, pero **solo en la primera línea del
fragmento**, que es la única que puede empezar a media línea.

**MySQL escribe la línea en el texto y de ahí se saca.** Es un heurístico y se
comporta como tal: la expresión se ancla al final del mensaje —el SQL del usuario
viaja dentro y podría llevar un «at line 99» en un literal— y si el servidor
responde en otro idioma no se devuelve ninguna línea. Antes de esto, en MySQL el
error se leía sin saber dónde miraba.

**Informix no se puede arreglar desde aquí.** No da posición, ni línea, ni el
fragmento culpable. Queda declarado en el contrato: `SyntaxErrorPlace.Nothing`, y
la prueba lo comprueba contra el motor real. Si algún día IBM lo añade, esa
prueba se pondrá roja y nos enteraremos.

**Verificado.** **623 pruebas de backend** —343 unitarias, 170 contractuales y
110 de integración, con los cuatro motores— y **468 en frontend**. Y visto en la
aplicación contra PostgreSQL: un `FROM` mal puesto subraya `FROM` y solo `FROM`;
la misma consulta como tercera instrucción de la pestaña lo subraya en su sitio
real; y una columna inexistente subraya el nombre de la columna. En MySQL se
comprobó por la API, que ahora devuelve `line: 3` donde antes devolvía nulo.

**Archivos.** `execution-error.ts`, `sql-editor.ts`, `sql-editor.spec.ts`,
`MySqlErrorNormalizer.cs`, `Druse.Provider.MySql.csproj`,
`MySqlErrorNormalizerTests.cs` (nuevo), `ProviderContract.cs`, las cuatro
fixtures y `DatabaseProviderContractTests.cs`.

### Sesión 022n — 2026-08-18 · Ejecutar solo la instrucción del cursor

Con varias consultas en la misma pestaña, ejecutar una obligaba a resaltarla a
mano: «Ejecutar» manda la pestaña entera y «Ejecutar selección» estaba
deshabilitado si no había nada marcado.

**El botón pasa a ser «Ejecutar actual».** Con selección, ejecuta lo
seleccionado; sin ella, la instrucción donde está el cursor. Ya no se deshabilita
y su atajo, `Ctrl+Shift+Enter`, se ve en el propio botón. `Ctrl+Enter` sigue
siendo la pestaña entera: no se cambia un atajo que ya está en los dedos.

**Partir por `;` no vale.** Un punto y coma dentro de un literal
—`'O''Donnell; 12'`—, de un identificador citado o de un comentario es un
carácter más, y cortar ahí manda media instrucción al servidor. `sql-statements`
recorre el texto con los mismos criterios que `SqlStatementReader` usa para leer
un respaldo: los cuatro estilos de comilla, comentarios de línea y de bloque. Y
con el mismo límite declarado: **el `$cuerpo$` de PostgreSQL no se reconoce**.

Lo que sí es distinto de leer un respaldo: aquí hacen falta las **posiciones**,
no las instrucciones. El texto se parte en tramos que lo cubren entero, incluidos
los huecos, para que cualquier cursor caiga en alguno. El sitio pegado al `;`
cuenta como parte de la instrucción que cierra —es el caso de escribirla,
cerrarla y pulsar el atajo sin mover el cursor—; en un hueco de en medio manda lo
que viene debajo; y un tramo con solo comentarios se salta.

El desplazamiento donde empieza el fragmento viaja con él, así que **el error del
servidor sigue señalando la línea de verdad** y no la primera del trozo.

El cálculo lo hace el editor, que es quien tiene el cursor, y solo al pedirlo:
recorrer el texto en cada pulsación sería pagar por algo que se usa al ejecutar.
La paleta de comandos gana «Ejecutar instrucción actual», que si no la acción
nueva solo se descubre pulsando el botón.

**Verificado.** **466 pruebas en frontend** (17 nuevas, todas del separador: los
puntos y coma que no separan, dónde cae cada cursor y qué pasa cuando no hay nada
que ejecutar). Backend sin tocar.

**Archivos.** `sql-statements.ts` y su prueba (nuevos), `sql-editor.ts`,
`app-shell.ts`, `app-shell.html`, `editor-toolbar.html`, `editor-toolbar.scss`,
`command-palette.ts`.

**Y se vio funcionando.** Levantando Druse de verdad contra el contenedor de
PostgreSQL, con tres `SELECT` en una pestaña: el cursor en la segunda ejecuta la
segunda, en la tercera —que no lleva `;` final— la tercera, pegado al `;` de la
primera la primera, con selección lo seleccionado, y `Ctrl+Enter` sigue
devolviendo los tres resultados.

Eso encontró algo que el código no decía: **el texto del panel vacío se había
quedado atrás**. Anunciaba «una selección con Ctrl+Shift+Enter» cuando ese atajo
ya hace más que eso. Corregido.

**Cómo se condujo el navegador, por si hace falta repetirlo.** La extensión de
Chrome no estaba conectada y el proyecto no trae Playwright, así que se habló CDP
directamente desde Node —`WebSocket` es global desde Node 21— contra el Chrome ya
instalado. Dos cosas que costaron: el servidor de Angular escucha en `localhost`
resolviendo a IPv6, y `127.0.0.1:4200` **no responde**; y cerrar una pestaña con
cambios abre un `confirm()` del navegador que **congela el renderer**, así que
hay que atender `Page.javascriptDialogOpening` o la siguiente evaluación no
vuelve nunca.

### Sesión 022m — 2026-08-18 · El ciclo en los otros tres motores, y lo que escondían

Llevar el ciclo de respaldo y restauración a los cuatro motores **por HTTP** era
la tarea que quedaba de la Fase F. No fue escribir pruebas de una función que ya
estaba: fue destapar que en dos motores no funcionaba.

**1. En MySQL e Informix el respaldo perdía la estructura de todas las tablas.**
La instantánea abre una transacción sobre la conexión de la sesión —para que
todas las tablas se lean en el mismo instante— pero no se la anunciaba a nadie.
Los comandos que leen el catálogo salían sin ella, y esos dos motores rechazan un
comando cuando la conexión tiene una transacción pendiente: «the transaction
associated with this command is not the connection's active transaction». Cada
tabla se saldaba con un aviso y el respaldo terminaba «con avisos» llevándose
**solo los datos**. En PostgreSQL no se ve porque Npgsql no exige asignarla; en
SQL Server tampoco, porque la base de prueba no admite instantáneas y se acaba
trabajando sin transacción, o sea que **pasaba por accidente**. Ahora la
instantánea se presta a la sesión mientras dura, y todo comando que salga la
lleva puesta.

**2. En MySQL, restaurar «en otra base» escribía en la de origen.** Allí el
esquema es la base, así que el guion salía con `druse_test.tabla` dentro y el
artefacto quedaba atado a la base de la que salió. Se veía como un `CREATE TABLE`
que fallaba porque la tabla ya existía —en el origen—; **si no hubiera existido,
se habría creado en la base equivocada sin que nada lo dijera**. Ahora el guion de
MySQL nombra la tabla a secas, como hace `mysqldump`, y eso alcanza también a lo
que apuntan las claves foráneas. Lo que se lee del origen sí conserva el nombre
completo: la tabla puede estar en otra base del mismo servidor. Y la inspección
empareja las colisiones aunque el artefacto no traiga esquema, que si no diría
«no hay nada que sobrescribir» justo antes de sobrescribirlo.

**3. Las pruebas dejaban bases huérfanas.** `DROP DATABASE` no llega a ejecutarse
mientras el pool del proveedor conserve una conexión, y la limpieza se traga los
errores: en el contenedor de PostgreSQL había **diez** `druse_nueva_*` y nueve en
el de SQL Server. Ahora cada motor dice cómo se borra del todo una base suya
—`WITH (FORCE)` en PostgreSQL, `SINGLE_USER WITH ROLLBACK IMMEDIATE` en SQL
Server— y las que ya estaban se borraron.

**4. El autocompletado quedaba por debajo de la rejilla.** Las cabeceras de las
columnas son `sticky` con z-index 2 y el editor no creaba capa propia, así que
cuando la lista de sugerencias caía sobre el panel de resultados se veían los
nombres de las columnas por encima. El editor pasa a una capa por encima de la
rejilla y del tirador, y por debajo de los menús y de todo lo modal.

**Verificado.** **615 pruebas de backend** —339 unitarias, 166 contractuales y
110 de integración, con `DRUSE_REQUIRE_ENGINES=1` y los cuatro motores— y **466
en frontend**. Las nueve nuevas son el ciclo completo, la base nueva y el rechazo
de la base repetida, en SQL Server, MySQL e Informix.

**De paso, las pruebas dicen ahora por qué fallan.** Un respaldo con avisos hacía
caer el ciclo con un «se esperaba Completed» y ni una palabra del motivo; ahora
el mensaje trae los avisos, el fallo y la instrucción donde se paró. Es lo que
convirtió el primer fallo en un diagnóstico en un minuto.

**Archivos.** `SessionTransaction.cs`, `TableDesignerBase.cs`,
`MySqlTableDesigner.cs`, `IDatabaseScripter.cs`, `RestoreService.cs`,
`RestoreEngines.cs` (nuevo), `RestoreEndpointTests.cs`, `TableScripterTests.cs`,
`sql-editor.ts`, `docs/plan-respaldos-y-restauracion.md`.

**No hecho.** Repetir a mano el respaldo de `empresa_estado_financiero`: esa base
no está en los contenedores, es de un servidor del usuario.

### Sesión 022l — 2026-08-18 · Lo que encontró usarlo de verdad

Cuatro cosas, y **tres salieron de una sola tarde de uso real**, no de leer el
código. Conviene anotarlo: el respaldo llevaba dos sesiones «terminado».

**1. Los índices sobre expresiones rompían la restauración entera.** Un índice
como `lower(nit)` no tiene columnas que enumerar; el catálogo devuelve la lista
vacía y el guion salía con `CREATE INDEX … USING btree ()`. La restauración se
paraba ahí con «syntax error at or near ")"» **en la instrucción 2.722 de
2.747**, con todo lo anterior ya aplicado. Ahora PostgreSQL entrega su propia
definición —`pg_get_indexdef`, solo para los que tienen `indexprs`— y se guioniza
tal cual; y en cualquier motor, un índice sin columnas y sin definición ya no se
escribe, con su aviso por tabla. Mejor un índice de menos que un artefacto que no
se puede aplicar.

**2. Restaurar en una base nueva.** El asistente pregunta dónde: la base abierta,
o una que se crea en ese momento con el nombre del que venía el respaldo. No se
restaura dentro de una que ya exista —quien copia no espera escribir encima— y se
comprueba dos veces: en la pantalla mientras se escribe el nombre, y en el
proceso local antes de tocar nada. La base se crea **antes** de abrir el
artefacto: si el nombre está cogido, mejor saberlo antes que a mitad de tres
millones de filas. `CREATE DATABASE` entra en el contrato del scripter, con el
`WITH LOG` de Informix, donde una base sin registro se crea y luego no admite
conexiones DRDA.

**3. Abrir un `.sql` en el navegador no abría nada.** Se elegía el archivo y no
pasaba nada. El código adivinaba la cancelación mirando el foco de la ventana, y
el navegador devuelve el foco **antes** de despachar el `change`: se quitaba el
input del DOM —matando el evento que estaba por llegar— y se resolvía como si no
se hubiera elegido nada. Ahora se usa `showOpenFilePicker` donde existe y, si no,
el evento `cancel` del propio input. Ese camino **no tenía ninguna prueba**, que
es exactamente cómo un fallo así llega al usuario; ahora tiene cuatro.

**4. Cambiar de conexión sin salir de la pestaña.** El chip de la barra dice
ahora «conexión · base» y su menú lista las dos cosas: las conexiones abiertas y
también las guardadas, que se abren al elegirlas. Es el caso de mirar algo en
desarrollo y repetirlo en preproducción sin pegar el SQL en otra pestaña. Al
cambiar se retira el resultado en pantalla y la procedencia editable —eran de
otro servidor— y se avisa de la transacción que quede abierta en la conexión que
se deja. Producción se ve desde el chip, sin abrir el menú.

**Verificado.** **606 pruebas de backend** —339 unitarias, 166 contractuales y
101 de integración, con `DRUSE_REQUIRE_ENGINES=1` y los cuatro motores— y **466
en frontend**. Las nuevas cubren el índice de expresión de punta a punta, la base
nueva (creada y rechazada por nombre repetido), el camino del navegador al abrir
un `.sql` y el cambio de conexión.

**De propina.** `docs/Guia-Druse-Levantar-y-Empaquetar.md`: cómo levantar los
servicios a mano y generar instaladores y portable, con las rutas exactas de cada
artefacto. Se redactó en Word, pero **al repositorio entra en Markdown**: un
`.docx` es un binario y ningún diff lo enseña. El original se queda fuera, en
`docs/`, ignorado.

**Sigue sin poder compilarse Rust en este equipo**, así que todo lo probado va
por el navegador; el envoltorio no se ha ejercitado.

### Sesión 022k — 2026-08-18 · Elegir dónde va el respaldo, sin teclear la ruta

El asistente ya tenía un botón «Elegir…», pero **solo aparecía dentro del
envoltorio**: usaba el diálogo nativo de Tauri. En el navegador —que es como se
prueba en este equipo, donde Rust no compila— la única forma de decir dónde iba
el respaldo era teclear la ruta entera y acertar a la primera.

Ahora hay un selector propio: **el proceso local enumera las carpetas** y la
pantalla las enseña. Es el mismo proceso que después escribe el archivo, así que
lo que se ve es exactamente lo que él puede hacer: si una carpeta no aparece,
tampoco podría escribir en ella. El botón está siempre; dentro del envoltorio
sigue abriendo el diálogo del sistema, que es el que el usuario ya conoce.

**La carpeta y el nombre son dos campos y no uno.** Son dos decisiones distintas
—dónde y cómo se llama— y juntarlas en una caja de texto es justo lo que obliga a
escribir la ruta a mano. El nombre viene propuesto (`respaldo-base-fecha.sql`) y
se puede cambiar entero; la etiqueta cambia a «Nombre de la carpeta» cuando el
respaldo va por carpetas, porque entonces lo que se crea es un directorio.

Tres cosas que el selector hace y un campo de texto no podía:

- **Dice si ya existe** algo con ese nombre, antes de aceptar. No lo impide
  —repetir el respaldo de ayer encima es legítimo— pero se ve.
- **Comprueba que se puede escribir**, y lo comprueba escribiendo: en Windows los
  permisos no se deducen de los atributos, así que se crea un archivo temporal y
  se borra en el acto.
- **Crea carpetas** sin salir a buscar el explorador de Windows.

El nombre se valida como nombre: un `..\` dentro escribiría en un sitio distinto
del que la pantalla enseña, y eso no es una comodidad sino una sorpresa. Solo se
enumeran **carpetas**, nunca archivos: para elegir dónde guardar no hacen falta.

**Hecho.** `IFolderBrowser` en `Druse.Platform.Abstractions` y su implementación
en `Druse.Platform.Native`, los endpoints `/api/folders`, el componente
compartido `folder-picker` y su enganche en el asistente de respaldo.

**Verificado.** **336 unitarias, 166 contractuales y 98 de integración** en el
backend y **432 en frontend**, todas en verde. Las nuevas son catorce del
explorador, seis de sus endpoints, trece del selector —ocho al guardar y cinco al
abrir— y una del asistente de restaurar.

**Y después, el mismo selector para restaurar.** Elegir un artefacto no es
componer una ruta nueva sino señalar algo que ya existe, así que el componente
gana un modo: al **abrir** enseña los archivos —solo los `.sql` y `.zip`, con su
tamaño y su fecha, del más reciente al más viejo— y **marca las carpetas que
llevan un `manifest.json` dentro**, que son las que se pueden restaurar enteras.
Sin esa marca habría que entrar en cada carpeta a comprobarlo.

Elegir el respaldo **lo mira en el acto**: era lo que se iba a hacer a
continuación de todos modos, y dejar la ruta puesta sin inspeccionarla obligaba a
pulsar «Mirar» para descubrir si servía.

Al **guardar** también se enseñan los `.sql` y `.zip` que ya están en la carpeta,
y pinchar uno copia su nombre: es como se sobrescribe el respaldo de la semana
pasada sin teclearlo entero. Que ya exista lo sigue diciendo el aviso de debajo.

Una lección de la prueba a mano: la lista **no puede dar por hecho** que la
respuesta traiga archivos. Con una API anterior —la que el usuario tenía
levantada— el campo no venía y el `@for` tumbaba el render entero del selector,
con lo que el síntoma no era «no hay archivos» sino «no me deja elegir nada».

### Sesión 022j — 2026-08-18 · Los CSV se restauran, y por el camino aparecen dos errores

Un respaldo con los datos en CSV se inspeccionaba bien y no se aplicaba: el
lector del artefacto solo miraba los `.sql`. Ahora el artefacto no entrega
cadenas sino **entradas** —una instrucción o un lote de filas—, y quien restaura
distingue: la instrucción se ejecuta y las filas se meten por el camino de la
importación, con sus columnas emparejadas por nombre y sus valores convertidos al
tipo de cada columna.

Las filas van **en lotes de 500**, y eso resuelve dos cosas a la vez: una tabla de
tres millones de filas no se carga en memoria, y cada lote es una entrada del
flujo, así que reanudar cae en el grano correcto. Reanudar desde el archivo
entero habría duplicado todo lo ya insertado.

El CSV se parte con la **misma máquina de estados** que usa la importación
(`CsvSplitter`), ahora compartida: dos formas de leer un CSV serían dos formas de
equivocarse con las comillas. Y la conversión de filas de texto a un lote de
`INSERT` se extrajo a `RowBatchPlanner`, que usan la importación y la
restauración: dos criterios distintos sobre qué es un nulo solo se verían en los
datos, nunca en un error.

**Lo que el formato no conserva, se dice antes.** Un CSV escribe igual un nulo y
una cadena vacía. En las columnas que no son texto la diferencia se recupera —una
celda vacía en una fecha solo puede ser un nulo—, pero en una columna de texto el
nulo vuelve como cadena vacía, y la inspección lo avisa antes de aplicar nada.

**Dos errores que solo aparecieron al probarlo en los cuatro motores.** La prueba
contractual nueva —leer las filas como texto y volver a meterlas, que es lo que
hace un CSV— falló en tres motores:

1. **Las fechas.** MySQL, SQL Server e Informix devuelven una columna `DATE` como
   «2026-08-17 00:00:00», y `ColumnValueParser` la rechazaba por no ser una fecha.
   Rompía la restauración **y la importación** de cualquier CSV exportado por
   Druse desde esos tres motores.
2. **Los nulos sin tipo.** Un `DBNull` sin `DbType` lo manda el driver como texto,
   y SQL Server tumbaba el `INSERT` entero al llegar a una columna binaria. Ahora
   la celda lleva el tipo de su columna y el editor lo declara **solo cuando el
   valor es nulo**, que es cuando no hay nada de donde deducirlo.

De propina, el driver de Informix no conoce `DateOnly` ni `TimeOnly`: se traducen
en su proveedor, que es donde vive lo que es del driver y no del dominio.

**Y un tercero encontrado leyendo.** El respaldo en CSV exportaba con las opciones
por omisión, y ahí el tope es de **un millón de filas**: una tabla de tres
millones se habría respaldado con un tercio y el artefacto no lo diría en ningún
sitio. El tope se quita al respaldar, y si el exportador cortara igual, se anota
como aviso.

**Verificado.** **580 pruebas de backend** en verde con `DRUSE_REQUIRE_ENGINES=1`
y los cuatro motores: 322 unitarias, 166 contractuales y 92 de integración. Las
nuevas son seis del lector de artefactos, dos de las fechas, una contractual
—que corre en los cuatro— y una de integración que respalda en CSV y lo restaura
comprobando que la coma, las comillas y el salto de línea dentro de un campo
llegan siendo dato.

**No hecho.** Nadie ha restaurado a mano desde el asistente, y el ciclo entero por
HTTP sigue probándose solo contra PostgreSQL.

### Sesión 022i — 2026-08-17 · Fase F: la restauración, vista desde la pantalla

El backend de restaurar ya estaba (sesión anterior, commit `70dd3db`). Esta
sesión pone **la mitad que se ve**: elegir el artefacto, mirarlo sin tocar nada,
y solo entonces aplicarlo.

El orden no es decorativo. Restaurar **escribe**, así que el asistente son dos
pasos y no cuatro, y el segundo enseña antes que nada qué tablas del destino ya
existen y **cuántas filas tienen hoy**: «tres tablas» no asusta y «tres tablas
con 40.000 filas» sí, y esa es la diferencia entre avisar y avisar de verdad.
El botón de restaurar queda deshabilitado mientras la inspección diga que no se
puede, y los motivos —otro motor, formato desconocido, conexión de solo
lectura— se enseñan todos juntos y no de uno en uno.

Cuando falla a mitad, la pantalla no se limita a decir que falló: dice **en qué
instrucción**, la enseña entera, avisa de que lo aplicado hasta ahí sigue en la
base, y ofrece reanudar desde esa instrucción. Reanudar no es repetir —un
`CREATE TABLE` repetido falla y un `INSERT` repetido duplica filas—, así que se
sigue desde donde se quedó, no desde el principio.

«Restaurar…» se ofrece **solo sobre la base** y no sobre un esquema: el
artefacto trae sus propios esquemas dentro, y ofrecerlo más abajo sugeriría que
se aplica ahí, que es justo lo que no pasa.

La restauración también se ve en la barra de estado, igual que el respaldo y por
un motivo más fuerte: mientras corre **se está escribiendo en la base**, y
perderla de vista es lo que hace que alguien cierre la aplicación a mitad. Las
clases del indicador pasan de `.backup*` a `.op*` con `--backup` y `--restore`,
porque son el mismo tipo de trabajo y se leen igual; solo cambia lo que dicen.
Los dos pueden verse a la vez, que son trabajos independientes.

En el envoltorio entra `choose_restore_source`, que **pregunta si se busca un
archivo o una carpeta** en vez de adivinarlo: un diálogo de archivos no deja
elegir una carpeta y uno de carpetas no deja elegir un archivo, y equivocarse
deja al usuario sin poder seleccionar lo que tiene delante. Va **sin comprobar
con el compilador**, por lo de siempre en este equipo.

**Hecho.** `RestoreStore`, el asistente `restore-dialog`, las cuatro llamadas de
restauración en el gateway, la entrada del menú en la base, el enganche en el
shell, el indicador de la barra de estado y el comando del envoltorio.

**Verificado.** **418 pruebas en frontend**, todas en verde. Las cuatro nuevas
son las del indicador: que diga el paso y el objeto, que reabra su detalle al
pulsarlo, que respaldo y restauración se enseñen por separado cuando coinciden,
y que desaparezca al terminar.

**No hecho, y es lo que queda de la fase.**

1. **Los CSV no se restauran.** No hay una sola mención a CSV en
   `RestoreService.cs`: un respaldo escrito en carpeta con los datos en CSV se
   inspecciona pero no se aplica por el camino de importación que ya existe. Es
   el único punto del checklist de la Fase F sin escribir.
2. **La ida y vuelta con los cuatro motores.** Solo la cubre
   `RestoreEndpointTests.RespaldaUnaBaseYLaRestauraEnOtra`, contra PostgreSQL.
   El criterio de salida pide respaldar, restaurar en un servidor limpio y
   comparar las dos estructuras releídas, con los cuatro.
3. **Nadie ha restaurado a mano.** El escenario de `druse-pg-test` sigue
   sembrado y sirve tal cual; el asistente no se ha usado contra él.

**Archivos.** `frontend/src/app/core/backup/restore.store.ts`,
`frontend/src/app/features/backup/restore-dialog/*`,
`frontend/src/app/core/application-gateway/*`,
`frontend/src/app/features/connections/connections-sidebar/*`,
`frontend/src/app/layout/app-shell/*`, `frontend/src/app/layout/status-bar/*`,
`shells/desktop-tauri/src/backups.rs`, `shells/desktop-tauri/src/main.rs`.

### Sesión 022h — 2026-08-17 · Fase E: un perfil guarda una intención, no una foto

Los respaldos ya se pueden guardar y repetir. Lo que decide el diseño entero es
qué se guarda: **la selección tal y como el usuario la eligió**, no la lista de
tablas que había ese día. Un esquema con todas sus tablas marcadas se guarda como
el esquema, y entonces lo que se cree dentro después también entra; en cuanto se
desmarca una, se guardan nombres. Es la regla del §3.1 llevada a la pantalla, y
se explica sola al usarla: se guardó «Tienda a desarrollo» con el esquema entero,
se creó una tabla dentro, y al reabrirlo el asistente la trajo marcada avisando
de que era nueva.

Abrir un perfil es resolverlo contra el catálogo de hoy, y se devuelven las dos
mitades juntas: lo que existe —listo para lanzar— y lo que ya no. Negarse a abrir
un perfil porque alguien borró una tabla obligaría a rehacerlo entero; abrirlo
callando la ausencia haría creer que el respaldo se llevó algo que no está. Y se
dice también lo que ha crecido, porque un esquema al que le añaden veinte tablas
de trabajo convierte un respaldo de estructura en uno de veinte gigabytes: para
eso el perfil recuerda qué resolvía la última vez.

Guardar nombres y nunca identificadores no es un detalle: los del catálogo
cambian al recrear un objeto y los de sesión no sobreviven a cerrar la ventana.

Lanzar un perfil no lo modifica —la marca de «último uso» va por su propia ruta—
porque si ejecutar guardara el perfil entero, un respaldo lanzado desde una
pantalla con cambios a medias los daría por buenos.

En SQLite entra `backup_profiles` con la migración a `user_version` 4: la
selección y las anulaciones como JSON, y lo que se lista y se ordena en columnas.

Pruebas: **545 en backend** —la de integración mueve la base debajo del perfil
contra PostgreSQL de verdad, borrando la tabla que nombraba y creando otra dentro
del esquema elegido— y **407 en frontend**.

### Sesión 022g — 2026-08-17 · El respaldo, probado de verdad: faltaba el esquema

Se levantaron los cuatro contenedores y se hizo lo que ninguna prueba automática
había hecho: **usar la función**. Una base con el caso del §1 —tres catálogos de
4, 4 y 5 filas y cuatro tablas con 10.000 filas de «producción»—, y el respaldo
armado desde el menú del árbol.

Casi todo funcionó a la primera: las casillas de tres estados —desmarcar `public`
dejó 7 de 23 tablas—, las estimaciones del catálogo, la regla general con sus tres
excepciones señaladas, la vista previa con el DDL real, y el artefacto escrito con
sus `INSERT` solo de los catálogos y los acentos intactos. Después, uno de
**3.010.013 filas y 417 MB en 20,9 s** para ver el progreso con calma: se cerró el
asistente a mitad, la barra de estado siguió contando —«Escribiendo datos ·
pedido_lineas · 8 %»— y al volver a abrirlo el resumen seguía ahí.

**Y entonces el artefacto no se pudo aplicar.** Contra una base vacía murió en la
primera línea: «schema "tienda" does not exist». El respaldo escribía
`CREATE TABLE "tienda"."…"` sin crear nunca el esquema, así que lo único que la
función existe para hacer —llevarse la estructura a una base de desarrollo donde
todavía no hay nada— era justo lo que no se podía. Ninguna prueba lo veía porque
todas restauran sobre el esquema por omisión, que siempre está.

Arreglado con `ScriptSchema` en el contrato del guionizador. PostgreSQL escribe
`CREATE SCHEMA IF NOT EXISTS`; SQL Server lo condiciona con
`IF SCHEMA_ID(...) IS NULL EXEC(...)`, porque no admite `IF NOT EXISTS` y exige
ser la primera instrucción de su lote; MySQL e Informix no escriben nada, que
allí el esquema es la base y crear una decidiría por quien restaura adónde va
todo. Va condicionado a propósito: restaurar encima de lo de ayer es el caso más
común y un `CREATE SCHEMA` a secas lo rompería. Lo fija una prueba contractual
que aplica el guion **dos veces** contra los cuatro motores, y la de integración
comprueba además que el esquema se escribe **antes** que sus tablas en las cuatro
formas de salida.

Con eso, el ciclo cierra sin tocar nada a mano: base vacía → respaldo → aplicado
→ ocho tablas, catálogos con sus filas y producción vacía.

Pruebas del backend: **532** (295 unitarias, 158 contractuales, 79 de
integración), con `DRUSE_REQUIRE_ENGINES=1` y los cuatro motores, ninguna
omitida.

De paso, en el resumen del asistente los modos salían con el nombre del
contrato —`StructureAndData`—, lo único de esa pantalla escrito para el servidor
y no para quien lo lee.

### Sesión 022f — 2026-08-17 · La Fase D enganchada, y el diálogo que nunca estuvo en git

Tres archivos y unas pocas líneas, que eran la diferencia entre tener la función
y no tenerla. Ahora se llega al asistente desde el menú del explorador —sobre una
base, un esquema o una tabla—, el shell lo carga tarde con su `@defer` y la barra
de estado enseña paso, objeto y porcentaje mientras el respaldo corre.

**Cerrar el asistente no puede parar el respaldo, y ahora tampoco perder el
camino de vuelta.** El shell guarda por separado el nodo (`backupTarget`) y si el
diálogo se ve (`backupOpen`): cerrar apaga solo lo segundo, así que el indicador
de la barra puede devolver al detalle. El trabajo en sí nunca estuvo en el
componente —vive en `BackupStore`—, y hay una prueba que lo fija: tras cerrar, el
sondeo sigue y nadie llamó a `cancel`.

**Lo que encontró una prueba, gastando ocho gigabytes.** El doble del catálogo
que usa el resto de pruebas del shell devuelve siempre el mismo esquema, y
resolver las tablas de un nodo baja por esquemas y carpetas: la recursión no
paraba y el worker de Vitest moría por falta de memoria. El doble se arregló, y
el recorrido lleva ahora un tope de seis niveles —el árbol más hondo es
base → esquema → carpeta → tabla—, porque un catálogo que devolviera un hijo
igual a su padre colgaría la ventana igual que colgó la prueba.

**Y la regla `Backup*/` mordió por tercera vez.** La sesión anterior desexcluyó
`frontend/src/app/features/backup/` y dio el asunto por cerrado, pero el patrón
vuelve a atrapar cualquier **subcarpeta** que empiece por «backup», y la del
asistente se llama `backup-dialog`. Resultado: los tres archivos del diálogo,
escritos y compilando desde la sesión 022e, **nunca habían entrado en el
repositorio** —un clon limpio no compilaba—. Las excepciones bajan ahora con
`/**`, que es lo que hacía falta desde el principio.

Pruebas del frontend: **398**, con 35 nuevas repartidas entre el `BackupStore`
—que el porcentaje no retroceda ni pase de cien, que sin estimación caiga a barra
indeterminada, que un sondeo perdido no dé el respaldo por muerto—,
`operation-progress`, la barra de estado y el camino entero desde el menú del
árbol hasta el asistente abierto.

Lo que sigue sin verse funcionar es lo de siempre: **un respaldo de verdad contra
los contenedores**, y el Rust del selector nativo.

### Sesión 022e — 2026-08-17 · Fase D a medias: la interfaz, sin enganchar

Sesión corta, cortada por el límite de uso. Queda escrito y compilando —backend y
frontend— pero **no alcanzable desde la aplicación**, y eso es lo primero que hay
que arreglar al volver.

Lo que entró:

- **La vista previa por su propia ruta** (`/api/backup/preview`), no como una
  bandera de lanzar: ver y ejecutar son cosas distintas, igual que en la edición
  de filas. Se limita a unas pocas filas por tabla y corta al llegar al tope,
  porque una vista previa que leyera la tabla entera tardaría lo mismo que el
  respaldo y nadie va a leer diez mil instrucciones.
- **`BackupStore` en `core`, no dentro del diálogo.** El trabajo sigue en el
  proceso local aunque se cierre el asistente, así que el estado tiene que
  sobrevivir al componente que lo lanzó. Sondea cada medio segundo, que aguanta
  que la ventana se cierre y se reabra.
- **`operation-progress` en `shared/ui`** con las dos barras. Sin la del objeto en
  curso, una tabla de ocho millones de filas deja el indicador inmóvil veinte
  minutos; y sin estimación fiable la barra va indeterminada con contador
  absoluto, en vez de un porcentaje inventado.
- **El asistente de cuatro pasos**, con casillas de tres estados, el interruptor
  general, las anulaciones señaladas como excepciones y el resumen final que no se
  desvanece solo.
- **El selector nativo**, que devuelve solo la ruta: los bytes no pasan por el
  puente porque un respaldo puede ocupar gigabytes y lo escribe el proceso local.
  **El Rust no se ha compilado nunca aquí** —cargo falla por el SDK de Windows—.

Y la regla `Backup*/` del `.gitignore` heredado de Visual Studio volvió a morder,
ahora en el frontend: `core/backup/` y `features/backup/` se daban por ignoradas
en silencio. Ya están las cuatro excepciones escritas con su motivo.

### Sesión 022d — 2026-08-17 · Fase C: el artefacto, el progreso y la instantánea

Lo que convierte dos guionizadores en una herramienta: alguien que recorra la
selección en orden, escriba el resultado donde el usuario diga y **cuente lo que
está haciendo mientras lo hace**.

#### El respaldo sobrevive a la petición que lo lanzó

`POST /api/backup/run` devuelve un identificador y termina. El trabajo sigue en el
proceso local con su propio token, y el progreso se pregunta aparte con
`GET /api/backup/{id}/status`. Es lo que permite cerrar el asistente sin matar un
respaldo de media hora, y es justo lo que no se vería probando el servicio en vez
de la API.

El estado se conserva **después** de terminar. Un resumen que desapareciera al
acabar no serviría para algo que tardó veinte minutos y que quizá terminó sin
nadie mirando.

#### Cuatro formas de salida, y qué hace cada una al descartarse

Un `.sql` suelto, un árbol de carpetas, un `.zip` y los datos en CSV. El
manifiesto va donde puede: un `manifest.json` en la carpeta y en el zip, y un
bloque de comentarios en el `.sql` —cabecera al empezar, recuentos y avisos al
final, porque reescribir la cabecera obligaría a copiar un archivo de gigabytes—.

Al cancelar, el archivo suelto y el zip **se borran**: un respaldo a medias con
aspecto de completo es más peligroso que no tener ninguno. La carpeta conserva lo
escrito, que ahí sí se ve qué hay y qué falta, con el manifiesto marcado como
incompleto.

#### La instantánea: lo que enseñó probarla

Venía pendiente de la Fase B y aquí se descubrió por qué merecía su sitio.

**SQL Server acepta abrir la transacción con `SNAPSHOT` y falla en la primera
consulta:** «snapshot isolation is not allowed in this database». Como las bases
vienen así de fábrica, envolver la apertura en un `try`/`catch` no habría servido
de nada: el respaldo habría reventado al leer la primera tabla. Hay que
preguntarle antes a `sys.databases`.

Y cuando no la hay, se lee sin garantía y **el manifiesto lo dice**. No se cae a
`REPEATABLE READ` a propósito: en SQL Server eso mantiene bloqueos hasta el final
y un respaldo de media hora dejaría media base sin poder escribirse.

Tampoco se usa la transacción manual del usuario para esto, aunque encajaría: la
deshace el barrido por inactividad a los quince minutos, que es exactamente lo que
dura un respaldo grande.

#### Dos detalles que el contrato ya tenía resueltos y uno que no

La estimación de filas para la barra **ya estaba**: los cuatro lectores de
metadatos rellenan `ApproximateRowCount` desde el catálogo. Se usa tal cual y se
marca como aproximada; con condición `WHERE` se deja en nulo, que es la señal de
barra indeterminada.

El recuento de filas escritas dejó de deducirse del texto del `INSERT`: ahora cada
instrucción dice cuántas lleva. Contar comas en un SQL ya escrito es adivinar, y
de ese número sale la barra que el usuario mira durante veinte minutos.

Y uno que no: los enumerados del contrato HTTP **viajan como texto**, porque el
host no serializa enumerados de C#. Se escribieron primero como enumerados y el
respaldo devolvía un 500 genérico; el resto del contrato ya lo hacía bien.

#### Verificación

**528 pruebas en verde, ninguna saltada**, con `DRUSE_REQUIRE_ENGINES=1` y los
cuatro motores: 295 unitarias, 154 contractuales y 79 de integración.

Lo que queda fuera de la fase, y es una decisión: el **selector nativo** de
carpeta lo pone el envoltorio y no hay dónde abrirlo hasta que exista el asistente,
así que va con la interfaz en la Fase D. El backend ya recibe la ruta y escribe.

### Sesión 022c — 2026-08-17 · Fase B de los respaldos: los datos

Los `INSERT`, con lo que decide si un respaldo sirve o guarda otra cosa: **cómo se
escribe cada valor**.

#### Manda el tipo de la columna, no el del valor

Es la regla que resolvió el caso más difícil. Un booleano no siempre llega como
booleano: Informix lo entrega como `SMALLINT` porque DRDA no lo distingue de un
entero pequeño, y escribir `1` en una columna `BOOLEAN` lo rechaza el propio
motor. Lo que sabe la verdad es el catálogo, así que el literal se elige por el
tipo declarado de la columna y no por lo que devuelva el lector.

El resto de diferencias, cada una por su motivo:

- `true` en PostgreSQL, `1` en SQL Server y MySQL, `'t'` en Informix.
- **En MySQL la barra invertida también escapa dentro de un literal.** Doblar solo
  las comillas dejaría que un texto acabado en barra se comiera la comilla de
  cierre y el resto del respaldo se leyera como instrucción.
- Binarios: `'\x…'`, `0x…` y `X'…'` según el motor. En MySQL se usa `X'…'` porque
  `0x` con una tira vacía es un error de sintaxis y `X''` no. Informix **no tiene
  forma literal** para `BYTE` ni `BLOB`, y se declara.
- **Informix inserta una fila por instrucción:** `VALUES (1), (2)` es allí un
  error de sintaxis, no una forma menos eficiente de escribirlo.
- SQL Server necesita `IDENTITY_INSERT` para recibir las claves copiadas, y solo
  donde hay identidad: sobre una tabla que no la tiene, esa instrucción falla.
- Los números van sin comillas y con cultura invariante. Un `3,5` escrito con la
  coma de la máquina se restaura como 35 en otro equipo.

#### Lo que se lee, y cómo

Por streaming y con `SequentialAccess`: las filas se van escribiendo según se
leen y no se guarda ninguna. Un respaldo que materialice una tabla de diez
millones de filas no falla en las pruebas, falla en producción.

Con tope de filas se ordena por la clave primaria. Sin orden, «las primeras mil
filas» son mil filas cualesquiera y una muestra que no se puede reproducir no
sirve para comparar nada.

La condición `WHERE` se comprueba antes de pegarla al `SELECT`: sin punto y coma
—sería una segunda instrucción— y sin nada que escriba. Y excluir una columna
obligatoria sin valor por omisión se rechaza al marcarla, no tres horas después
con un `INSERT` que el motor no acepta.

#### Otro tipo mal leído en Informix

`BOOLEAN`, `BLOB`, `CLOB` y `LVARCHAR` comparten `coltype` —son tipos opacos y
solo `sysxtdtypes` los distingue—, así que Druse llamaba **CLOB a todos**. Un
booleano se anunciaba como CLOB en el explorador y al respaldarlo recibía comillas
de texto. Corregido en la lectura de columnas; los parámetros de rutinas todavía
no resuelven su nombre extendido.

#### La instantánea se mueve a la Fase C

Estaba en la lista de esta fase y no se ha hecho aquí, a propósito. El guionizado
de datos ya se une a la transacción del usuario cuando hay una abierta, que es lo
que le toca; pero una instantánea existe para que **todas** las tablas se lean en
el mismo instante —la de pedidos a las 10:00 y la de líneas a las 10:04 nacen
rotas— y eso lo abre quien recorre la selección entera. En SQL Server hay además
que comprobar que la base admita `SNAPSHOT` antes de pedirlo.

#### Verificación

**508 pruebas en verde, ninguna saltada**, con `DRUSE_REQUIRE_ENGINES=1` y los
cuatro motores: 286 unitarias, 150 contractuales y 72 de integración.

### Sesión 022b — 2026-08-17 · Fase A de los respaldos: guionizar la estructura

Escrito el plan, se empezó a construir. La Fase A entrega **el DDL que reproduce
una tabla que ya existe**, en los cuatro motores, y su criterio de salida es la
ida y vuelta.

#### El guionizador no es una clase nueva por motor

`IDatabaseScripter` es un puerto nuevo, pero lo implementa `TableDesignerBase`,
que ya resolvía el dialecto de los cuatro motores. Escribir un `CREATE TABLE`
desde un diseño y escribirlo desde el catálogo son la misma tarea con distinta
entrada; separarlo habría duplicado cuatro veces el modo de citar, la cláusula de
identidad y el cuerpo de una clave foránea, y **dos copias de un dialecto se
separan a la primera corrección que solo se aplica en una**.

Lo que sí cambió de forma: `TableDefinition` acepta ahora la clave primaria con
nombre y orden propios. El diseñador no lo necesitaba —quien dibuja una tabla
marca casillas y deja que el motor la nombre— pero quien **reproduce** una tabla
sí: en una clave compuesta `(pedido, linea)` no es la misma que `(linea, pedido)`,
y ese orden no tiene por qué coincidir con el de las columnas de la tabla.

#### Cinco fallos que ninguna prueba anterior veía

La ida y vuelta —leer, guionizar, **borrar la tabla**, recrearla desde el guion y
comparar dos lecturas del catálogo— destapó esto:

1. **Crear una tabla con restricciones fallaba en Informix.** `DescribeCreate`
   escribía `UNIQUE` y `CHECK` con el nombre delante en vez de pasar por
   `NamedConstraint`, que es el único sitio que sabe que allí va detrás. Es un
   fallo del **diseñador**, vivo desde la sesión 017, que solo se veía creando la
   tabla con restricciones de una vez: la prueba que había las añadía después,
   con un `ALTER`, y ese camino sí pasaba por el sitio correcto.
2. **MySQL devuelve sus condiciones escapadas a la manera de C.** `codigo <> ''`
   vuelve del catálogo como ``(`codigo` <> _latin1\'\')``, y MySQL **rechaza su
   propia expresión** en cuanto se escribe dentro de un `CREATE TABLE`. Además se
   veía así, con las barras, en el diseñador.
3. **Informix crea un índice interno por cada clave foránea.** Se llama ` 105_13`,
   con un espacio delante, y no estaba marcado como índice de restricción: la
   interfaz ofrecía borrar algo que no se puede borrar suelto, y el respaldo
   intentaba recrearlo con un nombre que el propio motor rechaza —«Illegal
   leading byte 0x20 in Index name»—.
4. **En Informix, los nombres de clave primaria y unicidad que Druse lee son los
   de su índice interno**, distintos en cada creación. Reproducirlos no copiaría
   nada: inventaría un nombre generado. Queda declarado en `ScripterCapabilities`
   y esas dos restricciones se guionizan sin nombre.
5. **Informix no entrega las columnas referenciadas de una clave foránea** —era
   una decisión ya tomada, para no gastar una consulta por clave—, así que
   `REFERENCES` se escribe sin la lista y el motor resuelve por la clave primaria.
   `REFERENCES padre ()` no lo acepta nadie.

Los dos primeros son correcciones de código que ya estaba en uso; los tres
últimos, límites de Informix declarados en vez de disimulados.

#### Verificación

**465 pruebas en verde, ninguna saltada**, con `DRUSE_REQUIRE_ENGINES=1` y los
cuatro motores en contenedores: 251 unitarias, 142 contractuales y 72 de
integración. La ida y vuelta corre idéntica en PostgreSQL, SQL Server, MySQL e
Informix.

Lo que la Fase A **no** hace todavía: datos, vistas, rutinas, secuencias,
disparadores y permisos. Solo la estructura de una tabla.

### Sesión 021 — 2026-08-16 · Lo que el CI encontró, y el Docker que sí estaba

Se empezó preguntando qué faltaba de la rama. La respuesta corta: catorce commits
sin subir y **el CI en rojo desde la sesión 019**, con dos de las noventa y cinco
pruebas contractuales cayendo. Las dos eran
`CreaIndicesYRestriccionesYLosVuelveALeer`, justo lo que la rama entrega.

Eso ya corrige una idea de esta bitácora: se decía que el DDL de índices «no ha
hablado nunca con un servidor real», y no era cierto. El flujo de integración
levanta los tres motores en contenedores y lo venía ejecutando; lo que faltaba
era mirar el resultado.

#### Tres fallos, no dos

El de PostgreSQL tapaba a otro que solo apareció al arreglarlo.

1. **`Column 'from_constraint' is null`.** En la consulta de índices,
   `i.indisexclusion OR con.contype IN ('p','u')` vale `NULL` cuando el
   `LEFT JOIN` con `pg_constraint` no encuentra nada, porque `false OR NULL` es
   `NULL` y no `false`. Resuelto con `COALESCE(…, false)`. **No era cosa de la
   prueba:** leer la estructura de cualquier tabla de PostgreSQL con un índice
   normal reventaba, así que el diseñador estaba roto en ese motor para el caso
   más común que existe.
2. **`Reading as 'System.String' is not supported for DataTypeName 'char'`.**
   `con.contype` es el `"char"` interno de un byte de PostgreSQL, que Npgsql no
   entrega como cadena. Va con `::text`. `confdeltype` y `confupdtype` de las
   claves foráneas tenían el mismo fallo esperando a que alguien leyera una tabla
   con una clave foránea; se arreglaron a la vez.
3. **MySQL rechazaba el CHECK.** Aquí el motor tiene razón: prohíbe cualquier
   CHECK que mencione una columna `AUTO_INCREMENT`. Lo equivocado era la prueba,
   que lo ponía sobre `id`. Ahora va sobre `nombre`, que es lo que se quería
   medir —el ciclo completo— y no una limitación de MySQL.

#### Docker estaba instalado

Lo que decía esta bitácora era falso. Docker Desktop está en el equipo y los tres
contenedores ya existían; solo hacía falta arrancar el escritorio. Con los
motores en pie, la suite completa pasa **sin saltarse nada**: 228 unitarias, 126
contractuales y 68 de integración —las 36 que antes se omitían por falta de motor
incluidas—, más 281 de frontend y 6 del envoltorio.

#### Informix, por fin contra un servidor

Se levantó su contenedor —el único que no se había arrancado nunca— y el motor
resultó estar roto de arriba abajo. **Ninguna conexión habría funcionado jamás**,
por tres capas encadenadas:

1. `DELIMIDENT` iba como `"Y"`, y el constructor de IBM convierte esa clave a
   booleano: reventaba antes de tocar la red.
2. Pasarlo como booleano tampoco vale. El paquete de IBM **se contradice**: su
   constructor escribe `DelimIdent=True` y su propia conexión rechaza ese valor
   con «Invalid argument». Comprobado contra el servidor: valen `1` y `y`;
   no valen `Y` ni `True`. Se pega a mano como `DELIMIDENT=1`.
3. `test-db.ps1` no creaba las bases. Informix no tiene
   `CREATE DATABASE IF NOT EXISTS`; no daba error visible y no creaba nada.

Con la conexión viva, 13 de 31 pruebas fallaron. Lo que enseñaron:

- **El catálogo viene relleno de espacios.** Es `CHAR(n)`, así que una base se
  llama `"druse_test"` y 118 espacios. Había `Trim()` en unos sitios y no en
  otros; ahora todo texto pasa por un único `Text()`.
- **Los enteros del catálogo no tienen el ancho que uno supone.** `GetInt32`
  sobre un `SMALLINT` no redondea: lanza «Specified cast is not valid» y tumba la
  consulta. Mismo remedio: un único `Number()`.
- **Una base sin tablas no tiene esquemas**, porque el esquema es el propietario.
  El árbol salía vacío y sin sitio donde crear la primera tabla; ahora el usuario
  conectado aparece siempre, como `public` o `dbo` en los demás.
- **`sysdefaults` no guarda el texto del `DEFAULT`**, sino una letra que dice de
  qué clase es. `CURRENT` llegaba vacío, que es justo el defecto más usado.
- **El nombre de una restricción va detrás**: `CHECK (…) CONSTRAINT "nombre"`, y
  al añadirla `CONSTRAINT` aparece dos veces. La forma estándar se rechaza con un
  escueto «A syntax error has occurred» que no dice dónde.

Y tres cosas que el motor **no puede** hacer, declaradas en el contrato en vez de
disimuladas: no emite avisos al cliente, y por DRDA un `BOOLEAN` llega como
`SMALLINT` de valor 1 —normalizarlo exigiría convertir todos los `SMALLINT`, y
una columna de cantidades pasaría a leerse como booleana—.

**Cuatro fallos eran del fixture, no del proveedor:** `ROWNUMBER` no existe, una
vista exige nombrar sus columnas, un `CREATE PROCEDURE` con `RETURNING` se
registra como función, y una fecha ISO no se interpreta sin `DBDATE`. El quinto
merece mención aparte: la consulta que hacía de espera se resolvía en 0,1 s, así
que ni la cancelación ni el timeout comprobaban nada. Un `SYSTEM 'sleep'` dura lo
pedido pero deja al motor fuera del SQL y **no atiende la cancelación**; la
espera tiene que ser trabajo SQL de verdad.

**Verificado:** las 426 del backend con `DRUSE_REQUIRE_ENGINES=1` contra
PostgreSQL 18, SQL Server 2022, MySQL 8.4 e Informix Developer, y compilación en
Release sin advertencias. Informix entra además en integración continua.

#### El arreglo destapó que Informix solo funcionaba en Windows

Al conectar de verdad, la integración continua se puso roja en Linux y macOS con
un `DllNotFoundException` sobre `db2app64.dll` que **se lleva por delante el
proceso de pruebas entero**, no una prueba suelta. La causa: `Net.IBM.Data.Db2`
es el paquete **de Windows**, e IBM publica uno por sistema operativo —`-lnx` y
`-osx`— con el mismo espacio de nombres y la misma versión.

Esto no se veía porque el fallo del `DELIMIDENT` lo tapaba: la conexión moría
antes de llegar a cargar nada nativo. Ahora la referencia se elige por el destino
de la publicación cuando lo hay, y por el sistema de la máquina cuando no, así
que un `publish -r linux-x64` desde Windows ya sale correcto —comprobado: en esa
publicación no queda ni un `db2*.dll`—.

Cabe que el paquete de macOS traiga solo binarios Intel; si es así, en Apple
Silicon habrá que declarar el motor no soportado. Lo dirá la integración continua.

#### Ejecutar procedimientos sin escribir la llamada

Lo pidió el usuario a media sesión. Un procedimiento solo ofrecía «Ver DDL»:
para llamarlo había que leer la definición, entender la firma y escribir el
`EXEC` a mano.

Hacía falta lo que nadie leía: **los parámetros**. El contrato de metadatos tenía
bases, hijos, columnas, definición y estructura de tabla, y nada de rutinas más
allá del nombre. `RoutineSignature` recorre ahora el mismo camino que hizo «Ver
DDL» —contrato, cuatro proveedores, aplicación, API local y gateway—.

Lo que enseñó cada catálogo:

- **SQL Server** marca `is_output` pero no distingue `OUT` de `INOUT`, y para un
  procedimiento de T-SQL `has_default_value` es siempre 0: el valor por omisión
  está en el texto del `CREATE`, no en el catálogo.
- **PostgreSQL** no identifica una rutina por su nombre —hay sobrecargas— así que
  la firma se resuelve por el OID que el nodo ya lleva, igual que el DDL. Y
  descarta los modificadores de tipo: un `VARCHAR(30)` vuelve como
  `character varying`.
- **MySQL** no admite valores por omisión en rutinas: hay que pasarlos todos.
- **Informix** guarda la dirección en `paramattr`, que la documentación no
  enumera entero. Comprobado contra el servidor: 1 entra, 4 sale y 3 es el valor
  de retorno. Y el retorno **no** se reconoce por posición: `paramid` empieza en
  0, que en un procedimiento sin `RETURNING` es el primer parámetro.

La llamada la escribe el escritor SQL, con la forma de cada motor en un solo
sitio. Las salidas cambian la forma entera: no basta con nombrar el parámetro,
hay que declarar una variable antes y leerla después, así que lo que sale no es
una instrucción sino un guion pequeño.

**Informix no puede recoger salidas fuera de un procedimiento** —el `INTO` solo
existe dentro de SPL—, así que allí se ejecuta sin ellas y se dice por qué.

**Verificado:** 430 en backend, con la lectura de parámetros pasando en los
cuatro motores reales, y 295 en frontend (14 nuevas: 6 del escritor y 8 del
formulario).

#### Recuperar el trabajo que no se llegó a ejecutar

Lo pidió el usuario: al cerrar, lo escrito y no ejecutado se perdía. El historial
guarda lo que llegó a lanzarse, y **lo demás no lo guardaba nadie**; el plan lo
tenía anotado desde la Fase 3 —«recordar las pestañas abiertas queda para la
Fase 5»— y nunca se hizo.

Se guarda solo, un segundo después de dejar de escribir, en el SQLite del usuario
—junto a las preferencias y el historial— y vuelve tal cual al abrir, sin
preguntar. Tres decisiones que lo sostienen:

- **Guardar en cada tecla sería una escritura por pulsación**, así que se espera
  a la pausa. Y esa espera deja una rendija —cerrar justo después de teclear—,
  que se tapa guardando también al perder el foco y al cerrar.
- **Antes de leer lo guardado no se guarda nada.** Es el fallo que más caro
  saldría: la pestaña vacía del arranque pisaría el trabajo de la sesión
  anterior antes de que a nadie le diera tiempo a verlo.
- **Todo lo que toca las pestañas pasa por un solo método.** Eran ocho sitios; el
  que se olvidara de guardar sería justo el que perdiera lo escrito.

Se guardan todas de una vez y dentro de una transacción: pestaña a pestaña, un
cierre a media escritura dejaría un conjunto que nunca existió. No se guardan los
resultados —se vuelven a pedir ejecutando— para no dejar datos de producción en
el disco sin que nadie lo pida.

**Verificado:** 435 en backend (5 nuevas del almacén, incluida una que reabre el
archivo) y 302 en frontend (7 nuevas).

#### Campos que ayudan según el tipo

Lo pidió el usuario: si un campo espera una fecha, que ayude a ponerla. Se
aplica en los cuatro sitios donde Druse pide un valor —INSERT, UPDATE,
parámetros de procedimiento, filtros del `WHERE` y edición de celdas— con un
solo componente.

La clasificación **no se reescribió en el navegador**: `ColumnValueParser` ya
traducía `timestamptz`, `datetimeoffset` o `DATETIME YEAR TO SECOND` a una
familia común para convertir lo que se escribe, así que la API la calcula y la
manda. Tenerla en dos sitios sería tenerla mal en uno de los dos, y se
separarían al añadir el siguiente motor.

Dos detalles que evitan que ayudar estorbe:

- **Se puede volver a texto libre en cualquier campo con tipo.** Un valor no
  siempre es un dato: a veces es `CURRENT_TIMESTAMP` o una función del motor, y
  un calendario no sabe escribir eso.
- **Un valor que el control no entiende se enseña como texto**, no se vacía. Un
  `date` que recibe algo que no sabe leer lo borra sin avisar, y en una celda eso
  sería perder el dato por entrar a mirarlo.

`IN` se queda en texto libre porque espera una lista separada por comas, y
`datetime-local` recibe la `T` que SQL escribe como espacio.

**Tres arreglos al probarlo en la aplicación**, que es donde se vieron:

- **El tipo se perdía por el camino.** La API lo mandaba, pero al construir las
  columnas del compositor y las de la cuadrícula no se copiaba, así que todo
  seguía pidiéndose con un campo de texto. Las pruebas no lo habrían visto: el
  componente recibía el tipo directamente.
- **La fecha con hora no dejaba elegir los segundos.** Sin `step`, el selector se
  queda en minutos.
- **El editor se quedaba «cargando» para siempre.** Los módulos de Monaco se
  pedían sin callback de error, así que uno que no cargara dejaba la promesa
  colgada: ni editor ni mensaje. Y como la promesa se cacheaba, no se recuperaba
  en toda la sesión. Ahora rechaza con el motivo, se puede reintentar sin
  recargar la aplicación, y hay un tope de espera por si el cargador ni contesta.

**Verificado:** 319 pruebas de frontend (17 nuevas).

#### Borrar filas, por las dos vías

Lo preguntó el usuario: si convenía una interfaz para los `DELETE` como la que
hay para `INSERT` y `UPDATE`. Sí, **pero no con las mismas reglas**: que sea la
operación más peligrosa es argumento para guiarla, no para dejarla fuera. Hasta
ahora la única forma de borrar era escribirlo a mano, que es justo donde se
olvida el `WHERE`.

- **En el compositor**: condición obligatoria y **recuento previo** con el mismo
  filtro. El error caro no es olvidar el `WHERE`, es escribir uno que abarca más
  de lo que uno cree, y contar es lo único que lo enseña antes.
- **En la cuadrícula**: se señalan filas con una casilla y se borran por clave
  primaria, solo donde ya se puede editar. Es la forma más segura de borrar,
  porque se ve exactamente qué se va.

En el servidor rige la misma regla que al editar —**una fila por instrucción, o
se deshace todo**— y aquí pesa más: de un borrado no queda valor anterior que
devolver. Hay dos pruebas contractuales nuevas por motor, y una comprueba
justamente que una clave que ya no existe no se lleve por delante las demás
filas del lote.

**De paso, un fallo que llevaba ahí desde el editor de filas:** el aviso de «N
filas guardadas» no se veía nunca, porque volver a ejecutar la consulta limpia el
aviso al empezar y el mensaje se ponía antes. Ahora va después de releer.

**Verificado:** 443 en backend —8 contractuales nuevas, borrado real en los
cuatro motores— y 329 en frontend.

#### Informix en Linux: dos problemas, no uno

El fallo que dejaba la integración continua en rojo —`Unable to load shared
library 'libdb2.so'`— se reprodujo aquí en un contenedor, con una sonda mínima
publicada para `linux-x64`. Y enseñó dos cosas encadenadas:

1. **La ruta.** El paquete despliega el `clidriver` en un subdirectorio, pero el
   `DllImport` pide `libdb2.so` a secas. En Windows funciona porque el cargador
   mira junto al ejecutable; en Linux solo consulta las rutas del sistema y
   `LD_LIBRARY_PATH`, así que no la encuentra.
2. **`libxml2`.** Al resolver la ruta apareció el segundo, que el primero tapaba:
   el clidriver depende de esa biblioteca del sistema, y no viaja en el paquete.

Se resuelve con un `DllImportResolver` registrado sobre el ensamblado de IBM, y
no con una variable de entorno, porque tiene que valer en los tres sitios donde
esto corre —la aplicación empaquetada, la integración continua y quien compile el
repositorio— y una variable hay que acordarse de ponerla en los tres.
`libxml2` sí hay que instalarla: queda en los requisitos del README y en el
flujo de integración.

**Comprobado de verdad**: la misma sonda, en un contenedor Linux sin
`LD_LIBRARY_PATH`, responde `CONECTA: 12.10.0000`.

#### El ciclo de instalación, de verdad

Instalar, actualizar y desinstalar sobre este equipo. Los tres pasos pasan:
instala sin pedir permisos de administrador; actualizar de 0.1.0 a 0.1.1 deja
**una sola entrada** en el registro y conserva `druse.db`; y desinstalar no deja
restos ni toca los datos del usuario, que viven en `%APPDATA%\Druse`.

**Y destapó un fallo que ninguna prueba habría encontrado.** Al matar la ventana
sin dejarla cerrarse bien, la API auxiliar seguía viva: con sus DLL cargados,
el desinstalador no podía borrar `api\` y dejaba **70 MB** con la entrada del
registro ya eliminada. Restos que nadie iba a encontrar, porque para Windows la
aplicación ya no existía.

Conviene decir cómo se llegó a la conclusión correcta, porque la primera fue
equivocada: parecía un fallo del desinstalador. La prueba de control —instalar y
desinstalar sin nada corriendo— lo descartó: limpia perfectamente. La causa era
el proceso huérfano.

Ahora **la API vigila a quien la arrancó** y se apaga cuando desaparece. Va en la
API y no con un Job Object de Windows porque Druse también compila para Linux y
macOS. Se distingue el cierre propio del padre muerto: si no, cada cierre normal
dejaría un aviso de «se cerró mal» y ese aviso dejaría de significar nada.

**Dos cosas más que dejó ver el ciclo:**

- La carpeta `logs` está siempre vacía: la API no escribe registro a archivo.
  Cuando la ventana se cerró sola en la primera prueba no había dónde mirar; se
  resolvió repitiéndola, no leyendo una traza. La deuda ya estaba anotada y este
  ciclo la confirma.
- La versión instalada y la de desarrollo **comparten `druse.db`**, porque
  `IAppPaths` no distingue. Probar la empaquetada toca los datos reales.

**Verificado:** 446 pruebas de backend, 3 nuevas del vigilante.

#### Informix se anunciaba y se rechazaba

Probando el ZIP portable contra un Informix real apareció lo que ninguna prueba
había podido ver: `/api/engines` ofrecía el motor —esa lista sale del registro de
proveedores— pero el traductor del contrato HTTP no reconocía su identificador y
respondía «Motor desconocido». **Informix era inalcanzable desde la aplicación**,
con su proveedor cargado, sus 127 archivos de driver dentro del paquete y las 138
pruebas contractuales en verde.

El agujero estaba en que las contractuales construyen el perfil **directamente en
el dominio**, sin pasar por el contrato HTTP. Solo se ve entrando por donde entra
la interfaz.

Los tres motores originales necesitan alias porque su identificador no se escribe
igual que el nombre interno; cuando coinciden —Informix, y cualquiera que venga—
ahora se reconocen solos, así que el quinto motor no repetirá esto. Y una prueba
nueva recorre `/api/engines` y exige que **todo motor anunciado se acepte al
conectar**.

**Comprobado con el portable ya arreglado**, contra el servidor de verdad: prueba
de conexión correcta (12.10.0000), sesión abierta, `SELECT` sobre `systables`
devolviendo tres filas en 50 ms, y sesión cerrada.

#### Fase 7: los paquetes de Linux y macOS

Lo que faltaba de la fase, salvo lo que exige otro equipo. Un job por plataforma
publica la API dentro del envoltorio, compila el frontend y empaqueta con Tauri,
y los artefactos quedan descargables de cada ejecución durante catorce días.

Dos cosas que no eran evidentes:

- **Los formatos se piden por línea de comandos.** `tauri.conf.json` fija NSIS y
  MSI, que fuera de Windows no existen, así que hay que pasar `--bundles` con los
  de cada plataforma. `package.ps1` tenía el mismo agujero: aceptaba
  `-Runtime linux-x64` y habría intentado construir un instalador de Windows.
- **El CLI de Tauri no viene con el runner** y compilarlo cuesta varios minutos,
  así que su binario se guarda en caché entre ejecuciones.

Salen sin firmar ni notarizar, que es otra tarea del backlog: sirven para probar
la aplicación, no para repartirla.

### Sesión 020 — 2026-08-14 · Transacciones manuales, y los 44 archivos ordenados

Dos trabajos: repartir lo que estaba sin commitear y terminar lo único que
quedaba a mitad.

#### Los 44 archivos, en cuatro commits temáticos

Se decidió no repartirlos en ramas. Sacar cada trabajo a la suya exigía separar
archivos que se tocan entre sí —`workspace-store.ts`, las clases base de los
proveedores— y volver a apilar PRs, que es exactamente lo que costó cuatro rondas
de conflictos y un PR fusionado contra su base en la sesión 018. Cuatro commits
sobre la rama que ya tiene el PR #8 conservan la misma separación en el historial
sin ese riesgo:

1. **La exportación en la aplicación empaquetada.**
2. **La transacción sostenida en la sesión**, que era el cimiento a medias.
3. **Informix como cuarto motor.**
4. **Dos variantes del paquete y la autoría**, incluido el `api/**/*` del glob.

Cada uno compila por su cuenta. Dos archivos llevan cambios de dos trabajos
—`RowEditorBase` y `TableDesignerBase`, donde los ganchos de Informix conviven
con `OperationScope`—; van en el commit de transacciones y su mensaje lo dice, en
lugar de partir hunks a mano y arriesgarse a dejar un commit que no compila.

#### Transacciones manuales terminadas

**Hecho:** `TransactionService` con las reglas, los endpoints, los tres botones
conectados, el indicador y los avisos.

- **El temporizador vive en el proceso, no en el navegador.** `IdleTransactionSweeper`
  mira cada minuto y deshace lo que lleve quince sin actividad. Tenía que ser así:
  la ventana puede estar cerrada o dormida justo cuando hay que soltar los
  bloqueos. Se mide la **inactividad**, no la duración: quien lleva media hora
  trabajando dentro de una transacción no ha olvidado nada.
- **Se anota la actividad en la capa de aplicación**, no en los proveedores:
  consultas, edición de filas, DDL y exportación tocan la transacción de la sesión
  *elegida*, que no es la de origen cuando se ejecuta contra otra base —esa va por
  otra conexión y no está dentro de la transacción—.
- **Un aviso que sobrevive a la transacción.** Cuando se deshace sola, el usuario
  no está delante; el servicio guarda ese hecho aparte y la interfaz lo cuenta al
  volver, porque preguntárselo a una transacción que ya no existe no devolvería
  nada. Por eso el servicio es singleton y no vive lo que dura una petición.
- **Los lectores de catálogo y de exportación también entran en la transacción.**
  No es simetría: SQL Server se niega a ejecutar sobre una conexión con
  transacción pendiente si el comando no la lleva asignada, así que sin esto
  **expandir un nodo del árbol fallaría solo por haber pulsado «Iniciar
  transacción»**. Es el fallo más difícil de relacionar con su causa de todo esto.
- **El aviso al cerrar la ventana lo da el envoltorio**, con un diálogo nativo y
  un estado que la interfaz mantiene al día. `beforeunload` no vale dentro del
  WebView —quien cierra es el sistema, no el navegador— y queda solo para el
  navegador. El diálogo se muestra con respuesta diferida: bloquear ahí colgaría
  la ventana que se intenta cerrar.
- Cerrar una conexión con cambios sin confirmar también pregunta, igual que cerrar
  una pestaña sin guardar y por el mismo motivo.
- En solo lectura no se abre ninguna: no habría nada que confirmar y la
  transacción retendría recursos del servidor a cambio de nada.
- El indicador dice **a qué conexión afecta**, y en MySQL avisa de que el DDL
  queda hecho aunque se pulse Rollback.

**Verificado:** 222 pruebas unitarias en backend (10 nuevas), 126 contractuales,
32 de integración (7 nuevas: 5 de las rutas y 2 del punto de conexión), 245 en
frontend (13 nuevas) y 6 en el envoltorio (2 nuevas),
más compilación de producción sin avisos nuevos. Las del backend corren contra
una base SQLite **real** en memoria, no contra dobles: lo que había que demostrar
es que lo escrito dentro desaparece al deshacer, y eso un doble no lo puede
enseñar.

**Sin ejecutar contra un motor real**, como el resto: ver el punto 3.b de «Qué
toca retomar», que enumera las tres cosas que solo se ven ahí.

#### Firma de código: hasta dónde se llega sin certificado

Se intentó firmar los artefactos. Resultado, para no repetir el camino:

- **No hay certificado de firma de código en el equipo**, ni `DRUSE_SIGN_THUMBPRINT`
  ni `DRUSE_SIGN_COMMAND` configurados. `signtool` sí está, en el SDK 10.0.26100.
- Se creó uno **autofirmado** (`CN=Darío Ramos`, RSA 3072, hasta 2029) y firma
  correctamente **con sello de tiempo**. Pero Windows no da la firma por válida:
  «la cadena termina en un certificado de raíz no compatible con el proveedor de
  confianza».
- Por eso `Test-DruseSignature` aborta el empaquetado, y hace bien: es justo la
  comprobación que evita repartir un paquete cuya firma el usuario final rechaza.
- Para que valide hay que meter el certificado en las raíces de confianza del
  equipo. **Eso no lo hace el asistente**: es un cambio en la configuración de
  seguridad y lo decide quien usa la máquina.

**Y aunque se haga, no resuelve el problema de fondo:** en otro equipo el aviso
sale igual, porque allí nadie confía en ese certificado. Un autofirmado sirve
para validar que el flujo de firma funciona y para repartir en equipos que uno
administra; para que SmartScreen desaparezca en cualquier PC hace falta un
certificado de una CA pública con la clave en token o HSM.

**Un detalle del portable que conviene recordar:** lo que dispara SmartScreen es
la marca de la web del archivo descargado. Un ZIP que llega por USB o por carpeta
de red normalmente no la lleva, y entonces el ejecutable arranca sin aviso aunque
vaya sin firmar.

**Una trampa al comprobarlo:** la primera prueba se hizo firmando una copia de
`where.exe`, que ya venía firmado por Microsoft, y `Get-AuthenticodeSignature`
devolvió «Valid» hablando de la firma de Microsoft. Para comprobar una firma
propia hay que partir de un binario **sin firmar**.

#### Se puede mirar la contraseña que se escribe

Lo pidió el usuario después de pelearse con una contraseña en otro equipo, y es
exactamente el caso donde hace falta: una contraseña larga escrita a mano solo se
comprobaba fallando al conectar, y ahí no se distingue una letra de más de una
credencial equivocada.

- El botón va **dentro** del recuadro, para que el campo siga midiendo lo mismo
  que los demás de la rejilla: uno más estrecho llamaría la atención justo sobre
  el dato que no conviene señalar.
- Vale también para el secreto del túnel SSH, que tenía el mismo problema.
- Empieza oculta y vuelve a ocultarse al cargar otro perfil: el diálogo puede
  quedarse abierto delante de alguien, y lo que se enseña a propósito no debería
  quedarse enseñado por descuido.
- Iconos nuevos `eye` y `eye-off`. El tipo `IconName` es una unión cerrada y
  cumplió su cometido: falló al compilar por usar un icono antes de declararlo.

#### Portable regenerado, y un fallo del empaquetado

Se generó el portable ligero con todo lo de esta sesión:
`Druse-0.1.0-win-x64-portable-sin-informix.zip`, 65,3 MB comprimido y 142 MB
dentro. Comprobado abriéndolo: lleva `druse.exe`, la API con Npgsql y
MySqlConnector, y **no** el `clidriver` de IBM, que es lo que debía quedar fuera.

**El fallo:** el script renombraba todos los artefactos del directorio de
bundles, incluidos los de ejecuciones anteriores, que ya llevaban su sufijo. El
resultado eran nombres como `...-sin-informix-sin-informix.exe` y, peor, dos
archivos parecidos sin forma de saber cuál era el nuevo. Ahora se anota la hora
antes de construir y solo se renombra lo que salió de esa construcción.

Es la tercera vuelta sobre el mismo punto —primero el sufijo que faltaba, luego
el que había que poner a las dos variantes, ahora el que se aplicaba dos veces—,
y las tres han salido de mirar la lista de artefactos al terminar en lugar de
fiarse de que el script hizo lo que decía.

#### «no pg_hba.conf entry», dicho con palabras

Salió al probar Druse desde otro equipo: PostgreSQL rechazaba la conexión con su
mensaje en inglés y en sus propios términos —habla de `pg_hba.conf`, que es un
archivo del servidor—, y quien lo lee no sabe qué hacer con eso.

Ahora el proveedor explica los cuatro fallos que impiden entrar, conservando el
texto del servidor al final entre paréntesis, que es lo que hay que enseñarle a
quien administra la base:

- **`28000` con «no encryption»:** la conexión llegó en claro y el servidor no
  admite conexiones sin cifrar desde esa dirección. Se dice que pruebe el cifrado
  en «Requerir», que es lo que lo arregla desde la propia aplicación. La pista
  está en esa palabra: con «Preferir», el driver intenta TLS y **vuelve a
  intentarlo en claro** si la negociación no sale, y es ese segundo intento el
  que el servidor rechaza.
- **`28000` con cifrado:** entonces no hay nada que el cliente pueda hacer; la
  dirección, el usuario o la base no están autorizados y la regla hay que
  añadirla en el servidor.
- **`28P01`:** la contraseña no es correcta.
- **`3D000`:** esa base no existe. Y **`57P03`:** el servidor aún no acepta
  conexiones.

**Los errores de SQL se dejan como están.** PostgreSQL dice qué columna, qué tipo
y qué restricción; reescribirlos sería perder información. Lo que no explica bien
es por qué no te deja entrar.

Los dos caminos de conexión —«Probar» y abrir sesión— ya pasaban por el
normalizador, así que el mensaje llega a los dos sitios. El normalizador es
interno y se prueba con `InternalsVisibleTo`, como ya se hacía con
`Druse.Platform.Native`.

#### Pulido de lo anterior

Repaso de lo hecho en la sesión, con cuatro arreglos:

- **La base elegida mentía en dos sitios.** Al cambiar de base en la barra, la
  pestaña y la barra de estado seguían enseñando la de la conexión. Lo introdujo
  el selector unas horas antes: la pestaña leía `connection.database` y la barra
  `session.database`, y ninguna de las dos es ya la que se ejecuta.
- **Cambiar de base con una transacción abierta avisa.** Esa consulta va por otra
  conexión y se confirma sola; creer lo contrario cuesta un Rollback que no
  deshace lo que se esperaba.
- **Los desplegables de la barra se cierran al pulsar fuera**, y abrir uno cierra
  los otros. Antes se quedaban abiertos tapando el editor hasta volver a su
  botón. Se escucha `pointerdown` y no `click` para cerrar al empezar la
  pulsación.
- **La caída de sesión se detecta en todo lo que habla con una sesión**:
  exportar, columnas, estructura y diseñador, además de lo que ya estaba. En la
  exportación hubo que leer el cuerpo del error antes de reconocerla, porque
  viaja como blob y `error.message` no existe hasta abrirlo.
- **El barrido de transacciones ya no se queda esperando.** Recorría las sesiones
  pidiendo cada turno sin límite, así que una consulta larga bloqueaba el barrido
  de las demás y otras transacciones olvidadas seguían reteniendo filas. Ahora
  espera cinco segundos por sesión y sigue; la que se salte se atiende en el
  barrido siguiente.

**Queda observado y sin arreglar:** el botón «Reconectar» del aviso aparece
mientras haya una conexión caída, aunque el aviso que se esté leyendo sea otro.
Arreglarlo bien exige que cada aviso sepa a qué conexión pertenece, que es un
cambio mayor que la molestia.

#### Reconectar, y cambiar de base sin abrir otro script

Dos peticiones del usuario que se resolvieron juntas porque tocan lo mismo: qué
significa «la conexión» dentro de una pestaña.

**La sesión perdida se detecta y tiene salida.** Cuando una petición falla con
«la sesión no está abierta» —el servidor cerró por inactividad, se cayó la red, o
la API se reinició—, la conexión se marca como caída: se retira su catálogo y su
transacción, que eran de una sesión que ya no existe, y el aviso trae un botón
«Reconectar». En la barra lateral, el mismo botón se resalta. Antes eso salía
como un error suelto que no decía qué hacer.

- **Reconectar conserva las pestañas y su SQL.** Lo que se pierde es lo que ya
  estaba perdido: el resultado en pantalla y cualquier transacción sin confirmar.
- **Solo se puede con perfiles guardados**, que son los únicos con credenciales
  que reabrir; si no hay contraseña guardada se abre el diálogo del perfil, y si
  la conexión no está guardada se dice claramente en lugar de fallar en silencio.
- **La detección vive en los sitios donde el usuario lo nota** —ejecutar,
  explorar, guardar, transacciones— y no en un interceptor: hace falta saber de
  qué conexión era la sesión, y eso solo lo sabe quien hizo la petición.

**La base se elige en la barra, no abriendo otro script.** El chip de contexto
—que hasta ahora solo informaba— es un desplegable con las bases de la conexión.
Cambiarla afecta a la pestaña activa: la misma consulta pasa a ejecutarse contra
otra base de la misma conexión.

- El backend ya sabía hacerlo: `UseDatabaseAsync` abre una sesión auxiliar
  conservando servidor, usuario y permisos, y `QueryTab.database` ya viajaba en
  cada ejecución. Lo que faltaba era poder elegirla.
- Al cambiar se retira el resultado en pantalla y la procedencia editable: eran
  de la base anterior, y dejarlos mientras la barra dice otra cosa es la clase de
  detalle que lleva a leer mal unas filas.
- El autocompletado de la base nueva se precalienta por detrás, como al conectar.
- **Ojo con las transacciones:** una consulta contra otra base va por otra
  conexión, así que **no entra en la transacción abierta**. Es cómo funciona una
  transacción, no una limitación de Druse, pero conviene tenerlo presente.

#### El formateo del editor se puede configurar

Estaba fijo en el código: mayúsculas, 80 caracteres, dos espacios y estilo
estándar. Ahora se elige desde un menú detrás de la flecha del botón «Formatear»,
y se recuerda entre arranques en las preferencias.

- **Cuatro ajustes y no los veinte de `sql-formatter`**: reparto de líneas
  (estándar o tabular), ancho de expresión, palabras clave y sangría. Cada opción
  suelta de más es una decisión que alguien tiene que tomar sin saber qué hace.
- **Formatear y configurar el formateo son dos botones.** Quien pulsa
  «Formatear» quiere formatear ya; esconder esa acción tras un menú encarecería
  lo frecuente por lo que se toca una vez.
- **El menú no se cierra al elegir**, al revés que el de tiempo máximo: el ancho
  y la sangría se ajustan juntos, y cerrarlo obligaría a abrirlo cuatro veces.
- **Los ajustes viven en `core`, no junto al formateador**, porque el store tiene
  que leerlos y guardarlos y el estado no puede depender de la interfaz (plan §5).
  Lo que sí depende es el formateador, que los traduce a su dialecto.
- Tipos y funciones siguen a las palabras clave: con «como estén», quien pidió
  que no se toque nada no esperaría que sus funciones cambiaran igualmente.
- Lo que no se reconozca al leer las preferencias cae en el valor por omisión.
  Viven en una base local que sobrevive a las versiones.

**Una cosa que la prueba corrigió sobre la marcha:** el ancho **no** reparte las
cláusulas —`FROM` siempre empieza línea—, sino las expresiones: los argumentos de
una función, una lista. La etiqueta dice «Ancho de expresión» por eso, después de
comprobar contra la librería qué hacía de verdad.

#### «Falta el token de la API local» con la API viva

Salió al levantar el entorno para verlo en el navegador, y no tenía nada que ver
con las transacciones: **al cerrarse, la API borraba `endpoint.json` sin
comprobar que siguiera siendo suyo**. Reiniciarla es arrancar una instancia y
cerrar la anterior, así que las dos conviven un instante; la que se iba se
llevaba por delante el punto de conexión que la nueva acababa de publicar. Desde
la pantalla se ve como «Falta el token de la API local o no es válido» con una
API perfectamente sana escuchando.

El archivo ya guardaba el `pid`, así que la comprobación era de tres líneas. Ante
un archivo ilegible o sin `pid` se borra igual, que es lo que hacía antes.

Dos cosas que conviene recordar de esto: el proxy del servidor de desarrollo lee
el archivo **en cada petición** —así que no hace falta reiniciar `ng serve` al
reiniciar la API—, y el aviso de la bitácora sobre compilar con la API en marcha
volvió a cumplirse puntualmente.

### Sesión 019 — 2026-08-14 · Índices y claves, cuarto motor, empaquetado y transacciones

Sesión larga y con cuatro trabajos distintos, en este orden: el diseñador de
tablas completo, el empaquetado (firma, autoría y variantes), Informix como
cuarto motor, y las transacciones manuales, que **quedaron a mitad** — ver el
apartado de arriba, que es por donde hay que empezar.

#### Diseñador de tablas: índices, claves foráneas y restricciones

**Hecho:** el diseñador de tablas deja de ser solo columnas. Ver, agregar,
modificar y quitar **índices, claves foráneas, restricciones de unicidad,
condiciones (CHECK) y la clave primaria de una tabla que ya la tiene.**

- **Leer no existía.** `IDatabaseMetadataReader` sabía de bases, hijos, columnas
  y definiciones de vistas; ningún proveedor consultaba índices ni claves. Se
  añadió `GetTableStructureAsync` con los catálogos de cada motor: `pg_index` y
  `pg_constraint` en PostgreSQL, `sys.indexes` y `sys.foreign_keys` en SQL
  Server, `information_schema` en MySQL.
- **Modificar un índice es borrarlo y volver a crearlo**, porque ningún motor
  sabe cambiarle las columnas a uno que ya existe. Se enseñan las dos
  instrucciones en el SQL previo, en ese orden.
- **Las opciones propias de cada motor se ofrecen sin ramificar por motor en la
  interfaz.** Cada proveedor declara sus `IndexCapabilities` —columnas incluidas,
  índices parciales, estructuras disponibles— y el formulario se dibuja a partir
  de esa declaración. Ningún componente Angular pregunta contra qué está
  conectado, que es lo que el plan §14 prohíbe. Lo que un motor no admite se
  **rechaza** en el validador en lugar de ignorarse al escribir el SQL: un índice
  que se crea callando una opción que se pidió es peor que uno que no se crea.
- **El orden del `ALTER` no es el de la pantalla.** Primero se sueltan claves
  foráneas e índices, luego la clave primaria, después se añaden y cambian
  columnas, y solo entonces se pone la clave nueva y se recrea lo demás. Cambiar
  la clave primaria con una foránea encima falla si se hace al revés.
- **Quitar un índice también se confirma aparte.** No borra datos, pero
  reconstruirlo sobre una tabla grande puede tardar y bloquearla. El aviso
  distingue lo que se lleva datos de lo que no, para no enseñar a confirmar sin
  leer.
- Un índice que sostiene una clave primaria o una restricción se enseña pero no
  se puede borrar suelto: los tres motores lo rechazan.

**Verificado:** 207 pruebas unitarias en backend (18 nuevas del DDL y del
validador), 25 de integración, 229 en frontend (5 nuevas del diseñador) y
compilación de producción sin avisos nuevos. Las pruebas fijan el texto generado
por los tres dialectos, incluido que el nombre de un índice no permita escapar.

**Sin ejecutar todavía, y es importante:** la prueba contractual nueva
—`CreaIndicesYRestriccionesYLosVuelveALeer`, que crea un índice y lo relee del
catálogo— **no se ha ejecutado contra ningún motor**, porque este equipo no tiene
Docker. Cuenta como superada porque el contrato se omite cuando el motor no
responde. Es la comprobación que de verdad valida esta entrega, y necesita
`DRUSE_REQUIRE_ENGINES=1` con los tres contenedores en marcha.

#### Empaquetado: firma, autoría y dos variantes

- **Preparado para firmar sin certificado todavía.** `signing.ps1` localiza
  `signtool`, firma con sellado de tiempo y **comprueba el resultado**: signtool
  puede terminar bien y dejar una firma que Windows no acepta. Se firma también
  `Druse.Host.LocalApi.exe`, que Tauri no toca — un instalador firmado que suelta
  un binario sin firmar es lo que hace saltar a los antivirus corporativos. La
  huella no se versiona: es de la máquina que compila, así que el script genera
  la configuración al vuelo y la borra en el `finally`.
- **El producto pasa a estar a nombre de Darío Ramos**, no de una empresa, en el
  envoltorio y en la API. Conviene no confundir las dos autorías: los metadatos
  del archivo los escribe cualquiera, mientras que el «Editor» que Windows enseña
  sale del certificado y no se configura en ningún archivo.
- **Dos variantes del paquete.** `-p:IncludeInformix=false` deja fuera el
  proveedor y su driver de 111 MB; el proyecto se sigue compilando y probando
  siempre, porque un motor que no se prueba acaba roto sin que nadie se entere.
  Ambas llevan sufijo en el nombre (`-completo` y `-sin-informix`).

**Un fallo silencioso encontrado por los tamaños, y merece recordarse:** el
instalador declaraba sus recursos como `api/*`, con un solo asterisco, que **no
baja a subdirectorios**. Los 81 MB del `clidriver` de IBM viven en una carpeta,
así que el ZIP portable los llevaba —el script copia con `-Recurse`— y el
instalador no. Quien instalara con el `.exe` habría visto Informix en la lista y
fallado al conectar, sin ninguna pista. La señal fue que la API creció 83 MB y el
instalador solo 0,4. **Es la segunda vez que ese glob da problemas**, después de
la incidencia 4 de la sesión 010.

Y un error propio que costó un empaquetado: al poner sufijo solo a la variante
ligera, encadenar las dos ejecuciones hizo que la segunda sobrescribiera el
instalador de la primera antes de renombrarlo, y el completo desapareció. Ahora
ambas lo llevan.

#### Cuarto motor: IBM Informix

Informix entra con las mismas funciones que los otros tres: explorador,
autocompletado con su catálogo, plantillas, formateo, compositor, edición de
filas y diseñador de tablas con índices y restricciones.

**La decisión que condiciona todo lo demás: se llega por DRDA.** No existe un
proveedor ADO.NET moderno de Informix —el `IBM.Data.Informix` clásico se quedó
en .NET Framework—, así que se usa `Net.IBM.Data.Db2` hablando DRDA. Comprobado
que restaura y compila en .NET 10. Dos consecuencias que hay que tener presentes:

- **El paquete pesa 111 MB**, así que el instalador pasa de ~46 MB a ~160 MB. Es
  con diferencia la dependencia más cara de la solución.
- **El servidor necesita DRDA habilitado**: un escuchador con `drsoctcp` en
  `sqlhosts` y una base con registro de transacciones. Contra un Informix sin esa
  configuración la conexión falla por cómo está montado el servidor, no por la
  cadena de conexión. El normalizador de errores lo dice explícitamente en el
  −951, porque si no el usuario buscaría el fallo en su contraseña.
- La licencia del driver es de IBM, no libre. Redistribuirlo dentro del
  instalador lo permite la sección de redistribuibles del IPLA, cuyos términos
  hay que cumplir.

**Lo que Informix hace distinto y obligó a tocar las clases base:**

- **La identidad es el tipo, no una cláusula.** Una columna autoincremental se
  declara `SERIAL`, no `INTEGER` seguido de algo. `TableDesignerBase` solo sabía
  añadir palabras detrás del tipo, así que se añadió el gancho `DataTypeOf`, que
  por omisión devuelve el tipo sin tocar. El ancho se conserva: un `BIGINT`
  autoincremental es `BIGSERIAL`, porque degradarlo a 32 bits agotaría los
  identificadores de una tabla grande sin que nadie lo pidiera.
- **Los parámetros son posicionales.** En el SQL todos son `?` y el enlace es por
  orden. `RowEditorBase` usaba el mismo método para el marcador y para el nombre
  del parámetro; se separaron con `ParameterName`, que por omisión sigue
  devolviendo lo mismo.
- **`SELECT FIRST n` va delante**, como el `TOP` de SQL Server y no como el
  `LIMIT` del final. La regla vive ahora en una sola función del escritor de SQL,
  para que un motor que lo ponga delante no arrastre además un `LIMIT` al final.
- **El esquema es el propietario de la tabla**, no un objeto que se cree aparte.
- **El tipo de una columna viene codificado en un número**, no escrito: hay una
  clase entera dedicada a descodificar `coltype` y `collength`.
- Sin `FULL OUTER JOIN`, igual que MySQL: el compositor no lo ofrece, porque
  generaría SQL que el servidor rechaza.
- Sin `DEFAULT VALUES`: para una tabla cuyas columnas rellena todas el motor, se
  nombra la serial y se le da un cero, que es su forma idiomática.

**Verificado:** 212 pruebas unitarias (5 nuevas del dialecto de Informix), 126
contractuales, 25 de integración, 232 en frontend, y compilación de producción
sin avisos nuevos. La prueba de arquitectura hizo su trabajo: falló al no
encontrar declarada la regla de referencias del proyecto nuevo.

**Sin ejecutar contra un servidor real.** No hay ningún Informix a mano, así que
todo el catálogo —`systables`, `syscolumns`, `sysindexes`, `sysconstraints`, la
descodificación de tipos— está escrito a ciegas contra la documentación. El
contenedor está preparado en `test-db.ps1` con la imagen de desarrollo de IBM,
publicando el 9089 y creando las bases `WITH LOG` que DRDA exige.

#### Exportar no guardaba nada en la aplicación empaquetada

Lo encontró el usuario probando el portable: **exportar decía «Exportado a
XLSX» y no aparecía ningún archivo.** Fallaba igual en CSV.

La exportación descargaba como en el navegador —crear un `blob:` y pulsar un
enlace `download`—, y eso **dentro de Tauri no hace nada**: la CSP solo admite
`blob:` para imágenes y workers, y el WebView no trae gestor de descargas. Lo
peor es que **tampoco falla**: `link.click()` no lanza ninguna excepción, así
que el código seguía hasta el aviso de éxito.

Es el tercer fallo de la misma familia, después de la hoja de estilos que se
quedaba en `media="print"` y de la API que no se encontraba: **cosas que
funcionan en el navegador y solo se rompen empaquetadas**. La regla que dejan
las tres: cualquier función que toque el navegador —CSP, descargas, origen— hay
que probarla en el ejecutable, porque el servidor de desarrollo no tiene CSP y
no puede enseñar el fallo.

Arreglado con el mismo patrón que los archivos `.sql` de la sesión 013: un
comando del envoltorio abre el diálogo del sistema y escribe el archivo. El
contenido viaja en bytes y no como texto, porque un XLSX es binario. La
bifurcación vive en un servicio nuevo, `FileSaveService`, para que el store no
tenga que saber dónde está corriendo.

Y **el aviso de éxito ahora depende de que se haya guardado**: si el usuario
cierra el diálogo, dice «Exportación cancelada» en lugar de mentir.

**Verificado:** 232 pruebas de frontend (3 nuevas del servicio) y 4 en el
envoltorio (2 nuevas). Falta la comprobación que de verdad cuenta: **exportar
desde la aplicación empaquetada contra una base real**, que es donde apareció.

### Sesión 018 — 2026-08-14 · Mensajes de error y cierre de la integración

**Hecho:**
- Los fallos se cuentan con palabras en lugar de con códigos. «La API respondió
  con el código 502» era lo que aparecía al cerrarse el proceso local —el fallo
  más frecuente y el peor explicado— y ahora dice qué pasó y qué hacer. El número
  se conserva al final entre paréntesis: no le sirve al usuario, pero es lo
  primero que hace falta para diagnosticar.
- Cuando el servidor sí explica el motivo, gana su mensaje: ya está escrito para
  leerse. Los errores de validación siguen contándose campo por campo.
- «Por omisión» pasa a llamarse «Por defecto» en el diseñador de tablas. Lo pidió
  el usuario al no entender el término, que es exactamente la señal de que una
  etiqueta está mal puesta.
- Fusionadas a `main` las cuatro ramas de la sesión anterior.

**Una integración que no salió lisa, y conviene saberlo:**
- **El PR #3 se fusionó contra su rama base en lugar de contra `main`.** Estaba
  apilado sobre el del túnel SSH y, al fusionar los dos seguidos, GitHub lo mandó
  a su base: quedó marcado como fusionado y su contenido no estaba en ninguna
  parte. Se detectó al echar en falta la sesión 016 en este archivo. Se reabrió
  como #6 contra `main`. **Un PR apilado marcado como MERGED no garantiza que su
  código esté en `main`; hay que comprobarlo.**
- Cuatro rondas de conflictos, siempre en `workspace-store.ts`, el gateway y esta
  bitácora. Se resolvieron combinando ambos lados, nunca descartando uno: en
  `describeError`, `main` traía mensajes de validación que no estaban en la rama,
  y se conservaron junto a las explicaciones nuevas.

**Verificado:** 189 pruebas unitarias y 25 de integración en backend, 224 en
frontend, todas sobre `main` ya fusionado. Comprobado en la aplicación
reproduciendo el fallo original: se cerró el proceso local con la ventana abierta
y salió el aviso nuevo.

### Sesión 017 — 2026-08-13 · Diseñador de tablas

**Hecho:**
- Crear y modificar tablas desde el explorador: «Crear tabla» sobre un esquema y
  «Modificar tabla» sobre una tabla, con una cuadrícula de columnas —nombre,
  tipo, nulos, clave primaria, autoincremento y valor por defecto—.
- Nada se ejecuta sin enseñar antes el SQL exacto, igual que la edición de filas:
  el botón de aplicar está deshabilitado hasta pulsar «Ver SQL». Borrar columnas
  exige además una confirmación aparte, porque se lleva sus datos.
- `TableDesignerBase` reúne lo que el DDL tiene en común y cada proveedor aporta
  su dialecto: corchetes e `IDENTITY` en SQL Server, comillas dobles y
  `GENERATED BY DEFAULT AS IDENTITY` en PostgreSQL, acentos graves y
  `AUTO_INCREMENT` en MySQL, donde además el esquema *es* la base.
- El SQL lo escribe siempre el proveedor a partir del diseño; el cliente nunca
  manda instrucciones. Aceptarlas convertiría este camino en una vía para
  ejecutar cualquier cosa saltándose el análisis de riesgo.
- MySQL declara que su DDL no es transaccional en lugar de envolverlo en una
  transacción que no serviría: hace un commit implícito antes de cada `ALTER`.
- El diseñador manda solo las columnas que de verdad cambiaron, comparando con
  una foto del estado inicial. Mandarlas todas reescribiría en MySQL columnas que
  nadie pidió tocar.

**Verificado:** 162 pruebas unitarias y 25 de integración en backend, 207 en
frontend, build de producción sin avisos nuevos. Las 11 pruebas del DDL
comprueban el texto generado por los tres motores, incluido que un nombre con el
carácter de cierre del identificador no permita escapar.

**Sin probar todavía:** no se ha ejecutado DDL real contra ningún motor. Las
únicas bases a mano son de la empresa (Azure SQL y RDS) y crear tablas ahí
necesita permiso. Falta esa comprobación antes de dar la función por cerrada.

**Fuera de esta entrega:** índices, claves foráneas y cambiar la clave primaria
de una tabla que ya la tiene.
### Sesión 016 — 2026-08-13 · Editar conexiones guardadas

**Hecho:**
- Una conexión guardada se puede editar: el mismo formulario se abre con sus
  datos —incluidos cifrado y túnel— desde un botón nuevo en la barra lateral, y
  guarda con `PUT /api/connections/{id}` sin abrir sesión. Hasta ahora, cambiar
  el puerto de un perfil obligaba a borrarlo y volver a crearlo.
- `null` y cadena vacía dejan de significar lo mismo en las contraseñas. El
  formulario no puede mostrar un secreto guardado, así que llega vacío aunque
  exista: ausente significa «no lo toques» y solo la cadena vacía lo retira. Sin
  esa distinción, cambiar el nombre de una conexión le borraba la contraseña.
- El store conserva los perfiles completos que devuelve la API; el resumen que
  pinta la barra lateral no basta para volver a llenar el formulario.

**Verificado:** 178 pruebas unitarias y 25 de integración en backend, 216 en
frontend. Comprobado además contra la API real con un perfil de prueba: editar
sin escribir la contraseña la conserva, vaciarla la retira, y el perfil se borra
al terminar.

**Aviso para quien lea esto:** las primeras pruebas contra la API dieron un falso
negativo porque `dotnet run` no pudo reemplazar los binarios —los tenía
bloqueados un proceso anterior— y respondía la versión vieja. Si algo no cuadra
al probar a mano, comprobar antes que no haya un `Druse.Host.LocalApi` viejo vivo.

### Sesión 015 — 2026-08-13 · Túnel SSH y selector de cifrado

**Hecho:**
- Cualquier conexión puede pasar por un servidor SSH intermedio. El proyecto
  nuevo `Druse.Ssh` encapsula SSH.NET igual que un proveedor encapsula su driver;
  `Druse.Application` solo ve `ISshTunnelFactory` y una dirección local.
- Al abrir la sesión se reenvía un puerto local hacia el servidor real y el
  driver recibe ese extremo. El túnel se registra junto a la sesión y se cierra
  con ella, o con el proceso.
- Tres métodos de acceso al servidor intermedio: contraseña, clave privada con
  passphrase y teclado interactivo para segundo factor. **Agente SSH no**: la
  librería no lo soporta y ofrecerlo sería prometer algo que falla al conectar.
- El secreto del túnel va al almacén del sistema con clave propia
  (`Druse:ssh:`), separada de la de la base. El código de un solo uso nunca se
  guarda.
- Columnas nuevas del túnel en la base local, con migración (`user_version = 3`).
- El diálogo expone el túnel y, por fin, el cifrado del transporte: los tres
  modos de `SslMode` descritos por lo que hacen, no por el nombre del parámetro
  de cada driver.
- Arreglado de paso: el botón elegido de un grupo no se distinguía salvo en el
  entorno, porque solo los entornos tenían color de selección.

**Verificado:** 174 pruebas unitarias y 25 de integración en backend (36 omitidas
por falta de contenedores), 212 en frontend y build de producción sin avisos
nuevos. El túnel se ejercitó contra un servidor SSH inexistente: el camino
completo se recorre y el error del driver llega escrito al diálogo. **Falta
probarlo contra un servidor SSH real**, que esta máquina no tiene.

### Sesión 014 — 2026-08-13 · Autenticación de Windows en SQL Server

**Hecho:**
- El perfil de conexión lleva método de autenticación (`password` o `windows`).
  `windows` solo se acepta en SQL Server y sobre Windows; el validador lo rechaza
  en cualquier otro caso en lugar de dejar que falle el driver.
- Con autenticación integrada, la cadena de SqlClient activa `Integrated
  Security` y deja fuera usuario y contraseña, que en ese modo el propio driver
  rechaza.
- El diálogo de nueva conexión muestra los dos métodos solo con SQL Server,
  oculta usuario, contraseña y «recordar la contraseña» al elegir Windows, y
  vuelve a contraseña si se cambia a otro motor.
- La base local guarda el método en una columna nueva, añadida por migración
  (`user_version = 2`); los perfiles existentes quedan como estaban.
- Una conexión guardada con autenticación de Windows ya no pide contraseña ni
  guarda secretos en el almacén del sistema.

**Verificado:** 159 pruebas unitarias y 25 de integración en backend (36 omitidas
por falta de contenedores), 208 en frontend y build de producción sin avisos
nuevos.

### Sesión 013 — 2026-08-13 · Archivos SQL

**Hecho:**
- La barra superior abre, guarda y guarda como archivos `.sql`; Monaco añade
  `Ctrl+O`, `Ctrl+S` y `Ctrl+Shift+S`.
- En escritorio, Tauri usa diálogos nativos y conserva las rutas detrás de un
  identificador opaco: el WebView no puede pedir lectura o escritura arbitraria.
- Solo admite `.sql` UTF-8 de hasta 10 MB. Abrir crea una pestaña limpia con el
  nombre del archivo y guardar solo quita el indicador si el texto escrito sigue
  siendo el contenido actual.
- En navegador, abrir usa el selector web y guardar descarga el archivo.
- Cerrar una pestaña modificada solicita confirmación para evitar pérdida de datos.

**Verificado:** 206 pruebas frontend, build de producción, `cargo check` y 2
pruebas Rust del envoltorio. Permanece únicamente el aviso conocido de `nearley`.

### Sesión 012 — 2026-08-13 · Tipos de datos en el explorador

**Objetivo:** iniciar la mejora posterior al MVP del plan §15 y cerrar su primera
entrega sin añadir consultas de metadatos.

**Hecho:**
- El tipo completo de `DatabaseColumn` se conserva al convertir una columna en
  `DatabaseObject` y llega a `ExplorerNode.hint`.
- La barra lateral muestra el tipo junto al nombre de la columna. Nombre y tipo
  se truncan de forma independiente y el tipo completo queda en `title`.
- Una prueba del store protege `varchar(200)` durante el aplanado del árbol y una
  prueba del componente protege el renderizado de `numeric(12,2)`.

**Verificado:** 139 pruebas de frontend y compilación de producción correctas. La
compilación conserva dos avisos anteriores: `results-panel.scss` supera su
presupuesto por 259 bytes y `nearley`, transitiva de `sql-formatter`, es CommonJS.

**Siguiente:** Entrega 2, plantillas SQL desde tablas según el motor de la conexión
que originó la acción.

#### Entrega 2 — Plantillas SQL por conexión

**Hecho:**
- El SELECT rápido reutiliza `buildSelect`: cita identificadores y escribe
  `TOP 100` en SQL Server o `LIMIT 100` en PostgreSQL y MySQL/MariaDB.
- El compositor añade `DROP TABLE`. `INSERT`, `UPDATE`, `CREATE TABLE` y
  `DROP TABLE` solo aparecen para tablas; las vistas conservan únicamente SELECT.
- Cada plantilla se abre en una pestaña editable ligada al `connectionId` del
  nodo. Ejecutar o exportar esa pestaña utiliza esa sesión, no la primera abierta.
- La caché de columnas incluye conexión, base, esquema y relación. El índice del
  editor y las importaciones también respetan el contexto del nodo.

**Pruebas nuevas:** dialecto de `DROP TABLE` en los tres motores, plantillas
visibles según tabla o vista, dos conexiones con `public.users` sin compartir
columnas y ejecución de una pestaña SQL Server en su propia sesión.

**Verificado:** 145 pruebas de frontend, compilación de producción y formato
correctos. Continúan únicamente los dos avisos de compilación anteriores.

**Siguiente:** Entrega 3, DDL de vistas desde el catálogo de cada motor.

#### Entrega 3 — DDL de vistas

**Hecho:**
- `IDatabaseMetadataReader`, `MetadataService` y la API local exponen la
  definición de una vista bajo el mismo turno exclusivo que el resto del catálogo.
- PostgreSQL usa `pg_get_viewdef` y distingue vistas normales de materializadas;
  SQL Server lee `sys.sql_modules` y explica definiciones cifradas o privadas;
  MySQL/MariaDB conserva lo que entrega `SHOW CREATE VIEW`.
- «Ver DDL» solo aparece en vistas, usa la sesión de `connectionId` y abre el SQL
  en una pestaña editable. Un error se muestra sin cerrar la sesión ni tocar el
  árbol.
- SQL Server rechaza expresamente pedir el DDL de una base distinta de aquella
  contra la que se abrió la sesión, hasta que el explorador soporte cambiar el
  catálogo de forma real.

**Verificado con motores reales desechables:** 25 comprobaciones compartidas por
PostgreSQL, SQL Server y MySQL; 85 pruebas en el ensamblado contractual y 59 de
integración, todas sin omisiones. Suite completa: 289 backend y 147 frontend.
Compilación backend sin advertencias; compilación frontend correcta con los dos
avisos anteriores. Los tres contenedores se retiraron al terminar.

**Correcciones surgidas de la revisión final:**
- Cambiar, crear o cerrar pestañas limpia el resultado visible y los cambios de
  cuadrícula; una fila leída en una conexión nunca puede quedar editable bajo otra.
- Toda pestaña queda ligada a una conexión. Motor, autocompletado, barra de estado,
  ejecución y exportación derivan de la misma sesión.
- SQL Server muestra únicamente la base conectada hasta que exista navegación
  real entre catálogos; antes se podían etiquetar como ajenos objetos leídos de la
  base actual.
- Los tres proveedores identifican identidad, autoincremento y columnas calculadas;
  las plantillas no intentan escribirlas.
- El compositor pasa también la base al buscar columnas y bloquea plantillas que
  dependen de ellas hasta terminar la carga.
- Modificar el SQL invalida la procedencia editable de una tabla; las respuestas
  o confirmaciones tardías se descartan si cambió la pestaña o su texto.
- La sincronización de una pestaña hacia Monaco no se confunde con una edición
  del usuario.

Tras estas correcciones se repitieron las pruebas reales de los tres motores sin
omisiones. En ese punto la suite frontend tenía 156 pruebas.

#### Mejora visual y de navegación

**Hecho:**
- Las pestañas muestran operación, conexión, base, motor y color de entorno; las
  nuevas consultas heredan la conexión de la pestaña visible.
- El explorador sustituyó la hilera de iconos por un menú textual accesible con
  `SELECT`, compositor, copiar nombre, DDL, importar y actualizar.
- `Ctrl+K` abre una paleta global con comandos, conexiones, tablas y vistas ya
  cargadas aunque su rama esté plegada. Admite flechas, Enter, Escape, foco
  contenido y resultados homónimos diferenciados por conexión y base.
- La cuadrícula ofrece densidad cómoda o compacta, encabezados fijos y una
  advertencia explícita cuando el resultado está recortado. Los errores enseñan
  código y se pueden copiar.
- En pantallas estrechas el explorador pasa a drawer recuperable; la barra superior
  reduce acciones secundarias sin perder búsqueda ni creación de conexiones.
- Respuestas y avisos tardíos de ejecución o exportación se descartan si cambió la
  pestaña o su SQL.

**Verificado:** 168 pruebas frontend y compilación de producción. La paleta se
publica en un chunk diferido de 9 kB y el bundle inicial queda en 499,60 kB,
dentro del presupuesto existente de 500 kB.

**Validación manual completada:** interfaz revisada en escritorio y móvil, junto
con los flujos de paleta, menús, pestañas, exportación y conexiones simultáneas.

#### Ubicación de errores y DDL de procedimientos

**Hecho:**
- PostgreSQL y SQL Server marcan en Monaco la línea que el motor reporta; al
  ejecutar una selección se conserva su desplazamiento dentro del documento.
  MySQL mantiene el mensaje sin inventar una línea cuando el driver no la aporta.
- «Ver DDL» está disponible también para procedimientos almacenados. PostgreSQL
  distingue sobrecargas por OID y firma; SQL Server y MySQL consultan sus
  catálogos nativos.
- La CI ya recibe los fuentes de iconos y persistencia SQLite que dos reglas
  demasiado amplias de `.gitignore` ocultaban en la primera subida.

**Verificado:** 295 pruebas backend, 176 frontend y compilaciones de producción.
El editor se carga en un chunk inmediato de 18,78 kB y el bundle inicial queda en
488,88 kB, dentro del presupuesto de 500 kB.

---

### Sesión 011 — 2026-08-12 · Fase 8, MySQL y primera beta

**Objetivo:** el tercer motor y cerrar el ciclo. Era la fase más previsible: el contrato compartido iba a decir en un minuto si el proveedor estaba bien.

**Hecho:**

*Proveedor MySQL*
- `MySqlDatabaseProvider`, `MySqlQueryExecutor`, `MySqlMetadataReader`, `MySqlResultReader`, `MySqlErrorNormalizer`, `MySqlValueFormatter` y `MySqlConnectionStringFactory` con MySqlConnector 2.6.2.
- Registrado en la composición: **tres líneas**, sin tocar Domain, Application ni un solo componente Angular. Es justo lo que el plan §14 pedía demostrar.
- Metadatos sobre `information_schema`, al revés que los otros dos: MySQL no tiene un catálogo interno que aporte más, y ahí ya están el recuento aproximado (`TABLE_ROWS`) y el tipo completo de cada columna (`COLUMN_TYPE`, que da `varchar(200)` donde `DATA_TYPE` solo daría `varchar`).
- Cuatro opciones del driver elegidas a conciencia, cada una con su motivo en el código: `ConvertZeroDateTime` (las fechas cero de MySQL no caben en .NET y reventarían a mitad de un resultado), `GuidFormat=None` (un `CHAR(36)` que no sea un GUID es legítimo y debe verse tal cual), `TreatTinyAsBoolean` (es lo que hace que un `BOOL` se lea `true` igual que en los otros motores) y `AllowUserVariables` (un cliente SQL tiene que poder ejecutar `SET @x = …`).

*Las 24 pruebas contractuales, otra vez sin tocarlas*
- **72 en verde: las mismas 24 contra PostgreSQL 18.4, SQL Server 2022 y MySQL 8.4.** Ninguna comprobación tuvo que cambiarse.
- Lo que sí varía queda declarado en el fixture: `SLEEP` frente a `pg_sleep` y `WAITFOR`, `SIGNAL SQLSTATE '01000'` frente a `RAISE NOTICE` y `PRINT`, el error 1064 frente a `42601` y 102, y el esquema por omisión, que en MySQL es la propia base.
- **MariaDB 11.4 supera las mismas 24 con el proveedor de MySQL**, así que la compatibilidad que declara el código está comprobada y no supuesta.

*Estabilización*
- Regresión: una prueba nueva comprueba que **todo motor anunciado tiene sus tres piezas registradas**. Sin ella, olvidar el lector de metadatos de un proveedor futuro no falla al arrancar: el motor aparece en la lista y revienta luego, al abrir el árbol.
- Los tres motores y sus puertos, comprobados por HTTP; `test-db.ps1`, `test-db.sh` y la integración continua levantan ahora los tres.
- Dos pruebas de frontend para el dialecto MySQL, incluida la que protege las comillas invertidas: son lo que permite que una columna se llame `order`.

*Primera beta*
- `docs/release-notes/0.1.0-beta.md`: qué trae, con qué números se comprobó y **qué no garantiza todavía**.
- La versión se queda en `0.1.0` sin sufijo (ver D-23).

**Un fallo encontrado, y lo que destapó:**

De las 24, una falló: **el tiempo de espera daba la consulta por completada**. MySqlConnector agota `CommandTimeout` mandando `KILL QUERY` desde otra conexión, pero el servidor no siempre convierte esa interrupción en error: un `SELECT SLEEP(30)` cortado **termina bien y devuelve una fila**. La consulta que el usuario dio por caducada se anunciaba como correcta, con datos incompletos. Ahora el plazo lo controla el proveedor con su propio token y `CommandTimeout` queda a cero: así se distingue quién cortó, si el reloj o el usuario. Es exactamente el tipo de diferencia que el contrato compartido existe para encontrar.

**Verificado con la aplicación en marcha, contra MySQL 8.4 real** (37 tenants, 412 empresas, 1 284 usuarios y 9 630 documentos):
- Los **tres motores** en `/api/engines` con sus puertos.
- Sesión abierta **sin reenviar la contraseña**, y la respuesta no la contiene.
- Árbol completo: base → esquema → carpetas → tablas con recuento, más vistas, funciones y procedimientos.
- Columnas con su tipo entero: `varchar(200)`, `decimal(12,2)`, `tinyint(1)`, `timestamp`, clave primaria y valores por defecto.
- Tipos normalizados: el `BOOL` de MySQL llega como `true`/`false` **igual que el `boolean` de PostgreSQL y el `bit` de SQL Server**; decimales en cultura invariante; binarios como `0x…`; nulos distintos de la cadena vacía; acentos intactos («André Sáez», «Ömer Çelik»).
- `SET @total = …; SELECT @total := …` funciona, y los parámetros con nombre de las consultas de catálogo siguen funcionando.
- Avisos del servidor recogidos («aviso desde MySQL»), error de sintaxis con código 1064, `DELETE` sin filtro → **409**, 9 630 filas recortadas a 500 con `truncated`.
- **Cancelación en vivo: `SLEEP(30)` cortado a los 2,8 s.**
- **9 630 filas exportadas a CSV en 0,06 s**, con BOM y acentos correctos.
- Tiempos (mediana de 10): metadatos **~5 ms**, `SELECT` de 500 filas **~26 ms**, abrir y cerrar sesión **~5 ms**.
- **Memoria plana: 44 MB antes y 42 MB después de tres exportaciones completas seguidas.** La lectura progresiva hace lo que promete.

**Verificación visual, por fin (la extensión de Chrome se conectó a mitad de sesión):**
- Se compararon lado a lado el mockup y Druse a 1440×900, con la aplicación conectada a MySQL y una consulta ejecutada. **La pantalla reproduce el mockup**: proporciones de los paneles, barra superior, pestañas, barra de herramientas, cuadrícula con tipos por columna, panel de resultados y barra de estado.
- Diferencias, todas conocidas: el wordmark dice «Druse» y no «Quarzo Studio» (D-05/D-06) y **falta la pestaña «Plan de ejecución»**, que el mockup enseña pero está fuera del MVP (backlog §15, prioridad media).
- De paso quedó comprobado el flujo de MySQL **desde la interfaz**, no solo por HTTP: diálogo con MySQL ya seleccionable, «Conexión correcta con MySQL 8 en 160 ms», árbol con recuentos, doble clic en una tabla generando `SELECT * FROM druse_test.usuarios LIMIT 100;` —dialecto correcto, no `TOP`— y 100 filas en 13 ms con booleanos en verde y rojo, nulos marcados y acentos intactos.

**Un fallo de interfaz encontrado mirando, que ninguna prueba veía:** la barra del editor escribía **`druse_test.public`**. El esquema estaba puesto a fuego desde la Fase 1, copiado del mockup: `public` es el esquema por omisión de PostgreSQL y de nadie más —en SQL Server es `dbo` y en MySQL no existe—, así que la aplicación mentía en dos motores de tres. Ahora el esquema solo se muestra cuando el árbol ha cargado uno y solo uno y no coincide con el nombre de la base. Dos pruebas nuevas lo fijan: una comprueba que MySQL no dice `public`, y otra que PostgreSQL **sí** sigue diciendo `druse_test.public`, para que arreglar un motor no rompa el otro.

**Incidencia del entorno, no del producto:** los acentos aparecían dobles («AndrÃ©»). No era Druse: el guion de carga entró por el cliente `mysql` sin `--default-character-set=utf8mb4` y los grabó doblemente codificados. Se comprobó con `HEX(nombre)` —`C383C2A9` en vez de `C3A9`— y al recargar bien salieron correctos de punta a punta. Merece quedar escrito para que la próxima lectura no lo confunda con un fallo del proveedor.

**No hecho, y por qué:** lo mismo que quedó de la Fase 7 —instalar de verdad y probar en un equipo limpio— sigue necesitando otra máquina.

---

#### Después de cerrar la Fase 8, usando la beta contra una base real

El usuario abrió su SQL Server de preproducción y lo que salió no estaba en ningún plan. Todo esto vino de usarla, no de leerla:

1. **El explorador no podía listar tablas** en su base. El recuento de filas salía de una DMV que exige `VIEW DATABASE STATE`, un permiso que un usuario de aplicación no tiene: el servidor respondía 262 y el usuario se quedaba sin ver **ninguna** tabla por culpa de un número informativo. Ahora sale de `sys.partitions`, que solo exige poder ver la tabla, y detrás queda un respaldo que lista sin recuento si aun así lo rechazan. Los números de error están comprobados en los dos entornos: 262 en Azure SQL, 297 en SQL Server 2022.

2. **El autocompletado se apagaba tras el punto de un esquema.** Se buscaba una tabla llamada `tpublico`; como no existía, la lista salía vacía justo donde más falta hace: en una base cuyo esquema no es el de por omisión. De paso, las columnas solo se conocían si la tabla se había expandido a mano, cosa que nadie hace con cientos de tablas. Ahora el catálogo **se precalienta al conectar** —hasta 20 esquemas, y el resto al escribir `esquema.`— y las columnas se piden la primera vez que se pregunta por una tabla.

3. **Una conexión no ejecuta dos cosas a la vez**, y el precalentado pedía tablas y vistas en paralelo: SQL Server respondía que no admite MultipleActiveResultSets. El fallo lo destapó el precalentado pero no era suyo —bastaba con expandir dos nodos seguidos—, así que cada sesión tiene ahora su turno en el servidor.

4. **IntelliSense**, a petición del usuario: tooltip con el tipo de cada columna, tipos en el desplegable, plantillas por motor y avisos que subrayan lo que el catálogo desmiente. La regla de los avisos es callar si no se está seguro: un aviso falso sobre SQL correcto enseña a ignorarlos.

5. **Edición de filas en la cuadrícula**, la primera vez que Druse escribe en los datos del usuario. Las reglas viven en el caso de uso, no en la interfaz: clave primaria obligatoria, la clave se lee del catálogo, no se toca la clave primaria, transacción, parámetros, el SQL a la vista antes de confirmar y **una fila por instrucción** —si toca cero o más de una, se deshace todo—.

6. **Los errores del motor llegan a la pantalla.** Un permiso que falta o una contraseña incorrecta salían como 500 con «se produjo un error inesperado» y el motivo se quedaba en el log. Ahora salen como 409 con el mensaje del motor y su código, ya saneado: se comprobó que la contraseña rechazada no aparece dentro.

**Al día:** 269 pruebas de backend y 120 de frontend.

7. **Importar CSV y Excel**, con la previsualización como pieza central: emparejar por nombre, revisar todas las filas y no escribir nada si algo no cabe.

8. **Componer consultas** sin escribirlas, y plantillas de `INSERT`, `UPDATE` y `CREATE TABLE` desde el catálogo.

9. **La aplicación empaquetada salía sin estilos**, y el usuario lo había visto. No era un fallo de los estilos: Angular difiere la hoja poniéndola como `media="print"` y activándola con un manejador en línea (`onload="this.media='all'"`), y la CSP de Tauri —`script-src 'self'`— bloquea los manejadores en línea. La hoja se quedaba en `print` para siempre, así que solo se aplicaba el CSS crítico incrustado. En el navegador no pasa porque ahí no hay CSP: **solo se ve empaquetando**. Se desactivó `inlineCritical` en la compilación de producción, y ahora el enlace es una hoja normal sin nada en línea.

   **Cómo se comprobó, que es lo reutilizable:** se sirvió el `dist` compilado con un servidor estático que devuelve **la CSP exacta del envoltorio**, y se abrió en el navegador. Es la única condición que distingue al ejecutable, y así se puede verificar sin empaquetar. Resultado: la hoja se aplica (`media` vacío, 16 hojas activas), el fondo es `#07080B` y la barra superior mide sus 46 px. En el binario ya no aparece `media="print"` por ninguna parte.

10. **La aplicación empaquetada no encontraba su API.** Al abrirla salía `Unexpected token '<', "<!DOCTYPE "… is not valid JSON`: sin `withGlobalTauri`, `window.__TAURI__` no existe, el frontend no podía preguntar el puerto ni el token, y sus peticiones acababan en el servidor de recursos, que devuelve el `index.html`. Corregido eso apareció el siguiente, «no se pudo contactar con la API local»: la ventana empaquetada sirve la aplicación desde `http://tauri.localhost`, un origen que la política de CORS no admitía. Con los dos orígenes de Tauri añadidos, la aplicación instalada abre sus conexiones guardadas y ejecuta consultas contra la preproducción real. **Ninguno de los dos fallos existe en el navegador**: los dos nacen de que empaquetada la aplicación cambia de origen y de forma de descubrir su API.

11. **La barra de estado se salía de la pantalla, y la consola de la API se veía.** El tamaño de `tauri.conf.json` está en puntos: 1440×900 son **1800×1125 píxeles** con el escalado al 125 % que Windows trae de fábrica en muchos portátiles, y en una pantalla de 1080 px el borde inferior quedaba fuera, detrás de la barra de tareas. Ahora la ventana se encoge hasta el área de trabajo del monitor —que ya descuenta la barra— y se centra dentro de ella. Aparte, la API es una aplicación de consola y Windows le abría su ventana negra con los registros de ASP.NET delante de Druse: se lanza con `CREATE_NO_WINDOW`.

    **Un aviso para la próxima medición, que costó tiempo:** mover o medir la ventana desde un proceso **sin conciencia de DPI** —PowerShell lo es— falsea el resultado con una ventana PerMonitorV2. Un `ShowWindow`/`SetWindowPos` desde ahí descuadró la ventana y produjo un síntoma inventado: la interfaz aparecía recortada por la derecha y por abajo, y llegué a reproducirlo píxel a píxel escalando el `dist` un 25 %. La aplicación estaba bien. **Lanzada limpia y capturada desde un proceso PerMonitorV2, la maquetación es correcta**: se ven los controles del topbar, los chips «sin conexión» y «Timeout 30 s», y «UTF-8 · LF». El diagnóstico solo vale si el observador tiene la misma conciencia de DPI que lo observado.

**Al día:** 285 pruebas de backend y 137 de frontend.

**Sin verificar todavía:** el recorrido en el navegador de la edición de filas y de la importación. Lo que decide si una tabla es editable sí se comprobó en la aplicación real; los clics finales los hará el usuario, y conviene que sea sobre una tabla de prueba.

**Decisiones tomadas:** D-20 a D-23 (ver §6).

---

### Sesión 010 — 2026-08-12 · Fase 7, aplicación de escritorio

**Objetivo:** que Druse deje de ser una pestaña del navegador.

**Instalación del entorno**
- Rust 1.97.1 con rustup, añadido al PATH del usuario.
- **El instalador oficial de Rust no viene firmado.** Es conocido y ha sido objeto de debate en el propio proyecto; se descargó de `win.rustup.rs` por HTTPS.
- Faltaba el enlazador de C++. Hubo que instalar Build Tools 2022 con el componente de C++ y el SDK de Windows: **4 GB de descarga**.

**Hecho:**

*Puerto dinámico*
- La API acepta `LocalApi:Port=0` y pide un puerto libre al sistema. Un puerto fijo puede estar ocupado por otro programa o por otra instancia.
- `LocalApiEndpoint` sustituye a `LocalApiToken`: publica **puerto, token y PID** en `endpoint.json`, dentro del directorio de datos. Quien pueda leer ese archivo tiene todo lo necesario para hablar con la API; quien no, nada.
- El archivo se escribe al arrancar el servidor, no en el constructor: con puerto dinámico el número real no existe antes.

*Envoltorio Tauri*
- Lanza la API como proceso auxiliar, espera a que publique su punto de conexión y **la mata al cerrar la ventana**.
- Expone un único comando, `api_connection`, que da al frontend el puerto y el token. Es toda su razón de ser: el navegador no puede leer archivos del disco.
- **No contiene lógica de base de datos** (ADR 0001).
- Icono generado a partir del logo del mockup: rombo sobre degradado azul-violeta.

*Frontend*
- `DesktopHost` detecta si corre dentro del envoltorio y le pide los datos de conexión.
- `apiInterceptor` antepone el host y añade el token **solo cuando hace falta**. En desarrollo no toca nada, porque de eso se encarga el proxy.
- **Es el único sitio del frontend que distingue navegador de escritorio.** Ni el gateway ni los componentes lo saben.

*Empaquetado*
- `package.ps1` publica la API autocontenida, compila el frontend y construye el instalador. Con `-Portable`, además un ZIP.
- `msvc-env.ps1` carga el entorno de MSVC antes de compilar.

**Verificado ejecutando la aplicación de verdad:**
- Se generaron **NSIS (44 MB), MSI (58 MB) y ZIP portable (62 MB)**.
- La aplicación abre, **arranca su propia API en un puerto asignado por el sistema** (56201 en la prueba) y responde.
- **La versión portable funciona extraída en un directorio limpio**, con la API en otro puerto (65088).
- Al cerrar la ventana **no queda ningún proceso vivo** y el `endpoint.json` desaparece.
- 192 pruebas de backend y 76 de frontend.

**Incidencias resueltas:**
1. **`ListenLocalhost(0)` no admite puerto dinámico**: abriría dos sockets, IPv4 e IPv6, y cada uno recibiría un puerto distinto. Se pasó a `Listen(IPAddress.Loopback, 0)`.
2. **winget no pasó el `--override`**: instaló el bootstrapper de Build Tools sin el componente de C++, y en el registro no aparecía VCTools por ninguna parte. Se resolvió con el instalador oficial de Microsoft directamente.
3. **Rust elegía el `link.exe` equivocado.** Conviven varias instalaciones de Visual Studio y la detección automática tomaba una que tiene el enlazador pero no las librerías, fallando con «no se puede abrir el archivo msvcrt.lib». Un `.cargo/config.toml` con otro enlazador **no resolvía nada** —el problema eran las rutas de librerías, no el enlazador— así que se hizo bien: cargar el entorno de MSVC.
4. **El glob de recursos `api/*` fallaba** cuando la API no estaba publicada. Se versiona un `.gitkeep`.
5. **`endpoint.json` sobrevivía al cierre**, porque Tauri mata la API sin darle tiempo a limpiar. Ahora lo borra el propio envoltorio.

**No hecho, y por qué:**
- **Instalar y desinstalar de verdad**: modificaría el sistema del usuario. Requiere su decisión.
- **Probar en un equipo limpio**: hace falta otra máquina. Es el criterio que de verdad demuestra que no se necesita .NET ni Node.
- **Artefactos de Linux y macOS**: exigen compilar en cada plataforma. Trabajo de integración continua, no de esta máquina.

---

### Sesión 009 — 2026-08-12 · Fase 6 completa

**Objetivo:** sacar los datos de la herramienta. Es lo último que faltaba del uso diario.

**Hecho:**

*Lectura progresiva*
- `IQueryResultReader`: nuevo contrato que recorre un resultado **fila a fila, sin materializarlo**. Implementado en los dos proveedores.
- Existe porque `ExecuteAsync` limita las filas —van a una cuadrícula— y exportar una tabla grande por ese camino agotaría la memoria del proceso.
- El búfer de fila se reutiliza en cada iteración, para no reservar un array por registro durante una exportación larga.

*Exportadores*
- **CSV según RFC 4180**, escrito a mano: son cuatro reglas y una dependencia para esto habría que justificarla. Entrecomilla cuando hay separador, comillas o saltos de línea, y duplica las comillas internas.
- Codificación elegible. Por defecto **UTF-8 con BOM**: sin él, Excel en Windows abre el archivo con la página de códigos del sistema y los acentos salen rotos.
- Separador y texto de nulo configurables. Un nulo escrito como vacío es indistinguible de una cadena vacía, así que se puede cambiar.
- **XLSX con ClosedXML**, con su propio tope de 200 000 filas: este formato sí necesita el libro entero en memoria, y se dice en el código por qué.
- Los valores van como texto a propósito: dejar que Excel los interprete convertiría «007» en 7.

*API*
- `/api/exports/csv` y `/api/exports/xlsx`, escribiendo directamente sobre la respuesta.
- **Exportar no es una vía para saltarse las protecciones**: pasa por las mismas reglas que una ejecución, incluidas solo lectura y confirmación de instrucciones destructivas.
- El nombre de archivo se sanea antes de ir a la cabecera.

*Interfaz*
- Menú **Exportar** con CSV y Excel, que descarga el archivo.
- **Filtros por columna**, locales sobre lo que se ve; para acotar de verdad está el `WHERE`.
- **Copiar**: celda con doble clic o Ctrl+C, fila entera con doble clic en su número, encabezados desde la esquina. Todo separado por tabuladores para pegarlo en una hoja.
- **Varios conjuntos de resultados**: un lote con tres `SELECT` muestra tres pestañas. El backend ya los devolvía; la interfaz ignoraba todos menos el primero.
- El historial se extrajo a su propio componente.

**Verificado con la aplicación en marcha:**
- **9 630 filas exportadas a CSV en 0,23 s**, cuando la cuadrícula solo muestra 500.
- XLSX que Windows identifica como «Microsoft Excel 2007+».
- Los casos que rompen un CSV mal hecho, todos correctos: `"Madrid, España"`, `"Dijo ""hola"""`, salto de línea dentro del campo, nulo vacío, acentos y BOM `ef bb bf`.
- `DELETE` sin filtro por la vía de exportación → 409.

**Incidencias resueltas:**
1. **Las cabeceras con el recuento de filas se añadían después de escribir el cuerpo**, cuando ya se habían enviado. Se pasó a **trailers HTTP**, que es el mecanismo para metadatos que solo se conocen al terminar. La validación se movió antes de tocar la respuesta, para poder devolver 409 con un cuerpo legible.
2. **ClosedXML necesita un destino con posicionamiento** y el cuerpo de una respuesta HTTP no lo tiene. Se compone en memoria y se copia; no es una limitación nueva, porque este formato ya obligaba a tener el libro entero en memoria.
3. El panel de resultados volvió a superar el presupuesto de estilos. Se extrajo el historial, que es una vista con entidad propia.

**Decisiones tomadas:** D-08 y D-16 (ver §6).

---

### Sesión 008 — 2026-08-11 · Fase 5 completa

**Objetivo:** que el trabajo diario se pueda hacer con el teclado, y apagar los botones de adorno.

**Hecho:**

*Formateador*
- `sql-formatter` con el dialecto de cada motor: PostgreSQL, T-SQL o MySQL. Formatear con el genérico no es inofensivo —parte el `::` de PostgreSQL y los corchetes de SQL Server por sitios que cambian el significado del SQL.
- Formatea la selección si la hay, o el documento entero.
- **Si el SQL no se puede analizar, se devuelve intacto.** Reformatear a la fuerza algo a medio escribir sería la forma más rápida de que alguien pierda trabajo.
- Va por `executeEdits`, así que **se deshace con Ctrl+Z** como cualquier otra edición.

*Autocompletado*
- Palabras reservadas y funciones por motor. La lista es corta a propósito: sugerir cientos convierte el desplegable en ruido.
- Tablas, vistas, esquemas y columnas **de lo que el explorador ya cargó**. Consultar el catálogo en cada pulsación sería mucho peor que sugerir de menos.
- Tras un punto se sugieren **solo columnas**, y se resuelven los alias: escribir `u.` funciona si antes hay `FROM users u`. Sin eso, la función más útil del autocompletado no existiría.
- Las tablas se ordenan por delante de las palabras reservadas, que es lo que más se escribe.

*Atajos*
- `Ctrl+Enter` ejecutar · `Ctrl+Shift+Enter` ejecutar selección · `Esc` cancelar · `Ctrl+S` guardar · `Ctrl+T` nueva consulta · `Ctrl+Shift+F` formatear · `Ctrl+F` buscar.
- Se registran en Monaco y no en el documento: un `Ctrl+S` global se comería el del navegador aunque el foco estuviera en otro sitio.

*Lo que dejó de ser decorativo*
- **Formatear**, que era un botón muerto.
- **Timeout**, ahora un desplegable con valores habituales que **se guarda en preferencias**.
- **Filtro de conexiones**, que además filtra objetos del árbol y conserva los ancestros de cada coincidencia: una tabla suelta sin su esquema no diría de dónde sale.
- **Historial filtrable**, resuelto en el servidor, que es quien tiene todas las entradas.
- **Copiar el nombre calificado** y **abrir el `SELECT`** desde el árbol, con acciones que solo aparecen al pasar por encima para no tapar los nombres.

**Verificado:**
- 61 pruebas de frontend (16 nuevas de formateo y autocompletado) y 167 de backend.
- La preferencia de timeout persiste: se escribió 120 y se leyó 120.
- El historial filtra por texto contra el servidor.

**Incidencia resuelta:** `sql-formatter` añadía **300 kB al paquete inicial**, que se descargarían siempre, incluso para quien no formatee nunca. Pasó a carga diferida, igual que Monaco: el paquete inicial volvió de 705 kB a 411 kB y el formateador se trae la primera vez que se usa.

**No hecho:**
- Guardar en disco: `Ctrl+S` solo quita el indicador de cambios pendientes. Los archivos llegan con el empaquetado de escritorio (Fase 7).
- Recordar las pestañas abiertas entre sesiones. Se aplaza otra vez; encaja mejor junto al estado de ventana de la Fase 7.

---

### Sesión 007 — 2026-08-11 · Fase 4 completa

**Objetivo:** el segundo motor. Es la fase que dice si las abstracciones sirven o solo lo parecían.

**Hecho:**
- `SqlServerDatabaseProvider`, `SqlServerQueryExecutor`, `SqlServerMetadataReader` y `SqlServerErrorNormalizer` con Microsoft.Data.SqlClient 7.
- Metadatos sobre las vistas `sys.*`, con recuento desde `sys.dm_db_partition_stats` —el equivalente de `reltuples`— para no hacer `COUNT(*)` por tabla.
- Los tipos se recomponen con su longitud (`nvarchar(200)`, `datetimeoffset(7)`), porque `sys.columns` los guarda despiezados y mostrar solo «nvarchar» perdería información que PostgreSQL sí da.
- Registrado en la composición: **tres líneas**, sin tocar Domain, Application ni un solo componente Angular.
- SQL Server habilitado en el diálogo de conexión.
- `test-db.ps1` y `.sh` levantan ahora los dos motores, por separado o juntos.

**Las pruebas contractuales pasaron a ser de verdad compartidas**
- `DatabaseProviderContractTests<TFixture>` define **24 comprobaciones idénticas**; cada motor solo aporta conexión y dialecto a través de `IProviderFixture`.
- **48 pruebas en verde: las mismas 24 contra PostgreSQL 18.4 y contra SQL Server 2022.** Ninguna comprobación tuvo que cambiarse para que pasara en un motor concreto.
- Lo que sí varía queda declarado y a la vista en el fixture: `pg_sleep` frente a `WAITFOR DELAY`, SQLSTATE `42601` frente al error `102`, `generate_series` frente a una CTE recursiva, `RAISE NOTICE` frente a `PRINT`, `public` frente a `dbo`.

**Dos fallos encontrados, y cómo:**

1. **`InvariantGlobalization=true`, puesto en la Fase 0 para reducir el tamaño del ejecutable, impide que SqlClient abra ninguna conexión**: falla con «Globalization Invariant Mode is not supported». Una decisión de tres fases atrás que solo se manifiesta al integrar el segundo motor. Desactivado, con el motivo escrito en `Directory.Build.props`. Tampoco encajaba con una aplicación que muestra datos de bases ajenas con sus intercalaciones.

2. **Las 24 pruebas de SQL Server pasaban sin comprobar nada.** El patrón de omisión silenciosa —terminar sin hacer nada cuando falta el servidor— convertía un motor caído en una suite verde. Se añadió `ElMotorEstabaDisponible`, que con `DRUSE_REQUIRE_ENGINES=1` convierte ese silencio en un fallo, y `UnavailableReason`, que muestra **por qué** no conectó en lugar de obligar a depurar a ciegas. Fue justo ese test el que destapó el problema anterior. La integración continua ya exige los dos motores.

**Verificado con la aplicación en marcha, contra SQL Server real:**
- `/api/engines` devuelve los dos motores.
- Conexión guardada y sesión abierta **sin reenviar la contraseña**.
- Esquemas sin `sys` ni `INFORMATION_SCHEMA`; tablas con su recuento.
- Columnas con tipos T-SQL correctos: `nvarchar(200)`, `datetimeoffset(7)`, `bit`, clave primaria e identidad.
- Consulta T-SQL con acentos y nulos.
- **El `bit` de SQL Server llega como `true`, igual que el `boolean` de PostgreSQL**: la normalización de tipos funciona.
- `DELETE` sin filtro → 409 con el mismo aviso que en PostgreSQL.

**Decisión registrada:** la autenticación integrada de Windows queda **fuera del MVP**. Ata la aplicación a un sistema operativo y el plan exige explícitamente que no sea la única forma de conectarse (ADR 0003). Sigue en el backlog de prioridad alta.

**Sobre el nombre «R3Safety»:** venía del mockup y lo había copiado a los datos de prueba. Sustituido por nombres neutros. En el código no quedaba ninguna referencia: los datos simulados que lo tenían se borraron en la Fase 2.

---

### Sesión 006 — 2026-08-11 · Ejecución completa y tres fallos corregidos

**Objetivo:** arrancar la aplicación entera y ver cómo se comporta de verdad.

**Qué se hizo:** se pobló la base de pruebas con los mismos datos del mockup (1 284 usuarios, 37 tenants, 412 empresas, 9 630 documentos; el nombre «R3Safety» del mockup se sustituyó por datos neutros), se arrancó con `dev.ps1` y se recorrió el flujo completo por el proxy.

**Tres fallos que solo aparecieron al ejecutar:**

1. **`dev.ps1` no funcionaba en esta máquina.** `Start-Process` une los argumentos con espacios sin entrecomillarlos, y la ruta contiene un espacio («DB STUDIO»), así que dotnet recibía `P:\Proyectos\Trabajo\DB`. El criterio de salida de la Fase 0 decía «existe un único comando documentado»… y ese comando nunca se había ejecutado entero. Corregido entrecomillando la ruta.

2. **El proxy no inyectaba el token.** Se había escrito con la sintaxis `on: { proxyReq }` de http-proxy-middleware v3, pero el servidor de Angular usa Vite, que espera `configure`. La opción se ignoraba **en silencio** y todas las peticiones llegaban sin token: el frontend habría respondido 401 en todo. Corregido con `configure`.

3. **El botón «Cancelar» no podía funcionar.** El `executionId` lo generaba el servidor y solo llegaba **con la respuesta**, es decir, cuando la consulta ya había terminado. Mientras corría, el cliente no tenía identificador que cancelar. Las pruebas no lo detectaron porque las contractuales cancelaban pasando un token directamente al ejecutor, y la de integración solo comprobaba que cancelar un id inexistente da 404. **Ahora el identificador lo elige el cliente y se envía con la petición.** Añadidas dos pruebas: cancelar una consulta *en curso* y comprobar que el id devuelto es el que se mandó.

**Verificado con la aplicación en marcha:**
- `dev.ps1` levanta API y frontend con un solo comando.
- El proxy inyecta el token: `/api/connections` responde 200 por el 4200 y 401 por el 5177 directo.
- Conexión guardada, sesión abierta **sin reenviar la contraseña**, con nombre en UTF-8 («PostgreSQL — Local») intacto.
- Explorador con carga perezosa: base → esquema → carpetas → tablas, con los recuentos reales (9 630, 412, 37, 1 284).
- La consulta del mockup ejecutada de verdad: 17 ms.
- `DELETE FROM users` sin filtro → **409** con el riesgo explicado.
- Error de sintaxis → SQLSTATE 42601 y posición 14.
- 9 630 filas recortadas a 500 con `truncated: true`.
- Nulos como `null`, distintos de la cadena vacía, y acentos correctos («Lucía Gómez»).
- **Cancelación en vivo: `pg_sleep(30)` cortado a los 2,8 segundos.**

**Pruebas:** 140 en backend (85 + 21 + 34) y 45 en frontend.

**Limpieza:** se borraron de la máquina los datos de prueba y la credencial del Administrador de credenciales.

**Nota sobre el proceso:** los tres fallos estaban en las costuras —un script, una opción de configuración, un contrato entre cliente y servidor—, justo donde las pruebas de cada lado no miran. Conviene ejecutar la aplicación entera al cerrar cada fase, no solo al final.

---

### Sesión 005 — 2026-08-11 · Fase 3 completa

**Objetivo:** que los datos sobrevivan al reinicio y que la API deje de ser abierta.

**Hecho:**

*Plataforma*
- `IAppPaths`: directorios según la convención de cada sistema (`%APPDATA%`, `Application Support`, XDG). Todo con `Path.Combine`; una prueba comprueba que no aparece el separador de la otra plataforma.
- `ISecretStore` con tres implementaciones: **Administrador de credenciales de Windows** por P/Invoke a `advapi32`, **Llavero de macOS** por `security` y **Secret Service** por `secret-tool`.
- `NullSecretStore` cuando no hay ninguno: la aplicación pide la contraseña cada vez **y lo dice en la interfaz**. Cifrar un archivo con una clave que está en el mismo disco sería seguridad aparente, que es peor que ninguna.

*Persistencia*
- SQLite con perfiles, historial y preferencias. Esquema explícito, WAL y `user_version` para poder migrar más adelante.
- `SavedConnectionService` reparte: el perfil a SQLite, la contraseña al almacén del sistema. **Nunca coinciden en el mismo sitio.**
- El historial guarda cada ejecución, incluidas las fallidas con su error. Un fallo al escribirlo no tumba la consulta.

*Seguridad*
- **Token de la API local**: 32 bytes aleatorios por arranque, en `api-token` con permisos 0600 en Unix, exigido en `X-Druse-Token` en todas las rutas menos `/api/health`. Comparación en tiempo constante.
- CORS restringido al origen de la aplicación y solo a la cabecera del token.
- El proxy de desarrollo de Angular pasó de `.json` a `.js` para poder **leer el token del disco e inyectarlo**: el navegador no puede hacerlo.
- ADR 0004 documenta el alcance real de la protección, incluido lo que **no** cubre.

*Interfaz*
- Perfiles guardados en la barra lateral, restaurados al arrancar y desconectados: abrir todas las sesiones al inicio despertaría servidores que el usuario no pensaba tocar.
- Un clic sobre un perfil guardado lo conecta usando la contraseña del almacén.
- **Color por entorno**: franja verde, ámbar o roja en desarrollo, pruebas y producción.
- Historial navegable con filtro; al pulsar una consulta se abre en una pestaña nueva.
- El diálogo ofrece guardar la conexión y recordar la contraseña, e informa de dónde queda.

**Verificado ejecutando:**
- 138 pruebas de backend y 45 de frontend, todas pasan.
- **Sin token la API responde 401; con él, 200.**
- **Al reiniciar la API, el token cambia y el anterior deja de valer.**
- **El perfil guardado sobrevive al reinicio y abre sesión sin reenviar la contraseña**, que sale del Administrador de credenciales.
- Se ejecutó una consulta real con esa sesión y quedó anotada en el historial.
- **Ningún archivo local contiene la contraseña**: se leyeron `druse.db`, `-wal`, `-shm` y `api-token` byte a byte buscándola. La credencial sí estaba en el Administrador de credenciales.
- Los datos de prueba y la credencial se borraron de la máquina al terminar.

**Incidencias resueltas:**
1. Una prueba destapó que **el término de búsqueda del historial no escapaba los comodines de LIKE**: buscar `%` devolvía todo y `_` casaba con cualquier carácter. No era inyección —iba como parámetro— pero sí una búsqueda que mentía. Ahora se escapa con `ESCAPE '\'`.
2. Otra prueba destapó que **`forget` borraba el perfil en el servidor pero lo dejaba en la lista local**, porque `disconnect` ahora conserva los perfiles guardados. Corregido.
3. La referencia nueva `Persistence.Sqlite → Platform.Abstractions` hizo fallar la prueba de arquitectura, que es justo su trabajo. Se amplió la regla con el motivo documentado.

**Comportamiento conocido:**
- Si el proceso muere de forma abrupta (kill, fallo), **el archivo del token queda en disco**. No es una brecha: ese valor ya no lo acepta nadie y el siguiente arranque lo sobrescribe. Verificado.
- En macOS, `security` recibe la contraseña como argumento y es visible un instante en la lista de procesos. Anotado en el ADR 0004 como mejora pendiente.

**No hecho:**
- No se recuerdan las pestañas abiertas: va con el resto del estado del editor en la Fase 5.
- Sin verificación visual: la extensión de Chrome sigue sin conectarse.

---

### Sesión 004 — 2026-08-11 · Fase 2 completa

**Objetivo:** el flujo vertical contra PostgreSQL, de la interfaz al motor.

**Hecho:**

*Dominio y contratos*
- `ConnectionProfile`, `DatabaseObject`, `DatabaseColumn`, `QueryRequest`, `QueryResult` y compañía en `Druse.Domain`.
- `IDatabaseProvider`, `IDatabaseSession`, `IDatabaseMetadataReader` e `IQueryExecutor` en `Druse.Database.Abstractions`.
- **`ConnectionProfile` no tiene campo de contraseña.** Las credenciales viajan aparte en `DatabaseCredentials`, se usan al abrir y se descartan. Hay una prueba que falla si alguien añade una propiedad que se llame «password», «secret» o «credential».
- `SqlSafetyAnalyzer`: detecta DROP, TRUNCATE, DELETE/UPDATE sin WHERE, cambios de esquema y de permisos. Descarta cadenas, identificadores citados y comentarios antes de analizar, para no avisar sin motivo.

*Proveedor PostgreSQL*
- `PostgreSqlDatabaseProvider` con Npgsql 10.
- `PostgreSqlQueryExecutor` sobre `DbCommand`/`DbDataReader`. **No reescribe el SQL**: el límite de filas se aplica al leer, no añadiendo `LIMIT`, porque modificar la consulta cambiaría su significado y su plan.
- `PostgreSqlMetadataReader` sobre los catálogos `pg_*`, con carga perezosa por nivel y recuento estimado desde `reltuples`.
- `PostgreSqlErrorNormalizer`: traduce excepciones a `QueryError` **saneado**, porque los mensajes del driver pueden traer la cadena de conexión.
- Los valores se formatean en cultura invariante: un `numeric` con la coma decimal de la máquina no se podría copiar de vuelta a una consulta.

*Aplicación e infraestructura*
- `ConnectionService`, `MetadataService` y `QueryService`.
- `QueryService.Validate` concentra las reglas comunes: solo lectura, confirmación de instrucciones destructivas y límites. **Confirmar un riesgo no permite saltarse el modo de solo lectura**, que tiene prioridad.
- `ProviderRegistry`, `SessionRegistry` y `QueryExecutionTracker` (cancelación con tokens enlazados).

*API local*
- Endpoints de motores, prueba de conexión, sesiones, metadatos, ejecución y cancelación.
- Middleware que traduce las excepciones conocidas: **ninguna traza llega al cliente**.
- Las sesiones se cierran al apagar el proceso.

*Frontend*
- `ApplicationGateway` ampliado con todo el contrato; `HttpApplicationGateway` traduce los DTO y clasifica los tipos de columna por nombre, no por motor.
- **`WorkspaceStore`**: conexiones, árbol perezoso, pestañas, ejecución y cancelación con Signals.
- Diálogo de nueva conexión según el mockup, con «Probar conexión».
- El árbol carga hijos al expandir y no vuelve a pedirlos; hay que actualizar el nodo explícitamente.
- Doble clic en una tabla abre una pestaña con su `SELECT`.
- Aviso de instrucción destructiva con «Ejecutar de todos modos».
- **Los datos simulados se borraron**, como estaba previsto.

*Pruebas*
- 21 contractuales contra PostgreSQL real: conexión válida e inválida, tipos, nulos, varios conjuntos de resultados, errores con su SQLSTATE, timeout, cancelación y metadatos.
- 15 de integración por HTTP, incluido el flujo completo y la comprobación de que **ninguna respuesta devuelve la contraseña**.
- 20 unitarias nuevas del analizador de SQL y las reglas de ejecución.

**Verificado ejecutando:**
- `dotnet build` y `ng build` — 0 advertencias.
- 90 pruebas de backend y 37 de frontend, todas pasan.
- Flujo completo por HTTP contra PostgreSQL 18.4: salud → motores → sesión → bases → esquemas → `SELECT` con nulo → cierre.
- `DELETE FROM pg_class` sin filtro devuelve **409** con el riesgo explicado, en lugar de ejecutarse.
- Proxy de Angular alcanzando la API y ésta la base.

**Incidencias resueltas:**
1. El puerto 55440 se eligió porque **55432 ya lo ocupaba `prima-postgres`**, un contenedor ajeno al proyecto. No se tocó ningún contenedor existente.
2. Una prueba destapó que `ALTER TABLE … DROP COLUMN` solo se marcaba como cambio de esquema, cuando **destruye datos**. Se amplió el patrón para tratarlo como DROP.
3. El diálogo de conexión superaba el presupuesto de estilos por 281 bytes. Aquí sí se subió el límite a 6 kB: partir un modal en dos componentes por eso habría sido peor que el problema.

**No hecho / decidido no hacer:**
- **Sin verificación visual**: la extensión de Chrome sigue sin estar conectada.
- El timeout está fijo en 30 s; exponerlo en la interfaz es de la Fase 5.
- No hay historial ni persistencia: la contraseña se pide en cada conexión. Es justo el objetivo de la Fase 3.
- No hay token entre Angular y la API. También Fase 3.
- Sin exportación a CSV/XLSX (Fase 6) ni plan de ejecución.

---

### Sesión 003 — 2026-08-11 · Fase 1 completa

**Objetivo:** reproducir el mockup como shell de Angular.

**Hecho:**

*Dependencias*
- Fuentes **Inter** y **JetBrains Mono** empaquetadas con `@fontsource` y cargadas desde `angular.json`. **D-07 resuelto**: verificado que el CSS servido tiene **cero** referencias a Google Fonts y que los WOFF2 salen del propio servidor.
- **Monaco Editor 0.56.0** copiado como recurso estático a `assets/monaco/vs`.

*Componentes* (todos `OnPush`, todos con los tokens, ningún color literal suelto salvo los pocos matices que aún no eran token)
- `layout/app-shell` — compone la ventana y sostiene el estado con Signals.
- `layout/top-bar` — marca, acciones, búsqueda global, controles de ventana.
- `layout/status-bar` — estado de sesión, motor, base, usuario, posición del cursor.
- `features/connections/connections-sidebar` — conexiones y árbol del explorador con sangría por nivel.
- `features/query-editor/editor-tabs` — pestañas con indicador de cambios sin guardar.
- `features/query-editor/editor-toolbar` — ejecutar, ejecutar selección, cancelar, formatear, contexto y timeout.
- `features/query-editor/sql-editor` — Monaco encapsulado; **ningún otro componente importa su API**.
- `features/query-results/results-panel` y `results-grid` — separados a propósito (ver «Incidencias»).
- `shared/ui/icon` — los 20 trazos del mockup en un solo sitio, con unión cerrada de nombres.
- `shared/ui/engine-badge` — el color por motor vive aquí y solo aquí, para no ramificar por motor en las plantillas (plan §13).
- `shared/ui/resize-handle` — arrastre con Pointer Events **y ajuste por teclado**, con `role="separator"` y valores ARIA.

*Editor*
- Tema `druse-dark` para Monaco derivado del mockup: violeta para reservadas, verde para literales, azul para identificadores.
- Creado fuera de la zona de Angular para no disparar detección de cambios en cada pulsación.
- `Ctrl/Cmd + Enter` ejecuta.
- Autocompletado por palabras del documento **desactivado**: sin esquema real solo estorba. Se activa en la Fase 5 con metadatos.

**Verificado:**
- `ng build` — 320 kB iniciales, 0 advertencias.
- `ng test` — 17 pruebas, todas pasan.
- `dotnet test` — 7 pruebas, siguen pasando.
- Servidor de desarrollo sirviendo `loader.js` de Monaco (39 kB) y los WOFF2 de ambas fuentes.

**Incidencias resueltas:**
1. **Monaco arrastraba una `dompurify` vulnerable** (3.4.8; avisos de XSS y de contaminación de configuración). `npm audit fix` proponía degradar Monaco a 0.53. En su lugar se añadió un `override` a `dompurify ^3.4.13`, que resuelve a la versión parcheada manteniendo Monaco 0.56.
2. **El panel de resultados superaba el presupuesto de estilos de Angular** (5,45 kB sobre 4 kB). En vez de subir el límite se extrajo `results-grid`, que además aísla justo la pieza que habrá que sustituir al resolver D-08.

**No hecho:**
- **Sin captura visual comparada con el mockup:** la extensión de Chrome no estaba conectada. La estructura está verificada por DOM y pruebas, pero falta el vistazo a ojo.
- El diálogo «Nueva conexión» del mockup **no se implementó**: pertenece a `connections`, no a la Fase 1.
- Quedan 3 vulnerabilidades moderadas en `@angular/cli` (su servidor MCP interno, vía `@hono/node-server`). Son de desarrollo, no llegan al bundle, y la única «solución» sería degradar Angular a la 21. Se espera actualización.

**Archivos:** 30 nuevos en `frontend/src/app`, más `angular.json` y `package.json`.

---

### Sesión 002 — 2026-08-11 · Fase 0 completa

**Objetivo:** montar el esqueleto del proyecto y cerrar la Fase 0.

**Hecho:**

*Estructura y repositorio*
- Creada la raíz `druse/` con el árbol del plan §4; movidos el plan, la bitácora y los mockups.
- Mockups renombrados: `druse-main.html` (referencia) y `druse-main-v0.html` (versión previa).
- `git init` en la rama `main`. `.gitignore` de .NET ampliado con Node, Angular, Tauri, artefactos de empaquetado y, sobre todo, bases SQLite, `.env` y `appsettings.Local.json` — nada de datos de usuario ni secretos en el repositorio.
- `.editorconfig` con convenciones de C#, TypeScript y SCSS, más reglas de nomenclatura y de diagnóstico alineadas con el plan.

*Backend*
- Solución con los 13 proyectos (10 en `src`, 3 en `tests`), todos en `Druse.slnx`.
- Grafo de referencias del plan §10 aplicado y verificado.
- `Directory.Build.props` con `net10.0`, `Nullable`, `TreatWarningsAsErrors` y `AnalysisLevel=latest-recommended`.
- `GET /api/health` implementado. Kestrel con `ListenLocalhost`: **verificado con `Get-NetTCPConnection` que solo escucha en `127.0.0.1` y `::1`**, nunca en `0.0.0.0`.
- 4 pruebas de arquitectura que leen los `.csproj` y hacen fallar la compilación si se rompe la dirección de dependencias, si el núcleo toca un driver o si un proveedor referencia a otro.
- 3 pruebas de integración de `/api/health`, incluida una que comprueba que la respuesta no filtra credenciales.

*Frontend*
- Angular 22.1.0 generado, zoneless y con Signals; encaja con la decisión del plan de no usar NgRx.
- Estructura de carpetas `core / shared / layout / features/*`.
- **Design tokens** en `src/styles/_tokens.scss` con toda la paleta, tipografías y medidas del mockup (§7).
- `ApplicationGateway` abstracto + `HttpApplicationGateway`, registrados en un único punto de `app.config.ts`. Ningún componente conoce host, puerto ni `HttpClient`.
- Proxy de desarrollo `/api` → `127.0.0.1:5177`.
- Pantalla provisional que verifica la conexión con la API, con 4 pruebas.

*Documentación e integración continua*
- `README.md` con requisitos, comando único y estructura.
- Tres ADR: arquitectura hexagonal, transporte local en loopback y estrategia multiplataforma.
- `build/scripts/dev.ps1` y `dev.sh`: **un solo comando** arranca API y frontend, espera a que la API responda y la detiene al salir.
- `.github/workflows/ci.yml` con matriz Windows/Linux/macOS para backend y frontend, más un job que publica la API autocontenida por Runtime Identifier.

**Verificado de verdad, no asumido:**
- `dotnet build` — 0 advertencias, 0 errores.
- `dotnet test` — 7 pruebas, todas pasan.
- `npm run build` — 220 kB iniciales.
- `npm test` — 4 pruebas, todas pasan.
- `GET /api/health` con la API real levantada → `200 OK`.
- Binding de red comprobado con `Get-NetTCPConnection`.
- `dotnet publish -r win-x64 --self-contained` → ejecutable de 107 MB generado correctamente.

**Incidencias resueltas:**
1. **Vulnerabilidad en la plantilla.** La plantilla `webapi` de .NET 10 arrastra `Microsoft.OpenApi` 2.0.0, con CVE-2026-49451 (GHSA-v5pm-xwqc-g5wc, CVSS 7.5, desbordamiento de pila con referencias circulares de esquema). `TreatWarningsAsErrors` lo convirtió en error de compilación. Elevado a 2.7.5 con una referencia directa comentada en el `.csproj`. **Revisar en futuras actualizaciones del SDK si ya viene elevada.**
2. **`.slnx` en vez de `.sln`.** .NET 10 genera el formato nuevo. Se mantiene; el plan quedó actualizado.
3. **CA1707 contra los nombres de prueba.** Los analizadores prohibían los guiones bajos de `Metodo_Escenario`. Desactivada solo para `tests/` mediante un `Directory.Build.props` propio.

*Cierre*
- `.gitattributes` que normaliza a LF. Sin él, `core.autocrlf` de Windows convertía todo a CRLF y `dev.sh` habría dejado de funcionar en Linux: `#!/usr/bin/env bash\r` no es un intérprete válido. Los `.ps1` y `.cmd` quedan forzados a CRLF.
- Commit inicial `4ba1319`: 71 archivos, 4861 inserciones. Sin remoto configurado.

**No hecho:**
- `Druse.ProviderContractTests` está vacío a propósito: se llena en las Fases 2 y 4.
- Sin trimming ni ReadyToRun en la publicación (107 MB). Optimizar en la Fase 7.

**Archivos creados/modificados:** 70 archivos versionables. Los principales:
- `README.md`, `.editorconfig`, `.gitignore`, `.github/workflows/ci.yml`
- `backend/Directory.Build.props`, `backend/tests/Directory.Build.props`
- `backend/src/Druse.Host.LocalApi/Program.cs`
- `backend/tests/Druse.UnitTests/ArchitectureRulesTests.cs`
- `backend/tests/Druse.IntegrationTests/HealthEndpointTests.cs`
- `frontend/src/styles/_tokens.scss`, `frontend/src/styles.scss`
- `frontend/src/app/core/application-gateway/*`, `app.ts`, `app.html`, `app.scss`, `app.config.ts`, `app.spec.ts`
- `frontend/proxy.conf.json`, `frontend/angular.json`
- `build/scripts/dev.ps1`, `build/scripts/dev.sh`
- `docs/decisions/0001…0003`

---

### Sesión 001 — 2026-08-11 · Arranque

**Hecho:**
- Analizado el plan completo y los dos mockups; confirmado el de referencia.
- Extraídas paleta, tipografías y medidas del mockup (§7).
- Verificado el toolchain instalado.
- **Cambio de nombre:** «Quarzo Studio» → **Druse**, con verificación previa de colisiones. Se descartó Geode por Apache Geode.
- Renombradas las 40 referencias del plan y el archivo a `PLAN_TRABAJO_DRUSE.md`.
- Creada esta bitácora.

**Notas:** el cambio de nombre se hizo antes de generar código, así que no hubo que tocar namespaces ni `.csproj`.

---

## 6. Decisiones

### Tomadas

| ID | Decisión | Resuelto |
| --- | --- | --- |
| D-01 | **Raíz del repositorio: `druse/`** dentro de `P:\Proyectos\Trabajo\DB STUDIO`. La carpeta contenedora conserva su nombre; el repositorio lleva el del producto. | 2026-08-11 |
| D-02 | **Mockup de referencia: `docs/mockups/druse-main.html`** (antes `Quarzo Studio.dc .html`). Incluye el diálogo «Nueva conexión»; el otro queda como `druse-main-v0.html`. El diseño se mantiene tal cual. | 2026-08-11 |
| D-03 | **El mockup HTML es la fuente de verdad**, no un PNG. Los tokens ya se extrajeron a SCSS; la comparación visual se hará por captura. | 2026-08-11 |
| D-04 | **Angular 22.1.0**, zoneless, con Signals y Vitest. Sin NgRx hasta que haya necesidad comprobada. | 2026-08-11 |
| D-05 | **Nombre del producto: Druse**, sin sufijo. Ver §3. | 2026-08-11 |
| D-07 | **Fuentes empaquetadas con `@fontsource`**, no enlazadas desde Google Fonts. La aplicación funciona sin conexión. Inter y JetBrains Mono son de licencia abierta (SIL OFL). | 2026-08-11 |
| D-09 | **Formato de solución `.slnx`**, el nuevo de .NET 10. Requiere VS 2022 17.13+ o Rider recientes. | 2026-08-11 |
| D-12 | **Monaco se carga con su cargador AMD desde `assets`**, no como ESM a través del bundler. Sus *web workers* se resuelven solos y queda fuera del bundle inicial. Encapsulado por completo en `SqlEditor`. | 2026-08-11 |
| D-13 | **`dompurify` fijado con `override` a ^3.4.13** en lugar de degradar Monaco. Revisar cuando Monaco actualice su dependencia. | 2026-08-11 |
| D-17 | **Sin almacén seguro no se guarda la contraseña.** Se pide en cada conexión y se dice en la interfaz. Cifrar un archivo con una clave del mismo disco sería seguridad aparente. Ver ADR 0004. | 2026-08-11 |
| D-18 | **Token obligatorio en la API local**, salvo `/api/health`. El proxy de desarrollo lo lee del disco y lo inyecta, porque el navegador no puede. | 2026-08-11 |
| D-08 | **Cuadrícula propia, sin biblioteca externa.** Con el límite de 500 filas la rejilla CSS va sobrada, y exportar —que es donde aparecen los volúmenes grandes— no pasa por ella. Revisar solo si algún día se sube ese tope. | 2026-08-12 |
| D-16 | **Sin paginación.** Exportar cubre el caso de «quiero todo», y para acotar está el `WHERE` de la consulta. Paginar obligaría a reescribir el SQL del usuario con `OFFSET` o a mantener un cursor abierto, y ninguna de las dos cosas compensa. | 2026-08-12 |
| D-19 | **`proxy.conf.json` → `proxy.conf.js`**: el proxy necesita lógica para leer el token en cada petición. No se cachea, para que reiniciar la API no obligue a reiniciar el servidor de desarrollo. | 2026-08-11 |
| D-10 | **La integración continua no genera instaladores todavía.** Compila, prueba y verifica la publicación autocontenida. El empaquetado llega en la Fase 7 (ADR 0003). | 2026-08-11 |
| D-20 | **En MySQL el árbol conserva el nivel de esquema**, con un nodo del mismo nombre que su base. `SCHEMA` es allí un sinónimo de `DATABASE`, así que el nivel es redundante; aun así se mantiene para que el explorador se comporte igual en los tres motores. La alternativa sería un árbol distinto solo para MySQL, y eso obligaría a ramificar por motor en la interfaz (plan §13). | 2026-08-12 |
| D-21 | **El tiempo de espera de MySQL lo controla el proveedor, no `CommandTimeout`.** El driver corta con `KILL QUERY` y hay instrucciones que al ser interrumpidas terminan «bien»: la consulta caducada se anunciaba como completada. Con un token propio se distingue el reloj del usuario. | 2026-08-12 |
| D-22 | **Cuatro opciones fijadas en la cadena de conexión de MySQL**: `ConvertZeroDateTime`, `GuidFormat=None`, `TreatTinyAsBoolean` y `AllowUserVariables`. Las tres primeras existen porque Druse muestra datos de bases ajenas y no puede reventar ante un `0000-00-00` o un `CHAR(36)` que no sea un GUID; la cuarta, porque un cliente SQL tiene que poder ejecutar `SET @x = …`. | 2026-08-12 |
| D-24 | **Sin CSS crítico incrustado en producción** (`inlineCritical: false`). Angular lo activa con un manejador `onload` en línea, y la CSP de Tauri prohíbe los manejadores en línea: la hoja de estilos no llegaba a aplicarse dentro del ejecutable. Se pierde una micro-optimización del primer pintado; se gana que la aplicación se vea. Relajar la CSP para permitirlo habría sido cambiar una protección real por una décima de segundo. | 2026-08-12 |
| D-27 | **El puente con Tauri se expone como `window.__TAURI__` (`withGlobalTauri`), y la política de CORS admite los orígenes de la ventana empaquetada.** El frontend descubre el puerto y el token de su API por ese puente; sin él las peticiones se iban al servidor de recursos y volvían con el `index.html`. La alternativa —importar `@tauri-apps/api` como paquete— obligaría a que el mismo bundle sirva para navegador y para escritorio con dos caminos distintos. Los orígenes admitidos siguen siendo una lista cerrada: los dos del desarrollo y los dos de Tauri. | 2026-08-12 |
| D-25 | **La ventana se encoge al área de trabajo del monitor al arrancar.** El tamaño de `tauri.conf.json` está en puntos y se multiplica por el escalado del sistema: 1440×900 son 1800×1125 px al 125 %, y en una pantalla de 1080 no cabían. Se ajusta en tiempo de ejecución en vez de bajar el tamaño por omisión, para no castigar a las pantallas grandes por lo que le pasa a las pequeñas. | 2026-08-12 |
| D-26 | **La API se lanza con `CREATE_NO_WINDOW`.** Es una aplicación de consola y Windows le abría su terminal con los registros de ASP.NET delante de Druse. El precio es que esos registros dejan de verse en el paquete; recogerlos en un archivo queda para cuando haga falta diagnosticar en campo. | 2026-08-12 |
| D-23 | **La primera beta es la `0.1.0`, sin sufijo de prerrelease.** Un `0.x` ya dice que es una beta, y los instaladores MSI de Windows exigen una versión de tres partes numéricas: añadir `-beta.1` sería arriesgar el empaquetado para repetir algo que el número ya comunica. Lo que sí se declara por escrito son sus límites, en `docs/release-notes/0.1.0-beta.md`. | 2026-08-12 |

| D-28 | **Dos temas, un solo juego de nombres.** El claro no es el oscuro invertido: sobre blanco, el acento `#6c8bff` del mockup no alcanza el contraste de un texto, así que en claro ese papel lo hace un azul más profundo, y los rellenos de estado suben de opacidad mientras los colores bajan de luminosidad. Lo que sí es idéntico son los **nombres**: los dos bloques de `_tokens.scss` declaran exactamente los mismos tokens, porque uno que solo exista en un tema se resuelve a nada en el otro y deja un hueco imposible de encontrar salvo mirando la pantalla. | 2026-08-17 |
| D-29 | **El tema se guarda en preferencias, con copia en `localStorage`.** La fuente es la base local, como el resto de ajustes, para que acompañe al usuario. La copia existe solo por el arranque: la preferencia llega por HTTP y para entonces la ventana ya se ha pintado una vez. La CSP prohíbe los scripts en línea (D-24), así que el atributo `data-theme` se escribe en `main.ts`, antes de arrancar Angular. | 2026-08-17 |
| D-30 | **El marco de la ventana lo tiñe el envoltorio, a petición de la interfaz.** La barra de título la dibuja el sistema y no lee CSS: sin el comando `set_window_theme`, el tema claro dejaba la cabecera negra. La preferencia sigue viviendo donde vive el resto —el envoltorio no habla con la base local—, así que es la interfaz quien se lo pide en cada cambio. | 2026-08-17 |

| D-31 | **El decorado se escribe en `hsl()` colgando de un matiz, y el acento en componentes sueltos de `rgb()`.** Así, teñir la aplicación entera es escribir dos números y elegir otro acento es escribir cuatro: los ochenta tokens que se derivan no se tocan. La conversión se hizo con una comprobación de que ningún color cambiaba. Los estados y los motores quedan fuera del tinte a propósito: un rojo de error tiene que seguir siendo rojo aunque la interfaz sea verde. | 2026-08-17 |
| D-32 | **La personalización solo mueve matiz y saturación, nunca luminosidad.** La jerarquía de superficies —qué está encima de qué— está construida sobre las luminosidades, y dejar tocarlas convertiría el ajuste en una forma de romper la interfaz. Por lo mismo, el texto que va sobre el acento se decide midiendo contraste y no eligiéndolo: un acento ámbar con letras blancas es ilegible, y el ámbar es de los colores que la gente elige. | 2026-08-17 |
| D-33 | **La imagen de fondo del editor no viaja a las preferencias.** Son texto en una base que se lee entera en cada arranque; unos megabytes en base64 harían lento algo que hoy es instantáneo. Se copia a la carpeta de datos de la aplicación y el envoltorio la devuelve ya leída como `data:`, lo que además evita abrir el protocolo de recursos en la CSP solo para ahorrarse una lectura por arranque. El editor la enseña con el fondo de Monaco transparente y la imagen en una capa propia, para que la opacidad no la herede el código. | 2026-08-17 |
| D-34 | **Una preferencia ausente no es una preferencia vacía.** Ausente significa que el servidor no sabe nada de ese ajuste y manda lo que ya había; vacía, que el usuario lo quitó. Sin esa distinción, arrancar contra un servidor que todavía no ha guardado nada borraba lo que se acabara de elegir. Se detectó probando en el navegador: los colores se perdían al recargar. | 2026-08-17 |
| D-35 | **El tamaño de la interfaz se aplica con `zoom` sobre el documento, no repartido por los tamaños de letra.** Las barras tienen alturas fijas sacadas del mockup, y agrandar solo el texto termina recortándolo dentro de barras que no crecen. Con la escala, la ventana se ve como si la pantalla tuviera otra densidad. El editor lleva aparte su propio cuerpo de letra, que es el ajuste que se pide con otra intención. | 2026-08-17 |

### Abiertas

| ID | Decisión | Opciones | Estado |
| --- | --- | --- | --- |
| D-15 | Selector de base de datos | PostgreSQL no permite cambiar de base sin reconectar, así que el explorador solo muestra los esquemas de la base de la sesión. Falta decidir si abrir una sesión nueva por base o pedirle al usuario que cree otra conexión. | Abierta — Fase 4, al comparar con SQL Server |
| D-11 | Optimización del ejecutable | La publicación autocontenida pesa 107 MB. Evaluar trimming y ReadyToRun. | Abierta — Fase 7 |
| D-14 | Estado del shell | Hoy vive en Signals dentro de `AppShell`. Al llegar los datos reales hay que decidir si se reparte en servicios por funcionalidad. Sigue en pie no incorporar NgRx sin necesidad comprobada. | Abierta — Fase 2 |

_D-06 (wordmark) quedó resuelta al construir el shell: la barra superior dice «Druse». El HTML del mockup no se retocó._

---

## 7. Referencia extraída del mockup

Fuente: `docs/mockups/druse-main.html`. **Ya implementado** en `frontend/src/styles/_tokens.scss`; esta tabla queda como referencia legible.

### Paleta

| Rol | Token | Hex |
| --- | --- | --- |
| Fondo exterior / ventana | `--dr-surface-outer` | `#07080B` |
| Fondo principal (editor, main) | `--dr-surface-base` | `#0B0D11` |
| Superficie de paneles | `--dr-surface-panel` | `#0E1219` |
| Top bar | `--dr-surface-topbar` | `#101420` |
| Barra de estado | `--dr-surface-statusbar` | `#0C1018` |
| Encabezado de cuadrícula | `--dr-surface-grid-header` | `#121824` |
| Superficie elevada / botón | `--dr-surface-raised` | `#1B2233` |
| Borde principal | `--dr-border` | `#1E2534` |
| Borde secundario | `--dr-border-subtle` | `#232A38` |
| Acento primario | `--dr-accent` | `#6C8BFF` |
| Acento claro (hover/iconos) | `--dr-accent-bright` | `#9FB0FF` |
| Acento secundario (violeta) | `--dr-accent-alt` | `#9A7CFF` |
| Éxito / conectado | `--dr-success` | `#3DDC97` |
| Texto principal | `--dr-text` | `#E4E8F1` |
| Texto secundario | `--dr-text-secondary` | `#C9D3E6` |
| Texto atenuado | `--dr-text-muted` | `#B9C2D4` |
| Texto terciario | `--dr-text-tertiary` | `#8B96AB` |
| Texto tenue | `--dr-text-faint` | `#66728A` |

### Tipografías

- UI: **Inter** (400, 500, 600, 700), tamaño base 13px.
- Código / SQL: **JetBrains Mono** (400, 500, 700).
- Ver D-07: hay que empaquetarlas, no enlazarlas.

### Medidas del layout (lienzo 1440×900)

| Zona | Token | Medida |
| --- | --- | --- |
| Top bar | `--dr-topbar-height` | 46px |
| Sidebar de conexiones | `--dr-sidebar-width` | 274px (redimensionable) |
| Encabezado de sidebar | `--dr-sidebar-header-height` | 38px |
| Barra de pestañas | `--dr-tabs-height` | 36px |
| Toolbar del editor | `--dr-editor-toolbar-height` | 42px |
| Canaleta de números de línea | `--dr-editor-gutter-width` | 44px |
| Panel de resultados | `--dr-results-height` | 322px (redimensionable) |
| Encabezado de resultados | `--dr-results-header-height` | 36px |
| Encabezado de la cuadrícula | `--dr-grid-header-height` | 31px |
| Barra de estado | `--dr-statusbar-height` | 26px |
| Radio de la ventana | `--dr-radius-window` | 10px |

---

## 8. Seguimiento por fases

| Fase | Descripción | Estado |
| --- | --- | --- |
| 0 | Preparación y decisiones | ✅ **Cerrada** — 9/9 |
| 1 | Shell visual basado en el mockup | ✅ **Cerrada** — 8/8 |
| 2 | Flujo vertical PostgreSQL | ✅ **Cerrada** — 11/11 |
| 3 | Persistencia local y seguridad | ✅ **Cerrada** — 10/10 |
| 4 | SQL Server | ✅ **Cerrada** — 9/9 |
| 5 | Productividad del editor | ✅ **Cerrada** — 10/10 |
| 6 | Resultados y exportaciones | ✅ **Cerrada** — 9/9 |
| 7 | Empaquetado de escritorio | 🟡 **11/12** — solo falta el equipo limpio |
| 8 | MySQL y estabilización | ✅ **Cerrada** — 7/7 |

### Fase 0 — criterio de salida ✅

> «La solución compila, Angular inicia, la API responde en `/api/health` y existe un único comando documentado para ejecutar ambos proyectos en desarrollo.»

Los cuatro puntos están verificados con ejecución real, no por inspección.

### Fase 1 — criterio de salida ✅

> «La pantalla reproduce el mockup con proporciones, colores y comportamiento de paneles consistente, todavía sin conexión real.»

Proporciones y colores salen de los tokens extraídos del propio mockup, y los dos paneles se redimensionan con ratón y con teclado. **Pendiente el visto bueno a ojo**: la comparación por captura no se pudo hacer.

### Fase 2 — criterio de salida ✅

> «Un usuario puede conectarse a PostgreSQL, navegar hasta una tabla, ejecutar un `SELECT`, ver el resultado y cancelar una consulta larga.»

Los cinco pasos están verificados contra PostgreSQL 18.4 real, no simulado.

### Fase 3 — criterio de salida ✅

> «Cerrar y abrir la aplicación conserva conexiones, historial y preferencias sin almacenar contraseñas legibles.»

Verificado reiniciando la API de verdad: el perfil sobrevivió, abrió sesión sin reenviar la contraseña, y **una búsqueda byte a byte en todos los archivos locales no encontró la contraseña por ninguna parte**.

### Fases 4 a 6 — criterios de salida ✅

Cerradas en las sesiones 007, 008 y 009. El detalle está en cada entrada de §5.

### Fase 7 — criterio de salida 🟡

> «Druse se instala y ejecuta en Windows sin que el usuario tenga que instalar Node.js, Angular CLI o el SDK de .NET.»

El ciclo completo —instalar, actualizar y desinstalar— está probado sobre este
equipo en la sesión 021, y de paso descubrió que la API auxiliar sobrevivía a un
cierre forzado. **Falta lo que exige otro equipo**: arrancar en una máquina sin
herramientas de desarrollo, que es el criterio que demuestra que el paquete se
basta solo.

### Fase 8 — criterio de salida ✅

> «Los tres motores superan el mismo contrato sin excepciones y existe una versión instalable con sus notas y sus límites declarados.»

72 pruebas contractuales en verde —24 idénticas por motor—, MariaDB comprobado con el mismo proveedor, y `docs/release-notes/0.1.0-beta.md` escrito, incluidos los límites que la beta **no** garantiza.

---

## 9. Riesgos y notas técnicas abiertas

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| **El actualizador no puede funcionar: el repositorio es privado** | La función entera queda muerta en todos los equipos, y falla de la peor forma: GitHub devuelve **404** a quien no está autenticado, que no se distingue de «no hay versión nueva» | El endpoint es `releases/latest/download/latest.json`. Hacer público el repositorio, o publicar los artefactos y el `latest.json` en otro sitio accesible. **Ninguna prueba lo ve**: la que hay comprueba que el endpoint sea `https`, y lo es |
| **Informix por SQLI no puede cancelar una consulta** | Quien lanza una consulta larga no la para: la aplicación responde, pero el motor sigue trabajando y esa conexión queda ocupada | No hay arreglo: comprobado que `cancel()`, `setQueryTimeout` y cerrar la conexión tardan lo mismo que la consulta. Se eligió soltar la espera (038). **Por DRDA sí se cancela**, así que es una razón para preferirlo donde haya escuchador |
| **El peso de IKVM y la licencia del driver** | `IKVM.Java.dll` son ~62 MB por plataforma sobre un paquete que ya iba por 93 MB | Medir con un publish recortado antes de prometer una cifra. Y el jar va bajo el *IBM Informix JDBC Software License Agreement*: **para repartir el instalador hay que leer esos términos**, como se hizo con el `odbc_REDIST.txt` del clidriver |
| **Compilar en paralelo rompe IKVM** | `dotnet build` sin `-m:1` falla con `os error 32` sobre el log del jar cuando dos proyectos lo traducen a la vez | Compilar la solución con `-m:1`. Pasó varias veces en la 038 y el error no dice de qué va |
| **Lo que solo falla empaquetado no lo ve nadie** | La ventana abrió sin un solo estilo durante quién sabe cuántas sesiones, y el puente con el proceso Rust llevaba igual de tiempo cortado. Ninguna prueba lo veía: en el navegador todo funciona | Al tocar la CSP, el `index.html` o cualquier `invoke`, **abrir el ejecutable y mirar la consola**. Hacen falta **tres** variables, no una (040): `DRUSE_DATA_DIR` para no tocar el espacio del usuario, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` y **`WEBVIEW2_USER_DATA_FOLDER` propio** —sin él WebView2 reutiliza el navegador de la instancia ya abierta, que arrancó sin depuración, y el puerto no llega a abrirse—. El target de CDP se llama `about:blank` pero su URL es `http://tauri.localhost/`. Las dos pruebas de `tauri.conf.json` sujetan lo ya conocido, no lo próximo |
| **El `.exe` se queda tomado y el empaquetado falla** | `os error 32` al parchear el binario para NSIS, con la compilación entera ya hecha | Cerrar todo `druse.exe` antes de empaquetar y no dejar un `cargo build` reciente sujetando el directorio. Relanzar basta; no hay nada que arreglar |
| **El frontend tiene más de un rojo por tiempo** | Se confunden con fallos del producto y se pierde media tarde | Antes de creerse un rojo del frontend, repetir la suite. En la 037 hubo dos, distintos, y los dos verdes a la segunda. En la **047**, cuatro en dos pasadas —`table-designer`, `results-grid`, `app-shell` y `query-builder`, ninguno repetido— y **los cuatro verdes al ejecutar su archivo solo**. Lanzar `tsc` o el barrido en paralelo lo dispara: la suite entera tarda 30 s sola y 46 s acompañada |
| **El MVP no se ha probado en un equipo limpio** | Es el criterio que demuestra que el paquete se basta solo | Instalar el NSIS en una máquina sin .NET ni Node. **Es lo único que queda del MVP** |
| macOS pasa la contraseña por argumento a `security` | Visible un instante en la lista de procesos | Enlazar Security.framework. Anotado en ADR 0004 |
| Contenedor `druse-pg-test` en el 55440 | El 55432 lo ocupa `prima-postgres`, ajeno al proyecto | Puerto configurable con `DRUSE_TEST_PG_PORT` |
| **Un motor recién creado da rojos que no son del código** | Se confunden con fallos del producto, y encima aparecen justo cuando se está validando algo | Pasó en la 037: la pasada lanzada trece segundos después de crear el contenedor de MySQL dio tres rojos —la segunda base y las dos de restaurar—, todos verdes al repetir. **Dar unos minutos al motor recién creado antes de fiarse de una pasada**, y repetir antes de investigar |
| **Los servidores del e2e sobreviven a la sesión** | Se dan por rojos del código fallos que son de un binario de ayer. Pasó en la 047: cuatro pruebas del editor no encontraban la base en el árbol **justo después de tocar el explorador**, que es lo peor que puede pasar | `reuseExistingServer` reutiliza lo que encuentre en el 4300 y el 5188, y la API de `dotnet run` **no recompila**. Antes de creerse un rojo del e2e, mirar de cuándo son esos dos procesos; pararlos y vaciar `%TEMP%\druse-e2e-datos` devolvió las 52 a verde |
| **Los contenedores de prueba desaparecen** | Con ellos se va lo sembrado, y las pruebas que lo necesitan pasan a comprobar otra cosa | Pasó entre la 023 y la 024, y otra vez antes de la 037: Informix y MySQL **ya no existían** y hubo que crearlos de cero. Antes de fiarse de una pasada, comprobar que están **y que tienen datos**. Los cuatro quedaron levantados al cerrar la 037 |
| Ejecutable de 107 MB | Instalador pesado | D-11: trimming y ReadyToRun. Sigue abierta |
| Dependencias con vulnerabilidades en plantillas | Ya pasó dos veces: `Microsoft.OpenApi` y `dompurify` | En backend lo caza `TreatWarningsAsErrors`; en frontend, `npm audit` en cada instalación |
| 3 vulnerabilidades moderadas en `@angular/cli` | Solo desarrollo; no llegan al bundle | Esperar actualización de Angular. Degradar a la 21 sería peor |
| Detalles visuales fuera del shell principal | La comparación de la sesión 011 cubrió la pantalla principal, no todos los estados | Repetir la comparación al tocar diálogos, filtros o vistas menos transitadas |
| `formatSql` falla a veces en las pruebas del frontend | Un rojo que no es del código: pasa al repetir | Se creía que solo pasaba con `ng serve` en paralelo. **En la 037 saltó sin el servidor levantado**, así que la explicación no era completa: es una prueba que se va por tiempo cuando la máquina está cargada. Repetir antes de investigarla |
| **El disco de este equipo se llena empaquetando** | `release.ps1` falló a mitad con «espacio en disco insuficiente» y dejó el backend sin compilar. La unidad P: son 30 GB y el proyecto ocupaba 15,4 | En la 040 se liberaron 14,6 GB con `cargo clean` y borrando `bin`/`obj`. Cada empaquetado deja ~2 GB de intermedios: **mirar el espacio antes de empaquetar**, y `cargo clean` recupera casi 10 GB cuando aprieta |
| **Una variable `Platform=x64` del entorno rompe `dotnet build`** | Falla con `MSB4126: Debug|x64 no es válida` antes de compilar nada, y el mensaje no menciona la variable | No está en el entorno de usuario ni de máquina, así que viene de la sesión que lanza el proceso. Anularla (`$env:Platform=$null`) y compilar |
| Identificador `druse` no reservado | Podría ocuparlo otro | Reservar dominio, org de GitHub y NuGet/npm cuando haya algo publicable |

_Retirado en la 037: «el selector nativo de carpeta no se ha podido probar porque aquí no compila Rust» —las dos mitades eran falsas: Rust compila con `msvc-env.ps1`, y el diálogo no funcionaba porque la CSP bloqueaba el IPC. Lo que queda no es un riesgo, es una comprobación pendiente._

_Retirados antes: «un traslado se queda en marcha de vez en cuando» (era el aviso final que se perdía en el registro del progreso; arreglado en la sesión 023g), «sin SQL Server de prueba» y «solo hay un proveedor» (Fase 4), «Rust no instalado» (Fase 7), «los datos simulados podrían filtrarse» (borrados en la Fase 2) y «fidelidad visual no comprobada» (comprobada en la sesión 011)._

---

## 10. Convención para actualizar esta bitácora

Al cerrar cada sesión:

1. Agregar una entrada nueva en §5, arriba de las anteriores (**Hecho**, **Verificado**, **No hecho**, **Archivos**).
2. Actualizar la tabla de §1 y el «Qué toca retomar».
3. Mover a **Decisiones tomadas** lo que se haya resuelto en §6.
4. Actualizar los checkboxes de §8 y del plan maestro.
5. Registrar cualquier riesgo nuevo en §9.
