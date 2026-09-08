import { expect, test, type Locator, type Page } from '@playwright/test';

import { abrir, apuntarPestana, conectar, ejecutar, escribirSql } from '../support/druse';

/**
 * Barrido visual de toda la aplicación: recorre pantallas y diálogos, los
 * fotografía y anota lo que se puede medir.
 *
 * No es una prueba de regresión —no afirma nada— sino una herramienta para
 * mirar. Las capturas van fuera de `test-results` a propósito: Playwright limpia
 * esa carpeta en cada arranque y aquí interesa poder compararlas después.
 */
const SALIDA = process.env['DRUSE_BARRIDO_DIR'] ?? 'barrido';

const hallazgos: string[] = [];

async function foto(page: Page, nombre: string, sitio?: Locator): Promise<void> {
  await (sitio ?? page).screenshot({ path: `${SALIDA}/${nombre}.png` });
}

/** Lo medible: qué no cabe, qué se corta y qué botón no dice lo que hace. */
async function medir(page: Page, donde: string): Promise<void> {
  const encontrado = await page.evaluate((sitio) => {
    const problemas: string[] = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(element);

      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }

      const caja = element.getBoundingClientRect();

      if (
        caja.width === 0 ||
        caja.height === 0 ||
        element.closest('.monaco-editor') ||
        (element.matches('.label') && caja.width <= 1 && caja.height <= 1)
      ) {
        continue;
      }

      // Contenido que no cabe en un contenedor que además lo recorta.
      const recorta = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const sobra = element.scrollWidth - element.clientWidth;

      /*
       * Recortar con puntos suspensivos no es un defecto: es una decisión, y
       * además se ve. Una celda de datos con un texto largo dentro va a
       * desbordar siempre —el dato lo pone quien consulta, no quien diseña— y,
       * mientras quede sitio para leer un trozo y los puntos, hace lo que se le
       * pidió.
       *
       * Lo que sí es un defecto es recortar hasta dejarlo en nada: ahí no hay
       * decisión que valga, porque no se lee ni el principio. De ahí el ancho
       * mínimo, en lugar de un «tiene ellipsis, se perdona».
       */
      const decidido = style.textOverflow === 'ellipsis' && element.clientWidth >= 40;

      if (
        recorta &&
        !decidido &&
        sobra > 2 &&
        element.children.length === 0 &&
        element.textContent?.trim()
      ) {
        problemas.push(`${sitio}: «${element.textContent.trim().slice(0, 32)}» se corta (${sobra}px)`);
      }

      // Alto que se desborda sin poder desplazarse.
      const sobraAlto = element.scrollHeight - element.clientHeight;

      if (style.overflowY === 'hidden' && sobraAlto > 4 && element.children.length > 0) {
        problemas.push(
          `${sitio}: <${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}> esconde ${sobraAlto}px de alto`,
        );
      }
    }

    for (const boton of Array.from(document.querySelectorAll('button'))) {
      const texto = boton.textContent?.trim() ?? '';
      const nombre = boton.getAttribute('aria-label') ?? boton.getAttribute('title') ?? '';

      if (texto.length === 0 && nombre.length === 0) {
        problemas.push(`${sitio}: botón sin nombre accesible (.${String(boton.className).split(' ')[0]})`);
      }
    }

    return [...new Set(problemas)];
  }, donde);

  hallazgos.push(...encontrado);
}

/**
 * Cierra un diálogo y anota si no obedece a Escape.
 *
 * Escape es lo que se espera de una ventana modal y casi todas lo hacen, así
 * que la que no lo haga es un hallazgo, no un motivo para cortar el barrido:
 * se cierra por su aspa y se sigue mirando lo que venga detrás.
 */
async function cerrar(page: Page, dialogo: Locator, donde: string): Promise<void> {
  await page.keyboard.press('Escape');

  /**
   * Se espera a que se vaya, y solo entonces se juzga.
   *
   * Preguntar por `isVisible()` justo después de la tecla no vale: un diálogo
   * que **sí** obedece está a mitad de destruirse y todavía responde que sí, y
   * el clic de rescate cae sobre un nodo que Angular acaba de quitar del DOM.
   * Playwright lo reintenta hasta agotar la prueba entera —cuatro minutos por
   * un diálogo que se había cerrado bien—.
   */
  try {
    await expect(dialogo).toBeHidden({ timeout: 2_000 });

    return;
  } catch {
    hallazgos.push(`${donde}: no se cierra con Escape, a diferencia del resto`);
  }

  await dialogo.getByRole('button', { name: 'Cerrar' }).first().click();
  await expect(dialogo).toBeHidden({ timeout: 10_000 });
}

/** Abre el menú de acciones de un nodo del árbol. */
async function menuDe(page: Page, nodo: string): Promise<void> {
  await page
    .locator('app-connections-sidebar .node', { hasText: nodo })
    .first()
    .getByRole('button', { name: `Acciones para ${nodo}` })
    .click();
}

/**
 * Deja el árbol abierto hasta las tablas.
 *
 * Los diálogos que se piden desde el menú de un nodo lo necesitan, y entre paso
 * y paso el árbol puede haberse quedado plegado: el del filtro lo pliega a
 * propósito, y basta con que algo lo recargue para que `Tables` deje de estar.
 * Sin esto, el barrido se queda esperando un botón de un nodo que no se ve.
 */
async function arbolAbierto(page: Page): Promise<void> {
  await desplegar(page, 'druse_test', 'public');
  await desplegar(page, 'public', 'Tables');
}

async function desplegar(page: Page, nodo: string, hijo: string): Promise<void> {
  const sidebar = page.locator('app-connections-sidebar');
  const dentro = sidebar.getByText(hijo, { exact: true }).first();

  if (await dentro.isVisible().catch(() => false)) {
    return;
  }

  await sidebar.getByText(nodo, { exact: true }).first().click();
  await expect(dentro).toBeVisible({ timeout: 30_000 });
}

test.describe('barrido visual', () => {
  /**
   * No corre con la suite: no afirma nada y tarda casi un minuto.
   *
   * Se pide a mano cuando toca mirar la aplicación con calma:
   * `DRUSE_BARRIDO=1 npx playwright test tests/barrido.spec.ts`, y las capturas
   * salen donde diga `DRUSE_BARRIDO_DIR`.
   */
  test.skip(!process.env['DRUSE_BARRIDO'], 'El barrido se pide a mano.');

  test('recorre la aplicación entera', async ({ page }) => {
    const consola: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consola.push(message.text().slice(0, 140));
      }
    });

    await abrir(page);
    await conectar(page);
    await apuntarPestana(page);
    await desplegar(page, 'druse_test', 'public');
    await desplegar(page, 'public', 'Tables');

    // --- Trabajo normal ----------------------------------------------------
    await escribirSql(
      page,
      `SELECT generate_series AS numero,
              'texto de ejemplo bastante largo para ver cómo respira la celda' AS descripcion,
              NULL::text AS vacio,
              now() AS cuando
       FROM generate_series(1, 40)`,
    );
    await ejecutar(page, 'todo');
    await expect(page.locator('.pager__range')).toBeVisible({ timeout: 30_000 });
    await medir(page, 'resultados');
    await foto(page, '01-resultados');

    // Pestañas del panel inferior.
    await page.getByRole('tab', { name: 'Mensajes' }).click().catch(() => {});
    await page.locator('app-results-panel').getByText('Mensajes').first().click();
    await page.waitForTimeout(200);
    await medir(page, 'mensajes');
    await foto(page, '02-mensajes');

    await page.locator('app-results-panel').getByText('Historial').first().click();
    await page.waitForTimeout(400);
    await medir(page, 'historial');
    await foto(page, '03-historial');

    await page.locator('app-results-panel').getByText('Resultados').first().click();

    // --- Una consulta que falla -------------------------------------------
    await escribirSql(page, 'SELECT * FROM tabla_que_no_existe');
    await ejecutar(page, 'todo');
    await page.waitForTimeout(500);
    await medir(page, 'error de consulta');
    await foto(page, '04-error');

    // --- Menú del árbol ----------------------------------------------------
    await menuDe(page, 'Tables');
    await page.waitForTimeout(200);
    await medir(page, 'menú del árbol');
    await foto(page, '05-menu-arbol');
    await page.keyboard.press('Escape');
    await page.locator('app-sql-editor').click();

    // --- Filtro del explorador ---------------------------------------------
    // Se fotografía con el esquema plegado a propósito: es donde se ve que el
    // filtro llega a lo que el árbol no enseña.
    const sidebar = page.locator('app-connections-sidebar');

    await sidebar.getByText('public', { exact: true }).first().click();
    await sidebar.locator('.filter__input').fill('e2e');
    await page.waitForTimeout(400);
    await medir(page, 'filtro del explorador');
    await foto(page, '19-filtro', sidebar);
    await sidebar.locator('.filter__clear').click();

    // El árbol se deja como estaba: lo que sigue baja por él.
    await desplegar(page, 'public', 'Tables');

    // --- Paleta de comandos ------------------------------------------------
    // También sirve desde Monaco: Druse registra el acorde antes de que el
    // editor se quede esperando la segunda tecla de sus propios atajos.
    await page.locator('app-sql-editor .monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+k');
    await expect(page.locator('app-command-palette')).toBeVisible();
    await medir(page, 'paleta');
    await foto(page, '06-paleta');
    await page.keyboard.press('Escape');

    // --- Muchas pestañas abiertas ------------------------------------------
    // Doce no caben en la barra: interesa ver que se llega a las de detrás.
    const barra = page.locator('app-editor-tabs');
    // Las que ya había: el espacio de trabajo de las pruebas se guarda entre
    // ejecuciones, así que el punto de partida no es una pestaña sola.
    const antes = await barra.locator('.tab').count();
    const activa = (await barra.locator('.tab.is-active .tab__title').textContent()) ?? '';

    // Hasta doce, y nunca menos de tres nuevas: la foto necesita una barra
    // desbordada y el buscador, alguna «Query N» que encontrar.
    const nuevas = Math.max(3, 12 - antes);

    for (let vez = 0; vez < nuevas; vez += 1) {
      await barra.getByRole('button', { name: 'Nueva consulta' }).click();
    }

    await expect(barra.locator('.tab')).toHaveCount(antes + nuevas);
    await medir(page, 'barra con muchas pestañas');
    await foto(page, '06c-pestanas', barra);

    await barra.locator('.listing__toggle').click();
    await expect(barra.locator('.listing__menu')).toBeVisible();
    await medir(page, 'lista de pestañas');
    await foto(page, '06d-lista-pestanas');

    await barra.locator('.listing__search input').fill('Query 1');
    await page.waitForTimeout(200);
    await foto(page, '06e-lista-pestanas-buscando');
    await page.keyboard.press('Escape');

    // Se deja como estaba: lo que sigue trabaja sobre la pestaña apuntada.
    while ((await barra.locator('.tab').count()) > antes) {
      await barra.locator('.tab').last().locator('.tab__close').click();
    }

    await barra.locator('.tab', { hasText: activa }).first().click();

    // --- La hoja de atajos, que se pide con F1 -----------------------------
    await page.keyboard.press('F1');

    const atajos = page.locator('app-shortcuts-sheet');

    await expect(atajos).toBeVisible({ timeout: 30_000 });
    await medir(page, 'hoja de atajos');
    await foto(page, '06b-atajos', atajos.locator('.dialog'));
    await page.keyboard.press('Escape');

    // --- Diálogos ----------------------------------------------------------
    const dialogos: [string, string, () => Promise<void>][] = [
      [
        '07-conexion',
        'app-connection-dialog',
        async () => page.getByRole('button', { name: 'Nueva conexión' }).click(),
      ],
      [
        '08-preferencias',
        'app-settings-dialog',
        async () => page.getByRole('button', { name: 'Preferencias' }).click(),
      ],
      [
        '09-disenador',
        'app-table-designer',
        async () => {
          await arbolAbierto(page);
          await menuDe(page, 'Tables');
          await page.getByRole('menuitem', { name: 'Crear tabla' }).click();
        },
      ],
      [
        '10-respaldo',
        'app-backup-dialog',
        async () => {
          await menuDe(page, 'druse_test');
          await page.getByRole('menuitem', { name: 'Respaldar' }).click();
        },
      ],
      [
        '11-restaurar',
        'app-restore-dialog',
        async () => {
          await menuDe(page, 'druse_test');
          await page.getByRole('menuitem', { name: 'Restaurar' }).click();
        },
      ],
      [
        '12-migrar-varias',
        'app-transfer-set-dialog',
        async () => {
          await arbolAbierto(page);
          await menuDe(page, 'Tables');
          await page.getByRole('menuitem', { name: 'Migrar tablas a…' }).click();
        },
      ],
    ];

    for (const [nombre, selector, abrirlo] of dialogos) {
      await abrirlo();

      const dialogo = page.locator(selector);

      await expect(dialogo).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(500);
      await medir(page, nombre);
      await foto(page, nombre, dialogo.locator('.dialog').first());
      await cerrar(page, dialogo, nombre);
    }

    // --- El paso donde se elige el destino del respaldo --------------------
    // La casilla de sobrescribir solo sale cuando lo que se va a escribir es una
    // carpeta: un archivo o un zip los nombra el usuario en el diálogo del
    // sistema, que ya pregunta antes de reemplazar uno. Una carpeta no pregunta
    // nada, y sin marcarla el respaldo se rechaza en vez de mezclarse.
    await menuDe(page, 'druse_test');
    await page.getByRole('menuitem', { name: 'Respaldar' }).click();

    const respaldo = page.locator('app-backup-dialog');

    await expect(respaldo).toBeVisible({ timeout: 30_000 });
    await respaldo.getByRole('button', { name: '3. Cómo' }).click();
    await respaldo.getByRole('radio', { name: 'Carpeta por tipo de objeto' }).check();

    await expect(
      respaldo.getByText('Sobrescribir el respaldo anterior de esa carpeta'),
    ).toBeVisible();

    await page.waitForTimeout(300);
    await medir(page, 'destino del respaldo');
    await foto(page, '10b-respaldo-destino', respaldo.locator('.dialog'));
    await cerrar(page, respaldo, 'destino del respaldo');

    // --- El diagrama, en sus dos pasos -------------------------------------
    // Va fuera del bucle porque son dos pantallas y no una: primero se elige
    // qué tablas entran y después se dibujan.
    await arbolAbierto(page);
    await menuDe(page, 'public');
    await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();

    const diagrama = page.locator('app-diagram-panel');

    await expect(diagrama.locator('.chooser')).toBeVisible({ timeout: 60_000 });
    await medir(page, 'elegir tablas del diagrama');
    await foto(page, '20-mer-tablas', diagrama.locator('.dialog'));

    await diagrama.getByRole('button', { name: 'Dibujar' }).click();
    await expect(diagrama.locator('.node').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(400);
    await medir(page, 'diagrama');
    await foto(page, '20-mer', diagrama.locator('.dialog'));
    await cerrar(page, diagrama, 'diagrama');

    // --- El mismo diagrama, pero de la base entera -------------------------
    // Donde una base tiene varios esquemas, el selector dice de cuál es cada
    // tabla: dos «orders» sin apellido no se pueden elegir.
    await arbolAbierto(page);
    await menuDe(page, 'druse_test');
    await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();

    const diagramaBase = page.locator('app-diagram-panel');

    await expect(diagramaBase.locator('.chooser')).toBeVisible({ timeout: 60_000 });
    await medir(page, 'elegir tablas de la base');
    await foto(page, '20-mer-base-tablas', diagramaBase.locator('.dialog'));
    await cerrar(page, diagramaBase, 'diagrama de la base');

    // --- El asistente de una tabla, con sus pasos --------------------------
    await desplegar(page, 'Tables', 'accionista');
    await menuDe(page, 'accionista');
    await page.getByRole('menuitem', { name: 'Migrar datos a…' }).click();

    const traslado = page.locator('app-transfer-dialog');

    await expect(traslado).toBeVisible();
    await medir(page, 'migrar una tabla');
    await foto(page, '13-migrar-una', traslado.locator('.dialog'));
    await page.keyboard.press('Escape');

    // --- Lo que cuelga de una tabla ---------------------------------------
    const sobreLaTabla: [string, string, string][] = [
      ['13a-importar', 'app-import-dialog', 'Importar archivo'],
      ['13b-componer', 'app-query-builder', 'Componer consulta'],
    ];

    for (const [nombre, selector, opcion] of sobreLaTabla) {
      await menuDe(page, 'accionista');
      await page.getByRole('menuitem', { name: opcion }).click();

      const dialogo = page.locator(selector);

      await expect(dialogo).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await medir(page, nombre);
      await foto(page, nombre, dialogo.locator('.dialog').first());
      await cerrar(page, dialogo, nombre);
    }

    // --- Un procedimiento, si la base de pruebas tiene alguno --------------
    // No se siembra ninguno: se mira el primero que haya y, si no hay, se
    // sigue. El barrido no afirma nada, así que quedarse sin esta captura vale
    // más que cortar las que vienen detrás.
    await page.locator('app-connections-sidebar').getByText('Procedures', { exact: true }).first().click();
    await page.waitForTimeout(1500);

    // El árbol no marca la clase del nodo, así que el procedimiento se busca
    // por posición: el primer nodo que cuelga de «Procedures» con más sangría.
    const suNombre = await page.evaluate(() => {
      const nodos = [...document.querySelectorAll<HTMLElement>('app-connections-sidebar .node--object')];
      const indice = nodos.findIndex((nodo) => nodo.textContent?.trim() === 'Procedures');

      if (indice < 0) {
        return null;
      }

      const sangria = Number.parseFloat(nodos[indice].style.paddingLeft || '0');
      const hijo = nodos
        .slice(indice + 1)
        .find((nodo) => Number.parseFloat(nodo.style.paddingLeft || '0') > sangria);

      return hijo?.querySelector('.node__label')?.textContent?.trim() ?? null;
    });

    if (suNombre) {
      await menuDe(page, suNombre);
      await page.getByRole('menuitem', { name: 'Ejecutar procedimiento' }).click();

      const runner = page.locator('app-procedure-runner');

      await expect(runner).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(600);
      await medir(page, 'ejecutar procedimiento');
      await foto(page, '13c-procedimiento', runner.locator('.dialog'));
      await page.keyboard.press('Escape');
    } else {
      hallazgos.push('procedimientos: la base de pruebas no tiene ninguno, sin captura');
    }

    // --- El diálogo de conexión con cada motor ----------------------------
    // Los motores no enseñan los mismos campos —Informix por SQLI añade el
    // servidor lógico— y es justo donde el diálogo puede quedar descuadrado.
    for (const motor of ['SQL Server', 'MySQL', 'Informix', 'Informix (DRDA)']) {
      await page.getByRole('button', { name: 'Nueva conexión' }).click();

      const dialogo = page.locator('app-connection-dialog');

      await expect(dialogo).toBeVisible({ timeout: 30_000 });
      await dialogo
        .locator('.engine')
        .filter({ has: page.locator('.engine__name', { hasText: new RegExp(`^${motor.replace(/[()]/g, '\\$&')}$`) }) })
        .first()
        .click();
      await page.waitForTimeout(400);
      await medir(page, `conexión ${motor}`);
      await foto(page, `13d-conexion-${motor.replace(/[^a-z]/gi, '').toLowerCase()}`, dialogo.locator('.dialog'));
      await cerrar(page, dialogo, `conexion ${motor}`);
    }

    // --- El asistente ------------------------------------------------------
    await page.getByRole('button', { name: 'Asistente', exact: true }).click();

    const asistente = page.locator('app-ai-panel');

    await expect(asistente).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await medir(page, 'asistente');
    await foto(page, '14-asistente');

    // Su diálogo de proveedores, que es donde se elige quién responde.
    await asistente.getByRole('button', { name: 'Configurar un proveedor' }).click();

    const proveedores = page.locator('app-ai-provider-dialog');

    await expect(proveedores).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await medir(page, 'proveedor de IA');
    await foto(page, '15-proveedor-ia', proveedores.locator('.dialog'));
    await cerrar(page, proveedores, 'proveedor de IA');

    await page.getByRole('button', { name: 'Asistente', exact: true }).click();
    await expect(asistente).toBeHidden({ timeout: 10_000 });

    // --- Tema claro en las dos pantallas que más se miran ------------------
    await page.getByRole('button', { name: 'Tema claro' }).click();
    await page.waitForTimeout(400);
    await escribirSql(page, 'SELECT 1 AS uno, 2 AS dos, 3 AS tres');
    await ejecutar(page, 'todo');
    await page.waitForTimeout(300);
    await medir(page, 'claro: resultados');
    await foto(page, '16-claro-resultados');

    await page.getByRole('button', { name: 'Nueva conexión' }).click();
    await expect(page.locator('app-connection-dialog')).toBeVisible();
    await medir(page, 'claro: conexión');
    await foto(page, '17-claro-conexion', page.locator('app-connection-dialog .dialog'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Tema oscuro' }).click();

    // --- Anchos ------------------------------------------------------------
    for (const ancho of [1440, 1024, 900]) {
      await page.setViewportSize({ width: ancho, height: 760 });
      await page.waitForTimeout(400);
      await medir(page, `ancho ${ancho}`);
      await foto(page, `18-ancho-${ancho}`);
    }

    console.log('=== HALLAZGOS ===');
    console.log([...new Set(hallazgos)].join('\n') || '(ninguno)');
    console.log('=== CONSOLA ===');
    console.log([...new Set(consola)].join('\n') || '(limpia)');
  });
});
