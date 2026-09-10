import { KnownColumn } from '../../../shared/models/workspace';
import {
  buildCall,
  buildCreateTable,
  buildDeleteCount,
  buildDeleteValues,
  buildDropTable,
  buildInsert,
  buildInsertValues,
  buildSelect,
  buildUpdate,
  buildUpdateValues,
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
      expect(quote('informix', 'order')).toBe('"order"');
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

      // Informix lo escribe delante como SQL Server, pero con su propia palabra.
      // Poner `LIMIT` al final aquí produciría SQL que su servidor rechaza.
      const informix = buildSelect('informix', spec);
      expect(informix).toContain('SELECT FIRST 100');
      expect(informix).not.toContain('LIMIT');
    });

    /**
     * El transporte no cambia el dialecto: DRDA y SQLI son el mismo motor.
     *
     * Esto estuvo roto. Cada regla de dialecto era un `switch` con una rama
     * `default` que valía PostgreSQL, y `informixsqli` no aparecía en ninguna:
     * una conexión por el protocolo nativo recibía `LIMIT` al final y un
     * `DEFAULT VALUES`, dos cosas que su servidor rechaza. Ahora los dialectos
     * son una tabla exhaustiva y el motor que falte no compila.
     */
    it('el protocolo de Informix no cambia el SQL que se escribe', () => {
      const spec = { ...base, limit: 100 };

      expect(buildSelect('informixsqli', spec)).toBe(buildSelect('informix', spec));
    });

    /**
     * Oracle limita al final como PostgreSQL, pero con otras palabras, y sus
     * nombres van en mayúsculas y sin comillas: es como los guarda el motor, y
     * citarlos crearía una tabla distinta de la que el usuario ve en el árbol.
     */
    it('Oracle limita con FETCH FIRST y no cita los nombres simples', () => {
      const sql = buildSelect('oracle', { ...base, limit: 100 });

      expect(sql).toContain('FETCH FIRST 100 ROWS ONLY');
      expect(sql).not.toContain('LIMIT');
      expect(sql).toContain('TPUBLICO.USUARIOS');
      expect(sql).not.toContain('"');
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

    it('agrupa y aplica HAVING con sintaxis portable en todos los motores', () => {
      const cases = [
        { engine: 'postgresql', category: '"categoria"', amount: '"importe"', alias: '"total"' },
        { engine: 'mysql', category: '`categoria`', amount: '`importe`', alias: '`total`' },
        { engine: 'sqlserver', category: '[categoria]', amount: '[importe]', alias: '[total]' },
        { engine: 'informix', category: '"categoria"', amount: '"importe"', alias: '"total"' },
      ] as const;

      for (const item of cases) {
        const total = { function: 'SUM' as const, column: 'importe', alias: 'total' };
        const sql = buildSelect(item.engine, {
          ...base,
          columns: ['categoria'],
          aggregates: [total, { function: 'COUNT', column: '*', alias: 'cantidad' }],
          groupBy: ['categoria'],
          having: [{ aggregate: total, operator: '>', value: '100' }],
        });

        expect(sql).toContain(
          `SELECT ${item.category}, SUM(${item.amount}) AS ${item.alias}, COUNT(*) AS`,
        );
        expect(sql).toContain(`GROUP BY ${item.category}`);
        // Se repite la expresión y no el alias: PostgreSQL y SQL Server no
        // aceptan de forma portable el alias del SELECT dentro de HAVING.
        expect(sql).toContain(`HAVING SUM(${item.amount}) > 100`);
        expect(sql).not.toContain(`HAVING ${item.alias}`);
      }
    });

    it('GROUP BY y HAVING respetan alias de JOIN y el orden de las cláusulas', () => {
      const total = {
        function: 'COUNT' as const,
        column: { alias: 't1', column: 'id' },
        alias: 'clientes',
      };
      const sql = buildSelect('sqlserver', {
        ...base,
        limit: 25,
        alias: 't0',
        columns: [{ alias: 't0', column: 'categoria' }],
        groupBy: [{ alias: 't0', column: 'categoria' }],
        aggregates: [total],
        having: [{ aggregate: total, operator: '>=', value: '2' }],
        orderBy: { alias: 't0', column: 'categoria' },
      });

      expect(sql).toContain('SELECT TOP 25 [t0].[categoria], COUNT([t1].[id]) AS [clientes]');
      expect(sql).toContain('GROUP BY [t0].[categoria]');
      expect(sql).toContain('HAVING COUNT([t1].[id]) >= 2');
      expect(sql.indexOf('GROUP BY')).toBeLessThan(sql.indexOf('HAVING'));
      expect(sql.indexOf('HAVING')).toBeLessThan(sql.indexOf('ORDER BY'));
      expect(sql).not.toContain('LIMIT');
    });

    it('combina WHERE y HAVING con AND u OR sin confundir sus etapas', () => {
      const count = { function: 'COUNT' as const, column: '*', alias: 'cantidad' };
      const sql = buildSelect('postgresql', {
        ...base,
        columns: ['categoria'],
        filters: [
          { column: 'activo', operator: '=', value: '1' },
          { column: 'prioridad', operator: '>', value: '3', conjunction: 'OR' },
        ],
        groupBy: ['categoria'],
        aggregates: [count],
        having: [
          { aggregate: count, operator: '>', value: '2' },
          { aggregate: count, operator: '=', value: '1', conjunction: 'OR' },
        ],
      });

      expect(sql).toContain('WHERE "activo" = 1\n  OR "prioridad" > 3');
      expect(sql).toContain('HAVING COUNT(*) > 2\n  OR COUNT(*) = 1');
      expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('GROUP BY'));
    });

    it('genera COUNT DISTINCT y varios criterios de orden', () => {
      const distinct = {
        function: 'COUNT' as const,
        column: 'cliente_id',
        alias: 'clientes',
        distinct: true,
      };
      const sql = buildSelect('mysql', {
        ...base,
        columns: ['categoria'],
        groupBy: ['categoria'],
        aggregates: [distinct],
        orders: [{ expression: distinct, descending: true }, { expression: 'categoria' }],
      });

      expect(sql).toContain('COUNT(DISTINCT `cliente_id`) AS `clientes`');
      expect(sql).toContain('ORDER BY COUNT(DISTINCT `cliente_id`) DESC, `categoria`');
    });

    it('agrupa fechas por mes con la expresión propia de cada motor', () => {
      const expected = {
        postgresql: 'DATE_TRUNC(\'month\', "creado")',
        mysql: 'DATE_ADD(MAKEDATE(YEAR(`creado`), 1), INTERVAL (MONTH(`creado`) - 1) MONTH)',
        sqlserver: 'DATEFROMPARTS(YEAR([creado]), MONTH([creado]), 1)',
        informix: 'MDY(MONTH("creado"), 1, YEAR("creado"))',
      } as const;

      for (const engine of Object.keys(expected) as (keyof typeof expected)[]) {
        const sql = buildSelect(engine, {
          ...base,
          dateGroups: [{ column: 'creado', period: 'month', alias: 'creado_month' }],
          aggregates: [{ function: 'COUNT', column: '*', alias: 'cantidad' }],
        });
        expect(sql).toContain(`${expected[engine]} AS`);
        expect(sql).toContain(`GROUP BY ${expected[engine]}`);
      }
    });

    it('genera varios tipos de JOIN con alias y columnas calificadas', () => {
      const sql = buildSelect('postgresql', {
        ...base,
        alias: 't0',
        columns: [
          { alias: 't0', column: 'id' },
          { alias: 't1', column: 'nombre' },
          { alias: 't2', column: 'codigo' },
        ],
        joins: [
          {
            type: 'INNER',
            schema: 'public',
            table: 'clientes',
            alias: 't1',
            leftAlias: 't0',
            leftColumn: 'cliente_id',
            rightColumn: 'id',
          },
          {
            type: 'LEFT',
            schema: 'public',
            table: 'estados',
            alias: 't2',
            leftAlias: 't1',
            leftColumn: 'estado_id',
            rightColumn: 'id',
          },
        ],
      });

      expect(sql).toContain('SELECT "t0"."id", "t1"."nombre", "t2"."codigo"');
      expect(sql).toContain('FROM "tpublico"."usuarios" AS "t0"');
      expect(sql).toContain('INNER JOIN "public"."clientes" AS "t1"');
      expect(sql).toContain('ON "t0"."cliente_id" = "t1"."id"');
      expect(sql).toContain('LEFT JOIN "public"."estados" AS "t2"');
      expect(sql).toContain('ON "t1"."estado_id" = "t2"."id"');
    });

    it('CROSS JOIN no genera condición ON', () => {
      const sql = buildSelect('mysql', {
        ...base,
        alias: 't0',
        joins: [
          {
            type: 'CROSS',
            table: 'colores',
            alias: 't1',
            leftAlias: 't0',
            leftColumn: '',
            rightColumn: '',
          },
        ],
      });

      expect(sql).toContain('CROSS JOIN `colores` AS `t1`');
      expect(sql).not.toContain('\n  ON ');
    });

    it('admite FULL OUTER JOIN en los motores que lo soportan', () => {
      const sql = buildSelect('sqlserver', {
        ...base,
        joins: [
          {
            type: 'FULL OUTER',
            table: 'archivo',
            alias: 't1',
            leftAlias: 't0',
            leftColumn: 'id',
            rightColumn: 'id',
          },
        ],
      });

      expect(sql).toContain('FULL OUTER JOIN [archivo] AS [t1]');
      expect(sql).toContain('FROM [tpublico].[usuarios] AS [t0]');
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

      // Informix no admite ninguna de las dos formas: nombra su columna serial y
      // le da un cero. Y lo hace igual por sus dos protocolos.
      expect(buildInsert('informix', soloIdentidad)).toContain('("id")\nVALUES (0)');
      expect(buildInsert('informixsqli', soloIdentidad)).toContain('("id")\nVALUES (0)');
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

  describe('valores rellenados', () => {
    it('distingue números, texto, vacío y NULL en INSERT', () => {
      const sql = buildInsertValues('postgresql', {
        schema: 'public',
        table: 'usuarios',
        values: [
          { column: 'id', dataType: 'int', value: { kind: 'value', text: '12' } },
          { column: 'nombre', dataType: 'text', value: { kind: 'value', text: "O'Brien" } },
          { column: 'correo', dataType: 'text', value: { kind: 'value', text: '' } },
          { column: 'borrado_en', dataType: 'timestamp', value: { kind: 'null' } },
        ],
      });

      expect(sql).toContain("VALUES (12, 'O''Brien', '', NULL)");
    });

    it('un valor sin rellenar queda como marcador visible', () => {
      const sql = buildInsertValues('sqlserver', {
        table: 'usuarios',
        values: [
          { column: 'nombre', dataType: 'nvarchar(200)', value: { kind: 'value', text: null } },
        ],
      });

      expect(sql).toContain('/* nvarchar(200): valor obligatorio */');
    });

    it('un INSERT sin columnas usa valores por defecto según el motor', () => {
      expect(buildInsertValues('postgresql', { table: 't', values: [] })).toContain(
        'DEFAULT VALUES',
      );
      expect(buildInsertValues('mysql', { table: 't', values: [] })).toContain('()\nVALUES ()');
    });

    it('UPDATE escribe NULL, DEFAULT y conserva todos los filtros', () => {
      const sql = buildUpdateValues('sqlserver', {
        schema: 'dbo',
        table: 'usuarios',
        assignments: [
          { column: 'correo', dataType: 'nvarchar(200)', value: { kind: 'null' } },
          { column: 'actualizado', dataType: 'datetime2', value: { kind: 'default' } },
        ],
        filters: [
          { column: 'tenant_id', operator: '=', value: '4' },
          { column: 'id', operator: '=', value: '7' },
        ],
      });

      expect(sql).toContain('[correo] = NULL');
      expect(sql).toContain('[actualizado] = DEFAULT');
      expect(sql).toContain('WHERE [tenant_id] = 4\n  AND [id] = 7');
    });

    it('UPDATE sin filtro deja una condición obligatoria', () => {
      const sql = buildUpdateValues('mysql', {
        table: 'usuarios',
        assignments: [
          { column: 'nombre', dataType: 'text', value: { kind: 'value', text: 'Ana' } },
        ],
        filters: [],
      });

      expect(sql).toContain('WHERE /* condición obligatoria */');
    });

    it('UPDATE sin columnas elegidas no produce SQL ejecutable', () => {
      expect(
        buildUpdateValues('postgresql', { table: 'usuarios', assignments: [], filters: [] }),
      ).toBe('-- Elige al menos una columna para modificar.\n');
    });
  });

  describe('llamada a un procedimiento', () => {
    const entrada = {
      name: 'entrada',
      dataType: 'int',
      direction: 'input',
      value: { kind: 'value', text: '7' },
    } as const;

    const salida = {
      name: 'salida',
      dataType: 'varchar(30)',
      direction: 'output',
      value: { kind: 'null' },
    } as const;

    it('SQL Server declara la salida, la pasa como OUTPUT y la lee después', () => {
      const sql = buildCall('sqlserver', {
        schema: 'dbo',
        routine: 'registrar',
        parameters: [
          { ...entrada, name: '@entrada' },
          { ...salida, name: '@salida' },
        ],
      });

      expect(sql).toContain('DECLARE @out_salida varchar(30);');
      expect(sql).toContain('@entrada = 7');
      expect(sql).toContain('@salida = @out_salida OUTPUT');
      expect(sql).toContain('SELECT @out_salida AS [salida];');
      expect(sql).toContain('EXEC [dbo].[registrar]');
    });

    it('MySQL usa variables de sesión para las salidas', () => {
      const sql = buildCall('mysql', {
        schema: 'tienda',
        routine: 'registrar',
        parameters: [entrada, salida],
      });

      expect(sql).toContain('SET @salida_salida = NULL;');
      expect(sql).toContain('CALL `tienda`.`registrar`(7, @salida_salida);');
      expect(sql).toContain('SELECT @salida_salida AS `salida`;');
    });

    it('PostgreSQL pasa un hueco NULL y recoge la salida del propio CALL', () => {
      const sql = buildCall('postgresql', {
        schema: 'public',
        routine: 'registrar',
        parameters: [entrada, salida],
      });

      expect(sql).toBe('CALL "public"."registrar"(7, NULL);\n');
    });

    it('Informix ejecuta sin las salidas y explica por qué', () => {
      const sql = buildCall('informix', {
        schema: 'informix',
        routine: 'registrar',
        parameters: [entrada, salida],
      });

      expect(sql).toContain('EXECUTE PROCEDURE "informix"."registrar"(7);');
      expect(sql).toContain('-- Informix solo recoge los parámetros de salida (salida)');
    });

    it('un procedimiento sin parámetros no escribe paréntesis vacíos en SQL Server', () => {
      expect(buildCall('sqlserver', { schema: 'dbo', routine: 'limpiar', parameters: [] })).toBe(
        'EXEC [dbo].[limpiar];\n',
      );
    });

    it('un valor sin escribir queda señalado en lugar de colarse vacío', () => {
      const sql = buildCall('mysql', {
        routine: 'registrar',
        parameters: [{ ...entrada, value: { kind: 'value', text: null } }],
      });

      expect(sql).toContain('/* int: valor obligatorio */');
    });
  });

  describe('DELETE compuesto', () => {
    it('escribe el DELETE con su filtro', () => {
      const sql = buildDeleteValues('postgresql', {
        schema: 'public',
        table: 'usuarios',
        filters: [{ column: 'id', operator: '=', value: '7' }],
      });

      expect(sql).toBe('DELETE FROM "public"."usuarios"\nWHERE "id" = 7;\n');
    });

    /** Lo que impide el accidente: sin condición, no hay DELETE que ejecutar. */
    it('sin filtros deja la condición como hueco obligatorio', () => {
      const sql = buildDeleteValues('sqlserver', { table: 'usuarios', filters: [] });

      expect(sql).toContain('/* condición obligatoria */');
      expect(sql).not.toMatch(/WHERE\s*;/);
    });

    it('el recuento usa exactamente el mismo filtro', () => {
      const filters = [
        { column: 'estado', operator: '=' as const, value: 'baja' },
        { column: 'creado', operator: '<' as const, value: '2020-01-01' },
      ];

      const borrado = buildDeleteValues('mysql', { table: 'usuarios', filters });
      const recuento = buildDeleteCount('mysql', { table: 'usuarios', filters });

      const condiciones = (sql: string) => sql.slice(sql.indexOf('WHERE'));

      expect(recuento).toContain('SELECT COUNT(*) AS filas FROM `usuarios`');
      expect(condiciones(recuento).replace(';', '')).toBe(condiciones(borrado).replace(';\n', ''));
    });

    it('sin filtros no hay nada que contar', () => {
      expect(buildDeleteCount('postgresql', { table: 'usuarios', filters: [] })).toBe('');
    });
  });
});
