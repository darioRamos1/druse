# ADR 0004 — Almacenamiento de secretos y token de la API local

- **Fecha:** 2026-08-11
- **Estado:** aceptada
- **Fase:** 3

## Contexto

Druse guarda conexiones a bases de datos, y esas conexiones tienen contraseñas. Además expone una API HTTP en la máquina del usuario. Ambas cosas son riesgos si se resuelven mal, y ninguna admite un arreglo posterior cómodo: si las contraseñas acaban en un archivo, cambiarlo después obliga a migrar los datos de todos los usuarios.

## Decisión

### 1. Las contraseñas nunca se guardan con el perfil

Los datos se reparten entre dos almacenes distintos:

| Qué | Dónde | Por qué |
| --- | --- | --- |
| Perfil de conexión (host, puerto, base, usuario) | SQLite, en el directorio de datos | Se necesita leer y editar; no es secreto |
| Contraseña | Almacén del sistema operativo | Cifrado y ligado a la sesión del usuario |

`ConnectionProfile` **no tiene una propiedad donde quepa una contraseña**. Las credenciales viajan aparte en `DatabaseCredentials`, se usan al abrir la conexión y se descartan. Una prueba unitaria falla si alguien añade al dominio una propiedad llamada «password», «secret» o «credential», y otra comprueba el esquema real de SQLite.

Implementaciones por sistema, todas tras `ISecretStore`:

- **Windows:** Administrador de credenciales, por P/Invoke a `advapi32`.
- **macOS:** Llavero, mediante la herramienta `security`.
- **Linux:** Secret Service, mediante `secret-tool` de libsecret.

### 2. Sin almacén no se guarda nada

Si el sistema no ofrece uno —modo portable, o un escritorio Linux sin libsecret— se usa `NullSecretStore` y la aplicación **pide la contraseña en cada conexión, diciéndolo claramente en la interfaz**.

La alternativa habitual sería cifrar un archivo con una clave que también está en el disco. Eso no protege de nadie: quien puede leer el archivo cifrado puede leer la clave. Sería seguridad aparente, que es peor que la ausencia de seguridad, porque el usuario confiaría en ella.

### 3. La API local exige un token

Escuchar solo en loopback impide el acceso desde la red, **pero no desde la propia máquina**. Sin token, cualquier proceso del usuario —incluida una página web abierta en el navegador— podría abrir sesiones contra sus bases de datos y ejecutar lo que quisiera.

- Se genera un token de 32 bytes aleatorios en cada arranque.
- Se escribe en `api-token`, dentro del directorio de datos, con permisos 0600 en Unix.
- Todas las rutas lo exigen en la cabecera `X-Druse-Token`, salvo `/api/health`, que existe justo para saber si el proceso ya arrancó y no expone ningún dato.
- La comparación es en tiempo constante.
- CORS admite solo el origen de la aplicación y solo la cabecera del token.

**Cómo lo obtiene el cliente.** En desarrollo, el proxy del servidor de Angular lee el archivo y añade la cabecera, porque el navegador no puede leer del disco. En producción lo hará el proceso que empaqueta la aplicación (Tauri, Fase 7).

## Alcance real de la protección

Conviene ser precisos sobre qué protege esto y qué no:

- **Protege** frente a otro proceso o página web que intente hablar con la API sin poder leer el directorio de datos del usuario.
- **No protege** frente a un atacante que ya tenga acceso a la cuenta del usuario: puede leer el archivo del token, igual que puede leer todo lo demás. Ese caso está fuera del alcance de una aplicación de escritorio.
- El token **muere con el proceso**: si la aplicación se cierra de forma abrupta el archivo puede quedar en disco, pero ese valor ya no lo acepta nadie y el siguiente arranque lo sobrescribe.

## Consecuencias

**A favor**

- Una contraseña filtrada exige comprometer el almacén del sistema, no leer un archivo.
- El usuario decide si recordar cada contraseña.
- El repartir los datos hace imposible que un volcado de la base local exponga credenciales.

**En contra**

- Tres implementaciones nativas que mantener y probar por separado.
- En macOS, `security` recibe la contraseña como argumento, visible un instante en la lista de procesos. Enlazar Security.framework lo evitaría; queda pendiente.
- El modo portable no podrá recordar contraseñas hasta que exista una bóveda con contraseña maestra (backlog).
