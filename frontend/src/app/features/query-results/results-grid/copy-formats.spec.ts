import { ResultColumn } from '../../../shared/models/workspace';
import { CopySelection, formatSelection } from './copy-formats';

/** Columna mínima: de lo que hay aquí, al formato solo le importan nombre y tipo. */
function column(name: string, kind: ResultColumn['kind'] = 'text'): ResultColumn {
  return { name, dataType: kind, kind, width: null };
}

function selection(
  columns: readonly ResultColumn[],
  rows: readonly (readonly (string | null)[])[],
): CopySelection {
  return { columns, rows };
}

describe('formatSelection', () => {
  describe('Excel', () => {
    it('pone los nombres arriba y separa con tabuladores', () => {
      const texto = formatSelection(
        selection(
          [column('id', 'number'), column('nombre')],
          [
            ['1', 'Ana'],
            ['2', 'Luis'],
          ],
        ),
        'excel',
      );

      expect(texto).toBe('id\tnombre\n1\tAna\n2\tLuis');
    });

    it('deja los NULL como celda vacía', () => {
      const texto = formatSelection(selection([column('nombre')], [[null]]), 'excel');

      // Escribir la palabra dejaría un texto donde debe haber un hueco.
      expect(texto).toBe('nombre\n');
    });

    it('entrecomilla lo que partiría la fila', () => {
      const texto = formatSelection(
        selection([column('nota')], [['dos\tpartes'], ['con "comillas"'], ['dos\nlíneas']]),
        'excel',
      );

      expect(texto).toBe('nota\n"dos\tpartes"\n"con ""comillas"""\n"dos\nlíneas"');
    });
  });

  describe('condición IN', () => {
    it('escribe los números sin comillas', () => {
      const texto = formatSelection(
        selection([column('cliente_id', 'number')], [['1001'], ['1002']]),
        'where-in',
      );

      expect(texto).toBe('cliente_id IN (1001, 1002)');
    });

    it('entrecomilla el texto y escapa las comillas simples', () => {
      const texto = formatSelection(
        selection([column('nombre')], [["O'Hara"], ['Ana']]),
        'where-in',
      );

      expect(texto).toBe("nombre IN ('O''Hara', 'Ana')");
    });

    it('entrecomilla los números guardados como texto', () => {
      // Un código postal sin comillas se compararía como número y no encontraría
      // nada: aquí manda el tipo de la columna, no lo que parezca el valor.
      const texto = formatSelection(selection([column('cp')], [['01234']]), 'where-in');

      expect(texto).toBe("cp IN ('01234')");
    });

    it('quita los repetidos y conserva el orden', () => {
      const texto = formatSelection(
        selection([column('pais')], [['MX'], ['ES'], ['MX']]),
        'where-in',
      );

      expect(texto).toBe("pais IN ('MX', 'ES')");
    });

    it('saca los NULL fuera del IN, que nunca los encontraría', () => {
      const texto = formatSelection(
        selection([column('estado')], [['activo'], [null]]),
        'where-in',
      );

      expect(texto).toBe("(estado IN ('activo') OR estado IS NULL)");
    });

    it('con todo a NULL escribe solo IS NULL', () => {
      const texto = formatSelection(selection([column('estado')], [[null], [null]]), 'where-in');

      expect(texto).toBe('estado IS NULL');
    });

    it('une varias columnas con AND, una por línea', () => {
      const texto = formatSelection(
        selection(
          [column('pais'), column('anio', 'number')],
          [
            ['MX', '2026'],
            ['ES', '2025'],
          ],
        ),
        'where-in',
      );

      expect(texto).toBe("pais IN ('MX', 'ES')\n  AND anio IN (2026, 2025)");
    });

    it('entrecomilla el nombre de columna que no sobreviviría suelto', () => {
      const texto = formatSelection(selection([column('fecha alta')], [['hoy']]), 'where-in');

      expect(texto).toBe('"fecha alta" IN (\'hoy\')');
    });
    it('avisa en el propio SQL cuando la columna no tiene nombre', () => {
      // SQL Server devuelve sin nombre las columnas sin alias —`SELECT 42`—, y un
      // identificador vacío daría una condición que no se puede ejecutar.
      const texto = formatSelection(selection([column('')], [['42']]), 'where-in');

      expect(texto).toBe("/* columna sin nombre */ IN ('42')");
    });

    it('no se deja engañar por un nombre de solo espacios', () => {
      const texto = formatSelection(selection([column('   ')], [['1']]), 'where-in');

      expect(texto).toContain('/* columna sin nombre */');
    });
  });

  describe('lista de valores', () => {
    it('separa por comas sin tocar el orden ni los repetidos', () => {
      const texto = formatSelection(
        selection([column('pais')], [['MX'], ['ES'], ['MX']]),
        'list',
      );

      expect(texto).toBe("'MX', 'ES', 'MX'");
    });

    it('escribe los NULL como NULL', () => {
      const texto = formatSelection(
        selection([column('id', 'number')], [['1'], [null]]),
        'list',
      );

      expect(texto).toBe('1, NULL');
    });

    it('recorre fila a fila cuando hay varias columnas', () => {
      const texto = formatSelection(
        selection(
          [column('id', 'number'), column('pais')],
          [
            ['1', 'MX'],
            ['2', 'ES'],
          ],
        ),
        'list',
      );

      expect(texto).toBe("1, 'MX', 2, 'ES'");
    });
  });
});
