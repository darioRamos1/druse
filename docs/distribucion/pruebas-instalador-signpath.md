# Validación del instalador candidato de Druse

Estado: protocolo preparado el 14 de septiembre de 2026; ejecución pendiente. Cubre PKG-04, P-02 y P-03 del [plan](../planes/plan-signpath-donaciones.md). Las pruebas de código y una vista previa web no sustituyen estas comprobaciones.

## Entorno y evidencia

Usar una máquina virtual Windows limpia y una cuenta de pruebas sin datos personales, credenciales reales ni herramientas de desarrollo. No ejecutar desinstalaciones de prueba sobre la instalación habitual. Conservar una instantánea inicial de la máquina virtual y repetir por separado para las variantes completa y sin Informix.

Registrar antes de empezar:

- Versión/build de Windows y presencia/versión de WebView2.
- Commit, versión y variante de Druse, nombre del instalador y SHA-256.
- Manifiesto del paquete, salida de verificación de release, URL y resultado de CI.
- Estado real de Authenticode. La firma de actualización de Tauri no acredita al editor de Windows.

No usar una release generada con `-SinComprobarCI` como evidencia de CI satisfactoria. No marcar una actualización como probada si solo se reinstaló manualmente la misma versión.

## Secuencia por variante

| Caso | Acción | Evidencia y criterio |
| --- | --- | --- |
| Instalación | Ejecutar el instalador y anotar cada aviso, ubicación y cambio del sistema | Instalación terminada; accesos directos y desinstalador presentes; avisos de cambios registrados |
| Sin conexión | Repetir desde instantánea sin red; distinguir si WebView2 ya está instalado | Resultado y mensaje de error, sin procesos auxiliares abandonados; no afirmar compatibilidad sin conexión si exige descargar el runtime |
| Primer arranque | Abrir con preferencias nuevas, sin autorizar actualizaciones ni configurar IA | Aviso accesible en Preferencias → Privacidad; sin consulta automática de versión antes de autorizar |
| Actualizaciones | Probar rechazo, búsqueda manual, autorización y posterior desactivación; reiniciar tras cada elección | Se conserva la elección; registrar peticiones a GitHub y errores de red. La consulta manual debe seguir disponible |
| Datos sintéticos | Crear una SQLite temporal, una tabla `prueba_privacidad` y filas ficticias; consultar, exportar, cerrar y abrir | Datos y exportación correctos; ningún dato o credencial real utilizado |
| Motores | Conectar a servidores de prueba de los motores incluidos; contrastar con la matriz de motores | Registrar motor/versión y resultado. Un motor no disponible queda «no probado», no «correcto» |
| IA opcional | Usar un proveedor de pruebas que registre solicitudes con preguntas sintéticas y cada nivel de contexto | Contrastar cuerpo enviado con el aviso: pregunta, SQL y esquema según elección; no incluir filas automáticamente |
| Cambio de versión | Actualizar desde una versión anterior usando el canal y artefactos candidatos verificables | Versión nueva, datos preservados, variante conservada y rechazo de una firma inválida en entorno aislado |
| Diagnóstico | Provocar errores con nombres y contraseñas ficticias; guardar y revisar el ZIP | Verificar redacción; registrar metadatos que permanezcan; guardar el ZIP no debe enviarlo por sí solo |
| Desinstalación | Cerrar Druse y usar Aplicaciones instaladas de Windows | Comprobar procesos, accesos directos, ejecutables y registro de desinstalación; documentar cualquier resto |
| Datos después de desinstalar | Inspeccionar carpetas Druse en AppData, exportaciones de prueba y entradas Druse del Administrador de credenciales | Registrar exactamente qué se conserva. No exigir ni implementar borrado indiscriminado de datos personales |
| Reinstalación | Reinstalar y comprobar datos y elección de actualizaciones conservados o reiniciados | El comportamiento debe coincidir con el aviso final publicado |

## Observación de tráfico

Capturar únicamente tráfico de la máquina virtual de pruebas. Registrar destino, proceso, momento y acción que lo provoca, diferenciando Druse, WebView2, Windows y los programas de IA. No confundir una conexión de Windows Update con telemetría de Druse.

La observación de destinos HTTPS no demuestra qué contiene el cuerpo cifrado. Para contrastar el contenido de IA, usar un proveedor sintético controlado; para otros protocolos, documentar las limitaciones de captura. No instalar certificados de interceptación ni capturar tráfico del equipo habitual.

## Registro de resultados

Por cada caso anotar: fecha, variante, entorno, esperado, observado, evidencia local y estado (`correcto`, `falló`, `no probado`). Usar nombres de evidencia sin secretos; revisar y ocultar datos sensibles antes de publicar capturas o registros. Abrir incidencias por diferencias con el aviso y repetir solo los casos afectados tras corregirlas.

Al terminar, actualizar [privacidad de la aplicación](../privacidad/privacidad-aplicacion.md), [matriz de motores](../motores/matriz-de-motores.md) y el expediente. P-02, P-03 y PKG-04 permanecen abiertos hasta contar con resultados. En la revisión actual no se encontró `WindowsSandbox.exe` disponible en PATH; no se ha creado ni ejecutado una máquina virtual limpia.
