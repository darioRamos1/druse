import { expect, test } from '@playwright/test';

import {
  abrir,
  conectar,
  conjuntos,
  ejecutar,
  escribirSql,
  marcaDeError,
  primeraColumna,
  situarCursor,
} from '../support/druse';

/**
 * Las dos cosas del editor que solo se pueden comprobar con Monaco de verdad
 * cargado: qué se manda a ejecutar y qué se subraya cuando falla.
 *
 * Las pruebas del frontend ya cubren el cálculo —dónde empieza cada instrucción,
 * qué línea y columna señala el motor— con el texto pelado. Lo que no pueden
 * cubrir es que el cursor, el atajo y el marcador se junten bien, porque ahí no
 * hay editor: hay un doble.
 */
test.describe('el editor', () => {
  test('«Ejecutar actual» manda solo la instrucción del cursor', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(
      page,
      "SELECT 'primera' AS cual;\nSELECT 'segunda' AS cual;\nSELECT 'tercera' AS cual",
    );

    await situarCursor(page, 2, 12);
    await ejecutar(page, 'la del cursor');

    expect(await primeraColumna(page)).toEqual(['segunda']);

    // La última no lleva punto y coma, que es como acaba cualquier pestaña.
    await situarCursor(page, 3, 12);
    await ejecutar(page, 'la del cursor');

    expect(await primeraColumna(page)).toEqual(['tercera']);
  });

  test('con el cursor pegado al punto y coma, ejecuta la que se acaba de cerrar', async ({
    page,
  }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, "SELECT 'primera' AS cual;\nSELECT 'segunda' AS cual");

    // Justo detrás del `;` de la primera: es donde queda el cursor al terminar
    // de escribirla.
    await situarCursor(page, 1, 26);
    await ejecutar(page, 'la del cursor');

    expect(await primeraColumna(page)).toEqual(['primera']);
  });

  test('Ctrl+Enter sigue mandando la pestaña entera', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, "SELECT 'uno' AS a;\nSELECT 'dos' AS b");

    await situarCursor(page, 1, 5);
    await ejecutar(page, 'todo');

    await expect(conjuntos(page)).toHaveCount(2);
  });

  test('un error de sintaxis subraya la palabra culpable', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, 'SELECT\n  uno,\n  FROM tabla_x');
    await ejecutar(page, 'todo');

    // PostgreSQL da la posición exacta, así que se subraya `FROM` y no la línea
    // entera: es la diferencia entre señalar la palabra y señalar el párrafo.
    expect(await marcaDeError(page)).toMatchObject({
      linea: 3,
      texto: 'FROM',
    });
  });

  test('el error de un fragmento se marca en su sitio de la pestaña', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, "SELECT 'ok' AS a;\nSELECT 'ok' AS b;\nSELECT uno, FROM tabla_x");

    await situarCursor(page, 3, 14);
    await ejecutar(page, 'la del cursor');

    // El motor cuenta desde el principio del fragmento —que empieza en la
    // tercera línea— y aun así la marca cae donde está el `FROM` de verdad.
    const marca = await marcaDeError(page);

    expect(marca).toMatchObject({ linea: 3, texto: 'FROM' });
  });

  test('una consulta correcta borra la marca de la anterior', async ({ page }) => {
    await abrir(page);
    await conectar(page);

    await escribirSql(page, 'SELECT * FROM');
    await ejecutar(page, 'todo');

    expect(await marcaDeError(page)).not.toBeNull();

    await escribirSql(page, 'SELECT 1 AS uno');
    await ejecutar(page, 'todo');

    // Un subrayado que sobrevive a la consulta que lo causó señala un error que
    // ya no existe.
    expect(await marcaDeError(page)).toBeNull();
  });
});
