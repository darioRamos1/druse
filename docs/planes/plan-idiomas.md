# Plan — Druse en varios idiomas

Creación: 16 de septiembre de 2026. Estado: **fase 1 terminada** (22 de septiembre de 2026): la interfaz entera está en el catálogo —1 564 claves, inglés al 100 %—, no queda ninguna plantilla con texto a mano y el camino crítico pasa en los dos idiomas. Lo siguiente es la fase 2: los mensajes del backend y de Tauri (§3, §4).

Objetivo: que Druse se pueda usar entero en **español, inglés, portugués de Brasil
y francés**, y que añadir un quinto idioma sea traducir un archivo, no tocar código.

---

## 0. Decisiones tomadas

| Tema | Decisión |
| --- | --- |
| Idiomas | `es` (idioma fuente), `en` (respaldo), `pt-BR`, `fr`. |
| Alcance | Interfaz, mensajes del backend y de Tauri, asistente de IA, landing, aviso de privacidad, notas de versión e instalador. |
| Elección | Primer arranque: idioma del sistema si Druse lo tiene; si no, inglés. Se cambia en Preferencias y se aplica al momento, sin reiniciar. |
| Mecanismo en Angular | Servicio propio basado en signals y catálogos JSON. Sin dependencias nuevas. |
| Errores del backend | La API devuelve una clave y sus parámetros; el frontend pone el texto. Hay un solo catálogo. |
| Textos legales | Se traducen, pero manda el español, y así se indica. Los traduce o revisa el mantenedor, no la comunidad. |
| Referencia de SQL | Un archivo por idioma (`sql-reference.{es,en}.ts`), no claves del catálogo: es documentación —93 funciones y palabras reservadas— y meterla clave a clave obligaría a la comunidad a traducir documentación de SQL para llegar al umbral de §6. Una prueba compara las dos. |
| Traducciones | Las hace la comunidad en Weblate (o Crowdin). |
| Entregas | Cuatro fases que se pueden publicar por separado (§8). |

---

## 1. Punto de partida

| Lo que hay hoy | Qué implica |
| --- | --- |
| Ninguna biblioteca ni servicio de idiomas en `frontend/`. Unas 8 900 líneas de plantillas y literales en español repartidos por el TypeScript (`command-palette.ts`, `shortcuts-sheet.ts`, `connection-dialog.ts`…). | Es el grueso del trabajo. Se migra por *features*, nunca todo de golpe. |
| `'es'` fijo en los formatos: `explorer-store.ts:729`, `activity-dialog.ts:36`, `diagram-layout.ts:198,273`, `editor-toolbar.ts:435`, `query-history.ts:44`, `results-grid.ts:724`, `results-panel.ts:434`, `operation-progress.ts:101`. | Números, fechas y orden alfabético tienen que seguir al idioma elegido. |
| Plurales armados a mano (`'1 fila' : '… filas'`). | Hacen falta plurales de verdad: el francés trata el 0 como singular. |
| `frontend/src/index.html` declara `lang="en"`, aunque la interfaz está en español. | Error de accesibilidad que ya existe: los lectores de pantalla pronuncian mal. |
| `text-match.ts` busca por «la inicial de la palabra en español». | La búsqueda de la paleta tiene que funcionar en cualquier idioma. |
| Backend: `QueryError.Message`, `BackupFailure`, `TransferFailure`, `RestoreFailure`, validadores y normalizadores de error (`SqliteErrorNormalizer.Text`, `InformixErrorNormalizer.Explain`…) devuelven español. | Hay que añadir clave y parámetros sin romper el contrato de hoy. |
| Tauri: títulos de diálogos nativos (`backups.rs`) y errores (`api_process.rs`, `editor_background.rs`) en español. | El frontend ya sabe el idioma: los títulos pueden llegar como parámetro. |
| `AiEndpoints.Compose` manda un `SystemPrompt` fijo que no dice en qué idioma responder. | Basta con una instrucción más y con que la petición diga el idioma. |
| NSIS ya tiene `["Spanish", "English"]`. | Añadir `PortugueseBR` y `French`. |
| La landing es HTML escrito a mano con `lang="es"`. `generar-privacidad-web.cjs` genera la privacidad desde `privacy-notice.html`. | Ya hay un patrón de «un origen, varias salidas» que se puede extender por idioma. |
| Las pruebas e2e buscan por nombre accesible en español (`name: 'Formatear'`). | Las e2e se fijan en `es`; los otros idiomas se prueban con pseudolocalización. |
| El repositorio sigue siendo **privado** ([plan SignPath](plan-signpath-donaciones.md)). | Hosted Weblate gratuito exige un proyecto libre y público. La fase 3 depende de abrir el repositorio. |

**Lo que no se traduce**, a propósito:

- **La cabecera de los respaldos** (`BackupSinks.cs:104`, «-- Respaldo generado por Druse», «-- Formato: 1»). Es formato de archivo: la restauración y sus pruebas la leen. Si cambia según el idioma, un respaldo hecho en inglés no se podría restaurar en español.
- **Los mensajes que vienen del motor** (el texto de `ORA-00942` o de PostgreSQL). Llegan en el idioma del servidor. Druse traduce solo la explicación que añade encima.
- Los logs, los comentarios del código, los nombres de los commits y los documentos internos de `docs/`.
- El SQL, los identificadores y las palabras clave.

---

## 2. Frontend

### 2.1 Catálogos

```
frontend/src/i18n/
  es.json      ← fuente, siempre completo
  en.json
  pt-BR.json
  fr.json
```

- **Claves semánticas por feature**, planas y con puntos: `connections.dialog.title`, `results.rows`. Nunca se usa el texto en español como clave: si se corrige una tilde, no se pierde la traducción.
- **Formato ICU reducido**: interpolación `{name}`, `plural` y `select`. Weblate lo valida con la marca `icu-message-format`.

  ```json
  { "results.rows": "{count, plural, one {# fila} other {# filas}}" }
  ```

- Los catálogos se **empaquetan** con `import()` dinámico: nada de `fetch` a `assets/`. En Tauri no hay servidor, y así cada idioma es un chunk aparte que solo se descarga si se usa.

### 2.2 `I18nService`

En `core/i18n/`, con unas 150 líneas más sus pruebas:

- `locale = signal<Locale>()`, `setLocale(locale)` carga el catálogo y cambia la signal.
- `t(key, params?)` devuelve una `string`. Como lee la signal, las plantillas y los `computed` se actualizan solos.
- `TranslatePipe` (`{{ 'editor.format' | t }}`), impuro y con caché por clave, idioma y parámetros.
- Cadena de respaldo: `pt-BR` → `en` → `es` → la propia clave. En modo desarrollo, además, un aviso en consola.
- `Intl.PluralRules` para los plurales, y un parser ICU propio, pequeño, que solo entiende lo de §2.1.

### 2.3 Formatos

`LocaleFormat` (en el mismo módulo) sustituye los nueve `'es'` fijos de §1: `number()`, `date()`, `relative()` y un `Intl.Collator` para ordenar. Una prueba de arquitectura falla si vuelve a aparecer `toLocaleString('es'` o `localeCompare(…, 'es')`.

### 2.4 Preferencia y arranque

Se copia el patrón de la apariencia (`theme.service.ts`):

1. **Antes de arrancar Angular**: se lee `localStorage` (con `try/catch`). Si no hay nada, se usa `navigator.languages`, que en WebView2 refleja el idioma del sistema. Con eso se decide el idioma y se carga el catálogo, para que la primera pantalla no se vea un instante en español.
2. Correspondencias: `es-*` → `es`, `pt-*` → `pt-BR` (también `pt-PT`, a falta de algo mejor), `fr-*` → `fr`, cualquier otro → `en`.
3. Después se guarda con las demás preferencias del backend, y la copia de `localStorage` sirve solo para arrancar sin parpadeo.
4. En `<html>` se actualizan `lang` y el `title` del documento.
5. Preferencias añade el selector de idioma, con cada nombre escrito en su propio idioma («Español», «English», «Português (Brasil)», «Français»). Los idiomas que no lleguen al umbral de §6 aparecen marcados como «beta».

### 2.5 Casos especiales

- **Paleta de comandos**: `text-match.ts` compara con el texto traducido, sin tildes y en minúsculas según el idioma. Cada comando conserva también su clave en inglés como alias, para que quien cambie de idioma siga encontrando «format».
- **Atajos y ayuda de teclado** (`shortcuts-sheet.ts`): las descripciones pasan al catálogo. Las teclas no cambian.
- **Monaco**: su interfaz propia (el buscador, el menú contextual) **ya sale en español** (22 de septiembre). Druse carga Monaco con su cargador AMD, y el paquete trae `vs/nls/lang/{es,fr,pt-br,…}.js`: un script que deja los textos en `globalThis._VSCODE_NLS_MESSAGES` y que hay que cargar *antes* que Monaco. No es un módulo AMD, así que pedirlo con la opción `vs/nls` del cargador lo deja esperando y el editor no arranca. Hoy el archivo es fijo (`es`); con el selector, tiene que seguir al idioma elegido, y como Monaco solo lee los textos al evaluarse, cambiar de idioma exige recargar el editor.
- **`aria-label` y `title`**: pasan también al catálogo. Es lo que más se olvida y lo que peor se nota con un lector de pantalla.

### 2.6 Guardas

- `build/scripts/check-i18n.mjs`, ejecutado en la CI, comprueba que:
  - `es.json` y `en.json` tengan exactamente las mismas claves;
  - cada clave de `pt-BR` y `fr` exista en `es` (se admite que falten claves, pero se informa el porcentaje);
  - los parámetros `{…}` coincidan entre idiomas y el ICU sea válido;
  - no haya claves que ya no use nadie.
- **Detector de literales**: una regla que busca texto visible en las plantillas (nodos de texto y `aria-label`/`title`/`placeholder` que no pasan por `t`). Empieza con una lista de excepciones que se va vaciando feature a feature; la fase 1 se cierra con la lista vacía.
- **Pseudolocalización**: un idioma `qps` solo para desarrollo, que convierte «Formatear» en `[Ƒöŕɱåţéåŕ ~~~~]`. Alarga el texto un 40 % y marca el principio y el final. Se añade al barrido de `e2e/tests/barrido.spec.ts` a 900 px, y así se ven de una vez los textos sin traducir y los recortes que traerá el francés (entre un 15 % y un 20 % más largo).
- Las pruebas de componente arrancan con `es` por defecto; las e2e fijan `es` en `localStorage` antes de cargar. Una e2e corta recorre el camino crítico en `en`.

---

## 3. Backend (.NET)

### 3.1 Contrato

Se **añade** información sin quitar nada, para poder migrar poco a poco:

```csharp
public sealed record QueryError
{
    public required string Message { get; init; }       // se queda: logs y respaldo
    public string? MessageKey { get; init; }            // "errors.session.notOpen"
    public IReadOnlyDictionary<string, string>? MessageArgs { get; init; }
    public string? Code { get; init; }                  // código del motor, igual que hoy
    …
}
```

Se hace lo mismo con `BackupFailure`, `TransferFailure`, `RestoreFailure` y las respuestas de validación. El frontend usa `MessageKey` si viene, y si no, `Message`. Así, en ningún momento de la migración se ve un mensaje vacío.

### 3.2 Claves

- Una clase `MessageKeys` con constantes, para que el compilador detecte las erratas.
- **Prueba unitaria** que lee `frontend/src/i18n/es.json` y falla si alguna constante de `MessageKeys` no está allí. Esta prueba une los dos lados del repositorio.
- Orden de migración: validadores (conexión, perfil de IA) → servicios de sesión → normalizadores de error de cada motor (solo la explicación que añade Druse) → respaldos, restauraciones y transferencias.
- Los parámetros se mandan **sin formatear** (números y fechas en formato invariante), y el frontend los formatea en el idioma elegido.

### 3.3 Asistente de IA

- `AiChatDto` gana `Locale`.
- `Compose` añade una instrucción de sistema: *«Responde en {nombre del idioma}. Los identificadores y el SQL no se traducen.»*
- La etiqueta «Contexto del editor y de la base» y el `SystemPrompt` pueden quedarse en un solo idioma: el modelo no los enseña. La instrucción de idioma es lo que decide.
- Prueba: `Compose` incluye la instrucción del idioma pedido y, sin `Locale`, usa `es` (compatibilidad con la versión anterior).

---

## 4. Tauri (Rust)

- **Diálogos nativos**: los comandos (`backups.rs`, `sql_files.rs`, `exports.rs`…) reciben `title` y los nombres de los filtros desde el frontend, que ya los tiene traducidos. En Rust no hace falta catálogo.
- **Errores**: devuelven un código (`api.startFailed`, `image.unreadable`) y un detalle técnico. El frontend los traduce como los del backend.
- **Lo que se muestra antes de que haya WebView** (por ejemplo, si la API local no arranca y se enseña con un diálogo nativo): una tabla mínima en Rust con esos pocos mensajes, elegida con `sys-locale`. Primero hay que confirmar si ese caso existe.
- **Instalador NSIS**: `languages: ["Spanish", "English", "PortugueseBR", "French"]` y `displayLanguageSelector`. `shortDescription` y `longDescription` son metadatos únicos de Windows y se dejan en inglés. De paso, `longDescription` está desactualizada: solo nombra PostgreSQL y SQL Server.

---

## 5. Web, privacidad y notas de versión

- **Landing**: un generador `build/scripts/generar-landing.cjs` a partir de una plantilla y `landing/i18n/{es,en,pt-BR,fr}.json`. Genera `/`, `/en/`, `/pt-br/` y `/fr/` con `<link rel="alternate" hreflang>`, más un selector visible. **No** se redirige automáticamente ni se guarda la preferencia en cookies: la web presume de no tenerlas.
- **Aviso de privacidad**: `privacy-notice.{es,en,pt-BR,fr}.html`. `generar-privacidad-web.cjs` genera una página por idioma. Las versiones traducidas llevan arriba: *«Traducción informativa. En caso de diferencia prevalece la versión en español»*, con enlace a esa versión. Estos archivos **quedan fuera de Weblate**.
- **Notas de versión**: se publican en `es` y `en`. El actualizador enseña las del idioma elegido, y `pt-BR` y `fr` ven las inglesas. Traducir las notas a cuatro idiomas en cada versión no compensa.

---

## 6. Traducción en comunidad

- **Weblate** (Hosted Weblate, plan Libre para proyectos libres) mejor que Crowdin: es software libre, se puede alojar uno mismo si hiciera falta y encaja con la GPL. Crowdin Open Source es la alternativa si Weblate no aprueba el proyecto.
- **Componentes**: `frontend/src/i18n/*.json` (JSON clave-valor, monolingüe, con `es` como fuente) y `landing/i18n/*.json`. Weblate propone los cambios como PR, y la CI pasa `check-i18n`.
- **Glosario** antes de abrir: respaldo/backup, esquema, fila, motor, conexión, transferencia, perfil, divulgación… Se decide una vez y Weblate lo aplica en sus comprobaciones.
- **Contexto**: cada clave lleva una descripción de dónde aparece (en Weblate, con el archivo de explicaciones) y, en las pantallas importantes, una captura del barrido.
- **Umbral para publicar un idioma**: con un 100 % de las claves de interfaz aparece sin marca; con un 80 % o más aparece como «beta», y lo que falte se ve en inglés; por debajo del 80 % no aparece en Preferencias.
- **Mientras el repositorio siga privado**: el mantenedor hace el `en` con ayuda de IA. Si se quiere, `pt-BR` y `fr` se siembran con IA para que la comunidad empiece revisando en vez de traduciendo desde cero, y hasta la revisión no pasan de «beta».
- `CONTRIBUTING.md` gana una sección «Traducir Druse».

---

## 7. Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| R1 | La migración de la interfaz toca casi todas las plantillas y choca con el trabajo en curso. | Una feature por commit temático, en la rama actual. El detector de literales, con su lista de excepciones, permite parar y seguir en cualquier punto. |
| R2 | Textos armados concatenando en TypeScript (`` `1–${n} de ${total}` ``) que no se pueden traducir por partes. | Cada frase entera es una clave con parámetros. Con la pseudolocalización se ven las que quedan partidas. |
| R3 | La interfaz interna de Monaco sigue en inglés. | **Resuelto** para el español (§2.5). Queda que siga al idioma elegido. |
| R4 | El francés y el portugués son más largos y rompen las barras que ya se ajustaron (plan de mejoras visuales). | Barrido con `qps` a 900 px y otra pasada con `fr` antes de publicarlo. |
| R5 | Weblate depende de abrir el repositorio, y esa fecha la marca el plan de SignPath. | Las fases 1 y 2 no dependen de la comunidad; `en` lo hace el mantenedor. |
| R6 | El orden alfabético cambia con el idioma (árbol, diagrama). | Es lo esperado. Las pruebas que dependan del orden fijan `es`. |
| R7 | El modelo de IA no respeta el idioma cuando el usuario escribe en otro. | Se prioriza el idioma del mensaje del usuario y, si no está claro, el de la interfaz. Se deja dicho así en la instrucción. |
| R8 | Se cuela por error una traducción de la cabecera de los respaldos. | Una prueba de restauración con un respaldo creado con la interfaz en `en`. |

---

## 8. Fases

### Fase 1 — Base e interfaz en español e inglés

1. `core/i18n`: servicio, pipe, parser ICU, `LocaleFormat`, preferencia, arranque sin parpadeo, `lang` en `<html>`.
2. `check-i18n`, detector de literales con lista de excepciones, idioma `qps` y su paso en el barrido.
3. Selector en Preferencias.
4. Migración por features, cada una en su commit: `layout` (barra superior, barra de estado, paleta, atajos) → `settings` → `connections` → `query-editor` → `query-results` → `database-explorer` → `tables` → `query-builder` → `diagram` → `transfer`/`import` → `backup` → `activity`/`query-history` → `ai` → `shared/ui`.
5. `en.json` completo.

**Terminada cuando**: la lista de excepciones del detector está vacía, el barrido `qps` no encuentra texto sin marcar ni recortes nuevos, las e2e pasan en `es`, el camino crítico pasa en `en`, y se ha revisado en la app levantada, en los dos temas.

**Cómo quedó** (22 de septiembre de 2026):

- 1 564 claves en `es`, las mismas en `en`. `build/i18n-pendientes.json` ya no lista ninguna plantilla pendiente; solo el aviso de privacidad, marcado como lo que no va al catálogo y por qué (fase 4).
- Lo que componen las funciones puras —los comentarios del SQL del compositor, los avisos del escritor— llega al idioma por `core/i18n/active.ts`, que guarda el servicio de esta ventana. Sin servicio cae al catálogo fuente, así que las pruebas que llaman a la función suelta siguen comprobando el texto.
- Las e2e abren Druse en el idioma que se les pida (`DRUSE_E2E_LOCALE`) y comparan contra el mismo catálogo: el camino crítico se escribe una vez y pasa en `es` y en `en`.
- `tests/idiomas.spec.ts` es el paso del pseudoidioma. Con el texto un 40 % más largo no se recorta nada, y lo único que sale sin marcar son datos y los nombres de los idiomas, que van en el suyo a propósito.

### Fase 2 — Backend, Tauri e IA

1. `MessageKey`/`MessageArgs` en los contratos y `MessageKeys` con su prueba contra `es.json`.
2. Migración de los mensajes en el orden de §3.2.
3. Títulos y errores de Tauri.
4. `Locale` en el chat de IA.

**Terminada cuando**: con la interfaz en `en`, una conexión mal configurada, un respaldo que falla y una transferencia sin columnas comunes muestran su mensaje en inglés, y el asistente responde en inglés.

### Fase 3 — Comunidad, portugués y francés

Depende de que el repositorio sea público.

1. Glosario y descripciones de las claves.
2. Proyecto en Weblate conectado al repositorio. Sección en `CONTRIBUTING.md`.
3. Siembra opcional de `pt-BR` y `fr` con IA, como «beta».
4. Paso del barrido con `fr` y `pt-BR`.

**Terminada cuando**: cada idioma supera el umbral de §6 y aparece en Preferencias.

### Fase 4 — Web, privacidad, notas e instalador

1. Generador de la landing por idioma, con `hreflang`.
2. Aviso de privacidad en cuatro idiomas, con la nota de que prevalece el español.
3. Notas de versión en `es` y `en`, y el actualizador que elige cuáles enseñar.
4. NSIS con los cuatro idiomas y el selector de idioma.

**Terminada cuando**: la web publicada tiene las cuatro versiones enlazadas entre sí y el instalador se ha probado en Windows con el sistema en inglés.

---

## 9. Pendiente de decidir

- Si el `SystemPrompt` de la IA se pasa al inglés, que suele obedecerse mejor, o se queda en español con la instrucción de idioma. Se decide midiendo en la fase 2.
- Si los mensajes de error de validación que ya se muestran en los formularios necesitan también un texto corto para `aria-describedby`, o sirve el mismo.
- Plataforma definitiva (Weblate o Crowdin) cuando se abra el repositorio.
