import { test } from '@playwright/test';
import { comprobarPlanContexto } from '../support/ai-plans';

for (const locale of ['es', 'en']) {
  test(`revisa y comparte un plan real de SQLite sin volver a ejecutar consultas (${locale})`, async ({
    page,
  }) => {
    await comprobarPlanContexto(page, locale);
  });
}
