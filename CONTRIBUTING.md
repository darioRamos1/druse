# Contribuir a Druse

Gracias por el interés. Este archivo explica qué se puede aportar hoy, cómo se trabaja aquí y qué se espera de un cambio.

## Lo primero: la licencia todavía no está elegida

Druse **no tiene archivo `LICENSE`**. Mientras no lo tenga, no se fusionará código de terceros: sin licencia no hay términos bajo los que aceptarlo ni bajo los que tú lo cedes, y aceptar código en ese vacío le crearía un problema a quien contribuye y al proyecto. La decisión está registrada como **DEC-02** en el [plan de SignPath y donaciones](docs/plan-signpath-donaciones.md).

Hasta entonces sí son útiles, y mucho:

- **Informes de fallo** con pasos para reproducirlos.
- **Informes de compatibilidad** de un motor y versión concretos: qué funcionó y qué no.
- Preguntas sobre documentación que no se entiende o que ya no describe lo que hace el programa.

Cuando la licencia esté decidida, este archivo dirá cómo se aceptan los cambios de código y bajo qué términos.

## Antes de abrir una incidencia

Comprueba que usas la última versión y busca si ya existe una incidencia parecida. Para un fallo de seguridad **no abras una incidencia pública**: sigue [`SECURITY.md`](SECURITY.md).

Y no pegues contraseñas, cadenas de conexión completas, claves de API ni datos de tus clientes. Si hace falta enseñar un error, sustituye lo sensible primero.

## Levantar el proyecto

Los requisitos y el arranque están en el [README](README.md). En resumen:

```bash
dotnet build backend/Druse.slnx
dotnet test  backend/Druse.slnx

cd frontend && npm test
```

Las bases de prueba se levantan con `./build/scripts/test-db.ps1` (o `.sh`), en contenedores que escuchan solo en `127.0.0.1` y con puertos propios para no pisar los tuyos. Las pruebas de punta a punta viven en `e2e/` y levantan la aplicación entera; su README lo explica.

Las pruebas de los guiones de construcción no compilan nada y tardan un segundo:

```powershell
./build/tests/manifiesto-paquete.ps1
./build/tests/test-db-loopback.ps1
```

## Cómo se escribe aquí

- **Todo en español**: interfaz, mensajes de error, comentarios, nombres de pruebas y mensajes de commit. Los identificadores técnicos —clases, métodos, tipos— se quedan como están.
- **Los comentarios explican por qué, no qué.** Un comentario que repite lo que dice la línea siguiente sobra; uno que cuenta qué pasó cuando se hizo de la otra forma se queda.
- **Una función nueva con interfaz añade su captura** al barrido de `e2e/tests/barrido.spec.ts`, y las imágenes se miran antes de darla por terminada.
- Las decisiones de arquitectura se registran en [`docs/decisions`](docs/decisions), un archivo por decisión.
- Los mensajes de commit llevan ámbito y dicen qué cambió en la aplicación, no qué archivos se tocaron: `fix(sqlite): cancelar una consulta ahora la corta de verdad`.

## Lo que no entra

- Nada que guarde contraseñas en la base local, en la configuración o en un registro.
- Ramificar la interfaz por motor: lo que un motor no puede hacer se declara en sus capacidades, no en un `if` de la pantalla.
- Dependencias nuevas sin justificar: tres funciones de una API del sistema no necesitan un paquete.
- Archivos generados, artefactos de construcción, volcados o capturas con datos reales.

## Compatibilidad de motores

Si pruebas Druse contra un motor o una versión que no figura como comprobada en la [matriz de motores](docs/matriz-de-motores.md), cuéntalo: qué versión, qué funcionó, qué falló y con qué mensaje. Esa matriz solo puede crecer con informes concretos, y hoy hay versiones anunciadas que nadie ha verificado una por una.
