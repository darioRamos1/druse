# Plan de implementación · Identidad de empresa en los tableros

12 de noviembre de 2026 · Propuesta.

## 1. Qué se busca

Que un tablero de Reportes BI pueda ser **el tablero de una empresa**: con su
logo, su nombre, sus datos y su color, en pantalla y en lo que se exporta.

| Hoy se puede | Falta |
|---|---|
| Nombre del tablero y de sus páginas | Logo |
| Título, descripción y encabezado de cada panel | Encabezado con nombre de la empresa, subtítulo y datos (NIT, dirección, contacto) |
| Color del tablero o del panel, entre los 8 tonos de la paleta | Color de marca exacto (`#0A6CBF`) |
| PDF con título, filtros y fecha | Logo y datos de la empresa en el PDF, con pie de página |
| Excel con hoja de resumen y gráficos editables | Logo y datos en la hoja de resumen; color de marca en los gráficos |

Fuera de este plan: tipografías propias (licencias y empaquetado de fuentes),
fondos con imagen y temas completos por empresa. Se pueden plantear después.

## 2. Lo que ya existe y se reutiliza

| Pieza | Dónde | Uso |
|---|---|---|
| Modelo del tablero (`DashboardModel`, `DashboardStyle`) | `features/reports/report-dashboard-model.ts` | El estilo del tablero gana la referencia a una identidad. Hoy guarda solo `color`. |
| Guardado de tableros (JSON validado como JSON) | `ReportDashboard`, `SqliteReportDashboardStore`, `ReportEndpoints.cs` | Sin cambios de forma: la referencia viaja en el modelo. |
| Base local de Reportes | `ReportsDatabase.cs` (`reports.db`) | Una tabla nueva para las identidades, con el logo como BLOB. |
| Paleta por tema (`--rc-*` en claro y en oscuro) | `features/reports/_report-palette.scss` | El color de marca entra como un tono más, con su variante para cada tema. |
| Herencia de color panel → reporte → tablero → tema (`ColorSource`) | `report-dashboard-model.ts` | «Marca» se añade como origen entre tablero y tema. |
| Vista de impresión | `features/reports/report-print` | Encabezado con logo y datos, y pie de página. |
| Exportación a Excel (ClosedXML y OpenXML) | `Druse.Infrastructure/Exports/ReportWorkbookWriter.cs`, `ReportExport.cs` | El logo y los datos en la hoja de resumen; el color de los gráficos ya admite hexadecimal. |
| Plantillas (máximo 512 KB) | `ReportTemplate.cs`, `report-template-model.ts` | La identidad **no** viaja por defecto; se puede incluir a propósito. |

## 3. Diseño

### 3.1 Identidades de empresa, reutilizables

Una **identidad** es un conjunto con nombre que se elige en cada tablero:

| Campo | Detalle |
|---|---|
| Nombre de la empresa | Obligatorio. Es también el texto alternativo del logo. |
| Subtítulo | Opcional: «Informe mensual de ventas», un área, un eslogan. |
| Datos | Hasta tres líneas libres: NIT, dirección, teléfono, web. |
| Logo | Opcional. Ver 3.2. |
| Color de marca | Opcional, en hexadecimal. Ver 3.3. |
| Pie de página | Opcional, para el PDF: «Confidencial», «Uso interno»… |

Se guardan en `reports.db` y se gestionan desde Reportes BI («Identidades»,
junto a Tableros). Un tablero guarda solo el id de la identidad: cambiar el logo
de la empresa actualiza todos sus tableros, y quien prepara informes para varios
clientes tiene una identidad por cliente.

Un tablero sin identidad se ve exactamente como hoy.

### 3.2 Logo

- Formatos: PNG, JPEG y WebP. **SVG** se acepta solo convertido a PNG en el
  propio Druse al subirlo: un SVG puede llevar código, y guardarlo tal cual
  obligaría a sanearlo en cada sitio donde se pinta.
- Al subirlo se reduce a un máximo de 1.200 × 400 px y se guarda en PNG o JPEG.
  Límite de 512 KB tras reducirlo; si no cabe, se dice.
- La API comprueba el tipo por sus primeros bytes, no por la extensión, y las
  dimensiones, antes de guardarlo.
- Se sirve desde la API local con su tipo; en el modelo del tablero solo viaja
  el id de la identidad.
- Vista previa sobre fondo claro y oscuro al subirlo: un logo negro sin fondo no
  se ve en el tema oscuro. Se puede marcar «poner fondo blanco al logo en el
  tema oscuro».

### 3.3 Color de marca

- Se elige con un selector de color o escribiendo el hexadecimal.
- Druse calcula su variante para el tema oscuro (más clara, mismo tono) y
  comprueba el contraste contra las superficies de los paneles en los dos temas:
  3:1 para barras y líneas, 4,5:1 si se usa como color de texto. Si no llega,
  lo dice y propone el tono más cercano que sí llega.
- En el tablero pasa a ser el color «heredado» de los paneles que no eligen
  otro, por delante del color del tema. Un panel puede seguir eligiendo un tono
  de la paleta.
- «Un color por categoría» sigue usando la paleta de 8 tonos, que es la que se
  validó para daltonismo; el color de marca no se mezcla con ella.
- `ReportChart` hoy recibe un tono de la paleta por nombre. Se amplía para
  aceptar un color propio, con sus dos variantes como variables CSS.

### 3.4 Encabezado del tablero

- En pantalla: logo a la izquierda, nombre y subtítulo, y los datos en una línea
  discreta. Se puede ocultar en la vista de edición para ganar espacio.
- En pantallas estrechas el logo se reduce y los datos pasan debajo.
- El nombre del tablero y la fecha de los datos siguen visibles como hoy.

### 3.5 Exportaciones

- **PDF:** encabezado con logo, nombre, subtítulo y datos en la primera página;
  en las demás, una franja reducida con logo y nombre. Pie con el texto de la
  identidad y «Página n de m» (`@page` y contadores de CSS de impresión).
- **Excel:** en la hoja de resumen, el logo (imagen anclada a las primeras
  celdas) y debajo nombre, subtítulo y datos; las cifras empiezan después. Los
  gráficos editables usan el color de marca cuando es el heredado.
- **CSV:** sin cambios; son datos.

### 3.6 Plantillas

- Al guardar un tablero como plantilla, la identidad **no** se incluye por
  defecto: las plantillas se comparten, y llevarse el logo de una empresa a
  otra sería un error fácil.
- Una casilla «Incluir la identidad (logo y datos)» la incluye. Al importarla en
  otra instalación se crea la identidad si no existe, avisando antes.
- El límite de 512 KB de las plantillas cuenta el logo incluido.

### 3.7 Idiomas, accesibilidad y privacidad

- Todo texto nuevo en español e inglés, en el catálogo.
- El logo lleva como texto alternativo el nombre de la empresa. El encabezado
  es un `banner` con su título, y el foco no pasa por elementos decorativos.
- Las identidades viven en el equipo, en `reports.db`, como el resto de
  Reportes BI. No salen de Druse salvo en lo que el usuario exporta.

## 4. Fases y criterios de aceptación

Cada fase es una entrega visible: versión *minor*, novedades en español e
inglés, comprobaciones y commit, como indica `AGENTS.md`.

| Fase | Trabajo | Cómo se valida |
|---|---|---|
| 1. Identidades | Tabla en `reports.db`, API (crear, editar, borrar, servir el logo), validación del logo por bytes, tamaño y dimensiones, y editor en Reportes BI con vista previa en los dos temas y comprobación de contraste. | Crear una identidad con logo PNG, SVG convertido y JPEG grande reducido; rechazar un archivo renombrado y uno demasiado grande; borrar una identidad en uso pide confirmación y deja sus tableros sin identidad. Pruebas de backend, frontend y una E2E. |
| 2. Tablero con identidad | Elegir la identidad del tablero, encabezado en pantalla, color de marca como heredado y `ReportChart` con color propio. | Un tablero de dos páginas con identidad se ve con logo, datos y color en claro y en oscuro; un panel con tono propio lo conserva; cambiar el logo de la identidad cambia el tablero. Barrido de capturas. |
| 3. Exportaciones | Encabezado y pie del PDF; logo y datos en la hoja de resumen de Excel; color de marca en los gráficos editables. | Con un filtro activo y las bases desconectadas, exportar el tablero: el PDF lleva logo, datos y páginas numeradas, y el Excel abre con el logo en el resumen y los gráficos del color de la marca. |
| 4. Plantillas | Incluir o no la identidad al guardar; importarla con aviso. | Una plantilla sin identidad no lleva el logo; con identidad, al importarla en un perfil limpio se crea la identidad y el tablero sale igual. |

**Estado:** fase 1 hecha el 12 de noviembre de 2026, en la versión 1.25.0.
Cambios respecto a lo previsto:

- El logo se sirve como JSON (tipo y base64) y no como imagen: la API pide su
  cabecera de acceso, y un `<img>` no puede mandarla. La interfaz monta la
  imagen con un `data:`; el PDF de la fase 3 podrá usar lo mismo.
- Se lee el tipo y el tamaño de PNG, JPEG y WebP por su cabecera, sin
  decodificar la imagen. El servidor no acepta SVG: la interfaz lo convierte.
- «Borrar una identidad en uso» pasa a la fase 2: hasta que los tableros la
  nombren, ninguna está en uso.
- La lista de identidades va en la barra lateral de Reportes, debajo de
  Tableros, y cada una enseña el punto de su color.

## 5. Riesgos y decisiones abiertas

- **Una identidad por tablero o por instalación.** *Decidido el 12 de noviembre
  de 2026: por tablero*, con identidades reutilizables. Cubre a la empresa que
  usa Druse para sí misma y a quien prepara informes para varios clientes, con
  una identidad por cliente.
- **Logos con transparencia en el tema oscuro.** Se resuelve con la vista previa
  en los dos temas y la opción de fondo blanco; no se intenta adivinar.
- **Colores de marca poco legibles.** No se bloquean: se avisa y se propone uno
  cercano. La decisión es de la empresa.
- **Tamaño de `reports.db`.** Con logos de 512 KB como máximo y una identidad
  por empresa, el crecimiento es pequeño y entra en la cuota de almacenamiento
  que ya enseña Reportes BI.
