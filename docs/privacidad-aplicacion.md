# Privacidad de la aplicación Druse — borrador

Preparación: 13 de septiembre de 2026. Corresponde a **PUB-02** del [plan de SignPath y donaciones](plan-signpath-donaciones.md). Alcance: Druse 1.1.0 para Windows, variantes completa y sin Informix.

Este documento describe la aplicación de escritorio. La [política de la landing](../landing/legal.html) cubre la página web y no sirve para la aplicación: son dos cosas distintas y confundirlas es justo lo que SignPath revisa.

**Estado: borrador contrastado con el código, no con tráfico capturado.** Cada afirmación cita dónde se comprobó. Lo que falta por comprobar está en la sección 6 y no se disimula: un texto de privacidad que promete más de lo que se verificó es peor que no tenerlo.

## 1. Lo que Druse no hace

No hay registro de cuentas, telemetría, analítica, publicidad ni identificador de instalación. Una búsqueda de `telemetr`, `analytics`, `sentry`, `appinsights` y `gtag` sobre el backend, el frontend y el envoltorio de Tauri no devuelve ninguna integración; la única coincidencia está en un texto de la landing.

Druse tampoco envía las consultas, las filas, los nombres de las bases ni las credenciales a ningún servicio propio. No existe un servidor de Druse: no hay dónde enviarlas.

## 2. Lo que sale del equipo

| Destino | Cuándo | Qué viaja | Quién lo decide |
| --- | --- | --- | --- |
| Las bases de datos que configures | Al conectar, consultar, exportar o respaldar | Lo que exige el protocolo del motor: usuario, contraseña, SQL y datos | Tú, al crear la conexión |
| Un servidor SSH, si usas túnel | Mientras dure la conexión | Credenciales o clave del túnel y el tráfico del motor | Tú, al configurar el túnel |
| `github.com` | Al abrir la aplicación **solo si lo has autorizado**, y siempre que pulses «Buscar actualizaciones» | Una petición HTTPS al archivo de la última versión. No se envía versión, variante ni identificador; GitHub registra lo que registra cualquier descarga: dirección IP, fecha y cabeceras del cliente | Tú, en Preferencias → Acerca de. Mientras no elijas, Druse no consulta nada |
| El proveedor de IA que configures | Solo al escribir una pregunta en el asistente | Tu texto y, según el nivel que elijas, el SQL abierto y la estructura de las tablas en juego. **Ninguna fila de resultados** | Tú, al crear el perfil y al elegir el nivel de cada pregunta |
| Un programa de IA instalado en tu equipo | Solo al usar ese tipo de proveedor | Lo mismo, entregado al proceso local, que responde según su propia cuenta y sus términos | Tú |
| Microsoft Edge WebView2 | Según su configuración en tu Windows | Lo que ese componente del sistema haga por su cuenta | Microsoft; Druse lo usa, no lo distribuye |

La dirección del proveedor de IA es la que escribas. El diálogo propone `api.openai.com/v1`, `api.anthropic.com/v1` y `generativelanguage.googleapis.com/v1beta` como puntos de partida, pero acepta cualquier servidor compatible, incluido uno de tu red: en ese caso la pregunta no sale a internet, y la propia aplicación lo dice con esas palabras.

Sin perfiles de IA configurados, el asistente no tiene a quién preguntar y no se abre ninguna conexión hacia fuera.

## 3. Lo que se guarda en tu equipo

| Qué | Dónde | Detalle |
| --- | --- | --- |
| Conexiones, historial, fragmentos SQL, diagramas, perfiles de respaldo y de IA | `%APPDATA%\Druse\druse.db` | SQLite local. La tabla de perfiles **no tiene columna de contraseña** |
| Contraseñas de conexión y claves de proveedores de IA | Administrador de credenciales de Windows | Escritas con `CredWriteW`, persistencia local: no viajan con un perfil móvil |
| Registros | `%LOCALAPPDATA%\Druse\logs` | Saneados al escribirse (sección 5) |
| Caché | `%LOCALAPPDATA%\Druse\cache` | |
| Punto de conexión de la API local | `%APPDATA%\Druse\endpoint.json` | Puerto, PID y token de sesión; permisos restringidos y se borra al cerrar |
| Exportaciones, respaldos y archivos que generes | Donde tú elijas | Druse no los copia a ningún otro sitio |

`DRUSE_DATA_DIR` mueve todo eso a una ruta absoluta que indiques. En la distribución portable los datos siguen yendo al perfil del usuario, no junto al ejecutable, y así lo advierte el `LEEME.txt` del ZIP.

## 4. La API local

Druse arranca un proceso auxiliar que **escucha solo en `127.0.0.1`** y exige un token de 32 bytes generado en cada arranque, comparado en tiempo constante y publicado en `endpoint.json` con permisos restringidos.

Escuchar en loopback impide el acceso desde la red, pero no desde la propia máquina: sin token, cualquier proceso de tu sesión —incluida una pestaña del navegador— podría abrir sesiones contra tus bases. Esa es la razón del token, y es también la razón por la que `endpoint.json` merece el mismo cuidado que una contraseña.

## 5. Registros y paquete de diagnóstico

El criterio del proyecto es no registrar SQL, ni filas, ni credenciales. Como los controladores sí meten la cadena de conexión entera en sus mensajes de error, cada línea que va al archivo pasa además por un saneado que sustituye `password`, `pwd`, `user id`, `uid`, `token`, `api key` y `secret`, y las cadenas largas en base64 que podrían ser el token de la API.

Es una limpieza por patrones: reconoce las formas conocidas, no todas las imaginables.

El botón de diagnóstico empaqueta esos registros ya saneados más un resumen de versión, sistema y motores. Está pensado para poder enseñarse, pero **antes de enviarlo conviene abrirlo**: un mensaje de error de un motor puede contener nombres de bases, de tablas o de servidores de tu organización, y eso no es un secreto que el saneado busque.

## 6. Huecos pendientes

- **P-01 — Resuelto a medias: hay aviso y opción, pero en la aplicación y no en el instalador.** Antes la aplicación consultaba GitHub al arrancar sin preguntar y sin ajuste que lo evitara. Ahora la consulta automática **está desactivada mientras nadie la autorice**: la elección se guarda en las preferencias (`updates.autoCheck`), se cambia en Preferencias → Acerca de y, mientras siga sin decidirse, el primer arranque lo avisa y no se consulta nada. Buscar a mano sigue disponible siempre. Lo que falta es que esa elección se ofrezca **durante la instalación**, que es donde la piden las condiciones de SignPath; el instalador NSIS de Tauri necesita una página propia para eso. Conviene preguntarlo en la consulta de elegibilidad: si el consentimiento en el primer arranque les vale, P-01 queda cerrado.
- **P-06 — Quien ya tenía Druse instalado deja de recibir avisos hasta que elija.** Es la consecuencia de que el valor por omisión sea no consultar, y es deliberado: autorizar una conexión en nombre de alguien que nunca la autorizó sería justo lo que P-01 venía a corregir. Debe decirse en las notas de la versión.
- **P-02 — Qué deja atrás la desinstalación.** No se ha comprobado si el desinstalador NSIS retira `%APPDATA%\Druse`, la caché, los registros y las credenciales guardadas, ni qué cambios hace el instalador en el sistema. SignPath exige desinstalación y aviso de cambios. Se resuelve en **PKG-04**, con una instalación limpia en un Windows sin herramientas de desarrollo.
- **P-03 — Falta contrastar con tráfico real.** Todo lo anterior se leyó en el código. El plan pide comparar el texto con el tráfico observado de la aplicación y del instalador; esa captura no se ha hecho.
- **P-04 — El texto todavía no está en la aplicación.** Este documento no se muestra dentro de Druse ni se enlaza desde la landing. Hacerlo forma parte de **PUB-04**, junto con los datos del titular que siguen pendientes.
- **P-05 — Responsable y contacto.** El contacto público es `druse.contacto@gmail.com`; la identidad del responsable del tratamiento depende de **DEC-04**.

## 7. Dónde se comprobó cada cosa

| Afirmación | Evidencia |
| --- | --- |
| Sin telemetría | Búsqueda de integraciones de analítica en `backend/src`, `frontend/src`, `shells/desktop-tauri/src` |
| La API escucha solo en loopback | `backend/src/Druse.Host.LocalApi/Program.cs`, `options.ListenLocalhost` |
| Token de la API local | `backend/src/Druse.Host.LocalApi/Security/LocalApiEndpoint.cs` |
| Contraseñas en el almacén de Windows | `backend/src/Druse.Platform.Native/Secrets/WindowsSecretStore.cs` |
| Rutas de datos, caché y registros | `backend/src/Druse.Platform.Native/AppPaths.cs` |
| Saneado de registros | `backend/src/Druse.Host.LocalApi/Diagnostics/LogRedaction.cs` |
| Contenido del diagnóstico | `backend/src/Druse.Host.LocalApi/Diagnostics/DiagnosticPackage.cs` |
| Actualizador: destino, autorización y arranque | `shells/desktop-tauri/tauri.conf.json`, `shells/desktop-tauri/src/updates.rs`, `frontend/src/app/core/update/update.service.ts` y sus pruebas |
| Qué acompaña a una pregunta de IA | `frontend/src/app/features/ai/ai-panel/ai-panel.ts` y su prueba |
| Direcciones propuestas de proveedores | `frontend/src/app/features/ai/ai-provider-dialog/ai-provider-dialog.ts` |
