# Plan de mejoras y endurecimiento — Druse

> Plan operativo derivado del barrido técnico realizado el 5 de septiembre de
> 2026. Complementa `PLAN_TRABAJO_DRUSE.md`: aquel conserva la visión general del
> producto; este documento ordena el trabajo necesario para aumentar la
> fiabilidad de la versión 1.1.0 antes de seguir ampliando funciones.

## 1. Objetivo

Preparar Druse para una distribución confiable, con prioridad sobre:

- Integridad de respaldos, restauraciones y transferencias.
- Ejecución real y verificable de todas las pruebas en CI.
- Seguridad efectiva de conexiones y operaciones destructivas.
- Recuperación y diagnóstico de operaciones largas.
- Mantenibilidad del contrato HTTP y del estado del frontend.
- Accesibilidad y compatibilidad del producto empaquetado.

Este plan no propone una reescritura. Las mejoras deben ser pequeñas,
incrementales y protegidas por pruebas de regresión.

---

## 2. Estado de partida

Comprobado durante el barrido:

| Área | Resultado |
| --- | --- |
| Frontend | Compila; 785 de 785 pruebas pasan |
| Bundle inicial | 388,40 kB sin comprimir; 81,22 kB estimados transferidos |
| Typecheck E2E | Pasa |
| Backend unitario | 521 pasan y 11 se omiten al forzar `IsTestProject=true` |
| Backend integración | 82 pasan y 76 se omiten sin motores externos |
| Contratos con motores | Último registro: 266 de 267; falla una restauración `DATE` por Informix SQLI |
| Rust/Tauri | La bitácora registra 17 pruebas; no se repitieron por entorno MSVC local incompleto |
| Dependencias frontend | Una alerta alta y una moderada, ambas transitivas de herramientas de desarrollo |
| GitHub Actions | Bloqueado por facturación según `BITACORA.md` |
| Actualizador | Inoperante mientras los artefactos permanezcan en Releases privadas |

Problema de control detectado: con .NET SDK 10.0.400, el comando actual
`dotnet test backend/Druse.slnx` termina correctamente sin ejecutar pruebas porque
los tres proyectos de pruebas no declaran `IsTestProject`.

---

## 3. Prioridades

| Prioridad | Significado | Regla |
| --- | --- | --- |
| P0 | Bloquea una publicación confiable | Resolver antes de distribuir otra versión |
| P1 | Riesgo alto de pérdida de datos o seguridad | Resolver en el siguiente ciclo |
| P2 | Calidad, diagnóstico y mantenibilidad | Resolver después del endurecimiento funcional |
| P3 | Evolución y experiencia avanzada | Planificar sin bloquear las correcciones anteriores |

---

## 4. Orden de ejecución

```text
Fase 0: CI confiable
    |
    v
Fase 1: Fidelidad de respaldos y restauraciones
    |
    v
Fase 2: Ciclo de vida de operaciones largas
    |
    v
Fase 3: Seguridad efectiva
    |
    v
Fase 4: Observabilidad y límites de recursos
    |
    v
Fase 5: Contrato, frontend y accesibilidad
    |
    v
Fase 6: Distribución y compatibilidad
```

No comenzar una extracción grande de `WorkspaceStore` o `TransferService` antes
de cerrar las fases 0 y 1.

---

## 5. Fase 0 — Recuperar un CI confiable

**Prioridad:** P0  
**Esfuerzo estimado:** 1-2 días  
**Resultado esperado:** un check verde vuelve a significar que las pruebas se
ejecutaron de verdad.

### Tareas

- [x] **CI-001:** añadir `<IsTestProject>true</IsTestProject>` a los tres proyectos de pruebas.
- [x] **CI-002:** comprobar que `dotnet test backend/Druse.slnx` descubre y ejecuta las tres suites.
- [x] **CI-003:** ejecutar restauración, compilación y pruebas backend con `-m:1` para evitar la carrera conocida de IKVM.
- [x] **CI-004:** hacer que CI falle si se descubren cero pruebas o no aparece ningún resultado de test.
- [x] **CI-005:** publicar también el puerto 9088 del contenedor Informix para las pruebas SQLI.
- [x] **CI-006:** declarar `DRUSE_TEST_IFX_SQLI_PORT=9088` en el job de motores reales.
- [x] **CI-007:** añadir `npm run typecheck` al job E2E.
- [x] **CI-008:** añadir `cargo test --locked`, `cargo fmt --check` y `cargo clippy --locked -- -D warnings`.
- [x] **CI-009:** impedir que el workflow de release publique un SHA sin checks verdes.
- [ ] **CI-010:** resolver la facturación o límite de GitHub Actions.

> Estado al 7 de septiembre de 2026: CI-001 a CI-009 aplicados y comprobados en
> local. `dotnet test backend/Druse.slnx` pasó de ejecutar **cero** pruebas a
> ejecutar **870** repartidas en las tres suites (521 unitarias, 82 de
> integración y 267 contractuales). El envoltorio Rust pasa `cargo fmt --check`,
> `cargo clippy -- -D warnings` y sus 17 pruebas. Lo único que no se puede
> comprobar desde aquí es que el CI real las ejecute: eso depende de CI-010, que
> sigue abierta y es una gestión de facturación, no una tarea de código.

### Criterios de aceptación

- El resumen de CI muestra cantidades de pruebas ejecutadas, no solo compilación.
- Las unitarias backend, integración sin motores y frontend pasan en Windows,
  Linux y macOS.
- Las contractuales se ejecutan sobre PostgreSQL, SQL Server, MySQL, Informix
  DRDA e Informix SQLI.
- Un fallo intencional temporal en una prueba hace fallar el job correspondiente.
- El workflow de publicación no puede ejecutarse sobre un commit sin validar.

### Comandos de referencia

```powershell
dotnet restore backend/Druse.slnx -m:1
dotnet build backend/Druse.slnx --configuration Release --no-restore -m:1
dotnet test backend/Druse.slnx --configuration Release --no-build -m:1

Push-Location frontend
npm ci
npm run build
npm test -- --watch=false
Pop-Location

Push-Location e2e
npm ci
npm run typecheck
Pop-Location

. ./build/scripts/msvc-env.ps1
cargo test --manifest-path shells/desktop-tauri/Cargo.toml --locked
```

---

## 6. Fase 1 — Garantizar respaldos reversibles

**Prioridad:** P0  
**Esfuerzo estimado:** 4-7 días  
**Resultado esperado:** un respaldo completado puede restaurarse sin mezclar
ejecuciones, perder tablas ni cambiar valores.

### Tareas

- [x] **BKP-001:** impedir que un respaldo por carpetas reutilice silenciosamente un destino con contenido anterior.
- [x] **BKP-002:** escribir primero en un destino temporal y publicar el artefacto final de forma atómica cuando sea posible.
- [x] **BKP-003:** identificar archivos por motor, base, esquema y tabla, no solo por nombre de tabla.
- [x] **BKP-004:** definir una codificación reversible para diferenciar `NULL` de `""` en CSV.
- [x] **BKP-005:** versionar en el manifiesto el formato y las reglas de representación de datos.
- [ ] **BKP-006:** corregir el formateo de columnas `DATE` en Informix SQLI para no escribir una hora inexistente.
- [x] **BKP-007:** validar que `ResumeFrom` esté dentro del rango permitido.
- [x] **BKP-008:** conservar en manifiestos parciales el motor y resultado reales; no etiquetar todo como PostgreSQL cancelado.
- [x] **BKP-009:** distinguir fallo, cancelación y artefacto incompleto en interfaz y manifiesto.
- [x] **BKP-010:** advertir claramente si se intenta restaurar un formato antiguo que no conserva `NULL`.

> Estado al 7 de septiembre de 2026: el artefacto pasa a **formato 2**, que es el
> primero reversible. Cada entrada se nombra `esquema.tabla`; en los CSV el nulo
> va en blanco y la cadena vacía con sus dos comillas; el manifiesto de una
> carpeta a medias lleva el motor, el origen y el resultado reales; un `.sql` o
> un `.zip` se escriben como `.parcial` y solo reciben su nombre al estar
> enteros, de modo que un respaldo fallido ya no se lleva por delante el
> anterior; una carpeta que ya tiene un respaldo se rechaza salvo que se marque
> «sobrescribir», que borra el respaldo viejo y **solo** el respaldo viejo; y
> reanudar por encima de lo que trae el artefacto deja de terminar en verde sin
> aplicar nada.
>
> **BKP-002 queda a medias a propósito** en la salida por carpetas: ahí no hay un
> temporal que publicar de una vez, porque renombrar la carpeta elegida por el
> usuario tiene sus propios problemas. Lo que se hace es no mezclar.
>
> **BKP-006 sigue abierta**: reproducir el `DATE` de Informix por SQLI necesita
> el contenedor levantado, y en esta sesión no había Docker. Ojo con esto: las
> 267 contractuales salen en verde **sin motores delante**, porque cuando el
> servidor no responde cada prueba termina sin comprobar nada. `ElMotorEstabaDisponible`
> lo caza solo con `DRUSE_REQUIRE_ENGINES=1`, que es lo que pone el CI.

### Compatibilidad

Los respaldos son artefactos persistidos y potencialmente ya distribuidos. Antes
de cambiar el formato:

- Mantener lectura explícita de la versión anterior cuando sea segura.
- Rechazar con un mensaje claro los casos ambiguos, en vez de inventar valores.
- No reinterpretar automáticamente una cadena vacía como `NULL`.
- Documentar desde qué versión se garantiza una restauración reversible.

### Pruebas obligatorias

- Dos respaldos consecutivos hacia la misma carpeta.
- Dos tablas homónimas en esquemas diferentes.
- Tabla con `NULL`, cadena vacía, espacios, saltos de línea y texto igual al marcador de nulo.
- Round-trip completo de fecha, hora, fecha-hora y zona horaria por proveedor.
- Cancelación y fallo a mitad del respaldo.
- `ResumeFrom` negativo, igual al total y superior al total.
- ZIP y carpeta con el mismo conjunto lógico de entradas.
- Restauración de un artefacto legado.

### Criterios de aceptación

- Comparar origen y destino después de un round-trip no muestra diferencias de
  esquema ni datos.
- Ningún archivo se sobrescribe por una colisión de nombres lógica.
- Un artefacto parcial nunca se presenta como completo.
- La contractual de Informix SQLI queda en verde.

---

## 7. Fase 2 — Controlar operaciones largas y cierres

**Prioridad:** P1  
**Esfuerzo estimado:** 5-8 días  
**Resultado esperado:** cerrar o actualizar Druse no deja operaciones destructivas
sin control ni artefactos con apariencia válida.

### Primera entrega mínima

- [x] **JOB-001:** exponer a Tauri si existen backups, restauraciones o transferencias activas.
- [x] **JOB-002:** bloquear el cierre y la actualización mientras exista trabajo destructivo, igual que ya se hace con transacciones.
- [x] **JOB-003:** permitir cancelar, esperar la confirmación de cancelación y cerrar después.
- [x] **JOB-004:** eliminar el `kill()` inmediato del camino normal y reservarlo para timeout o proceso no responsivo.

### Segunda entrega durable

- [ ] **JOB-005:** sustituir los `Task.Run` de endpoints por una cola administrada y un `BackgroundService`.
- [ ] **JOB-006:** crear scopes de DI por trabajo y no conservar servicios del scope HTTP.
- [ ] **JOB-007:** persistir identificador, tipo, estado, progreso y resultado de cada trabajo en SQLite.
- [ ] **JOB-008:** marcar como interrumpido cualquier trabajo que estuviera activo al arrancar de nuevo.
- [ ] **JOB-009:** definir qué operaciones pueden reanudarse y cuáles deben reiniciarse desde cero.
- [x] **JOB-010:** corregir el progreso de transferencias atómicas para no contar como copiadas filas que acabaron en rollback.

> Estado al 7 de septiembre de 2026: **la primera entrega está cerrada y vista
> funcionando**. Cerrar Druse con un respaldo, una restauración o un traslado en
> marcha pregunta y nombra lo que se va a interrumpir; «Cancelarlo y cerrar»
> cancela, espera la confirmación de la API y solo entonces cierra; actualizar
> aplica la misma regla. La API deja de morir a la fuerza: se le pide el apagado
> por HTTP y matarla queda para cuando no responde o no acepta.
>
> De la segunda entrega solo está **JOB-010**, que no dependía del rediseño: un
> traslado «todo o nada» que falla informaba las filas que el motor acababa de
> deshacer. **JOB-005 a JOB-009 siguen abiertas** y son otra cosa: cola
> administrada, `BackgroundService`, scopes de DI por trabajo y estado en SQLite.
> Con eso llega el criterio que falta —«reiniciar Druse permite conocer que un
> trabajo anterior fue interrumpido»—, y también la decisión de qué se reanuda y
> qué se reinicia desde cero.

### Criterios de aceptación

- Cerrar durante un respaldo muestra una decisión explícita y no mata la API inmediatamente.
- Reiniciar Druse permite conocer que un trabajo anterior fue interrumpido.
- Una transferencia atómica fallida informa cero filas confirmadas.
- Ningún archivo temporal se confunde con un respaldo final.

---

## 8. Fase 3 — Endurecer seguridad

**Prioridad:** P1  
**Esfuerzo estimado:** 5-9 días  
**Resultado esperado:** las opciones de seguridad representan garantías reales y
no solamente validaciones visuales.

### Solo lectura

- [ ] **SEC-001:** aplicar modo read-only nativo de conexión o transacción cuando el motor lo soporte.
- [ ] **SEC-002:** mantener el analizador SQL como aviso preventivo, no como frontera de seguridad.
- [ ] **SEC-003:** documentar que un usuario restringido en el servidor sigue siendo la garantía definitiva.
- [ ] **SEC-004:** probar `CALL`, `EXEC`, `SELECT INTO`, `COPY FROM`, `LOAD DATA` y funciones con efectos laterales.

### TLS

- [ ] **SEC-005:** ampliar la configuración a `Disable`, `Prefer`, `Require`, `VerifyCA` y `VerifyFull` cuando el proveedor lo permita.
- [ ] **SEC-006:** no presentar como verificada una conexión que cifra pero acepta cualquier certificado.
- [ ] **SEC-007:** permitir configurar CA, certificado cliente y validación de hostname cuando corresponda.
- [ ] **SEC-008:** actualizar valores por defecto y mensajes de ayuda sin romper perfiles guardados.

### Restauración y archivos

- [ ] **SEC-009:** devolver en la inspección un identificador o hash SHA-256 del artefacto aprobado.
- [ ] **SEC-010:** exigir ese identificador y una confirmación explícita al ejecutar la restauración.
- [ ] **SEC-011:** rechazar la ejecución si el archivo cambió después de inspeccionarlo.
- [ ] **SEC-012:** tratar un fallo de lectura del catálogo como estado desconocido, nunca como “sin colisiones”.
- [ ] **SEC-013:** establecer permisos restrictivos para SQLite, logs y `endpoint.json`.
- [ ] **SEC-014:** decidir y documentar una defensa contra fórmulas al exportar CSV para hojas de cálculo.

### Criterios de aceptación

- Una conexión read-only no puede escribir mediante instrucciones indirectas en
  los motores que soportan protección nativa.
- La interfaz diferencia cifrado de identidad verificada.
- No se puede aplicar un archivo distinto al inspeccionado.
- Los datos locales sensibles no quedan legibles para otros usuarios del equipo
  por permisos predeterminados permisivos.

---

## 9. Fase 4 — Observabilidad y límites de recursos

**Prioridad:** P2  
**Esfuerzo estimado:** 3-5 días

### Tareas

- [ ] **OBS-001:** escribir logs locales rotativos con tamaño y retención limitados.
- [ ] **OBS-002:** añadir identificadores de petición, sesión y trabajo largo.
- [ ] **OBS-003:** excluir contraseñas, tokens, claves, cadenas de conexión, SQL y datos de filas por defecto.
- [ ] **OBS-004:** añadir una acción para abrir o exportar un paquete de diagnóstico saneado.
- [ ] **PERF-001:** procesar CSV de importación en streaming y cortar al alcanzar el límite.
- [ ] **PERF-002:** proteger XLSX frente a archivos comprimidos desproporcionados y libros excesivos.
- [ ] **PERF-003:** aplicar el límite de resultados al lote completo, no de nuevo a cada result set.
- [ ] **PERF-004:** medir memoria en exportaciones XLSX y documentar el límite con datos reales.
- [ ] **PERF-005:** revisar el bloqueo por sesión para que un backup largo no congele navegación que pueda usar otra conexión segura.

### Criterios de aceptación

- Un fallo en una aplicación empaquetada puede diagnosticarse sin consola.
- Los logs no contienen secretos ni datos SQL salvo una opción explícita de diagnóstico.
- Un archivo mayor que los límites se rechaza sin materializarlo entero en memoria.
- Un lote con muchos resultados no supera el máximo global configurado.

---

## 10. Fase 5 — Contrato, frontend y accesibilidad

**Prioridad:** P2  
**Esfuerzo estimado:** incremental, 2-3 ciclos

### Contrato HTTP

- [ ] **API-001:** generar y versionar el documento OpenAPI en CI.
- [ ] **API-002:** detectar cambios incompatibles del contrato en pull requests.
- [ ] **API-003:** generar tipos o cliente TypeScript, o validar automáticamente el gateway manual contra OpenAPI.
- [ ] **API-004:** añadir pruebas HTTP para IA/SSE, pestañas, diagramas y trabajos largos.

### Frontend

- [ ] **FE-001:** dividir `WorkspaceStore` por responsabilidades sin introducir otra biblioteca de estado por defecto.
- [ ] **FE-002:** separar primero sesiones/transacciones, pestañas, explorador y ejecución de consultas.
- [ ] **FE-003:** extraer de `AppShell` la coordinación de diálogos y comandos.
- [ ] **FE-004:** activar `strict` y `strictTemplates` de manera incremental.
- [ ] **FE-005:** añadir scripts verificables de formato y lint.
- [ ] **FE-006:** corregir la etiqueta de versión que muestra Informix como MySQL.

### Backend

- [ ] **BE-001:** separar planificación, ejecución y progreso de `TransferService`.
- [ ] **BE-002:** extraer scripting de datos y ejecución DDL de `TableDesignerBase` solo cuando exista una prueba que proteja la extracción.
- [ ] **BE-003:** hacer transaccionales y dirigidas por versión las migraciones SQLite.
- [ ] **BE-004:** definir compensación entre SQLite y el almacén de secretos cuando una escritura parcial falla.

### Accesibilidad

- [ ] **A11Y-001:** dar semántica completa `grid` o `table` a la cuadrícula de resultados.
- [ ] **A11Y-002:** permitir seleccionar y redimensionar columnas con teclado.
- [ ] **A11Y-003:** añadir valores ARIA al separador de tamaño.
- [ ] **A11Y-004:** implementar foco inicial, trampa, Escape y restauración de foco en todos los diálogos.
- [ ] **A11Y-005:** probar navegación completa sin ratón y con lector de pantalla.

### Criterios de aceptación

- Un cambio incompatible entre DTO C# y TypeScript falla en CI.
- Ninguna extracción cambia comportamiento observable.
- Los coordinadores principales reducen tamaño y responsabilidades gradualmente.
- Los flujos críticos pueden completarse usando solo teclado.

---

## 11. Fase 6 — Distribución y compatibilidad

**Prioridad:** P2/P3  
**Esfuerzo estimado:** depende de decisiones externas

### Tareas

- [ ] **REL-001:** decidir entre repositorio público o alojamiento público separado para las actualizaciones.
- [ ] **REL-002:** comprobar instalación y actualización en una máquina Windows sin herramientas de desarrollo.
- [ ] **REL-003:** comprobar los selectores nativos de archivo y carpeta en la aplicación empaquetada.
- [ ] **REL-004:** probar multicursor y atajos dentro de WebView2.
- [ ] **REL-005:** obtener firma Authenticode y verificar sellado de tiempo.
- [ ] **REL-006:** fijar GitHub Actions por SHA y contenedores de CI por versión o digest.
- [ ] **REL-007:** añadir Dependabot o Renovate y auditoría periódica de NuGet, npm y Cargo.
- [ ] **REL-008:** crear una matriz programada para versiones mínimas soportadas y MariaDB.
- [ ] **REL-009:** comprobar todos los RIDs prometidos por el plan maestro.
- [ ] **REL-010:** actualizar README, descripción Tauri y notas de versión para reflejar motores y transportes actuales.

### Criterios de aceptación

- Una instalación limpia recibe y valida una actualización firmada.
- SmartScreen reconoce el editor cuando la reputación del certificado lo permita.
- Las versiones mínimas declaradas tienen una comprobación automatizada periódica.
- La documentación pública coincide con el producto distribuido.

---

## 12. Pruebas E2E que faltan

Añadirlas después de estabilizar los formatos y el ciclo de vida, no antes:

- [ ] Editar y borrar una fila desde la cuadrícula.
- [ ] Importar un CSV pequeño con vista previa y confirmación.
- [ ] Respaldar y restaurar una tabla conservando `NULL` y cadena vacía.
- [ ] Cancelar una operación larga y comprobar el estado final.
- [ ] Intentar cerrar Druse durante una restauración.
- [ ] Probar un proveedor de IA simulado, incluyendo streaming y cancelación.
- [ ] Abrir, guardar y exportar mediante diálogos nativos en la aplicación empaquetada.

---

## 13. Métricas de seguimiento

Registrar estas métricas al cerrar cada fase:

| Métrica | Línea base | Objetivo |
| --- | ---: | ---: |
| Pruebas frontend | 785 | Sin regresiones |
| Unitarias backend ejecutadas en CI | 0 con el comando actual | Más de 500 |
| Contractuales reales | 266/267 | 267/267 o el nuevo total completo |
| Pruebas Rust en CI | 0 | 17 o el nuevo total completo |
| Vulnerabilidades npm de severidad alta | 1 de desarrollo | 0 |
| Operaciones largas persistidas | 0 | 100 % |
| Formatos de respaldo reversibles | SQL parcial / CSV ambiguo | SQL y CSV verificados por round-trip |
| Cobertura publicada | No disponible | Línea base visible y sin caídas injustificadas |

No imponer inicialmente un porcentaje arbitrario de cobertura. Primero publicar
la línea base y exigir cobertura sobre código nuevo y regresiones críticas.

---

## 14. Definición de terminado

Una tarea de este plan se considera terminada cuando:

- Tiene una prueba que falla antes del cambio cuando se trata de una regresión.
- Compila sin advertencias en los sistemas afectados.
- Pasa pruebas unitarias, integración y contractuales aplicables.
- Actualiza contrato y documentación cuando cambia comportamiento persistido o público.
- No registra secretos ni datos sensibles.
- Incluye comprobación manual si depende de Tauri, WebView2 o un diálogo nativo.
- Deja la bitácora con resultado, comandos ejecutados y trabajo pendiente real.

Una fase se cierra solamente cuando todos sus criterios de aceptación están
comprobados. “Implementado” y “verificado” deben mantenerse como estados
distintos.

---

## 15. Primer bloque de trabajo recomendado

Orden exacto para la próxima sesión:

1. Resolver acceso a GitHub Actions.
2. Añadir `IsTestProject` y comprobar descubrimiento real de pruebas.
3. Serializar compilación backend con `-m:1` en CI.
4. Publicar el puerto SQLI y ejecutar los cinco fixtures contractuales.
5. Corregir el `DATE` de Informix SQLI hasta obtener todas las contractuales verdes.
6. Crear pruebas que reproduzcan carpeta reutilizada, tablas homónimas y `NULL` CSV.
7. Corregir esos tres defectos sin cambiar todavía el sistema de trabajos largos.
8. Generar un respaldo real por proveedor y restaurarlo en una base nueva.
9. Cerrar la fase 1 antes de comenzar nuevas funciones.

Al terminar este bloque, decidir si la siguiente entrega será una versión de
corrección 1.1.x o si debe esperar también al cierre coordinado de operaciones de
la fase 2.
