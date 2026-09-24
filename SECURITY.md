# Política de seguridad

## Cómo informar

Escribe a **druse.contacto@gmail.com** con el asunto «Seguridad». Si prefieres GitHub, usa el aviso privado de seguridad del repositorio cuando esté disponible; **no abras una incidencia pública** para un fallo de seguridad.

Cuenta qué versión de Druse usas, qué sistema, qué motor de base de datos y qué pasos llevan al problema. Un caso reproducible vale más que una descripción larga.

## Qué no debes enviar

Nunca incluyas contraseñas, cadenas de conexión completas, claves de API, volcados de bases de datos ni datos de tus clientes. Si necesitas enseñar el contenido de un error, sustituye lo sensible antes de pegarlo.

El paquete de diagnóstico de Druse ya sanea contraseñas y tokens al escribir los registros, pero **es una limpieza por patrones**: reconoce las formas conocidas, no todas. Ábrelo antes de mandarlo. Los mensajes de error de un motor pueden llevar nombres de bases, tablas o servidores de tu organización.

## Qué puedes esperar

Este proyecto lo mantiene una persona. No hay un acuerdo de nivel de servicio, y decir lo contrario sería inventarlo. El compromiso es acusar recibo del informe, decirte si se considera un fallo de seguridad y mantenerte al tanto de la corrección.

No hay programa de recompensas.

## Qué versiones se corrigen

Solo la última publicada. Druse está en 1.2.0 y todavía no tiene una rama de mantenimiento con versiones anteriores; si eso cambia, esta sección lo dirá.

## Qué se considera un fallo de seguridad

Druse es una aplicación de escritorio que se conecta a las bases de datos que tú configuras. Interesan especialmente:

- Filtración de credenciales: en registros, en la interfaz, en respuestas de la API local, en exportaciones o en el paquete de diagnóstico.
- Acceso a la API local sin el token, o cualquier forma de obtenerlo desde otro proceso o desde una página web.
- Ejecución de instrucciones destructivas sin la confirmación explícita, o escrituras en una conexión marcada como solo lectura.
- Inyección de SQL a través de la interfaz: el explorador, el diseñador de tablas, la edición de filas o los diagramas.
- Cualquier camino que permita escribir o ejecutar archivos fuera de lo que el usuario eligió, incluidos instalación y actualización.
- Que una actualización se acepte sin firma válida, o que el instalador ejecute algo distinto de lo publicado.

**No** se consideran fallos de seguridad, aunque siguen siendo bienvenidos como incidencias corrientes: que Windows muestre el aviso de SmartScreen —Druse todavía no tiene firma Authenticode, y está explicado en [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md)—, que un motor rechace una credencial correcta, o que una consulta que tú escribes borre tus datos tras confirmarlo.

## Lo que Druse ya hace

Resumido; el detalle está en la [privacidad de la aplicación](docs/privacidad/privacidad-aplicacion.md).

- La API local escucha solo en `127.0.0.1` y exige un token de 32 bytes generado en cada arranque, comparado en tiempo constante.
- Las contraseñas van al Administrador de credenciales de Windows. La base local no tiene columna para guardarlas, y hay pruebas que lo comprueban.
- Cada línea de registro pasa por un saneado de credenciales y tokens antes de escribirse.
- Las actualizaciones se verifican con la firma del actualizador de Tauri antes de instalarse.
- No hay telemetría ni servidor propio: Druse no envía tus datos a ningún sitio que no hayas configurado.

## Divulgación

Si el informe resulta ser un fallo real, se corrige y se publica en las notas de la versión, mencionando a quien lo reportó si quiere. Pide un plazo razonable antes de publicarlo por tu cuenta y avísanos de la fecha que tengas prevista.
