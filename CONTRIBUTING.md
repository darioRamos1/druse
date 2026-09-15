# Contribuir a Druse

Gracias por el interés. Este archivo explica qué se puede aportar hoy, cómo se trabaja aquí y qué se espera de un cambio.

## Licencia de las contribuciones

El código original de Druse usa **GPL-3.0-only**: GNU General Public License, exclusivamente versión 3, disponible en [LICENSE](LICENSE), con el permiso adicional de [COPYRIGHT](COPYRIGHT) para combinarlo con los controladores de Oracle, IBM y Microsoft que no son libres. Al proponer código original para incorporarlo a Druse, debes poder aportarlo bajo esos mismos términos, **permiso adicional incluido**, y conservar los avisos de autoría aplicables. Sin el permiso, tu parte no podría distribuirse junto a esos controladores. No se exige ceder la titularidad de tu contribución.

Cada contribución se revisa antes de fusionarse. Declara la procedencia y licencia de cualquier material ajeno, y no aportes código de tu empleador o de un cliente sin tener los derechos necesarios. Las dependencias nuevas requieren revisión de compatibilidad; consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

También son útiles:

- **Informes de fallo** con pasos para reproducirlos.
- **Informes de compatibilidad** de un motor y versión concretos: qué funcionó y qué no.
- Preguntas sobre documentación que no se entiende o que ya no describe lo que hace el programa.

La apertura pública del repositorio sigue siendo una decisión separada, registrada en el [plan de SignPath y donaciones](docs/planes/plan-signpath-donaciones.md).

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

Si pruebas Druse contra un motor o una versión que no figura como comprobada en la [matriz de motores](docs/motores/matriz-de-motores.md), cuéntalo: qué versión, qué funcionó, qué falló y con qué mensaje. Esa matriz solo puede crecer con informes concretos, y hoy hay versiones anunciadas que nadie ha verificado una por una.
