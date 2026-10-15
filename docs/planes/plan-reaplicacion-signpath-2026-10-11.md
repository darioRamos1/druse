# Plan para volver a solicitar SignPath Foundation

Fecha: 11 de octubre de 2026. Responsable: Darío Ramos. Horizonte inicial: ocho semanas, hasta el 6 de diciembre; es una fecha de revisión interna, no una fecha prometida de aprobación.

Objetivo: demostrar que personas ajenas al mantenimiento conocen y usan Druse, reunir referencias independientes y presentar una edición Comunidad comprobada. La aceptación depende de SignPath. Este plan complementa el [plan técnico y de donaciones](plan-signpath-donaciones.md); las donaciones no son una condición para esta candidatura.

Avance del 14 de octubre: preparados localmente README y landing con descarga, tres casos de uso, [guía SQLite ilustrada](../guias/primera-prueba-sqlite.md), [convocatoria para revisión](../distribucion/convocatoria-pruebas-comunidad.md) y documentos de estado actualizados (REA-01/02/03/05/17). El recorrido de consulta y CSV pasó con un perfil aislado y la API ya construida. El [registro de evidencia](../distribucion/evidencia-adopcion-signpath.md) recoge los resultados y límites: Windows limpio no está disponible y una compilación nueva está bloqueada por avisos de seguridad de una dependencia transitiva. No se han publicado estos cambios, enviado mensajes ni registrado pruebas externas. La difusión amplia queda pendiente de resolver esos puntos.

Continuación del 14 de octubre: [corregidas las referencias PKCS y el runtime autocontenido](../revisiones/seguridad-comunidad-2026-10-14.md), con avisos de terceros actualizados. La solución compila, la auditoría NuGet de 19 proyectos no informa paquetes vulnerables y pasan las pruebas seleccionadas de SQL Server, Oracle y SQLite. Se construyó y verificó el instalador local y se preparó un kit transferible con protocolo y hoja de resultados. Darío no dispone de entorno de pruebas y el equipo actual usa Windows Home, sin soporte de Sandbox: preparar una VM con Windows es la siguiente dependencia. Windows limpio, una nueva distribución pública y las pruebas externas siguen pendientes; esta corrección local no actualiza la beta ya publicada.

Preparación de la VM, 14 de octubre: [VirtualBox descargado y verificado, configuración y comprobación del anfitrión preparadas](../distribucion/entorno-windows-limpio.md). C: tiene unos 23 GiB libres y P: unos 11; faltan una ubicación con el presupuesto de 80 GiB, más RAM libre al arrancar y la ISO oficial. VirtualBox no se ha instalado, la VM no se ha creado y no hay resultados de instalación. Se pidió al titular una ruta con espacio antes de reservar el disco virtual.

## 1. Qué dijo SignPath y qué sabemos hoy

Se recibieron dos correos en `druse.contacto@gmail.com`. Las horas siguientes corresponden a America/Bogota:

- **8 de octubre, 19:56:** [Open Source Project Submitted](https://mail.google.com/mail/u/?authuser=druse.contacto%40gmail.com#all/1a11e28f6977e8bc), confirmación de recepción del formulario.
- **9 de octubre, 01:01:** [Your SignPath Foundation application](https://mail.google.com/mail/u/?authuser=druse.contacto%40gmail.com#all/1a11f4083f4875b9), rechazo por ahora. Phillip señala falta de señales de confianza y visibilidad pública: adopción comunitaria, referencias externas o respaldo institucional, y actividad sostenida. Invita a volver a solicitarlo cuando exista mayor reconocimiento.

El correo no cuestiona la calidad del proyecto ni resuelve SNI, WebView2 o el momento del consentimiento para actualizaciones. Esas preguntas siguen abiertas; el silencio no equivale a aprobación técnica.

Línea base comprobada el 11 de octubre mediante la API de GitHub:

| Señal | Estado observado | Interpretación |
| --- | --- | --- |
| [Repositorio](https://github.com/darioRamos1/druse) | Público, 0 estrellas, 0 forks | Visibilidad comunitaria todavía limitada |
| Contribuciones registradas | Un mantenedor humano y Dependabot | El bot no es un colaborador externo; no se ha acreditado una comunidad de contribución |
| [Beta Comunidad 1.3.0](https://github.com/darioRamos1/druse/releases/tag/v1.3.0-beta.1) | Publicada el 8 de octubre a las 21:15; una descarga del instalador | Ya existe descarga pública; el contador no identifica usuarios ni confirma instalación o uso |
| Evidencia técnica de la beta | [Construcción de GitHub Actions](https://github.com/darioRamos1/druse/actions/runs/37871707187), commit, manifiesto y SHA-256 enlazados en la release | Base que se puede reutilizar; no equivale a una prueba completa en Windows limpio |
| Referencias y uso externo | No reunidos en el expediente | No afirmar que no existen en toda Internet; falta localizarlos y verificarlos |

El [formulario del 8 de octubre](../distribucion/solicitud-signpath-2026-10-08.md) declaraba que aún no existía release pública. La beta se publicó después del envío y antes del rechazo. No sabemos si SignPath la revisó. En una nueva candidatura habrá que actualizar el enlace y el estado de distribución.

Las [condiciones oficiales](https://signpath.org/terms) incluyen reputación verificable y requisitos de distribución, privacidad y firma. No publican una cifra mínima de estrellas o descargas ni un plazo de admisión. Los objetivos numéricos de este plan son metas propias para organizar el trabajo.

## 2. Prioridades y calendario

| Periodo | Prioridad | Resultado que debe quedar |
| --- | --- | --- |
| 11–17 de octubre | Facilitar la prueba y comprobar el instalador | Descarga clara, demostración, guía breve y resultados de Windows limpio |
| 18–31 de octubre | Conseguir primeras pruebas externas | Informes concretos de personas ajenas al mantenimiento y correcciones de los problemas encontrados |
| 1–21 de noviembre | Dar continuidad y obtener referencias | Pruebas repetidas, incidencias atendidas y menciones independientes con enlaces |
| 22 de noviembre–6 de diciembre | Consolidar evidencia y decidir | Expediente actualizado y decisión de reaplicar o seguir reuniendo evidencia |

La difusión inicial y el cierre técnico pueden avanzar en paralelo. Las pruebas del instalador deben preceder a una invitación amplia a instalarlo. Si aparece un fallo importante, se corrige y se revalida antes de ampliar la difusión.

## 3. Semana 1: que alguien pueda conocer y probar Druse

- [ ] **REA-01 — Presentación:** revisar README y landing. Mostrar qué problema resuelve Druse, una captura o demostración corta y tres casos: abrir SQLite, explorar PostgreSQL y exportar resultados. Diferenciar claramente los motores de Comunidad de los de la edición completa.
- [ ] **REA-02 — Descarga:** enlazar la beta existente desde la presentación con versión, Windows x64, requisitos, hashes y limitaciones. Indicar su estado sin Authenticode y sin actualización automática. Comprobar los enlaces como visitante sin sesión; un artefacto temporal de Actions no reemplaza una descarga pública.
- [ ] **REA-03 — Primera prueba:** preparar una guía de diez minutos con una SQLite y datos sintéticos. Terminar con un formulario de incidencia o instrucciones para contar qué funcionó y qué falló. No pedir bases de clientes ni credenciales.
- [ ] **REA-04 — Instalador:** ejecutar el [protocolo de Windows limpio](../distribucion/pruebas-instalador-signpath.md) sobre los bytes publicados. Registrar instalación, arranque, consulta, desinstalación y tráfico; identificar versión de Windows, WebView2, commit y SHA-256. Cada caso queda como correcto, falló o no probado.

**Cierre de la fase:** una persona puede encontrar la descarga, entender sus límites y completar la consulta de ejemplo; los resultados técnicos están documentados. La beta no tiene canal automático: dejar la actualización por ese canal como no probada hasta que exista un candidato que permita comprobarla de verdad.

## 4. Semanas 2–3: conseguir uso externo verificable

- [ ] **REA-05 — Convocatoria:** preparar una invitación breve con enlace a la beta y un caso de uso. Darío elige los destinatarios y los espacios donde publicarla: comunidades de desarrollo, bases de datos, .NET o grupos de estudio cuyas reglas permitan presentar proyectos. Las publicaciones y correos se ejecutarán en una tarea posterior con autorización; este plan no los envía.
- [ ] **REA-06 — Pruebas:** objetivo propio de **10–20 personas externas que completen una prueba**, aunque haga falta ampliar el plazo. No contar una invitación, una descarga ni una estrella como una prueba realizada.
- [ ] **REA-07 — Informes:** guardar motor y versión, versión de Druse, tarea realizada, resultado y enlace público cuando exista. Buscar al menos **cinco informes detallados**, incluso si describen fallos. Un reporte de compatibilidad, documentación o instalación aporta evidencia sin exigir que alguien escriba código.
- [ ] **REA-08 — Respuesta:** atender los informes, reproducir problemas con datos sintéticos y enlazar cada corrección con su incidencia y release. Objetivo propio: revisar cada reporte dentro de tres días hábiles y comunicar el siguiente paso cuando la solución tarde más.

**Cierre de la fase:** hay informes de terceros con experiencias concretas, respuestas del mantenedor y problemas priorizados. Un participante anónimo puede aportar información útil, pero un informe que solo conserva el mantenedor tiene menos verificabilidad externa que una incidencia o discusión pública.

## 5. Semanas 4–6: demostrar continuidad y referencias independientes

- [ ] **REA-09 — Segunda prueba:** invitar a quienes probaron una primera versión a repetir una tarea tras las correcciones. Objetivo propio: **cinco personas que confirmen un segundo uso** con fecha y versión. Esto ayuda a distinguir interés inicial de uso continuado.
- [ ] **REA-10 — Referencias:** buscar **dos o tres referencias independientes sustanciales**: una reseña, vídeo, artículo, discusión o experiencia de una comunidad. Deben describir Druse o una experiencia de uso. El tutorial del propio mantenedor sirve para presentar el producto, pero no se contabiliza como validación independiente.
- [ ] **REA-11 — Contribución accesible:** seleccionar tareas pequeñas y reales de documentación, compatibilidad o errores reproducibles, con instrucciones para contribuir. Recibir y revisar los aportes que lleguen; no convertir un número de colaboradores en condición para continuar.
- [ ] **REA-12 — Mantenimiento visible:** publicar correcciones cuando estén listas, con notas que expliquen su efecto y referencias a los reportes. Registrar qué se atendió cada semana; no generar commits o versiones vacías para aparentar actividad.
- [ ] **REA-13 — Respaldo opcional:** si un grupo educativo, comunidad o institución usa Druse, solicitar una referencia verificable a la experiencia con su permiso. Es una vía adicional, no una obligación que haya impuesto SignPath.

**Cierre de la fase:** el expediente muestra personas que regresan, reportes atendidos y referencias externas. Estrellas y forks se registran si crecen de forma natural; no se compran, intercambian ni se exige apoyo público para recibir ayuda.

## 6. Cierre técnico que acompaña a la adopción

Estas tareas vienen del plan anterior. No fueron el motivo explícito del rechazo, pero siguen pendientes para una revisión completa:

| Tarea | Evidencia de cierre | Dependencia |
| --- | --- | --- |
| **REA-14 — SNI y WebView2** | Respuesta escrita de SignPath sobre el alcance propuesto o una alternativa técnica comprobada y documentada | Preparar una consulta breve sobre Comunidad; no retirar SQL Server ni asumir una excepción por falta de respuesta |
| **REA-15 — Privacidad** | Avisos concordantes con tráfico observado y decisión documentada sobre consentimiento durante instalación | REA-04; contraste con las condiciones y las preguntas pendientes |
| **REA-16 — Terceros y procedencia** | Inventario del artefacto final, avisos, exclusiones y revisión de los pendientes OSS-03/04 | Revisar la candidata concreta, no extrapolar el resultado de otro instalador |
| **REA-17 — Expediente coherente** | README, página de descarga, política de firma y expediente describen el estado real | Corregir menciones a solicitud pendiente y ausencia de beta; conservar los antecedentes con su fecha |
| **REA-18 — Construcción y roles** | Commit y CI exactos, hashes finales, responsables reales y controles de acceso documentados | Revalidar para la versión propuesta; no usar `-SinComprobarCI` como evidencia de CI aprobada |

La configuración efectiva del servicio de firma se hará si SignPath concede acceso. Hasta entonces se documenta el flujo preparado, sin atribuir al proyecto una firma o patrocinio concedidos.

## 7. Registro de evidencia

Crear un registro semanal, sin telemetría nueva en Druse, con esta estructura:

| Fecha | Tipo | Versión | Qué demuestra | URL o evidencia | Independiente | Limitaciones |
| --- | --- | --- | --- | --- | --- | --- |
| 11-10-2026 | Descargas | 1.3.0 beta | Una descarga agregada del instalador | API de la release | Desconocido | No confirma instalación, identidad ni uso |

Registrar por separado:

- Contadores de estrellas, forks y descargas por artefacto, con fecha de captura.
- Pruebas externas completadas y pruebas repetidas; evitar contar dos reportes de la misma persona como dos usuarios.
- Incidencias, discusiones y aportes de terceros, con enlaces a las respuestas o correcciones.
- Referencias independientes, indicando autor y relación con el proyecto. Una presentación propia y sus republicaciones no son varias validaciones independientes.
- Resultados técnicos asociados al commit y al instalador exactos.

Los informes privados se publican solo con permiso y sin datos sensibles. Conservar enlaces estables y distinguir siempre descargas, pruebas, usuarios y colaboradores. No inferir ninguno de ellos a partir de otro contador.

## 8. Cuándo volver a solicitarlo

El 6 de diciembre se revisan estas condiciones. La fecha no obliga a enviar nada:

- [ ] Hay descarga pública mantenida y documentación concordante con esa edición.
- [ ] Existe un conjunto de pruebas externas verificables, con uso repetido y respuestas del mantenedor durante varias semanas.
- [ ] Se pueden enlazar referencias independientes o respaldo verificable que aporten reconocimiento nuevo respecto a la primera solicitud.
- [ ] Las pruebas técnicas y los pendientes de SNI, WebView2, privacidad y terceros están resueltos o se ha acordado expresamente con SignPath cómo tratarlos.
- [ ] La candidata tiene commit, CI, inventario y hashes verificables, y el expediente diferencia lo comprobado de lo pendiente.

Las metas de participantes y referencias ayudan a evaluar el progreso, pero no garantizan que SignPath considere suficiente la reputación. Si faltan evidencias, ampliar la fase de adopción dos a cuatro semanas y revisar el motivo: dificultad para instalar, poco interés en el caso de uso o fallos de funcionamiento.

Preparar una nueva solicitud breve que enlace: release exacta, resumen de evolución desde octubre, tres a cinco evidencias externas sólidas, historial de mantenimiento y expediente técnico actualizado. Explicar qué cambió desde el rechazo, con hechos y enlaces. Darío revisa y autoriza el envío en una tarea posterior.

Si la firma es urgente, evaluar por separado la suscripción de pago mencionada por Phillip y la [ruta Microsoft Store/MSIX](../distribucion/distribucion-windows-smartscreen.md), verificando costes y requisitos antes de decidir. No se contrata ni se cambia la distribución como parte de este plan.

## 9. Primer bloque ejecutable

Orden propuesto para la siguiente tarea:

1. Actualizar las páginas y documentos de estado de la candidatura (REA-17).
2. Preparar guía SQLite, capturas y convocatoria para revisión (REA-01/03/05).
3. Ejecutar Windows limpio y resolver los fallos que aparezcan (REA-04/15).
4. Revisar la descarga y presentar el material de convocatoria listo para publicar (REA-02).
5. Iniciar las pruebas externas y el registro semanal cuando Darío autorice las publicaciones.

El plan se creó el 11 de octubre. El primer bloque se inició el 14 de octubre con los entregables y límites indicados arriba. La preparación local no equivale a publicación ni a completar Windows limpio o adopción externa; las casillas de las fases siguen pendientes de su cierre completo.
