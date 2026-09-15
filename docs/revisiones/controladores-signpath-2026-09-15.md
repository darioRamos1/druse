# Controladores y candidatura SignPath — 15 de septiembre de 2026

Estado: revisión documental parcial; OSS-03 y OSS-04 siguen abiertos. La licencia del código original de Druse ya es GPL-3.0-only. `COPYRIGHT` contiene un permiso adicional para cuatro controladores; esta revisión conserva ese texto y no extiende sus permisos.

## Evidencia recogida

Ejecutado `pwsh -NoProfile -File build/scripts/auditar-licencias-controladores.ps1`. El script toma las versiones del inventario, lee las cachés locales y conserva ocho documentos con SHA-256 verificado, sin restaurar dependencias ni cambiar el paquete. Guarda resultados en una carpeta nueva dentro de `artifacts/open-source-audit/controladores-*`, excluida de Git.

| Componente | Versión | Hallazgo | Qué falta |
| --- | --- | --- | --- |
| Oracle.ManagedDataAccess.Core | 23.26.301 | El texto local permite redistribuir el programa sin modificar, sujeto a condiciones, entre ellas acompañar la licencia y conservar avisos. Restringe cobros adicionales por el controlador; contempla productos de pago con valor añadido bajo sus condiciones. | Verificar avisos y forma de distribución de Druse; aclarar elegibilidad con SignPath. Donaciones voluntarias y venta del controlador no deben confundirse. |
| Net.IBM.Data.Db2 | 10.0.0.200 | Hay `Lic_en.txt`, `REDIST.txt` y avisos adicionales de clidriver. El listado redistribuible distingue archivos por plataforma; no basta con el nombre de la licencia en NuGet. | Reconciliar los archivos Windows realmente incluidos con ambas listas REDIST y la información de licencia aplicable. Confirmar requisitos del distribuidor y usuario final. |
| Informix JDBC | 15.0.0.1.1 | El POM identifica una licencia IBM y enlaza un documento antiguo. En el JAR local no se identifican entradas cuyos nombres contengan license/licence, notice, copying o copyright. | Obtener y conservar los términos aplicables a esta versión. Confirmar que permiten la transformación y redistribución mediante IKVM; el permiso de Druse no concede derechos sobre el JAR de IBM. |
| Microsoft.Data.SqlClient.SNI.runtime | 6.0.2 | La licencia autoriza código objeto dentro de aplicaciones bajo condiciones, incluyendo términos protectores para distribuidores y usuarios finales. No es una licencia MIT como la de SqlClient administrado. | Resolver cómo cumplir esas condiciones en Druse y consultar si SignPath lo considera biblioteca de sistema. El permiso adicional GPL no equivale a cumplir el contrato de Microsoft. |

Fuentes de términos: archivos originales recogidos desde los paquetes; [Oracle](https://www.oracle.com/downloads/licenses/oracle-free-license.html), [SNI 6.0.2](https://www.nuget.org/packages/Microsoft.Data.SqlClient.SNI.runtime/6.0.2/License), [paquete IBM](https://www.nuget.org/packages/Net.IBM.Data.Db2/10.0.0.200) y [POM de Informix](https://repo.maven.apache.org/maven2/com/ibm/informix/jdbc/15.0.0.1.1/jdbc-15.0.0.1.1.pom). No se consiguió verificar en esta sesión el texto del enlace antiguo del POM; no se deducen sus permisos del título de la licencia.

## Contraste adicional del paquete IBM

Se contrastaron **121 archivos** del directorio local `api/clidriver` y el proveedor IBM con los nombres de ambas listas REDIST: **92 coincidencias y 29 sin coincidencia**. Estos últimos incluyen 10 DLL del runtime de Visual C++, 17 DLL bajo `icc64`, el aviso `odbc_LI_en.rtf` y el identificador de producto `12.1.4.swidtag`. Es una lista de revisión, no una declaración de infracción: pueden existir permisos y avisos específicos para esos componentes. La presencia del propio aviso entre las diferencias muestra la limitación de comparar solo nombres.

No se construyó un instalador nuevo. Para cerrar la revisión hay que verificar versión, plataforma, avisos y derechos de cada componente, no solo encontrar su nombre. Los 121 hashes y las 29 rutas están registrados en `evidencia.json`. El JAR de Informix revisado contiene 457 entradas y tiene SHA-256 `b544e61c9d37ac667038d2b7f2c06b2337dbb4d3a0fc8d1e66916ace9da467b0`.

## Alternativa SNI administrada

Microsoft documenta `Switch.Microsoft.Data.SqlClient.UseManagedNetworkingOnWindows`, pero lo destina a pruebas y depuración y señala diferencias, entre ellas autenticación Windows fuera de dominio. No se activó ni se retiró la DLL nativa: hacerlo como solución de distribución requeriría evaluar soporte y compatibilidad. [Documentación oficial](https://learn.microsoft.com/en-us/sql/connect/ado-net/appcontext-switches?view=sql-server-ver17#enable-managed-networking-on-windows).

## Consecuencia para la solicitud

Hay que distinguir tres comprobaciones: permiso del código de Druse, derechos que concede cada fabricante y admisión por SignPath. La fundación excluye componentes propietarios salvo bibliotecas de sistema admitidas; un permiso adicional de enlace no cambia esa condición. [Condiciones de SignPath](https://signpath.org/terms.html).

La [consulta preparada](../distribucion/consulta-signpath-borrador.md) se actualizó para declarar GPL v3 y el permiso adicional existente. Pregunta por los componentes de sistema y por una posible edición candidata sin Oracle/IBM. No se ha enviado, no se ha retirado ningún motor y no se considera aprobada ninguna de las cuatro dependencias.

Siguiente evidencia necesaria: respuesta sobre alcance de SignPath, términos completos del JDBC exacto y reconciliación de los redistribuibles de IBM. La revisión del resto del inventario, las pruebas en Windows limpio y la publicación siguen pendientes en el [plan](../planes/plan-signpath-donaciones.md).

Verificaciones locales de esta sesión: el nuevo script terminó correctamente y verificó las copias por SHA-256; pasaron `build/tests/manifiesto-paquete.ps1` y `build/tests/release-verificacion.ps1`, incluidas las comprobaciones de avisos legales ausentes o desactualizados. Estas pruebas no implican una firma Authenticode real ni una ejecución satisfactoria de CI.
