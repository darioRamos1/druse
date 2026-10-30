import { expect, test } from '@playwright/test';

import {
  CONTENEDOR,
  abrir,
  apuntarPestanaA,
  ejecutar,
  escribirSql,
  primeraColumna,
} from '../support/druse';
import { t } from '../support/i18n';

test('un perfil sin clave guardada permite cancelar, editar o conectar sin duplicarlo', async ({
  page,
}) => {
  // Windows puede tener llavero y Linux no: se reproduce la misma elección en
  // ambos. Sólo se sustituye el estado del llavero; perfil, sesiones y consulta
  // pasan por la API y PostgreSQL reales.
  await page.route('**/api/connections/secret-store', (route) =>
    route.fulfill({
      json: {
        available: false,
        description: 'Almacén deshabilitado en esta prueba',
      },
    }),
  );

  const nombre = `E2E contraseña pendiente ${Date.now()}`;
  const nombreEditado = `${nombre} editado`;
  const sesiones: string[] = [];
  let perfilId: string | undefined;
  const dialogo = page.locator('app-connection-dialog');
  const campo = (clave: string) =>
    dialogo
      .locator(`.field:has(.field__label:text-is("${t(clave)}")) input`)
      .first();

  try {
    await test.step('crear un perfil real sin almacenar la contraseña', async () => {
      await abrir(page);
      await page
        .getByRole('button', { name: t('topbar.newConnection') })
        .click();
      await expect(dialogo).toBeVisible();
      await dialogo
        .locator('.engine', { hasText: 'PostgreSQL' })
        .first()
        .click();
      await campo('connection.name').fill(nombre);
      await campo('connection.server').fill(CONTENEDOR.host);
      await campo('connection.port').fill(String(CONTENEDOR.puerto));
      await campo('connection.database').fill(CONTENEDOR.base);
      await campo('connection.user').fill(CONTENEDOR.usuario);
      await campo('connection.password').fill(CONTENEDOR.contrasena);
      await expect(
        dialogo
          .locator('.checkbox', { hasText: t('connection.rememberPassword') })
          .getByRole('checkbox'),
      ).toBeDisabled();
      await dialogo
        .getByRole('button', { name: new RegExp(t('connection.advanced')) })
        .click();
      await dialogo
        .getByRole('button', { name: t('connection.ssl.disable') })
        .click();

      const guardada = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/connections' &&
          response.request().method() === 'POST',
      );
      const conectada = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/sessions' &&
          response.request().method() === 'POST',
      );
      await dialogo
        .getByRole('button', { name: t('connection.connect'), exact: true })
        .click();
      const guardado = await guardada;
      expect(guardado.ok()).toBe(true);
      expect(guardado.request().postDataJSON().storePassword).toBe(false);
      const perfil = await guardado.json();
      perfilId = perfil.id;
      expect(perfil.hasStoredPassword).toBe(false);
      const sesion = await conectada;
      expect(sesion.ok()).toBe(true);
      sesiones.push((await sesion.json()).sessionId);
      await expect(dialogo).toBeHidden({ timeout: 60_000 });
    });

    const fila = page.locator(
      `app-connections-sidebar .node--connection[data-tree-id="${perfilId}"]`,
    );
    await fila.locator('.connection-menu-trigger').click();
    await fila.locator(`[title="${t('sidebar.disconnect')}"]`).click();
    await expect(fila.locator('.status-dot')).toHaveAttribute(
      'title',
      t('sidebar.status.off'),
    );
    // Una nueva carga obliga a recuperar el perfil persistido y pierde las
    // señales del formulario que conocieron la contraseña anterior.
    await abrir(page);
    await expect(fila.locator('.status-dot')).toHaveAttribute(
      'title',
      t('sidebar.status.off'),
    );

    const aperturas: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (
        request.method() === 'POST' &&
        (path === '/api/sessions' ||
          path === `/api/connections/${perfilId}/sessions`)
      ) {
        aperturas.push(path);
      }
    });

    await test.step('editar ofrece Guardar y no abre una sesión', async () => {
      await fila.locator('.connection-menu-trigger').click();
      await fila.locator(`[title="${t('sidebar.editTitle')}"]`).click();
      await expect(
        dialogo.getByRole('button', {
          name: t('connection.saveChanges'),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialogo.getByRole('button', {
          name: t('connection.connect'),
          exact: true,
        }),
      ).toHaveCount(0);
      await campo('connection.name').fill(nombreEditado);
      const modificada = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/connections/${perfilId}` &&
          response.request().method() === 'PUT',
      );
      await dialogo
        .getByRole('button', { name: t('connection.saveChanges'), exact: true })
        .click();
      expect((await modificada).ok()).toBe(true);
      await expect(dialogo).toBeHidden();
      expect(aperturas).toHaveLength(0);
      await expect(fila).toContainText(nombreEditado);
      await expect(fila.locator('.status-dot')).toHaveAttribute(
        'title',
        t('sidebar.status.off'),
      );
    });

    const pedirClave = async () => {
      const pendiente = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/connections/${perfilId}/sessions` &&
          response.request().method() === 'POST',
      );
      await fila.click();
      const respuesta = await pendiente;
      expect(respuesta.status()).toBe(428);
      expect((await respuesta.json()).requiresPassword).toBe(true);
      await expect(
        dialogo.getByRole('button', {
          name: t('connection.connect'),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialogo.getByRole('button', {
          name: t('connection.saveChanges'),
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(campo('connection.name')).toHaveValue(nombreEditado);
      await expect(campo('connection.server')).toHaveValue(CONTENEDOR.host);
      await expect(campo('connection.database')).toHaveValue(CONTENEDOR.base);
      await expect(campo('connection.password')).toHaveValue('');
    };

    await test.step('cancelar la petición de clave conserva el perfil desconectado', async () => {
      await pedirClave();
      await dialogo
        .getByRole('button', { name: t('common.cancel'), exact: true })
        .click();
      await expect(dialogo).toBeHidden();
      await expect(fila.locator('.status-dot')).toHaveAttribute(
        'title',
        t('sidebar.status.off'),
      );
      expect(aperturas).toHaveLength(1);
    });

    await test.step('la contraseña abre el mismo perfil y ejecuta SQL real', async () => {
      await pedirClave();
      await campo('connection.password').fill(CONTENEDOR.contrasena);
      const abierta = page.waitForResponse((response) => {
        const path = new URL(response.url()).pathname;
        return (
          response.request().method() === 'POST' &&
          response.ok() &&
          (path === '/api/sessions' ||
            path === `/api/connections/${perfilId}/sessions`)
        );
      });
      await dialogo
        .getByRole('button', { name: t('connection.connect'), exact: true })
        .click();
      sesiones.push((await (await abierta).json()).sessionId);
      await expect(dialogo).toBeHidden({ timeout: 60_000 });
      await expect(fila).not.toHaveClass(/is-offline/);
      await apuntarPestanaA(page, nombreEditado, CONTENEDOR.base);
      await escribirSql(page, 'SELECT 42 AS prueba');
      await ejecutar(page, 'todo');
      expect(await primeraColumna(page)).toEqual(['42']);

      const perfilesResponse = await page.request.get('/api/connections');
      expect(perfilesResponse.ok()).toBe(true);
      const perfiles = (await perfilesResponse.json()) as Array<{
        id: string;
        name: string;
        hasStoredPassword: boolean;
      }>;
      const propios = perfiles.filter((perfil) =>
        perfil.name.startsWith(nombre),
      );
      expect(propios).toHaveLength(1);
      expect(propios[0]).toMatchObject({
        id: perfilId,
        name: nombreEditado,
        hasStoredPassword: false,
      });
    });
  } finally {
    for (const sesion of sesiones) {
      await page.request.delete(`/api/sessions/${sesion}`);
    }
    if (perfilId) {
      await page.request.delete(`/api/connections/${perfilId}`);
    }
  }
});

test('elegir otro perfil desde el editor conserva la pestaña y completa el cambio al dar la clave', async ({
  page,
}) => {
  await page.route('**/api/connections/secret-store', (route) =>
    route.fulfill({
      json: {
        available: false,
        description: 'Almacén deshabilitado en esta prueba',
      },
    }),
  );
  const prefijo = `E2E cambio con contraseña ${Date.now()}`;
  const perfiles: Array<{ id: string; nombre: string; sesionId: string }> = [];
  const sesiones: string[] = [];
  const dialogo = page.locator('app-connection-dialog');
  const chip = page.locator('app-editor-toolbar .chip').first();
  const campo = (clave: string) =>
    dialogo
      .locator(`.field:has(.field__label:text-is("${t(clave)}")) input`)
      .first();
  const crearPerfil = async (nombre: string) => {
    await page.getByRole('button', { name: t('topbar.newConnection') }).click();
    await expect(dialogo).toBeVisible();
    await dialogo.locator('.engine', { hasText: 'PostgreSQL' }).first().click();
    for (const [clave, valor] of [
      ['connection.name', nombre],
      ['connection.server', CONTENEDOR.host],
      ['connection.port', String(CONTENEDOR.puerto)],
      ['connection.database', CONTENEDOR.base],
      ['connection.user', CONTENEDOR.usuario],
      ['connection.password', CONTENEDOR.contrasena],
    ]) {
      await campo(clave).fill(valor);
    }
    await dialogo
      .getByRole('button', { name: new RegExp(t('connection.advanced')) })
      .click();
    await dialogo
      .getByRole('button', { name: t('connection.ssl.disable') })
      .click();
    const guardada = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/connections' &&
        response.request().method() === 'POST',
    );
    const abierta = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sessions' &&
        response.request().method() === 'POST',
    );
    await dialogo
      .getByRole('button', { name: t('connection.connect'), exact: true })
      .click();
    const guardado = await guardada;
    expect(guardado.ok()).toBe(true);
    expect(guardado.request().postDataJSON().storePassword).toBe(false);
    const perfil = await guardado.json();
    expect(perfil.hasStoredPassword).toBe(false);
    const sesionResponse = await abierta;
    expect(sesionResponse.ok()).toBe(true);
    const sesion = await sesionResponse.json();
    const resultado = {
      id: perfil.id as string,
      nombre,
      sesionId: sesion.sessionId as string,
    };
    perfiles.push(resultado);
    sesiones.push(resultado.sesionId);
    await expect(dialogo).toBeHidden({ timeout: 60_000 });
    return resultado;
  };
  type Pestana = {
    id: string;
    isActive: boolean;
    connectionId?: string;
    sql: string;
  };
  const pestañaActiva = async () => {
    const respuesta = await page.request.get('/api/workspace/tabs');
    expect(respuesta.ok()).toBe(true);
    return ((await respuesta.json()) as Pestana[]).find(
      (pestana) => pestana.isActive,
    );
  };

  try {
    await abrir(page);
    const origen = await crearPerfil(`${prefijo} A`);
    const destino = await crearPerfil(`${prefijo} B`);
    const filaDestino = page.locator(
      `app-connections-sidebar .node--connection[data-tree-id="${destino.id}"]`,
    );
    await filaDestino.locator('.connection-menu-trigger').click();
    await filaDestino.locator(`[title="${t('sidebar.disconnect')}"]`).click();
    await expect(filaDestino.locator('.status-dot')).toHaveAttribute(
      'title',
      t('sidebar.status.off'),
    );
    await apuntarPestanaA(page, origen.nombre, CONTENEDOR.base);
    const sql = 'SELECT 73 AS prueba';
    await escribirSql(page, sql);
    await expect
      .poll(async () => {
        const pestana = await pestañaActiva();
        return { connectionId: pestana?.connectionId, sql: pestana?.sql };
      })
      .toEqual({ connectionId: origen.id, sql });
    const tabId = (await pestañaActiva())!.id;

    const elegirDestino = async () => {
      const pendiente = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            `/api/connections/${destino.id}/sessions` &&
          response.request().method() === 'POST',
      );
      await chip.click();
      await page
        .locator('.context__option', { hasText: destino.nombre })
        .click();
      expect((await pendiente).status()).toBe(428);
      await expect(
        dialogo.getByRole('button', {
          name: t('connection.connect'),
          exact: true,
        }),
      ).toBeVisible();
      await expect(campo('connection.name')).toHaveValue(destino.nombre);
      await expect(campo('connection.password')).toHaveValue('');
    };

    await test.step('cancelar deja la pestaña en la conexión anterior', async () => {
      await elegirDestino();
      await dialogo
        .getByRole('button', { name: t('common.cancel'), exact: true })
        .click();
      await expect(dialogo).toBeHidden();
      await expect(chip.locator('.chip__name')).toHaveText(origen.nombre);
      expect(await pestañaActiva()).toMatchObject({
        id: tabId,
        connectionId: origen.id,
        sql,
      });
      await expect(filaDestino.locator('.status-dot')).toHaveAttribute(
        'title',
        t('sidebar.status.off'),
      );
    });

    await test.step('la contraseña completa la selección de B sin crear otra pestaña', async () => {
      await elegirDestino();
      await campo('connection.password').fill(CONTENEDOR.contrasena);
      const abierta = page.waitForResponse((response) => {
        const path = new URL(response.url()).pathname;
        return (
          response.request().method() === 'POST' &&
          response.ok() &&
          (path === '/api/sessions' ||
            path === `/api/connections/${destino.id}/sessions`)
        );
      });
      await dialogo
        .getByRole('button', { name: t('connection.connect'), exact: true })
        .click();
      const sesionId = (await (await abierta).json()).sessionId as string;
      sesiones.push(sesionId);
      await expect(dialogo).toBeHidden({ timeout: 60_000 });
      // Aquí no se llama al helper que selecciona la conexión: eso corregiría
      // desde la prueba el fallo que debe resolver la propia continuación.
      await expect(chip.locator('.chip__name')).toHaveText(destino.nombre);
      await expect
        .poll(async () => (await pestañaActiva())?.connectionId)
        .toBe(destino.id);
      expect(await pestañaActiva()).toMatchObject({
        id: tabId,
        connectionId: destino.id,
        sql,
      });
      const consulta = page.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/queries',
      );
      // Ctrl+Enter pertenece al editor; cerrar el diálogo deja el foco fuera.
      // Recuperarlo no cambia el SQL ni la conexión que acaba de elegir el usuario.
      await page.locator('app-sql-editor .monaco-editor').click();
      await ejecutar(page, 'todo');
      expect((await consulta).postDataJSON().sessionId).toBe(sesionId);
      expect(await primeraColumna(page)).toEqual(['73']);

      const respuestaPerfiles = await page.request.get('/api/connections');
      expect(respuestaPerfiles.ok()).toBe(true);
      const guardados = (await respuestaPerfiles.json()) as Array<{
        id: string;
        name: string;
      }>;
      expect(
        guardados
          .filter((perfil) => perfil.name.startsWith(prefijo))
          .map((perfil) => perfil.id)
          .sort(),
      ).toEqual([origen.id, destino.id].sort());
    });
  } finally {
    for (const sesion of sesiones) {
      await page.request.delete(`/api/sessions/${sesion}`);
    }
    for (const perfil of perfiles) {
      await page.request.delete(`/api/connections/${perfil.id}`);
    }
  }
});
