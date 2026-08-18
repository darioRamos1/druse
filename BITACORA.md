# Bitácora de seguimiento — Druse

> Documento vivo. Se actualiza **al final de cada sesión de trabajo**.
> El plan maestro (alcance, arquitectura, fases) vive en `PLAN_TRABAJO_DRUSE.md`.
> Esta bitácora responde solo a tres preguntas: **qué se hizo**, **en qué estado quedó** y **qué toca retomar**.

---

## 1. Estado actual

| Campo | Valor |
| --- | --- |
| Última sesión | **022g** — 2026-08-17 |
| Fase activa | **Respaldos y restauración:** Fases A, B, C y **D cerradas y probadas contra PostgreSQL real**: el caso del §1 se resuelve desde la interfaz y el artefacto se aplica en una base vacía. La siguiente es la **E, perfiles** |
| Fases 0–6 | ✅ Cerradas. |
| Fase 7 | 🟡 **11/12.** El ciclo de instalación está probado sobre este equipo; solo falta arrancar en una máquina sin herramientas de desarrollo. |
| Fase 8 | ✅ **7/7.** Tres motores sobre el mismo contrato y primera beta preparada. |
| ¿Compila el backend? | Sí — 0 advertencias, 0 errores |
| ¿Compila el envoltorio? | Sí |
| ¿Pasan las pruebas? | Sí — **532 en backend** (295 unitarias, 158 contractuales y 79 de integración), **398 en frontend** y **6 en el envoltorio**. Con `DRUSE_REQUIRE_ENGINES=1` y **los cuatro motores**, sin saltarse ninguna |
| ¿Hay aplicación de escritorio? | **Sí.** Instalador NSIS, MSI y ZIP portable, en dos variantes: con Informix y sin él |
| Motores | **PostgreSQL, SQL Server, MySQL/MariaDB e Informix**, todos sobre el mismo contrato compartido |
| Trabajo a medias | Ninguno. Las transacciones manuales quedaron terminadas en la sesión 020. |
| Bloqueantes | Ninguno para seguir programando. Sí para dar por buenos cuatro motores y cuatro funciones: ver «Qué toca retomar». |
| Git | El **PR #9 se fusionó** (sesión 022), con los quince commits que el #8 dejó fuera más lo de la personalización. Se trabaja en `feat/respaldos-y-restauracion`, salida de un `main` ya al día. |
| Integración continua | 🔴 **Parada, y no por el código.** GitHub aborta los catorce jobs en dos segundos: «recent account payments have failed or your spending limit needs to be increased». Hasta resolver la facturación, ningún PR podrá pasar los checks. |

### Qué toca retomar en la próxima sesión

**Lo primero: la Fase E, perfiles guardados** (`backup_profiles` en SQLite, con
la reconciliación de un perfil cuyas tablas ya no existen). La D quedó cerrada y
**probada contra PostgreSQL de verdad** en la sesión 022g.

**El escenario de pruebas ya está sembrado, no hay que rehacerlo.** En
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
carpeta**: es Rust y en este equipo cargo no compila. Fuera del envoltorio la
ruta se escribe a mano y el respaldo funciona igual, así que no bloquea nada,
pero nadie ha visto abrirse ese diálogo.

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
2. **DDL contra los cuatro motores.** El ciclo de índices y restricciones —crear,
   releer del catálogo, borrar y comprobar que desaparece— ya se ejecuta contra
   PostgreSQL, SQL Server y MySQL, y en la sesión 021 destapó tres fallos reales.
   Queda el resto del diseñador a mano: renombrar columnas, cambiar tipos,
   claves foráneas y clave primaria. Ojo a MySQL, que es el único donde un
   `ALTER` a medias no se deshace: si el `CREATE INDEX` que sigue a un
   `DROP INDEX` falla, la tabla se queda sin ese índice.
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
3. Lee «Qué toca retomar»: no queda nada a medias, y lo que falta es comprobar
   contra motores reales lo que se escribió a ciegas.
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
| **El MVP no se ha probado en un equipo limpio** | Es el criterio que demuestra que el paquete se basta solo | Instalar el NSIS en una máquina sin .NET ni Node. **Es lo único que queda del MVP** |
| macOS pasa la contraseña por argumento a `security` | Visible un instante en la lista de procesos | Enlazar Security.framework. Anotado en ADR 0004 |
| Contenedor `druse-pg-test` en el 55440 | El 55432 lo ocupa `prima-postgres`, ajeno al proyecto | Puerto configurable con `DRUSE_TEST_PG_PORT` |
| Ejecutable de 107 MB | Instalador pesado | D-11: trimming y ReadyToRun. Sigue abierta |
| Dependencias con vulnerabilidades en plantillas | Ya pasó dos veces: `Microsoft.OpenApi` y `dompurify` | En backend lo caza `TreatWarningsAsErrors`; en frontend, `npm audit` en cada instalación |
| 3 vulnerabilidades moderadas en `@angular/cli` | Solo desarrollo; no llegan al bundle | Esperar actualización de Angular. Degradar a la 21 sería peor |
| Detalles visuales fuera del shell principal | La comparación de la sesión 011 cubrió la pantalla principal, no todos los estados | Repetir la comparación al tocar diálogos, filtros o vistas menos transitadas |
| Identificador `druse` no reservado | Podría ocuparlo otro | Reservar dominio, org de GitHub y NuGet/npm cuando haya algo publicable |

_Retirados: «sin SQL Server de prueba» y «solo hay un proveedor» (Fase 4), «Rust no instalado» (Fase 7), «los datos simulados podrían filtrarse» (borrados en la Fase 2) y «fidelidad visual no comprobada» (comprobada en la sesión 011)._

---

## 10. Convención para actualizar esta bitácora

Al cerrar cada sesión:

1. Agregar una entrada nueva en §5, arriba de las anteriores (**Hecho**, **Verificado**, **No hecho**, **Archivos**).
2. Actualizar la tabla de §1 y el «Qué toca retomar».
3. Mover a **Decisiones tomadas** lo que se haya resuelto en §6.
4. Actualizar los checkboxes de §8 y del plan maestro.
5. Registrar cualquier riesgo nuevo en §9.
