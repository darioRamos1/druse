import { expect, type Page } from '@playwright/test';

/**
 * Lo que hace falta saber de Druse para escribir una prueba.
 *
 * Aquí vive todo lo que es «cómo se pulsa» —el nombre del botón, la forma del
 * menú, cómo se le habla a Monaco— para que las pruebas cuenten **qué** se
 * comprueba y no cómo se llega. Cuando cambie la interfaz, se cambia aquí.
 */

/** El PostgreSQL de pruebas, el mismo que usan las contractuales. */
export const CONTENEDOR = {
  nombre: 'E2E PostgreSQL',
  host: '127.0.0.1',
  puerto: Number(process.env.DRUSE_TEST_PG_PORT ?? 55440),
  base: process.env.DRUSE_TEST_PG_DB ?? 'druse_test',
  usuario: process.env.DRUSE_TEST_PG_USER ?? 'postgres',
  // No es un secreto: es la contraseña del contenedor de pruebas, la misma que
  // está escrita en `build/scripts/test-db.ps1` y en las fixtures del contrato.
  contrasena: process.env.DRUSE_TEST_PG_PASSWORD ?? 'druse_dev_only',
};

/**
 * Espera a que la aplicación esté usable, no solo servida.
 *
 * Son dos esperas distintas y las dos hacen falta. La lista de conexiones llega
 * por HTTP y hasta entonces la barra lateral está vacía **con el mismo aspecto**
 * que si no hubiera ninguna: preguntar antes lleva a crear una conexión que ya
 * existía, y a fallar por nombre repetido. El editor, además, se carga aparte
 * con Monaco y es lo último en aparecer.
 */
export async function abrir(page: Page): Promise<void> {
  const conexiones = page.waitForResponse(
    (response) => response.url().endsWith('/api/connections') && response.request().method() === 'GET',
    { timeout: 60_000 },
  );

  await page.goto('/');

  await conexiones;
  await expect(page.locator('app-sql-editor .monaco-editor')).toBeVisible({ timeout: 90_000 });
}

/**
 * Deja abierta una conexión al contenedor y la pestaña apuntando a su base.
 *
 * Es idempotente: si ya existe de una prueba anterior, la reutiliza. Las pruebas
 * comparten backend, así que crear la conexión en cada una dejaría una lista de
 * perfiles repetidos y la segunda fallaría por nombre duplicado.
 */
export async function conectar(page: Page): Promise<void> {
  const sidebar = page.locator('app-connections-sidebar');
  const fila = sidebar.getByText(CONTENEDOR.nombre).first();

  if ((await fila.count()) === 0) {
    await crearConexion(page);
  }

  const base = sidebar.getByText(CONTENEDOR.base, { exact: true }).first();

  /**
   * Un clic sobre la conexión la abre o la cierra, según cómo esté.
   *
   * Por eso solo se pulsa cuando sus bases no están ya a la vista: hacerlo por
   * costumbre plegaría el árbol que acaba de desplegar el diálogo, y la prueba
   * se quedaría esperando algo que ella misma acaba de esconder.
   */
  if (!(await base.isVisible().catch(() => false))) {
    await fila.click();
  }

  await expect(base).toBeVisible({ timeout: 60_000 });

  await apuntarPestana(page);
}

/** Rellena el diálogo de conexión nueva y conecta. */
async function crearConexion(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nueva conexión' }).click();

  const dialogo = page.locator('app-connection-dialog');

  await expect(dialogo).toBeVisible();

  await dialogo.locator('.engine', { hasText: 'PostgreSQL' }).first().click();

  /**
   * Los campos se localizan por su etiqueta y no por su posición.
   *
   * No vale `getByLabel`: la etiqueta envuelve al campo y también al mensaje de
   * error, así que su texto accesible cambia en cuanto algo está mal escrito y
   * la prueba dejaría de encontrarlo justo cuando más falta hace.
   */
  const campo = (etiqueta: string) =>
    dialogo.locator(`.field:has(.field__label:text-is("${etiqueta}")) input`).first();

  await campo('Nombre').fill(CONTENEDOR.nombre);
  await campo('Servidor').fill(CONTENEDOR.host);
  await campo('Puerto').fill(String(CONTENEDOR.puerto));
  await campo('Base de datos').fill(CONTENEDOR.base);
  await campo('Usuario').fill(CONTENEDOR.usuario);
  await campo('Contraseña').fill(CONTENEDOR.contrasena);

  /**
   * Sin cifrar, que es lo que ofrece el contenedor.
   *
   * El diálogo propone «Cifrado» por omisión —lo correcto para un servidor de
   * verdad— y la imagen oficial de PostgreSQL viene sin TLS, así que la sesión
   * se queda a medias: la conexión se guarda, pero no abre. Es la misma
   * elección que haría cualquiera contra una base local.
   */
  await dialogo.getByRole('button', { name: 'Sin cifrar' }).click();

  /**
   * Lo que responda el servidor mientras se conecta.
   *
   * Sin esto, un fallo aquí se ve como «el diálogo no se cerró en 60 segundos»,
   * que no dice nada: puede ser el motor, el perfil, el proxy o la propia
   * pantalla. Se recogen las respuestas para poder contar cuál de los cuatro.
   */
  const respuestas: string[] = [];

  page.on('response', async (response) => {
    const url = response.url();

    if (!url.includes('/api/connections') && !url.includes('/api/sessions')) {
      return;
    }

    if (response.status() >= 400) {
      respuestas.push(`${response.status()} ${url} → ${(await response.text()).slice(0, 300)}`);
    }
  });

  await dialogo.getByRole('button', { name: 'Conectar' }).click();

  try {
    await expect(dialogo).toBeHidden({ timeout: 60_000 });
  } catch (error) {
    const enPantalla = await dialogo.locator('.field__error, .alert, [role="alert"]').allTextContents();

    throw new Error(
      'El diálogo de conexión no se cerró.\n' +
        `En pantalla: ${enPantalla.join(' · ') || '(ningún mensaje)'}\n` +
        `Del servidor: ${respuestas.join('\n') || '(ninguna respuesta con error)'}\n` +
        `Original: ${(error as Error).message}`,
    );
  }
}

/** Apunta la pestaña activa a la conexión y la base del contenedor. */
export async function apuntarPestana(page: Page): Promise<void> {
  const chip = page.locator('app-editor-toolbar .chip').first();

  if ((await chip.textContent())?.includes(CONTENEDOR.base)) {
    return;
  }

  await chip.click();
  await page.locator('.context__option', { hasText: CONTENEDOR.nombre }).first().click();
  await expect(page.locator('app-editor-toolbar .chip').first()).toContainText(CONTENEDOR.nombre, {
    timeout: 30_000,
  });

  await chip.click();
  await page.locator('.context__option', { hasText: CONTENEDOR.base }).first().click();
  await expect(chip).toContainText(CONTENEDOR.base);
}

/**
 * Escribe SQL en el editor.
 *
 * Va por la API de Monaco y no tecleando: escribir carácter a carácter dispara
 * el autocompletado, que al llegar un salto de línea acepta la sugerencia
 * marcada y mete en el documento algo que la prueba no pidió.
 */
export async function escribirSql(page: Page, sql: string): Promise<void> {
  await page.evaluate((texto) => {
    const editor = (window as any).monaco.editor.getEditors()[0];

    editor.setValue(texto);
    editor.focus();
  }, sql);
}

/** Pone el cursor donde lo pondría una persona al hacer clic. */
export async function situarCursor(page: Page, linea: number, columna: number): Promise<void> {
  await page.evaluate(
    ({ lineNumber, column }) => {
      const editor = (window as any).monaco.editor.getEditors()[0];

      editor.focus();
      editor.setPosition({ lineNumber, column });
    },
    { lineNumber: linea, column: columna },
  );
}

/**
 * Los valores de la primera columna de resultados, en orden.
 *
 * Se piden las celdas de valor y no la primera celda de la fila: esa es la del
 * número de fila, y una prueba que la leyera compararía contra «1», «2», «3» y
 * pasaría diga lo que diga la consulta.
 */
export async function primeraColumna(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const grid = document.querySelector('app-results-grid');

    if (!grid) {
      return [];
    }

    return [...grid.querySelectorAll('.body .row')].map(
      (row) => row.querySelector('.cell--value')?.textContent?.trim() ?? '',
    );
  });
}

/** Lo que el editor está subrayando como error de la última ejecución. */
export async function marcaDeError(
  page: Page,
): Promise<{ linea: number; texto: string; mensaje: string } | null> {
  return page.evaluate(() => {
    const monaco = (window as any).monaco;
    const model = monaco.editor.getEditors()[0].getModel();

    const [marker] = monaco.editor.getModelMarkers({
      owner: 'druse-execution',
      resource: model.uri,
    });

    if (!marker) {
      return null;
    }

    return {
      linea: marker.startLineNumber,
      texto: model.getValueInRange({
        startLineNumber: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLineNumber: marker.endLineNumber,
        endColumn: marker.endColumn,
      }),
      mensaje: marker.message,
    };
  });
}

/**
 * Ejecuta y espera a que el resultado esté en pantalla.
 *
 * La espera se arma **antes** de pulsar, y por la respuesta del servidor y no
 * por el estado de los botones: «Cancelar» está deshabilitado tanto cuando la
 * consulta ha terminado como cuando todavía no ha empezado, así que esperar a
 * que lo esté daba por hecha una ejecución que aún no había salido y se miraba
 * la rejilla de la consulta anterior.
 */
export async function ejecutar(page: Page, que: 'todo' | 'la del cursor'): Promise<void> {
  const respuesta = page.waitForResponse(
    (r) => r.url().includes('/api/queries') && r.request().method() === 'POST',
    { timeout: 60_000 },
  );

  await page.keyboard.press(que === 'todo' ? 'Control+Enter' : 'Control+Shift+Enter');

  await respuesta;

  // La respuesta ya está; falta que Angular la pinte.
  await expect(page.getByRole('button', { name: 'Cancelar' })).toBeDisabled({ timeout: 30_000 });
}

/** Los conjuntos de resultados que se ofrecen, cuando la consulta trajo varios. */
export function conjuntos(page: Page) {
  return page.locator('app-results-panel .sets__tab');
}
