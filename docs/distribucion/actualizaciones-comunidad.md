# Preparar una actualización de Comunidad

El binario ya consulta `windows-x86_64-comunidad` en el `latest.json` de la última release de Druse. No acepta otra edición como alternativa. El guion de releases construye y verifica las tres entradas juntas para que publicar una edición no deje a las otras sin su canal.

## Preparación local sin publicar

Después de elegir una versión nueva, revisar sus notas y actualizar coordinadamente las versiones del proyecto:

```powershell
./build/scripts/release.ps1 -Etapa construir
./build/scripts/release.ps1 -Etapa verificar
```

La construcción requiere la clave del actualizador configurada en el entorno local. No se debe guardar ni mostrar esa clave en el repositorio. Los instaladores se generan por separado, con sus firmas; el selector de las dos ediciones anteriores conserva su comportamiento. Comunidad se ofrece mediante su instalador directo.

En `artifacts/releases/<version>/` quedan los tres instaladores, sus firmas, `latest.json`, el selector y los tres manifiestos de contenido. Se comprueban versión, SHA-256 del instalador, avisos propios, firmas contra los bytes finales y URL HTTPS exacta del repositorio/tag de destino. Una entrada de Comunidad ausente o cruzada detiene la verificación. El manifiesto conserva las otras dos plataformas.

## Publicación posterior

La integración está preparada; no se ejecutó una publicación ni se modificó el `latest.json` público durante este trabajo. Antes de hacerlo siguen pendientes revisión de redistribución/fuente correspondiente, instalación/actualización en Windows limpio, privacidad y beta aprobada.

Para publicar, CI general y `comunidad.yml` deben terminar correctamente sobre el commit exacto. Hay que ejecutarlos también sobre el commit final integrado: la ejecución de un PR no acredita automáticamente otro SHA. El workflow de releases usa Tauri CLI 2.11.4 y el mismo verificador de CI que el guion local, con paginación y teniendo en cuenta intentos pendientes. `-SinComprobarCI` no permite omitir el control de Comunidad.

La publicación sube además los tres manifiestos y `evidencia.json`. Authenticode y la firma del actualizador son controles distintos: una firma Tauri válida no constituye firma de SignPath ni reputación de SmartScreen. La candidatura de SignPath sigue limitada a Comunidad; construir las otras ediciones no solicita firma para ellas.
