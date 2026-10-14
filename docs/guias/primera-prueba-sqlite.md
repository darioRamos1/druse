# Primera prueba de Druse con SQLite

Guía preparada el 14 de octubre de 2026 para la beta Comunidad 1.3.0 de Windows x64.

La guía ilustrada vive en [`landing/primeros-pasos.html`](../../landing/primeros-pasos.html).
Se puede abrir con la [vista previa local de la web](landing-github-pages.md#vista-previa).
La página quedará en `/druse/primeros-pasos.html` cuando se publique este cambio en Pages.

## Recorrido de diez minutos

1. Descarga el instalador y `SHA256SUMS.txt` de la [release oficial](https://github.com/darioRamos1/druse/releases/tag/v1.3.0-beta.1).
   Compara su SHA-256 con `Get-FileHash -LiteralPath '.\Druse-Comunidad-1.3.0-beta.1-win-x64-setup.exe' -Algorithm SHA256`.
   El instalador está sin Authenticode, puede mostrar SmartScreen y necesitar descargar WebView2. La beta no se actualiza automáticamente y sigue pendiente de validación completa en Windows limpio.
2. En Druse, abre **Nueva conexión → SQLite**. Nombre: **Mi primera prueba**.
   Pulsa **Crear una nueva** junto a Archivo y guarda `druse-prueba.db` con un nombre que no exista. Pulsa **Conectar** después del aviso de creación.
3. Comprueba en el selector de la pestaña SQL la conexión elegida y la base **main**.
   Copia el [SQL de ejemplo](../../landing/assets/primeros-pasos.sql) al editor y ejecútalo una sola vez con **Ctrl + Enter** en esa base vacía.
4. Sustituye el contenido del editor por la consulta siguiente y ejecútala:

```sql
SELECT producto, unidades, precio_cop,
       unidades * precio_cop AS total_cop
FROM druse_prueba_ventas
ORDER BY id;
```

Debe mostrar Café → 24000, Té → 21000 y Cacao → 15000. La suma de `unidades * precio_cop` es 60000.

5. Abre **Exportar → CSV** en los resultados de esa consulta. Comprueba que el archivo contiene los tres productos.
6. Abre un [informe de compatibilidad](https://github.com/darioRamos1/druse/issues/new?template=compatibilidad.yml), aunque todo funcione, o escribe a `druse.contacto@gmail.com`.
   Incluye versión de Druse y Windows, pasos completados, resultado esperado y observado, mensaje de error y si es tu primera prueba o un uso repetido.

Todos los datos del ejemplo son ficticios. No uses una base real para este recorrido ni compartas credenciales, rutas personales o datos de clientes. Los informes de GitHub son públicos; los correos no se publican sin permiso.

El SQL no borra datos ni tablas. Si ya lo ejecutaste, consulta la tabla existente o empieza con otro archivo vacío. El archivo SQLite y el CSV permanecen donde los guardaste.
