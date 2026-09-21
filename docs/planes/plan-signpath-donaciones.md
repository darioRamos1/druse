# Plan de preparación para SignPath Foundation y donaciones

Avance del 21 de septiembre: Darío autorizó abrir el repositorio y continuar. `darioRamos1/druse` es público desde el 16 de septiembre, con GPL y avisos en `main`, comprobado también sin autenticación. Implementada y probada localmente la [edición Comunidad](../distribucion/edicion-comunidad.md) sin Oracle/IBM/IKVM, con canal propio y guardas de contenido. La API publicada arranca y ejecuta una consulta SQLite; no hay todavía una beta aprobada para SignPath. SNI/WebView2, consentimiento durante la instalación, redistribución y pruebas de Windows limpio siguen abiertos.

Cierre técnico del bloque Comunidad, 21 de septiembre: PR #18 integrado en `main`; instalador NSIS e inventario construidos en GitHub y descargados con SHA-256 coincidente. Pasaron las comprobaciones de API/SQLite, exclusiones y canal Rust, y 969 pruebas locales del frontend. Pages desplegó correctamente. Véanse [hashes, ejecución y límites](../distribucion/edicion-comunidad.md). La última respuesta localizada en Gmail sigue siendo la del 16 de septiembre; el seguimiento está redactado, sin enviar. Esto no cierra PKG-04, OSS-03/04, PUB-04 ni SIG-01.

Avance del 16 de septiembre: [respuesta de SignPath recibida](../distribucion/consulta-signpath-borrador.md). Druse aún no está listo para revisión: requieren repositorio público, artefacto publicado con alcance definido, licencia, inventario y flujo de construcción/firma. Podrían evaluar una edición independiente sin Oracle/IBM; no es una admisión. SNI, WebView2 y consentimiento durante la instalación no quedaron resueltos expresamente. OSS-03 y SIG-01 siguen abiertos. El siguiente paso propuesto es concretar DEC-03 y la edición candidata, manteniendo la distribución completa fuera de ese alcance de firma.

Avance del 15 de septiembre: [revisión de controladores](../revisiones/controladores-signpath-2026-09-15.md), ocho documentos de evidencia local con hashes y consulta de elegibilidad actualizada a GPL v3 con el permiso adicional existente. Consulta enviada a `info@signpath.io` desde `druse.contacto@gmail.com` a las 14:21 (America/Bogota), con confirmación de Gmail. OSS-03/04 siguen abiertos: faltan términos completos del JDBC, reconciliación de redistribuibles IBM y respuesta sobre elegibilidad. No se retiraron motores.

Creación: 12 de septiembre de 2026. Actualización: 14 de septiembre de 2026. Estado: fase A abierta; preparación de fases B, C y E adelantada en lo que no depende de decisiones del titular.

Última comprobación: [revisión del 14 de septiembre](../revisiones/revision-signpath-2026-09-14.md), con inventario actualizado, guardas de CI y manifiestos verificadas, y pendientes de candidatura. SIG-01 sigue abierto: preparar el expediente no equivale a presentarlo.

Continuación del 14 de septiembre: aviso de privacidad incorporado a Preferencias y enlazado desde la landing con contenido compartido (P-04 implementado, pendiente de distribución). Preparado el [protocolo del instalador](../distribucion/pruebas-instalador-signpath.md); PKG-04, P-02 y P-03 siguen abiertos hasta ejecutarlo en Windows limpio.

Primer bloque ejecutado: [auditoría de apertura](../revisiones/auditoria-apertura-2026-09-13.md), inventario de dependencias y corrección de puertos de pruebas. OSS-01 continúa abierto por las comprobaciones de procedencia y alcance pendientes; no hay aprobación de publicación.

Segundo bloque ejecutado: comprobación del contenido del paquete con manifiesto de hashes (PKG-02), documentos de apertura y [matriz de motores](../motores/matriz-de-motores.md) (PUB-01), [política de firma](../../CODE_SIGNING_POLICY.md) en borrador (PUB-03) y presupuesto de [financiación](../distribucion/financiacion.md) con gastos comprobados (DON-03). La [privacidad de la aplicación](../privacidad/privacidad-aplicacion.md) queda redactada y su hueco P-01 corregido dentro de la aplicación; PUB-02 sigue abierta por la desinstalación, la captura de tráfico y el consentimiento en el instalador. **Nada de esto cambia la visibilidad del repositorio, activa un cobro ni presenta una solicitud.**

Objetivo: preparar una candidatura verificable de Druse y habilitar aportes voluntarios. La aceptación de SignPath y la aprobación de GitHub Sponsors son resultados externos, no promesas del plan. Las donaciones pueden comenzar antes de obtener firma.

Complementa la [guía de sostenibilidad](../guias/guia-estrategia-open-source.md) y desarrolla la ruta SignPath de **REL-005** del [plan de mejoras](PLAN_MEJORAS_DRUSE.md). La alternativa Microsoft Store permanece en el [plan de distribución](../distribucion/distribucion-windows-smartscreen.md).

## 1. Punto de partida

| Evidencia local | Consecuencia para el plan |
| --- | --- |
| Repositorio `darioRamos1/druse` privado; `LICENSE` GPL-3.0-only incorporado el 14 de septiembre | Licencia elegida; apertura y revisión de procedencia pendientes. |
| Instalador completo 1.1.0 generado, con firma Tauri verificada y sin Authenticode | Hay una base de empaquetado; todavía no una release firmada por SignPath. |
| `Druse.Provider.Oracle` usa `Oracle.ManagedDataAccess.Core` | Auditar los términos incluidos en ese paquete. |
| `Druse.Provider.Informix` usa `Net.IBM.Data.Db2`; `Druse.Jdbc` incorpora JDBC de IBM | Auditar los tres componentes y sus archivos redistribuidos. |
| `IncludeInformix=false` ya existe; Oracle se referencia incondicionalmente en el host | La variante actual «sin Informix» no es automáticamente una edición apta para SignPath. |
| Hay CI y workflow de releases; se observó un bloqueo de Actions por facturación | Revalidar el servicio antes de depender de él. No dar por resuelto el bloqueo al abrir el repositorio. |
| Landing en el repositorio, sin despliegue público confirmado; texto legal en borrador | Faltan enlaces públicos y privacidad de la aplicación. |
| Contacto confirmado: `druse.contacto@gmail.com` | Puede usarse como contacto público; no sustituye la identidad del titular. |

Este inventario no es una auditoría completa de licencias, secretos ni seguridad.

## 2. Condiciones externas y decisiones

SignPath pide licencia OSI sin doble licencia comercial, mantenimiento, publicación y reputación verificable. Excluye componentes propietarios salvo bibliotecas de sistema admitidas. Exige MFA, responsables de revisión/aprobación, aprobación manual por release y una política de firma pública. También exige desinstalación, aviso de cambios del sistema y protección de privacidad; las transferencias de datos contempladas en sus condiciones requieren aviso y opción de desactivación durante la instalación. Prohíbe herramientas destinadas a explotar vulnerabilidades o eludir protecciones. La fundación decide la admisión. [Condiciones oficiales](https://signpath.org/terms.html).

Decisiones a registrar por Darío antes de ejecutar las acciones correspondientes:

- [x] **DEC-01:** Darío autorizó hacer público el repositorio actual el 16 de septiembre. Visibilidad pública aplicada y verificada; GPL y avisos incorporados a `main`. Esto no cierra por sí solo la revisión de procedencia de OSS-01/04.
- [x] **DEC-02-L:** Darío eligió GPL v3 el 14 de septiembre de 2026; aplicada como `GPL-3.0-only`, exclusivamente versión 3, al código original de Druse. Texto oficial en `LICENSE` y metadatos actualizados.
- [ ] **DEC-02-R:** confirmar derechos sobre código y recursos, incluidos aportes de colaboradores y trabajo realizado en contexto laboral. La elección de licencia no cierra esta revisión ni cambia términos de terceros.
- [x] **DEC-03:** al continuar el plan tras la respuesta, se prepara Comunidad con PostgreSQL, SQL Server, MySQL/MariaDB y SQLite. Oracle/Informix se mantienen en la completa. La elegibilidad de SNI y WebView2 queda abierta.
- [ ] **DEC-04:** confirmar titular, residencia, cuenta receptora y niveles de aportes. Colombia es la hipótesis de trabajo, no una verificación de residencia.

Responsables propuestos: Darío decide publicación, licencia, identidad y solicitudes; mantenimiento técnico prepara código, documentación y verificaciones. Se debe confirmar quién revisará contribuciones y aprobará firmas; no inventar miembros ni requisitos de tamaño del equipo.

## 3. Fase A — Auditar antes de abrir

Dependencias: ninguna para iniciar la revisión. Estimación propia: 2–4 jornadas, ampliables si aparecen incidencias.

- [ ] **OSS-01:** revisar archivos versionados, ramas, etiquetas e historial para detectar credenciales, claves de firma, bases de datos, dumps, capturas y datos de empresas. Guardar hallazgos con valores ocultos; rotar cualquier secreto expuesto antes de publicar. Un `.gitignore` no limpia el historial.
- [x] **OSS-02:** producir el inventario inicial `docs/licencias-dependencias.csv`: componente, versión, procedencia, licencia, fuente de sus términos, inclusión en cada edición y decisión pendiente/aprobada. Actualizado a 1.144 entradas y un inventario local de 612 archivos de API. Incluye dependencias de desarrollo y otras plataformas. La cobertura y las limitaciones están en la revisión del 14 de septiembre; falta reconciliar cada archivo distribuido y resolver las decisiones de licencia antes de cerrar H1.
- [ ] **OSS-03:** resolver específicamente Oracle, Db2 y JDBC de Informix. [Respuesta recibida el 16 de septiembre](../distribucion/consulta-signpath-borrador.md): probablemente deben excluirse de la edición candidata salvo excepción demostrada; una edición separada y funcional sin ellos podría evaluarse. Ese alcance ya se implementó en Comunidad; quedan SNI/WebView2 y las condiciones de distribución de la edición completa. No asumir que descargar el controlador aparte resuelve la elegibilidad del proyecto.
- [ ] **OSS-04:** `LICENSE` y `COPYRIGHT` incorporados; `THIRD_PARTY_NOTICES.md` identifica el inventario y las revisiones pendientes. Los tres viajan en `api/` de cada paquete: `package.ps1` se detiene si faltan o no coinciden con el repositorio, y la verificación de la release rechaza un manifiesto sin ellos. "Acerca de" muestra autoría, licencia y ausencia de garantía. `COPYRIGHT` concede un permiso adicional (GPL v3, sección 7) para combinar Druse con cuatro controladores no libres: Oracle.ManagedDataAccess.Core, Net.IBM.Data.Db2 con su clidriver, el JDBC de Informix y Microsoft.Data.SqlClient.SNI. Falta completar los avisos originales por archivo distribuido, revisar los términos de redistribución de esos controladores y finalizar procedencia.

**Salida:** alcance de publicación definido, hallazgos sensibles resueltos e inventario sin componentes de estado desconocido en la edición candidata. Esta fase permite decidir si conviene continuar con SignPath antes de invertir en integración.

## 4. Fase B — Preparar la edición candidata

Dependencias: OSS-02/03 y DEC-03. Estimación propia: 3–6 jornadas.

- [x] **PKG-01:** `package.ps1 -Community` excluye Oracle/Informix de referencias y registro del host, verifica los archivos resultantes y genera artefactos `-comunidad`, con identidad de instalador y canal de actualización propios. Es una candidata sin aprobación de SignPath; ver [alcance y pruebas](../distribucion/edicion-comunidad.md).
- [x] **PKG-02:** revisar el contenido real del paquete publicado, incluidas dependencias transitivas. Fallar la construcción si aparecen archivos excluidos por la decisión OSS-03. Generar un inventario de archivos y hashes de cada build. `build/scripts/manifiesto.ps1` inventaría cada archivo con su SHA-256, `build/paquete-excluidos.json` declara qué no puede viajar en cada variante y `package.ps1` detiene la construcción si aparece. Comprobado con las dos variantes reales: 612 archivos y 298 MB la completa, 402 y 140 MB la ligera, sin rastro de IBM ni IKVM en esta última. Oracle y SNI figuran como pendientes y **no** detienen nada mientras OSS-03 y DEC-03 sigan abiertos.
- [x] **PKG-03:** ajustar selector, lista de motores, documentación y actualizaciones para que cada edición conserve sus capacidades. Una actualización nunca debe cambiar de edición o incorporar controladores excluidos sin una decisión explícita del usuario. El selector, el canal por edición y la documentación ya existían; lo que faltaba era que alguien lo comprobara. Una prueba de Rust fija que el canal de actualización lleva la edición dentro —sin ese sufijo, las dos pedirían la misma entrada de `latest.json`— y la verificación de release rechaza que las dos ediciones anuncien el mismo artefacto o que un manifiesto de contenido describa otra variante. Ese caso no es hipotético: Tauri nombra igual los dos instaladores y ya pasó que la segunda construcción pisara a la primera.
- [ ] **PKG-04:** probar instalación, primera conexión, consulta, exportación, actualización y desinstalación en Windows sin herramientas de desarrollo, con datos sintéticos. Comprobar WebView2, proceso auxiliar y recuperación tras fallos de red.

**Salida:** artefacto candidato identificable, contenido revisado y pruebas registradas. Mantener la edición completa fuera del circuito de firma hasta resolver su alcance.

## 5. Fase C — Abrir y publicar una beta

Dependencias: fases A/B y DEC-01/02. Estimación propia: 2–4 jornadas, sin contar captación de usuarios.

- [x] **PUB-01:** preparar `SECURITY.md`, `CONTRIBUTING.md`, plantillas de incidencias y una matriz de motores realmente comprobados. Pedir reportes sin contraseñas ni datos de clientes. Escritos, con tres plantillas de incidencia y una de PR. `CONTRIBUTING.md` establece GPL-3.0-only para aportes y exige revisión de procedencia. La [matriz de motores](../motores/matriz-de-motores.md) separa el rango anunciado de la versión probada y deja a la vista que Oracle no se prueba en CI y que MariaDB no se prueba en ningún sitio.
- [ ] **PUB-02:** completar privacidad de Druse: conexiones elegidas por el usuario, búsqueda automática de actualizaciones, proveedores de IA, registros y credenciales. Redactada la [privacidad de la aplicación](../privacidad/privacidad-aplicacion.md) contrastada con el código. La consulta automática ya está desactivada hasta recibir autorización y puede desactivarse en Preferencias. **Sigue abierta** por aclarar el aviso durante la instalación (P-01), comprobar qué deja la desinstalación (P-02), observar tráfico real (P-03), mostrar o enlazar la política (P-04) y completar los datos del responsable (P-05).
- [x] **PUB-03:** preparar `CODE_SIGNING_POLICY.md` en borrador y enlazarlo desde README y descargas. Añadir la atribución requerida por SignPath solo cuando corresponda a un servicio concedido; antes indicar «solicitud pendiente». Incluir procedimiento de incidente y contacto.
- [ ] **PUB-04:** publicar el código aprobado y una beta con notas, hashes y estado real de firma. Comprobar desde una sesión sin autenticar el README, los archivos de release, la landing y las URLs del actualizador.
- [ ] **PUB-05:** recoger pruebas voluntarias, incidencias y correcciones públicas. Preparar enlaces a esta evidencia para la candidatura; las estrellas compradas o los testimonios inventados no son evidencia.

**Salida:** una persona externa puede inspeccionar el código y probar la edición anunciada. No fijar una cifra de descargas o plazo como garantía de admisión.

## 6. Fase D — Solicitar e integrar SignPath

Dependencias: beta pública y alcance resuelto. Estimación propia de ingeniería: 2–5 jornadas; revisión externa sin plazo comprometido.

- [ ] **SIG-01:** completar, revisar y presentar la [solicitud](https://signpath.org/apply.html); registrar respuesta y condiciones particulares. El borrador está reunido en [expediente-signpath.md](../distribucion/expediente-signpath.md), con texto en inglés y pendientes explícitos. Faltan derechos y compatibilidad de licencias revisados, enlaces públicos, alcance de dependencias resuelto y evidencia de uso. **Preparación adelantada; presentación y respuesta pendientes.**
- [ ] **SIG-02:** una vez habilitado el servicio, configurar el proyecto con los identificadores reales de SignPath. Usar runners alojados por GitHub para los jobs previos a la solicitud, subir el artefacto a Actions y enviarlo por su ID al conector. Guardar el token como secreto limitado, fijar acciones por SHA y descargar el resultado firmado. [Integración oficial](https://docs.signpath.io/trusted-build-systems/github).
- [ ] **SIG-03:** acordar el alcance de firma del EXE NSIS y los PE propios internos, con metadatos de producto/versión restringidos. No aplicar una regla global que firme DLL de terceros. Comprobar qué formatos y anidamientos admite la configuración antes de diseñar el flujo; no asumir que NSIS permite el mismo proceso que MSI. [Referencia de artefactos](https://docs.signpath.io/artifact-configuration/reference).
- [x] **SIG-04:** dividir `release.ps1` en construcción, firma/verificación y publicación. Mantener el requisito de CI verde para el commit exacto y detener la publicación ante firma rechazada, caducidad de la solicitud o fallo de verificación. Tres etapas ejecutables por separado —`-Etapa construir|verificar|publicar`—, porque cuando firme un servicio externo habrá que verificar y publicar los bytes que vuelven, no reconstruirlos. La verificación comprueba que cada `.sig` corresponde a los bytes, que `latest.json` dice lo mismo que los archivos, que Authenticode no es inválido y que los instaladores son los que revisó el empaquetado. Publicar exige integración continua verde para el commit exacto; `-SinComprobarCI` la salta y queda anotado en `evidencia.json` junto al commit, los hashes y cada comprobación.

Orden propuesto para Druse, a ajustar al flujo aprobado por SignPath:

```text
Commit y CI verificados
  → construir binarios propios
  → firmar/verificar los binarios internos acordados
  → empaquetar NSIS sin reconstruirlos
  → firmar/verificar el instalador final
  → generar .sig de Tauri y SHA-256 sobre esos bytes finales
  → verificar manifiestos y publicar
```

La firma Authenticode modifica el archivo: una `.sig` o un hash calculados antes ya no sirven para ese instalador. La prueba negativa ya existe —`build/tests/verificacion-de-actualizacion.cjs` altera un artefacto firmado y comprueba el rechazo, y `build/tests/release-verificacion.ps1` hace lo propio con las guardas de la publicación—, y se comprobó también contra el instalador real de 1.1.0: con un byte cambiado, rechazado. Falta conservar el request ID de SignPath cuando exista; commit, hashes y resultado de cada comprobación ya se guardan en `evidencia.json`.

**Salida:** instalación y actualización desde una release pública con Authenticode y sellado de tiempo válidos, además de la firma Tauri. Solo entonces evaluar el cierre de REL-005. El aviso de SmartScreen sigue dependiendo de reputación; no prometer su desaparición por usar SignPath.

## 7. Fase E — Donaciones mediante GitHub Sponsors

Puede avanzar tras publicar el trabajo abierto, sin esperar SIG-01/04. Estimación propia: 1–2 jornadas de preparación más revisión del proveedor.

GitHub Sponsors admite Colombia y aportes únicos o mensuales. GitHub no cobra comisión por aportes desde cuentas personales; desde organizaciones puede cobrar hasta 6%. Esto no calcula impuestos ni conversión de moneda del receptor. [Disponibilidad y tarifas](https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors).

- [ ] **DON-01:** Darío completa el registro, 2FA, datos de identidad, bancarios y fiscales mediante el proveedor. Si elige cuenta bancaria directa, verificar que su región coincide con la residencia. Revisar y aceptar los términos personalmente. No guardar documentos, números bancarios ni formularios fiscales en Git. [Guía de alta](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/setting-up-github-sponsors-for-your-personal-account).
- [x] **DON-02:** redactar un borrador del perfil y niveles en [financiacion.md](../distribucion/financiacion.md). Incluye propósito, responsable propuesto, contacto y destino de los aportes. Pendientes de DEC-04: aporte único de US$5; mensual de US$3, US$5 o US$10. Son propuestas sin activar cobros ni prometer servicios.
- [x] **DON-03:** preparar `docs/distribucion/financiacion.md` con presupuesto inicial basado en gastos comprobados. Priorizar pruebas, mantenimiento y correcciones. Meta sugerida de validación: US$25 mensuales recurrentes, sin comprometer gastos fijos basándose en ella. Gasto monetario comprobado: **cero**. La evidencia incómoda es que CI no está ejecutando nada: la última ejecución terminó en fallo con sus quince trabajos sin ejecutar un paso, y con el token disponible no se puede leer la facturación para confirmar la causa.
- [ ] **DON-04:** tras aprobarse el perfil, comprobar su URL real y añadir `.github/FUNDING.yml`, enlace en README y botón «Apoyar Druse» en la landing. `github: darioRamos1` es una configuración candidata, no prueba de que Sponsors esté activo. No publicar botones hacia un cobro inexistente.
- [ ] **DON-05:** usar un enlace externo sencillo al proveedor, sin widget ni rastreo adicional. Explicar el destino antes de salir. Texto propuesto: «Tu aporte voluntario ayuda a mantener Druse y mejorar su compatibilidad. Puedes usar la aplicación sin aportar».
- [ ] **DON-06:** revisar desde móvil y escritorio el enlace, receptor, moneda y periodicidad hasta antes de confirmar un pago. No realizar cargos de prueba sin autorización. Verificar más adelante el primer abono real, cuando exista.
- [ ] **DON-07:** llevar un registro privado de ingresos brutos, deducciones, abonos y gastos; revisar el tratamiento fiscal aplicable al titular antes de atribuir exenciones o beneficios tributarios. Publicar solo un resumen agregado y nombres de patrocinadores con permiso.

**Salida:** perfil aprobado, receptor correcto, enlaces operativos y explicación clara de los aportes. La primera donación es una métrica de adopción, no un requisito para declarar terminada la configuración.

## 8. Orden, seguimiento y contingencias

| Hito | Evidencia para cerrarlo | Estado |
| --- | --- | --- |
| H1 — Elegibilidad técnica y licencia | OSS-01/04 y decisiones registradas | Pendiente |
| H2 — Beta pública | PKG-01/04 y PUB-01/05, URLs comprobadas | Pendiente; PKG-02, PKG-03, PUB-01 y PUB-03 hechos |
| H3 — Donaciones habilitadas | DON-01/07, sin exigir ingresos | Pendiente |
| H4 — Solicitud SignPath presentada | Expediente y acuse de SIG-01 | Pendiente; el expediente está reunido, sin presentar |
| H5 — Primera release firmada | SIG-02/04 y pruebas de instalación/actualización | Pendiente |

Plan orientativo: semanas 1–2 para auditoría y decisiones; semanas 3–4 para edición y beta; después donaciones, recogida de evidencia y solicitud. Las estimaciones son de trabajo técnico, no fechas de aprobación ni previsiones de ingresos.

Si SignPath rechaza la candidatura, registrar el motivo y corregir solo lo que resulte compatible con el producto; considerar Microsoft Store/MSIX como alternativa. Si las condiciones exigen perder funciones esenciales, reconsiderar la ruta antes de retirarlas. Las opciones comerciales de la guía de sostenibilidad requieren reevaluación frente a este programa; no asumir que una edición propietaria o doble licencia conserva la elegibilidad.

Si Sponsors no se aprueba, no inventar un enlace alternativo: comparar disponibilidad, comisiones y requisitos del siguiente proveedor antes de integrarlo. Si Actions sigue bloqueado, resolver el bloqueo o acordar con SignPath otro sistema admitido; el instalador local no sustituye la procedencia exigida por su conector.

Revisar mensualmente descargas agregadas, reportes voluntarios, usuarios que regresan, aportantes recurrentes, ingresos netos y tiempo de mantenimiento. A los 90 días decidir cuánto trabajo sostener con esa evidencia. El presupuesto inicial debe poder mantenerse con cero donaciones.

## 9. Qué toca ahora

La documentación y las guardas de publicación han avanzado. Siguen pendientes decisiones **DEC-01 a DEC-04**, revisión de procedencia/licencias y verificaciones técnicas de Windows y privacidad:

1. **DEC-02-R y OSS-04:** GPL-3.0-only ya está elegida y aplicada al código original. Completar derechos, avisos de terceros y compatibilidad de distribución. `CONTRIBUTING.md` ya establece términos GPL para aportes y revisión de procedencia.
2. **OSS-03 / DEC-03:** concretar la edición independiente sin Oracle/IBM que SignPath permite evaluar bajo condiciones. Comprobar exclusiones e independencia del artefacto; aclarar SNI/WebView2. La [respuesta recibida](../distribucion/consulta-signpath-borrador.md) no aprueba componentes ni obliga a retirar motores de la distribución completa.
3. **P-01 de privacidad:** hecho dentro de la aplicación —la consulta automática queda desactivada mientras nadie la autorice, con aviso en el primer arranque y ajuste en Preferencias—, pero la respuesta no aclara si basta ese momento. Sigue pendiente resolver la condición **durante la instalación**; no marcarla cumplida por la valoración positiva del consentimiento explícito.
4. **PKG-04:** probar instalación, actualización y desinstalación en un Windows limpio; de ahí sale la respuesta a P-02.
5. **DON-01:** alta en Sponsors con los datos del titular. Solo después se crea `.github/FUNDING.yml`.

En la fase D, **SIG-04** tiene etapas de release y guardas comprobadas: requiere el workflow `ci.yml` del commit exacto y ambos manifiestos con producto, versión, variante y hashes correctos. La excepción explícita `-SinComprobarCI` sigue registrada; no acredita una construcción verificada para SignPath. **SIG-01 permanece abierto**, con el expediente preparado pero sin presentar. SIG-02 y SIG-03 se completan con la configuración y el alcance que acuerde SignPath si concede el servicio.

Las dos cosas que la matriz de motores dejó a la vista ya están corregidas: la exigencia de motores de la integración continua se acotó con `DRUSE_OPTIONAL_ENGINES=oracle` —la cobertura de Oracle sigue siendo local, pero ahora está declarada— y la imagen de Informix va por digest.
