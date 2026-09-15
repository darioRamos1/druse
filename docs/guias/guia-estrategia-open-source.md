# Guía de estrategia open source y sostenibilidad de Druse

> Documento de referencia para tomar decisiones futuras. No obliga a publicar el
> código ni sustituye una revisión legal de las licencias de terceros.

El [plan operativo de SignPath y donaciones](../planes/plan-signpath-donaciones.md) concreta
esta guía en tareas y criterios de aceptación. Las opciones futuras de módulos
propietarios o doble licencia necesitan una nueva evaluación de elegibilidad;
no deben asumirse compatibles con SignPath Foundation.

## 1. Decisión recomendada

Druse debería priorizar adopción y confianza antes que una suscripción. La ruta
con menor riesgo para un desarrollador independiente es:

1. Validar el producto con el usuario real que ya utiliza Informix.
2. Preparar una edición que pueda publicarse legalmente como open source.
3. Lanzar una beta gratuita y conseguir usuarios fuera del entorno cercano.
4. Aceptar donaciones sin depender de ellas para financiar el proyecto.
5. Monetizar primero servicios, soporte e integraciones.
6. Considerar una edición comercial únicamente cuando exista demanda demostrada.

Abrir el código puede reducir la barrera de confianza de una aplicación que
maneja conexiones y datos sensibles. Sin embargo, las donaciones suelen ser
pequeñas e impredecibles; no deben ser el único modelo de sostenibilidad.

## 2. Posicionamiento

Druse no debe presentarse solo como «otro editor SQL». El mercado ya tiene
alternativas gratuitas y maduras. La propuesta que merece validarse es:

> Cliente de bases de datos local y seguro para explorar, editar, trasladar y
> reproducir datos entre motores modernos y sistemas Informix, mostrando el SQL
> antes de modificar información.

Los posibles diferenciadores son:

- Migraciones guiadas entre conexiones y motores.
- Respaldos lógicos selectivos y reproducibles.
- Escrituras transaccionales con SQL visible antes de ejecutarse.
- Perfiles de solo lectura y confirmación de operaciones peligrosas.
- Credenciales almacenadas por el sistema operativo.
- Funcionamiento local y sin cuenta obligatoria.
- Compatibilidad comprobada con Informix y escenarios de modernización.

Conectar, ejecutar SQL, editar una cuadrícula, exportar CSV o añadir IA son
funciones necesarias, pero por sí solas no diferencian el producto.

## 3. Público inicial

El primer público no tiene que ser una empresa grande. Conviene buscar personas
que sufran el problema directamente:

- Desarrolladores que mantienen aplicaciones con Informix.
- Consultores que trasladan datos entre desarrollo, pruebas y producción.
- Equipos pequeños que modernizan sistemas hacia PostgreSQL o SQL Server.
- Usuarios que encuentran DBeaver complejo para sus tareas habituales.
- Entornos corporativos donde la aplicación debe funcionar localmente.

El líder de desarrollo que ya prueba Druse debe tratarse como el primer usuario
de diseño. Sus tareas reales sirven para descubrir problemas, pero no bastan
para demostrar que existe mercado. La siguiente meta es encontrar al menos
cinco usuarios externos con necesidades similares.

## 4. Etapas

### Etapa 0: validación interna

Objetivo: comprobar que Druse resuelve un trabajo real antes de publicarlo.

- Registrar las tareas que realiza el primer usuario con Informix.
- Observar dónde necesita ayuda o vuelve a otra herramienta.
- Probar catálogo, consultas, edición, cancelación, tipos especiales y errores.
- Probar al menos una migración y una restauración con datos no sensibles.
- Anotar cuánto tiempo ahorra y qué riesgos evita.
- Obtener permiso antes de publicar cualquier testimonio o caso de uso.

Criterio para avanzar: el usuario vuelve a usar Druse por decisión propia y
puede mencionar una tarea concreta que hace mejor o más rápido.

### Etapa 1: preparación legal y técnica

Objetivo: poder distribuir código y binarios sin crear una deuda legal o de
seguridad.

- Elegir una licencia OSI y agregar `LICENSE`.
- Crear un inventario de dependencias y sus licencias.
- Agregar avisos de terceros cuando corresponda.
- Confirmar por escrito los derechos de uso y redistribución de controladores de
  IBM, paquetes NuGet, archivos JAR y componentes nativos.
- Separar componentes propietarios u opcionales de la edición open source.
- Definir una política de privacidad clara, aunque no exista telemetría.
- Agregar una política para reportar vulnerabilidades.
- Documentar qué datos permanecen locales y cuáles podrían enviarse a servicios
  de IA cuando el usuario los configura.
- Validar el instalador en una máquina limpia.
- Publicar una matriz de motores y versiones realmente comprobados.
- Asegurar que CI, Releases y actualizaciones funcionen desde un repositorio
  accesible para usuarios sin autenticación.

#### Licencia candidata

`MPL-2.0` es una candidata razonable si se quiere mantener abierto el núcleo y
conservar la posibilidad de crear módulos separados en el futuro. Exige publicar
las modificaciones realizadas a archivos cubiertos, pero permite combinarlos con
módulos bajo otra licencia.

`Apache-2.0` facilita la adopción y reutilización, pero también permite que otra
persona distribuya comercialmente una versión modificada. `GPL-3.0` protege con
copyleft al programa completo, aunque puede reducir algunas integraciones
comerciales. La elección final debe hacerse después de auditar las dependencias.

#### Consideración especial para Informix

Una licencia open source para Druse no convierte automáticamente en open source
los controladores de IBM. Si no existe permiso claro de redistribución, se puede:

- Publicar una edición sin el controlador propietario.
- Pedir al usuario que instale o descargue el controlador desde IBM.
- Mantener un adaptador abierto que cargue el controlador cuando esté disponible.
- Publicar por separado artefactos sujetos a términos diferentes, si esos términos
  lo permiten.

No se debe asumir que un paquete disponible en NuGet o Maven puede redistribuirse
sin condiciones dentro de un instalador.

### Etapa 2: beta pública

Objetivo: lograr que una persona desconocida pueda descubrir, instalar y utilizar
Druse sin ayuda directa.

La publicación mínima debe incluir:

- README enfocado en el problema que resuelve.
- Tres o cuatro capturas legibles.
- Video de dos a cuatro minutos.
- Instalador y versión portable.
- Instrucciones para PostgreSQL, SQL Server, MySQL/MariaDB e Informix.
- Limitaciones conocidas y alcance real de los respaldos lógicos.
- Guía para reportar errores sin compartir credenciales ni datos sensibles.
- Roadmap corto, sin prometer fechas que no se puedan cumplir.
- Issues y Discussions habilitados con plantillas sencillas.

Demostraciones recomendadas:

1. Conectar Informix y explorar objetos.
2. Ejecutar y cancelar una consulta.
3. Editar una fila viendo el SQL antes de confirmar.
4. Trasladar un subconjunto de datos entre dos motores.
5. Crear y restaurar un respaldo lógico selectivo.

No se deben usar datos reales de una empresa en videos, capturas o archivos de
prueba.

### Etapa 3: distribución sin contactos

Objetivo: llegar a usuarios por el problema que buscan resolver, no mediante una
red personal previa.

Canales posibles:

- IBM TechXchange Community e IIUG.
- LinkedIn, explicando un problema técnico concreto en cada publicación.
- Artículos en Dev.to, Hashnode o un blog propio.
- Comunidades de PostgreSQL, SQL Server e Informix donde la publicación sea
  pertinente y esté permitida.
- GitHub Topics y una descripción del repositorio fácil de encontrar.
- Lanzamientos puntuales en Show HN o Product Hunt cuando la instalación ya sea
  confiable.

Ideas de contenido encontrable por buscadores:

- «Cómo conectar Informix desde una aplicación moderna».
- «Migrar datos de Informix a PostgreSQL de forma controlada».
- «Cómo copiar datos de producción a pruebas sin columnas sensibles».
- «DRDA frente a SQLI: diagnóstico de conexiones Informix».
- «Respaldos lógicos selectivos: alcance y limitaciones».

Cada publicación debe enseñar algo útil aunque el lector no instale Druse. No se
debe repetir el mismo anuncio en muchas comunidades ni contactar personas de
forma masiva.

### Etapa 4: donaciones

Objetivo: permitir que los usuarios apoyen el mantenimiento sin limitar el uso
del programa.

Opciones habituales:

- GitHub Sponsors.
- Open Collective.
- Ko-fi o una plataforma equivalente disponible en el país del responsable.

La página de financiación debe explicar para qué se usará el dinero, por ejemplo:

- Certificado de firma de código.
- Equipos o máquinas de prueba.
- Acceso a versiones de motores compatibles.
- Dominio, sitio web y documentación.
- Tiempo de mantenimiento y corrección de errores.

No se deben prometer tiempos de respuesta, funciones o votos vinculantes a cambio
de una donación. Eso convertiría la donación en una venta o contrato informal.

Expectativa realista: durante los primeros meses, el resultado normal puede ser
cero. Una donación confirma agradecimiento, pero no necesariamente disposición a
pagar una licencia.

### Etapa 5: ingresos sostenibles

Objetivo: financiar el proyecto cuando aparezcan necesidades empresariales
repetidas.

Servicios que pueden venderse sin cerrar el núcleo:

- Instalación y configuración en redes corporativas.
- Diagnóstico de conexiones Informix.
- Migraciones hacia PostgreSQL, SQL Server o MySQL.
- Adaptación a tipos y objetos específicos de una empresa.
- Capacitación y acompañamiento.
- Soporte prioritario con alcance y horario definidos.
- Desarrollo patrocinado de funciones que también puedan quedar abiertas.
- Builds empresariales, despliegue offline o integración con autenticación y
  almacenes de secretos corporativos.

Un servicio puntual puede financiar más trabajo que muchas donaciones pequeñas.
Antes de ofrecer soporte con SLA hay que asegurar que existe capacidad real para
responder y corregir problemas.

### Etapa 6: posible edición comercial

No debe crearse una edición Pro solo por anticipación. Puede evaluarse cuando se
cumplan varias señales:

- Al menos tres organizaciones usan Druse de forma recurrente.
- Existen solicitudes repetidas de soporte, administración o despliegue.
- Dos o más organizaciones manifiestan disposición concreta a pagar.
- El coste de mantener una función empresarial supera lo razonable para el
  proyecto comunitario.

Si se llega a ese punto, son modelos compatibles con una aplicación local:

- Licencia perpetua con doce meses de actualizaciones.
- Renovación opcional de actualizaciones.
- Contrato anual de soporte empresarial.
- Módulos comerciales separados del núcleo open source.

Una suscripción que desactive la aplicación al vencer no encaja bien con la
promesa local y offline. Si se cobra anualmente, debería cobrarse por nuevas
versiones, servicios o soporte, no por conservar acceso a los datos.

## 5. Firma de código

Las firmas del actualizador de Tauri no sustituyen Authenticode. Para que Windows
muestre un editor verificado, los ejecutables necesitan un certificado público de
firma de código.

Antes de tener ingresos hay dos caminos:

- Continuar con binarios sin Authenticode y documentar honestamente el aviso de
  SmartScreen.
- Solicitar el programa gratuito de SignPath Foundation cuando el proyecto
  cumpla todas sus condiciones.

SignPath exige, entre otros puntos, licencia OSI, proyecto mantenido y publicado,
compilaciones verificables y ausencia de componentes propietarios en los
artefactos que firma. La edición con controladores de IBM puede necesitar una
evaluación separada. La aceptación no está garantizada y el editor mostrado sería
`SignPath Foundation`.

No conviene convertir el proyecto en open source únicamente para ahorrar el coste
del certificado. La licencia debe responder a la estrategia completa.

## 6. Métricas útiles

Las estrellas de GitHub ayudan a la visibilidad, pero no demuestran uso. Conviene
revisar cada mes:

| Señal | Qué indica |
| --- | --- |
| Descargas de Releases | Interés inicial |
| Usuarios que regresan o actualizan | Utilidad sostenida |
| Conexiones exitosas reportadas por motor | Compatibilidad real |
| Migraciones y restauraciones completadas | Uso del diferenciador |
| Issues reproducibles de usuarios externos | Adopción real y coste de soporte |
| Personas que contribuyen documentación o código | Salud de la comunidad |
| Solicitudes de soporte o integración pagada | Potencial comercial |
| Donantes recurrentes | Apoyo comunitario, no necesariamente mercado |

No es obligatorio agregar telemetría. Las entrevistas, Discussions, encuestas y
reportes voluntarios pueden aportar información suficiente. Si se incorpora
telemetría, debe ser opcional, mínima y documentada antes de activarse.

### Criterios orientativos a 90 días

No son metas rígidas, sino señales para decidir:

- Cinco usuarios externos completan una conexión.
- Tres usuarios vuelven a utilizar Druse durante varias semanas.
- Dos usuarios completan una migración o restauración realista.
- Existe al menos una contribución o reporte útil externo.
- Se conoce con claridad la función por la que esos usuarios eligieron Druse.

Si hay descargas pero nadie vuelve, se debe mejorar activación y utilidad antes de
añadir funciones. Si nadie lo descubre, se debe mejorar distribución y contenido
antes de concluir que el producto no interesa.

## 7. Plan de lanzamiento de 90 días

### Días 1 a 30: preparar

- Terminar la prueba con el primer usuario de Informix.
- Elegir licencia después de auditar dependencias.
- Preparar una edición legalmente publicable.
- Corregir instalación, actualización y fallos de máquina limpia.
- Crear capturas, video, matriz de compatibilidad y guía de inicio.

### Días 31 a 60: publicar

- Hacer público el repositorio.
- Publicar la primera beta abierta.
- Habilitar Discussions e issues.
- Publicar dos artículos técnicos y una demostración.
- Invitar de forma personal y respetuosa a cinco usuarios potenciales.

### Días 61 a 90: aprender

- Atender primero bloqueos de instalación y conexión.
- Entrevistar a quienes regresen al producto.
- Medir qué flujo usan y qué herramienta reemplazan.
- Publicar correcciones pequeñas y frecuentes.
- Abrir el canal de donaciones solo cuando exista documentación suficiente sobre
  el destino de los fondos.
- Decidir el siguiente trimestre usando uso recurrente, no solo estrellas.

## 8. Decisiones que deben evitarse al principio

- Cobrar una suscripción antes de demostrar uso recurrente.
- Prometer soporte empresarial permanente sin capacidad para cumplirlo.
- Añadir muchos motores para competir por cantidad con DBeaver.
- Priorizar IA genérica sobre compatibilidad, seguridad y migraciones.
- Llamar «backup completo» a un respaldo lógico sin PITR ni recuperación física.
- Publicar controladores propietarios sin confirmar sus condiciones.
- Recopilar datos de uso sin consentimiento y documentación.
- Abrir el código esperando que aparezcan colaboradores automáticamente.
- Medir el éxito solo por estrellas, seguidores o una publicación viral.

## 9. Árbol de decisión futuro

1. ¿Los usuarios externos consiguen instalar y conectar?
   - No: corregir distribución, documentación y compatibilidad.
   - Sí: observar si vuelven.
2. ¿Vuelven para migrar, respaldar o editar con seguridad?
   - No: revisar el problema y el posicionamiento.
   - Sí: fortalecer esos flujos y pedir testimonios.
3. ¿Aparecen solicitudes empresariales repetidas?
   - No: mantener comunidad y donaciones con costes controlados.
   - Sí: ofrecer primero un servicio o soporte acotado.
4. ¿Varias organizaciones quieren la misma capacidad y pagarían por ella?
   - No: evitar una edición Pro prematura.
   - Sí: evaluar módulo comercial o mantenimiento anual sin bloquear la versión
     ya adquirida.

## 10. Revisión periódica

Revisar esta guía cada seis meses o cuando ocurra alguno de estos eventos:

- Cambio de licencia o publicación del repositorio.
- Aceptación o rechazo de un programa de firma gratuito.
- Primer usuario externo recurrente.
- Primera donación.
- Primera solicitud de trabajo pagado.
- Primera organización dispuesta a comprar soporte o una función.

La pregunta principal de cada revisión debe ser: **¿qué trabajo real hace Druse
mejor para sus usuarios y qué evidencia existe?**
