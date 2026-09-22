import { defineConfig } from 'vitest/config';

/**
 * Lo único que se cambia del ejecutor de pruebas: cuánto se espera.
 *
 * La primera prueba de un componente grande —el shell, el compositor— paga la
 * compilación de todo su árbol. Con la suite entera corriendo en paralelo, los
 * 5 s por prueba y 10 s por preparación que trae Vitest se agotaban en una
 * distinta cada vez, y el fallo no decía nada del código: por separado pasaban
 * siempre. Ir subiendo el límite prueba a prueba no acababa nunca.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
