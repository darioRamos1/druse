# Primera prueba de Druse con SQLite

Guía para Druse Comunidad en Windows x64. Los enlaces de la guía ilustrada se actualizan con cada publicación completa.

La guía ilustrada vive en [`landing/primeros-pasos.html`](../../landing/primeros-pasos.html).
Se puede abrir con la [vista previa local de la web](landing-github-pages.md#vista-previa).
La página pública está en [primeros pasos](https://darioramos1.github.io/druse/primeros-pasos.html).

## Recorrido de diez minutos

1. Abre la [guía ilustrada con las descargas actuales](https://darioramos1.github.io/druse/primeros-pasos.html) y descarga el instalador de Comunidad y `SHA256SUMS.txt` de la misma publicación. La guía muestra el comando `Get-FileHash` con el nombre exacto de ese instalador.
   Compara su SHA-256 con la entrada correspondiente de `SHA256SUMS.txt`.
   Si está disponible, también puedes comprobar y extraer el ZIP portable de Comunidad y abrir `druse.exe`; requiere WebView2 instalado y guarda los datos en el perfil de Windows.
   Los paquetes están sin Authenticode y pueden mostrar SmartScreen; el instalador puede descargar WebView2. Revisa en las notas qué pruebas y limitaciones corresponden a la versión elegida. La beta anterior 1.3.0 no se actualiza automáticamente.
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
