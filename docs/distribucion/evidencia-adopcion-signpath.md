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

- **Compilación nueva de la API: bloqueada.** El arranque de E2E con `dotnet run` falla por NU1902/NU1903 en `System.Security.Cryptography.Pkcs` 8.0.1 y 9.0.13, transitivas de Oracle y SQL Server. Los avisos apuntan a [GHSA-2fmv-rv2c-59x7](https://github.com/advisories/GHSA-2fmv-rv2c-59x7) y [GHSA-846f-f764-76mx](https://github.com/advisories/GHSA-846f-f764-76mx). No se han suprimido los avisos ni modificado dependencias. Hace falta revisar la remediación y su alcance en la beta antes de ampliar la difusión.
- **Windows limpio: no probado.** No se encontró `WindowsSandbox.exe`, `Get-VM`, VirtualBox ni VMware disponibles en este entorno. Quedan abiertos instalación, actualización, desinstalación y observación de tráfico del [protocolo](pruebas-instalador-signpath.md). No se instaló ni desinstaló Druse en el perfil habitual.
- **Recorrido SQLite local: correcto.** Conexión al archivo vacío, carga del SQL de la guía, tres filas y sus importes correctos, suma de 60000 y CSV con los tres productos. Se usaron el frontend de desarrollo y un perfil aislado con la API Comunidad ya construida, con SHA-256 de `Druse.Host.LocalApi.dll` `5a8cf18df76ece425607032c49abee0ad9585b72494df8046871a6e112f61f5d`, coincidente con el manifiesto local de Comunidad 1.3.0. El archivo vacío lo creó la herramienta de verificación: el diálogo nativo «Crear una nueva» no se ejercitó. Esto no sustituye una compilación nueva ni acredita una instalación de la beta.
- **Frontend: correcto.** TypeScript sin emisión, guarda de idiomas y seis pruebas de novedades aprobados. No cambió el código de la aplicación.
- **Web local: correcta.** Enlaces y anclas locales, recursos, menú móvil y descarga sin JavaScript comprobados bajo `/druse/`; sin errores de página ni desbordamiento a 320, 390 y 1440 px. Capturas revisadas de la guía y la landing. El aviso de privacidad compartido conserva su comprobación satisfactoria.

Las salidas, configuración temporal, perfil y CSV de la verificación se conservan localmente en `artifacts/signpath-inicio-2026-10-14/`, fuera del control de versiones. La captura de la guía muestra únicamente datos ficticios.

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
