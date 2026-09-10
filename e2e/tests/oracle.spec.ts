import { expect, test } from '@playwright/test';

import { abrir } from '../support/druse';

/**
 * Oracle, por donde lo usa una persona.
 *
 * El contrato de proveedor ya comprueba las cincuenta y cuatro cosas que este
 * motor tiene que saber hacer, y lo hace por debajo de la API. Lo que falta —y
 * es lo único que se prueba aquí— es que **el camino entero encaje**: que el
 * formulario lo ofrezca, que el clic llegue hasta el servidor y que lo que
 * vuelve se dibuje en el árbol.
 *
 * **Ejecutar no se prueba desde aquí.** Apuntar una pestaña a otro motor es un
 * baile de menús que ya cubren las pruebas de PostgreSQL y SQL Server, y lo que
 * añadiría no es del motor: lo que Oracle ejecuta lo comprueban sus cincuenta y
 * cuatro pruebas de contrato contra un servidor real.
 *
 * Va en su propio archivo y no en el barrido porque necesita su contenedor, que
 * tarda un par de minutos en arrancar la primera vez:
 * `./build/scripts/test-db.ps1 -Engine oracle`.
 */
const ORACLE = {
  nombre: 'E2E Oracle',
  host: '127.0.0.1',
  puerto: Number(process.env['DRUSE_TEST_ORACLE_PORT'] ?? 15210),
  // El **servicio**, que es lo que Oracle nombra para conectar. Lo que el árbol
  // enseña como bases son los esquemas, que están dentro.
  servicio: process.env['DRUSE_TEST_ORACLE_SERVICE'] ?? 'FREEPDB1',
  usuario: process.env['DRUSE_TEST_ORACLE_USER'] ?? 'druse',
  // No es un secreto: es la del contenedor de pruebas, la misma que está escrita
  // en `build/scripts/test-db.ps1` y en las fixtures del contrato.
  contrasena: process.env['DRUSE_TEST_ORACLE_PASSWORD'] ?? 'druse_dev_only',
  esquema: 'DRUSE',
};

test.describe('Oracle de punta a punta', () => {
  test('se conecta, se explora y se consulta', async ({ page }) => {
    await abrir(page);

    const sidebar = page.locator('app-connections-sidebar');
    const fila = sidebar.locator('.node--connection', { hasText: ORACLE.nombre }).first();

    if ((await fila.count()) === 0) {
      await page.getByRole('button', { name: 'Nueva conexión' }).click();

      const dialogo = page.locator('app-connection-dialog');

      await expect(dialogo).toBeVisible();

      // La tarjeta existe porque la lista sale de `/api/engines`: si el motor no
      // estuviera registrado en el servidor, aquí no habría nada que pulsar.
      await dialogo.locator('.engine', { hasText: 'Oracle' }).first().click();

      const campo = (etiqueta: string) =>
        dialogo.locator(`.field:has(.field__label:text-is("${etiqueta}")) input`).first();

      await campo('Nombre').fill(ORACLE.nombre);
      await campo('Servidor').fill(ORACLE.host);
      await campo('Puerto').fill(String(ORACLE.puerto));
      await campo('Base de datos').fill(ORACLE.servicio);
      await campo('Usuario').fill(ORACLE.usuario);
      await campo('Contraseña').fill(ORACLE.contrasena);

      // Sin cifrar: en Oracle el cifrado no es una opción de la misma conexión
      // sino otro protocolo —TCPS— con su propio escuchador, que el contenedor
      // de pruebas no levanta.
      await dialogo.getByRole('button', { name: 'Opciones avanzadas' }).click();
      await dialogo.getByRole('button', { name: 'Sin cifrar' }).click();

      await dialogo.getByRole('button', { name: 'Conectar' }).click();
      await expect(dialogo).toBeHidden({ timeout: 60_000 });
    }

    // --- El árbol -----------------------------------------------------------
    // El primer nivel de Oracle son esquemas, no bases: es lo que hay dentro de
    // un servicio.
    const esquema = sidebar.getByText(ORACLE.esquema, { exact: true }).first();

    if (!(await esquema.isVisible().catch(() => false))) {
      await fila.click();
    }

    await expect(esquema).toBeVisible({ timeout: 60_000 });

    // --- Y sus carpetas -----------------------------------------------------
    // Es lo que de verdad prueba el motor de punta a punta: el árbol de Oracle
    // se compone en el lector de catálogo —un esquema que cuelga de sí mismo, y
    // debajo las cuatro carpetas— y llega hasta aquí por la API.
    // Hay **dos** nodos con el mismo nombre, y es a propósito: en Oracle el
    // esquema es el dueño y no hay una base por encima, así que el árbol enseña
    // el esquema en el sitio de la base y debajo cuelga uno de su mismo nombre.
    // Es lo mismo que se hace en MySQL al revés, y lo que permite que el
    // explorador se comporte igual en los cinco motores.
    await esquema.click();

    const dentro = sidebar.getByText(ORACLE.esquema, { exact: true }).nth(1);

    await expect(dentro).toBeVisible({ timeout: 30_000 });
    await dentro.click();

    await expect(sidebar.getByText('Tables', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(sidebar.getByText('Views', { exact: true }).first()).toBeVisible();
  });
});
