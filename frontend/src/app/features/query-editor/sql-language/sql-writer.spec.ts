import { KnownColumn } from '../../../shared/models/workspace';
import {
  buildCreateTable,
  buildDropTable,
  buildInsert,
  buildSelect,
  buildUpdate,
  quote,
} from './sql-writer';

function col(
  name: string,
  dataType: string,
  {
    pk = false,
    nullable = true,
    generated = false,
  }: { pk?: boolean; nullable?: boolean; generated?: boolean } = {},
): KnownColumn {
  return { name, dataType, isPrimaryKey: pk, isNullable: nullable, isGenerated: generated };
}

const columnas: KnownColumn[] = [
  col('id', 'int', { pk: true, nullable: false }),
  col('nombre', 'varchar(200)', { nullable: false }),
  col('correo', 'varchar(200)'),
];

const tabla = { schema: 'tpublico', table: 'usuarios', columns: columnas };

describe('escribir SQL', () => {
  describe('citar nombres', () => {
    it('usa las comillas de cada motor', () => {
      expect(quote('sqlserver', 'order')).toBe('[order]');
      expect(quote('mysql', 'order')).toBe('`order`');
      expect(quote('postgresql', 'order')).toBe('"order"');
    });

    it('escapa la comilla de cierre', () => {
      // Sin esto, una tabla llamada `a]b` permitiría salirse del identificador.
      expect(quote('sqlserver', 'a]b')).toBe('[a]]b]');
      expect(quote('mysql', 'a`b')).toBe('`a``b`');
      expect(quote('postgresql', 'a"b')).toBe('"a""b"');
    });
  });

  describe('SELECT', () => {
    const base = { schema: 'tpublico', table: 'usuarios', columns: [], filters: [], limit: null };

    it('sin columnas elegidas usa el asterisco', () => {
      expect(buildSelect('postgresql', base)).toContain('SELECT *');
    });

    it('limita con LIMIT o con TOP según el motor', () => {
      const spec = { ...base, limit: 100 };

      // Es la diferencia que más se nota al cambiar de servidor y la que peor
      // se recuerda.
      expect(buildSelect('postgresql', spec)).toContain('LIMIT 100');
      expect(buildSelect('mysql', spec)).toContain('LIMIT 100');

      const sqlserver = buildSelect('sqlserver', spec);
      expect(sqlserver).toContain('SELECT TOP 100');
      expect(sqlserver).not.toContain('LIMIT');
    });

    it('junta los filtros con AND', () => {
      const sql = buildSelect('postgresql', {
        ...base,
        filters: [
          { column: 'nombre', operator: 'LIKE', value: '%ana%' },
          { column: 'id', operator: '>', value: '10' },
        ],
      });

      expect(sql).toContain('"nombre" LIKE \'%ana%\'');
      expect(sql).toContain('AND "id" > 10');
    });

    it('los números van sin comillas y el texto con ellas', () => {
      const sql = buildSelect('postgresql', {
        ...base,
        filters: [{ column: 'saldo', operator: '=', value: '10.5' }],
      });

      expect(sql).toContain('"saldo" = 10.5');
    });

    it('escapa las comillas del valor', () => {
      const sql = buildSelect('postgresql', {
        ...base,
        filters: [{ column: 'nombre', operator: '=', value: "O'Brien" }],
      });

      expect(sql).toContain("'O''Brien'");
    });

    it('IS NULL no lleva valor', () => {
      const sql = buildSelect('postgresql', {
        ...base,
        filters: [{ column: 'correo', operator: 'IS NULL', value: '' }],
      });

      expect(sql).toContain('"correo" IS NULL');
      expect(sql).not.toContain("IS NULL ''");
    });

    it('ordena en la dirección pedida', () => {
      const sql = buildSelect('mysql', { ...base, orderBy: 'nombre', descending: true });

      expect(sql).toContain('ORDER BY `nombre` DESC');
    });
  });

  describe('plantillas', () => {
    it('el INSERT deja fuera lo que el motor rellena solo', () => {
      const sql = buildInsert('postgresql', {
        schema: 'public',
        table: 'usuarios',
        columns: [
          col('id', 'bigint', { pk: true, nullable: false, generated: true }),
          col('nombre', 'text'),
        ],
      });

      // Escribir la columna de autoincremento obliga a quitarla a mano.
      expect(sql).not.toContain('"id"');
      expect(sql).toContain('"nombre"');
    });

    it('el INSERT usa la sintaxis de valores por defecto si todo es automático', () => {
      const soloIdentidad = {
        table: 'secuencia',
        columns: [col('id', 'bigint', { generated: true })],
      };

      expect(buildInsert('postgresql', soloIdentidad)).toContain('DEFAULT VALUES');
      expect(buildInsert('sqlserver', soloIdentidad)).toContain('DEFAULT VALUES');
      expect(buildInsert('mysql', soloIdentidad)).toContain('()\nVALUES ()');
    });

    it('el UPDATE trae el WHERE por clave primaria', () => {
      const sql = buildUpdate('sqlserver', tabla);

      expect(sql).toContain('WHERE [id] =');
      // Y no propone tocar la clave.
      expect(sql).not.toContain('  [id] =');
    });

    it('el UPDATE no propone escribir columnas calculadas', () => {
      const sql = buildUpdate('sqlserver', {
        ...tabla,
        columns: [...columnas, col('total', 'decimal(12,2)', { generated: true })],
      });

      expect(sql).not.toContain('[total] =');
    });

    it('el UPDATE sin columnas modificables no produce SQL ejecutable', () => {
      const sql = buildUpdate('postgresql', {
        table: 'secuencia',
        columns: [col('id', 'bigint', { pk: true, generated: true })],
      });

      expect(sql).toBe('-- Esta tabla no tiene columnas modificables.\n');
    });

    it('el UPDATE de una tabla sin clave lo dice en vez de dejar el WHERE vacío', () => {
      const sql = buildUpdate('postgresql', {
        table: 'sin_clave',
        columns: [col('a', 'int'), col('b', 'int')],
      });

      // Un UPDATE sin filtro es justo lo que Druse hace confirmar; ofrecerlo
      // escrito sería una invitación.
      expect(sql).toContain('condición');
    });

    it('el CREATE TABLE conserva tipos, nulabilidad y clave', () => {
      const sql = buildCreateTable('mysql', tabla);

      expect(sql).toContain('`nombre` varchar(200) NOT NULL');
      expect(sql).toContain('`correo` varchar(200)');
      expect(sql).toContain('PRIMARY KEY (`id`)');
    });

    it('el DROP TABLE cita el nombre según cada motor', () => {
      const objeto = { schema: 'sales data', table: 'order' };

      expect(buildDropTable('postgresql', objeto)).toBe('DROP TABLE "sales data"."order";\n');
      expect(buildDropTable('sqlserver', objeto)).toBe('DROP TABLE [sales data].[order];\n');
      expect(buildDropTable('mysql', objeto)).toBe('DROP TABLE `sales data`.`order`;\n');
    });
  });
});
