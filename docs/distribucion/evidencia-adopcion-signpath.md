# Evidencia de adopción y preparación de SignPath

Registro iniciado el 14 de octubre de 2026. Corresponde a REA-06/07/09/10/17 del [plan de reaplicación](../planes/plan-reaplicacion-signpath-2026-10-11.md).

## Comprobación del 14 de octubre

| Tipo | Evidencia | Qué demuestra | Límite |
| --- | --- | --- | --- |
| Repositorio | API de GitHub: público, 0 estrellas y 0 forks | Línea base de visibilidad al iniciar este bloque | No mide personas que usan Druse |
| Descargas | API de `v1.3.0-beta.1`: una descarga del instalador antes de comprobar enlaces | Disponibilidad y contador agregado | No identifica usuario ni demuestra instalación o uso externo; las comprobaciones propias no se cuentan como adopción |
| Acceso anónimo | HTTP HEAD 200 en la release, instalador y `SHA256SUMS.txt`, sin credenciales | Los enlaces públicos de descarga responden | No comprueba la instalación ni el contenido completo de una descarga nueva |
| Integridad | Copia local del instalador conservado de CI: SHA-256 `2dde47105a1386fe11910436bd1ee16439caaf7325d5aa50bbc57b85d8164a2d`, coincidente con el digest de GitHub | Se conserva el artefacto publicado | No es una segunda descarga ni una prueba externa |
| Firma de Windows | `Get-AuthenticodeSignature`: `NotSigned` en esa copia | Estado de firma comunicado en las guías | No hay Authenticode ni firma concedida por SignPath |

Fuentes: [repositorio](https://github.com/darioRamos1/druse), [release y artefactos](https://github.com/darioRamos1/druse/releases/tag/v1.3.0-beta.1) y [construcción de la beta](https://github.com/darioRamos1/druse/actions/runs/37871707187).

## Preparación local

Material preparado: [guía SQLite](../guias/primera-prueba-sqlite.md), [página ilustrada](../../landing/primeros-pasos.html), [SQL ficticio](../../landing/assets/primeros-pasos.sql) y [convocatoria para revisión](convocatoria-pruebas-comunidad.md). La landing enlaza la beta en el código local; estos cambios todavía no se han publicado en Pages.

Se actualizaron README, política de firma, expediente y edición Comunidad para reflejar la beta pública y el rechazo recibido. La primera solicitud y las revisiones de septiembre conservan su fecha y sus limitaciones originales.

### Comprobaciones técnicas y pendientes

- **Bloqueo de compilación corregido en código.** El primer bloque encontró NU1902/NU1903 en PKCS 8.0.1 y 9.0.13. La continuación del 14 de octubre actualiza esas referencias a 8.0.2/9.0.21 y el runtime autocontenido a 10.0.13. La solución compila y la auditoría NuGet de 19 proyectos no informa paquetes vulnerables. La [revisión de seguridad](../revisiones/seguridad-comunidad-2026-10-14.md) registra hashes, avisos originales y pruebas; la beta pública anterior no cambia por esta corrección local.
- **Windows limpio: no probado.** Darío confirmó que no tiene un entorno de pruebas disponible. La lectura local identifica Windows 11 Home Single Language (`CoreSingleLanguage`), edición para la que [Microsoft no admite Windows Sandbox](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/). No se encontraron Sandbox, Hyper-V Manager, VirtualBox ni VMware disponibles. Hace falta preparar una VM con Windows para ejecutar instalación, actualización, desinstalación y tráfico del [protocolo](pruebas-instalador-signpath.md). No se instaló ni desinstaló Druse en el perfil habitual ni se cambiaron funciones de Windows.
- **Recorrido SQLite del primer bloque: correcto.** Conexión al archivo vacío, carga del SQL de la guía, tres filas y sus importes correctos, suma de 60000 y CSV con los tres productos. Se usaron el frontend de desarrollo y un perfil aislado con la API Comunidad ya construida, con SHA-256 de `Druse.Host.LocalApi.dll` `5a8cf18df76ece425607032c49abee0ad9585b72494df8046871a6e112f61f5d`, coincidente con el manifiesto local de Comunidad 1.3.0. El archivo vacío lo creó la herramienta de verificación: el diálogo nativo «Crear una nueva» no se ejercitó. Esto no sustituye una compilación nueva ni acredita una instalación de la beta.
- **Continuación con dependencias corregidas: correcta.** Pasaron 699 pruebas unitarias, 196 de integración, 165 contractuales seleccionadas y el recorrido SQLite/CSV con la nueva API autocontenida. Hubo 14 omisiones explícitas de unitarias. Se generó un instalador local de 50.707.589 bytes, con SHA-256 `431069a096ff82deaf26373a8c8dd337b7420e0069ccb215cf464f43275a8510` y firma válida del actualizador; sigue sin Authenticode. La [revisión](../revisiones/seguridad-comunidad-2026-10-14.md) identifica los artefactos y el kit transferible de Windows limpio. No se ha instalado el candidato ni se ha reemplazado la beta pública.
- **Frontend: correcto.** TypeScript sin emisión, guarda de idiomas y seis pruebas de novedades aprobados. No cambió el código de la aplicación.
- **Web local: correcta.** Enlaces y anclas locales, recursos, menú móvil y descarga sin JavaScript comprobados bajo `/druse/`; sin errores de página ni desbordamiento a 320, 390 y 1440 px. Capturas revisadas de la guía y la landing. El aviso de privacidad compartido conserva su comprobación satisfactoria.

Las salidas, configuración temporal, perfil y CSV de la verificación se conservan localmente en `artifacts/signpath-inicio-2026-10-14/`, fuera del control de versiones. La captura de la guía muestra únicamente datos ficticios.

### Preparación de una VM

El [expediente del entorno Windows limpio](entorno-windows-limpio.md) registra VirtualBox 7.2.20 descargado, su firma Oracle válida y el hash coincidente con el catálogo. El guion `build/scripts/comprobar-vm-windows.ps1` se ejecutó en modo de lectura tanto sin ruta como con una ruta propuesta en P:, y notificó correctamente los prerrequisitos ausentes. Se comprobó que no creó la carpeta de VM. El equipo tiene unos 23 GiB libres en C:, 11 en P: y 4,3 GiB de RAM libre; hace falta una ubicación con al menos 80 GiB y memoria disponible antes del arranque. El usuario todavía debe obtener la ISO oficial. La descarga del hipervisor y esta comprobación no acreditan una VM creada ni pruebas del instalador.

Darío confirmó que no dispone de otra ubicación con espacio suficiente. La preparación no continúa con instalación del hipervisor ni descarga de la ISO. Se avanzó con la [consulta técnica sobre SNI, WebView2 y consentimiento](consulta-signpath-pendientes-2026-10-14.md): borrador local, sin envío ni respuesta nueva. REA-14/15 siguen abiertos.

## Pruebas externas

**Ninguna prueba externa verificada registrada todavía.** No se publicaron convocatorias ni se enviaron mensajes durante este bloque.

Por cada informe real, añadir una fila:

| Fecha | Participante o referencia pública | Druse y Windows/motor | Tarea y resultado | Evidencia | Primera prueba o repetida | Permiso de publicación |
| --- | --- | --- | --- | --- | --- | --- |

Registrar una persona una sola vez como participante y sus siguientes pruebas como uso repetido. Un correo privado solo pasa a esta tabla con permiso y sin información sensible; cuando no se pueda publicar, conservar la evidencia privada y declarar esa limitación.

## Referencias independientes

Sin referencias independientes incorporadas al expediente todavía. Los materiales de Druse y esta verificación propia son presentación y preparación, no reconocimiento externo.

| Fecha | Autor y relación con Druse | Tipo de referencia | URL estable | Qué aporta |
| --- | --- | --- | --- | --- |

Próxima revisión: después de validar Windows limpio y recibir los primeros informes externos. Los pendientes técnicos y el estado de publicación se actualizan con sus resultados, sin marcar pruebas no ejecutadas como correctas.
