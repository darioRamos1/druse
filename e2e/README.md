# Pruebas de punta a punta

Druse entero, por donde lo usa una persona: Angular en el navegador, la API
local detrás y un PostgreSQL de verdad al fondo. Es el único sitio del
repositorio donde las tres capas se prueban juntas.

## Qué se prueba aquí, y qué no

Las otras suites son más rápidas y más precisas, así que **lo que ellas puedan
cubrir no se repite aquí**:

| Suite | Qué cubre |
| --- | --- |
| `backend/tests/Druse.UnitTests` | Reglas sin motor: guionizado, normalizadores, transacciones. |
| `backend/tests/Druse.ProviderContractTests` | Lo mismo contra los cuatro motores reales, por debajo de la API. |
| `backend/tests/Druse.IntegrationTests` | El contrato HTTP: los mismos flujos por donde entra la interfaz. |
| `frontend` (Vitest) | Componentes y lógica del navegador, con dobles. |
| **`e2e`** | **Que todo lo anterior encaje**: el clic llega al motor y lo que vuelve se dibuja. |

Un caso pertenece aquí solo si necesita las tres capas a la vez. El cálculo de
dónde empieza cada instrucción se prueba en el frontend con texto pelado; que el
cursor, el atajo y el resultado se junten bien, aquí.

## Antes de ejecutarlas

Hace falta el contenedor de PostgreSQL, el mismo que usan las contractuales:

```powershell
./build/scripts/test-db.ps1 -Engine postgres
```

Y para las que cruzan de motor, el suyo: SQL Server (`-Engine sqlserver`) y
Oracle (`-Engine oracle`). Este último tarda un par de minutos la primera vez,
porque crea la base al arrancar.

**SQLite no necesita nada.** Su prueba se crea su propio archivo, así que corre
en cualquier máquina sin levantar un solo contenedor.

## Ejecutarlas

```bash
cd e2e
npm install
npx playwright install chromium   # solo la primera vez
npm test
```

Los servidores los levanta Playwright: la API en el 5188 y el frontend en el
4300, **no** en los puertos de `dev.ps1`. Se puede seguir desarrollando en 4200
con las pruebas corriendo.

La compilación de la API también queda aislada en `%TEMP%\druse-e2e-build`.
Así, en Windows, una API de desarrollo abierta no bloquea las DLL que necesita
compilar E2E. Los datos de las pruebas siguen en su carpeta separada.

Otras formas de lanzarlas:

```bash
npm run test:headed                  # con el navegador a la vista
npx playwright test --grep "editor"  # solo un grupo
npx playwright test --debug          # paso a paso
npm run report                       # el informe de la última ejecución
```

## Dónde escriben

En una carpeta aparte —`%TEMP%\druse-e2e-datos`— y no en el Druse de quien las
lanza. La API guarda ahí conexiones, historial y pestañas, y no tiene ninguna
opción para cambiar de sitio: se consigue arrancando los dos procesos con las
variables de entorno que `AppPaths` y el proxy ya siguen. Sin esto, la primera
ejecución dejaría una conexión de pruebas metida entre las de verdad.

La carpeta **no se vacía sola**, porque en local los servidores se reutilizan
entre ejecuciones y borrarla les quitaría la base de debajo. Las pruebas están
escritas para no depender de lo que encuentren. Para empezar de cero: cerrar los
servidores de prueba y borrarla a mano.

## Reglas que conviene no romper

- **De una en una** (`workers: 1`). Comparten backend, base y almacén de
  conexiones; en paralelo el fallo aparecería en la prueba que no tiene la culpa.
- **Sin reintentos.** Un E2E que solo pasa a la segunda esconde justo lo que hay
  que arreglar.
- **Al editor se le habla por su API**, no tecleando: escribir carácter a
  carácter dispara el autocompletado y el salto de línea acepta la sugerencia
  marcada, metiendo en el documento algo que la prueba no pidió.
- **Los selectores viven en `support/druse.ts`.** Las pruebas cuentan qué se
  comprueba; cómo se pulsa está en un solo sitio.

## Cuando una falla

Playwright guarda la traza, la captura y el árbol de la página en
`test-results/`:

```bash
npx playwright show-trace test-results/<carpeta>/trace.zip
```

En CI eso mismo se sube como artefacto `e2e-informe`.
