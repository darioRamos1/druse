import { DatabaseEngine } from '../../../shared/models/workspace';
import { INFORMIX, SqlReferenceEntry, fn, kw } from './sql-reference-types';

/**
 * La referencia de SQL en español, que es el original.
 *
 * Vive aparte del código que la usa —y de su traducción— porque es
 * documentación: se escribe y se revisa entera, con su propio criterio, y no
 * clave a clave como el resto de la interfaz. Por eso no está en el catálogo.
 * `sql-reference.spec.ts` comprueba que la traducción tenga las mismas entradas
 * y los mismos parámetros, que es lo que evita que una se quede atrás.
 */

/**
 * Funciones documentadas.
 *
 * Las comunes van primero y sin `engines`; las de un motor, después y
 * marcadas. Cuando dos motores escriben lo mismo de forma distinta —`LENGTH` y
 * `LEN`, `CEIL` y `CEILING`— hay una entrada por forma, cada una con los suyos.
 */
const FUNCTIONS: readonly SqlReferenceEntry[] = [
  // --- Agregados -------------------------------------------------------------
  fn(
    'COUNT',
    'Cuenta filas. `COUNT(*)` las cuenta todas; `COUNT(columna)` salta los nulos.',
    [['expresión', '`*`, una columna o `DISTINCT columna`.']],
    { example: 'SELECT COUNT(*) FROM pedidos' },
  ),
  fn(
    'SUM',
    'Suma los valores del grupo. Los nulos no cuentan; sin filas devuelve NULL, no 0.',
    [['expresión', 'Columna o cálculo numérico.']],
    { example: 'SELECT cliente_id, SUM(total) FROM pedidos GROUP BY cliente_id' },
  ),
  fn('AVG', 'Media de los valores del grupo, sin contar los nulos.', [
    ['expresión', 'Columna o cálculo numérico.'],
  ]),
  fn('MIN', 'El valor más pequeño del grupo. Sirve también con fechas y texto.', [
    ['expresión', 'Columna o cálculo.'],
  ]),
  fn('MAX', 'El valor más grande del grupo. Sirve también con fechas y texto.', [
    ['expresión', 'Columna o cálculo.'],
  ]),

  // --- Nulos -----------------------------------------------------------------
  fn(
    'COALESCE',
    'Devuelve el primer valor que no sea nulo.',
    [
      ['valor', 'Lo que se mira primero.'],
      ['alternativa', 'Lo que se usa si todo lo anterior es nulo.'],
    ],
    { variadic: true, example: "COALESCE(telefono, movil, 'sin teléfono')" },
  ),
  fn(
    'NULLIF',
    'Devuelve NULL si los dos valores son iguales; si no, el primero. Evita dividir entre cero.',
    [
      ['valor', 'Lo que se devuelve normalmente.'],
      ['igual_a', 'Si `valor` es igual a esto, sale NULL.'],
    ],
    { example: 'total / NULLIF(cantidad, 0)' },
  ),
  fn(
    'ISNULL',
    'Cambia un nulo por otro valor. Solo acepta dos argumentos; para más, `COALESCE`.',
    [
      ['valor', 'Lo que se mira.'],
      ['reemplazo', 'Lo que sale si `valor` es nulo.'],
    ],
    { engines: ['sqlserver'], example: 'ISNULL(descuento, 0)' },
  ),
  fn(
    'IFNULL',
    'Cambia un nulo por otro valor.',
    [
      ['valor', 'Lo que se mira.'],
      ['reemplazo', 'Lo que sale si `valor` es nulo.'],
    ],
    { engines: ['mysql', 'sqlite'], example: 'IFNULL(descuento, 0)' },
  ),
  fn(
    'NVL',
    'Cambia un nulo por otro valor.',
    [
      ['valor', 'Lo que se mira.'],
      ['reemplazo', 'Lo que sale si `valor` es nulo.'],
    ],
    { engines: ['oracle', ...INFORMIX], example: 'NVL(descuento, 0)' },
  ),
  fn(
    'NVL2',
    'Elige entre dos valores según el primero sea nulo o no.',
    [
      ['valor', 'Lo que se mira.'],
      ['si_no_nulo', 'Lo que sale si `valor` tiene algo.'],
      ['si_nulo', 'Lo que sale si `valor` es nulo.'],
    ],
    { engines: ['oracle'], example: "NVL2(fecha_baja, 'baja', 'activo')" },
  ),

  // --- Conversión y condiciones ----------------------------------------------
  fn(
    'CAST',
    'Convierte un valor a otro tipo.',
    [['valor AS tipo', 'Lo que se convierte, `AS` y el tipo de destino.']],
    { example: 'CAST(importe AS DECIMAL(10,2))' },
  ),
  fn(
    'CONVERT',
    'Convierte un valor a otro tipo; con fechas, el estilo elige el formato.',
    [
      ['tipo', 'Tipo de destino, como `varchar(10)`.'],
      ['valor', 'Lo que se convierte.'],
      ['estilo', 'Opcional. Formato de fecha: 103 es dd/mm/aaaa, 23 es aaaa-mm-dd.'],
    ],
    { engines: ['sqlserver'], example: 'CONVERT(varchar(10), fecha, 103)' },
  ),
  fn(
    'IIF',
    'Si la condición se cumple devuelve el segundo argumento; si no, el tercero.',
    [
      ['condición', 'Comparación que se evalúa.'],
      ['si_verdadero', 'Lo que sale si se cumple.'],
      ['si_falso', 'Lo que sale si no.'],
    ],
    { engines: ['sqlserver'], example: "IIF(stock > 0, 'disponible', 'agotado')" },
  ),
  fn(
    'DECODE',
    'Compara una expresión con varios valores y devuelve el resultado del que coincida. Es un `CASE` abreviado.',
    [
      ['expresión', 'Lo que se compara.'],
      ['busca', 'Valor con el que se compara.'],
      ['resultado', 'Lo que sale si coincide.'],
      ['por_defecto', 'Opcional, al final: lo que sale si no coincide ninguno.'],
    ],
    {
      variadic: true,
      engines: ['oracle', ...INFORMIX],
      example: "DECODE(estado, 'A', 'Activo', 'B', 'Baja', 'Otro')",
    },
  ),

  // --- Texto -----------------------------------------------------------------
  fn('LOWER', 'Pasa el texto a minúsculas.', [['texto', 'Texto de origen.']]),
  fn('UPPER', 'Pasa el texto a mayúsculas.', [['texto', 'Texto de origen.']]),
  fn('TRIM', 'Quita los espacios del principio y del final.', [['texto', 'Texto de origen.']]),
  fn('LENGTH', 'Número de caracteres del texto.', [['texto', 'Texto que se mide.']], {
    engines: ['postgresql', 'mysql', 'oracle', 'sqlite', ...INFORMIX],
  }),
  fn(
    'LEN',
    'Número de caracteres del texto, sin contar los espacios del final.',
    [['texto', 'Texto que se mide.']],
    { engines: ['sqlserver'] },
  ),
  fn(
    'SUBSTRING',
    'Trozo de un texto. Las posiciones empiezan en 1.',
    [
      ['texto', 'Texto de origen.'],
      ['inicio', 'Posición del primer carácter, contando desde 1.'],
      ['longitud', 'Cuántos caracteres se toman.'],
    ],
    { engines: ['postgresql', 'sqlserver', 'mysql', 'sqlite'], example: 'SUBSTRING(nit, 1, 3)' },
  ),
  fn(
    'SUBSTR',
    'Trozo de un texto. Las posiciones empiezan en 1.',
    [
      ['texto', 'Texto de origen.'],
      ['inicio', 'Posición del primer carácter, contando desde 1.'],
      ['longitud', 'Opcional. Cuántos caracteres se toman; sin él, hasta el final.'],
    ],
    {
      engines: ['oracle', 'sqlite', 'mysql', 'postgresql', ...INFORMIX],
      example: 'SUBSTR(nit, 1, 3)',
    },
  ),
  fn(
    'REPLACE',
    'Cambia todas las apariciones de un texto por otro.',
    [
      ['texto', 'Texto de origen.'],
      ['buscar', 'Lo que se busca.'],
      ['reemplazo', 'Lo que se pone en su lugar.'],
    ],
    { example: "REPLACE(telefono, '-', '')" },
  ),
  fn(
    'CONCAT',
    'Une varios textos en uno. Los nulos se tratan como texto vacío.',
    [
      ['texto', 'Primer trozo.'],
      ['texto', 'Siguiente trozo.'],
    ],
    {
      variadic: true,
      engines: ['postgresql', 'mysql', 'sqlserver'],
      example: "CONCAT(nombre, ' ', apellido)",
    },
  ),
  fn(
    'STRING_AGG',
    'Une en un solo texto los valores del grupo, con un separador.',
    [
      ['expresión', 'Lo que se une.'],
      ['separador', "Texto entre valores, como `', '`."],
    ],
    { engines: ['postgresql', 'sqlserver'], example: "STRING_AGG(nombre, ', ')" },
  ),
  fn(
    'GROUP_CONCAT',
    'Une en un solo texto los valores del grupo, separados por comas.',
    [['expresión', 'Lo que se une. En MySQL admite `ORDER BY` y `SEPARATOR` dentro.']],
    { engines: ['mysql', 'sqlite'], example: 'GROUP_CONCAT(nombre)' },
  ),
  fn(
    'LISTAGG',
    'Une en un solo texto los valores del grupo, con un separador.',
    [
      ['expresión', 'Lo que se une.'],
      ['separador', "Texto entre valores, como `', '`."],
    ],
    { engines: ['oracle'], example: "LISTAGG(nombre, ', ') WITHIN GROUP (ORDER BY nombre)" },
  ),
  fn(
    'ARRAY_AGG',
    'Reúne los valores del grupo en un arreglo.',
    [['expresión', 'Lo que se reúne.']],
    { engines: ['postgresql'] },
  ),

  // --- Números ---------------------------------------------------------------
  fn('ABS', 'Valor absoluto.', [['número', 'Número de origen.']]),
  fn(
    'ROUND',
    'Redondea a los decimales indicados.',
    [
      ['número', 'Número de origen.'],
      ['decimales', 'Cuántos decimales quedan. Negativo redondea a decenas, centenas…'],
    ],
    { example: 'ROUND(precio * 1.19, 2)' },
  ),
  fn('FLOOR', 'Redondea hacia abajo al entero más cercano.', [['número', 'Número de origen.']]),
  fn('CEIL', 'Redondea hacia arriba al entero más cercano.', [['número', 'Número de origen.']], {
    engines: ['postgresql', 'mysql', 'oracle', 'sqlite', ...INFORMIX],
  }),
  fn('CEILING', 'Redondea hacia arriba al entero más cercano.', [['número', 'Número de origen.']], {
    engines: ['sqlserver', 'postgresql', 'mysql'],
  }),

  // --- Fechas ----------------------------------------------------------------
  fn('NOW', 'Fecha y hora actuales.', [], { engines: ['postgresql', 'mysql'] }),
  fn('GETDATE', 'Fecha y hora actuales del servidor, como `datetime`.', [], {
    engines: ['sqlserver'],
  }),
  fn('SYSDATETIMEOFFSET', 'Fecha y hora actuales con su zona horaria.', [], {
    engines: ['sqlserver'],
  }),
  fn('CURDATE', 'La fecha de hoy, sin hora.', [], { engines: ['mysql'] }),
  fn(
    'EXTRACT',
    'Saca una parte de una fecha: el año, el mes, el día…',
    [['campo FROM fecha', 'La parte (`YEAR`, `MONTH`, `DAY`…), `FROM` y la fecha.']],
    { engines: ['postgresql', 'mysql', 'oracle'], example: 'EXTRACT(YEAR FROM fecha)' },
  ),
  fn(
    'DATE_TRUNC',
    'Recorta una fecha al principio de su día, mes, año…',
    [
      ['unidad', "`'day'`, `'month'`, `'year'`…"],
      ['fecha', 'Fecha o marca de tiempo.'],
    ],
    { engines: ['postgresql'], example: "DATE_TRUNC('month', fecha)" },
  ),
  fn(
    'DATEADD',
    'Suma a una fecha una cantidad de días, meses, años…',
    [
      ['parte', '`day`, `month`, `year`, `hour`…, sin comillas.'],
      ['cantidad', 'Cuánto se suma; negativo para restar.'],
      ['fecha', 'Fecha de partida.'],
    ],
    { engines: ['sqlserver'], example: 'DATEADD(day, -30, GETDATE())' },
  ),
  fn(
    'DATEDIFF',
    'Cuántas unidades hay entre dos fechas.',
    [
      ['parte', '`day`, `month`, `year`…, sin comillas.'],
      ['inicio', 'Fecha de partida.'],
      ['fin', 'Fecha de llegada.'],
    ],
    { engines: ['sqlserver'], example: 'DATEDIFF(day, fecha_pedido, GETDATE())' },
  ),
  fn(
    'DATEDIFF',
    'Días entre dos fechas. **Ojo: primero la fecha final**, al revés que en SQL Server.',
    [
      ['fin', 'Fecha de llegada.'],
      ['inicio', 'Fecha de partida.'],
    ],
    { engines: ['mysql'], example: 'DATEDIFF(CURDATE(), fecha_pedido)' },
  ),
  fn(
    'DATE_FORMAT',
    'Escribe una fecha con el formato indicado.',
    [
      ['fecha', 'Fecha de origen.'],
      ['formato', "Patrón como `'%d/%m/%Y'`."],
    ],
    { engines: ['mysql'], example: "DATE_FORMAT(fecha, '%d/%m/%Y')" },
  ),
  fn(
    'FORMAT',
    'Escribe un número o una fecha con el formato indicado.',
    [
      ['valor', 'Número o fecha.'],
      ['formato', "Patrón de .NET, como `'dd/MM/yyyy'` o `'N2'`."],
    ],
    { engines: ['sqlserver'], example: "FORMAT(fecha, 'dd/MM/yyyy')" },
  ),
  fn(
    'TO_CHAR',
    'Escribe una fecha o un número con el formato indicado.',
    [
      ['valor', 'Fecha o número.'],
      ['formato', "Patrón como `'DD/MM/YYYY'`."],
    ],
    { engines: ['postgresql', 'oracle', ...INFORMIX], example: "TO_CHAR(fecha, 'DD/MM/YYYY')" },
  ),
  fn(
    'TO_DATE',
    'Lee una fecha escrita como texto, con el formato indicado.',
    [
      ['texto', "La fecha escrita, como `'31/12/2025'`."],
      ['formato', "Cómo está escrita, como `'DD/MM/YYYY'`."],
    ],
    {
      engines: ['postgresql', 'oracle', ...INFORMIX],
      example: "TO_DATE('31/12/2025', 'DD/MM/YYYY')",
    },
  ),
  fn(
    'TO_NUMBER',
    'Lee un número escrito como texto.',
    [
      ['texto', 'El número escrito.'],
      ['formato', 'Opcional. Cómo está escrito.'],
    ],
    { engines: ['oracle', 'postgresql'] },
  ),
  fn(
    'TRUNC',
    'Con una fecha, le quita la hora (o la recorta al mes, al año…). Con un número, le corta los decimales.',
    [
      ['valor', 'Fecha o número.'],
      [
        'formato',
        "Opcional. Con fechas, `'MM'` o `'YYYY'`; con números, los decimales que quedan.",
      ],
    ],
    { engines: ['oracle', ...INFORMIX], example: 'TRUNC(SYSDATE)' },
  ),
  fn(
    'MDY',
    'Construye una fecha a partir del mes, el día y el año.',
    [
      ['mes', '1 a 12.'],
      ['día', '1 a 31.'],
      ['año', 'Con cuatro cifras.'],
    ],
    { engines: INFORMIX, example: 'MDY(12, 31, 2025)' },
  ),
  fn(
    'EXTEND',
    'Cambia la precisión de una fecha u hora: qué partes lleva, de la primera a la última.',
    [
      ['valor', 'Fecha o `DATETIME`.'],
      ['primera TO última', 'Como `YEAR TO DAY` o `HOUR TO MINUTE`.'],
    ],
    { engines: INFORMIX, example: 'EXTEND(fecha, YEAR TO MONTH)' },
  ),
  fn(
    'DBINFO',
    'Información de la sesión o de la última instrucción.',
    [['qué', "Como `'sqlca.sqlerrd1'`, el último serial insertado."]],
    { engines: INFORMIX, example: "DBINFO('sqlca.sqlerrd1')" },
  ),
  fn(
    'strftime',
    'Escribe una fecha con el formato indicado. En SQLite las fechas son texto.',
    [
      ['formato', "Patrón como `'%Y-%m'`."],
      ['fecha', "Fecha, o `'now'`."],
      ['modificador', "Opcional, como `'-1 day'` o `'start of month'`."],
    ],
    { variadic: true, engines: ['sqlite'], example: "strftime('%Y-%m', fecha)" },
  ),
  fn(
    'date',
    'La fecha, sin hora, aplicando los modificadores.',
    [
      ['fecha', "Fecha, o `'now'`."],
      ['modificador', "Opcional, como `'-7 days'`."],
    ],
    { variadic: true, engines: ['sqlite'], example: "date('now', '-7 days')" },
  ),
  fn(
    'julianday',
    'La fecha como número de días. Restar dos da los días entre ellas.',
    [['fecha', "Fecha, o `'now'`."]],
    { engines: ['sqlite'], example: "julianday('now') - julianday(fecha)" },
  ),
  fn(
    'GENERATE_SERIES',
    'Genera una fila por cada valor entre el inicio y el fin.',
    [
      ['inicio', 'Primer valor (número o fecha).'],
      ['fin', 'Último valor.'],
      ['paso', "Opcional. Con fechas, un intervalo como `'1 day'`."],
    ],
    {
      engines: ['postgresql'],
      example: "GENERATE_SERIES('2025-01-01'::date, '2025-12-31', '1 month')",
    },
  ),
];

/**
 * Palabras reservadas que merecen explicación.
 *
 * No están todas: `SELECT` o `FROM` no necesitan tooltip. Están las que cambian
 * de un motor a otro y las que se usan mal a menudo.
 */
const KEYWORDS: readonly SqlReferenceEntry[] = [
  kw(
    'DISTINCT',
    'Quita las filas repetidas del resultado. Mira todas las columnas del `SELECT`, no solo la primera.',
  ),
  kw(
    'GROUP BY',
    'Agrupa las filas con los mismos valores para calcular agregados. Toda columna del `SELECT` que no sea un agregado tiene que estar aquí.',
    {
      example: 'SELECT estado, COUNT(*) FROM pedidos GROUP BY estado',
    },
  ),
  kw(
    'HAVING',
    'Filtra los grupos después de agrupar. `WHERE` filtra filas antes; `HAVING` puede usar agregados.',
    {
      example: 'GROUP BY cliente_id HAVING COUNT(*) > 5',
    },
  ),
  kw(
    'ORDER BY',
    'Ordena el resultado. Sin él, el orden no está garantizado aunque parezca estable.',
  ),
  kw(
    'EXISTS',
    'Se cumple si la subconsulta devuelve al menos una fila. Suele ser más rápido que `IN` con subconsultas grandes.',
    {
      example: 'WHERE EXISTS (SELECT 1 FROM pedidos p WHERE p.cliente_id = c.id)',
    },
  ),
  kw(
    'IN',
    'Se cumple si el valor está en la lista. **Cuidado con `NOT IN`**: si la lista trae un NULL, no devuelve nada.',
  ),
  kw(
    'BETWEEN',
    'Entre dos valores, **incluidos los dos extremos**. Con fechas y hora, el último día solo cuenta hasta las 00:00.',
  ),
  kw(
    'LIKE',
    '`%` es cualquier texto y `_` un solo carácter. Distingue mayúsculas según la intercalación de la columna.',
    {
      example: "WHERE nombre LIKE 'Ana%'",
    },
  ),
  kw('ILIKE', 'Como `LIKE`, pero sin distinguir mayúsculas.', { engines: ['postgresql'] }),
  kw(
    'MATCHES',
    'Comparación con comodines al estilo Unix: `*` es cualquier texto y `?` un carácter.',
    {
      engines: INFORMIX,
      example: "WHERE nombre MATCHES 'Ana*'",
    },
  ),
  kw(
    'UNION',
    'Junta los resultados de dos consultas **y quita los repetidos**, lo que obliga a ordenar. Si no hace falta, `UNION ALL` es más rápido.',
  ),
  kw('UNION ALL', 'Junta los resultados de dos consultas tal cual, con repetidos.'),
  kw(
    'CASE',
    'Elige un valor según condiciones. La primera que se cumple gana; sin `ELSE`, sale NULL.',
    {
      example: "CASE WHEN total > 1000 THEN 'alto' ELSE 'normal' END",
    },
  ),
  kw('WITH', 'Declara consultas con nombre (CTE) que se usan después como si fueran tablas.'),
  kw(
    'TRUNCATE TABLE',
    'Vacía la tabla entera de golpe. No admite `WHERE` y en varios motores no se puede deshacer.',
  ),
  kw('LIMIT', 'Cuántas filas devolver como mucho. Va al final de la consulta.', {
    engines: ['postgresql', 'mysql', 'sqlite'],
    example: 'SELECT * FROM pedidos ORDER BY fecha DESC LIMIT 10',
  }),
  kw(
    'OFFSET',
    'Cuántas filas saltar antes de empezar a devolver. Para paginar, junto con `ORDER BY`.',
    {
      engines: ['postgresql', 'mysql', 'sqlite', 'sqlserver', 'oracle'],
    },
  ),
  kw('TOP', 'Cuántas filas devolver como mucho. Va justo después de `SELECT`.', {
    engines: ['sqlserver'],
    example: 'SELECT TOP 10 * FROM pedidos ORDER BY fecha DESC',
  }),
  kw('FETCH NEXT', 'Con `OFFSET`, cuántas filas devolver. Exige `ORDER BY`.', {
    engines: ['sqlserver', 'oracle'],
    example: 'ORDER BY id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
  }),
  kw('FETCH FIRST', 'Cuántas filas devolver como mucho. Va al final de la consulta.', {
    engines: ['oracle'],
    example: 'SELECT * FROM pedidos ORDER BY fecha DESC FETCH FIRST 10 ROWS ONLY',
  }),
  kw('FIRST', 'Cuántas filas devolver como mucho. Va justo después de `SELECT`, no al final.', {
    engines: INFORMIX,
    example: 'SELECT FIRST 10 * FROM pedidos ORDER BY fecha DESC',
  }),
  kw('SKIP', 'Cuántas filas saltar. Va después de `SELECT` y antes de `FIRST`.', {
    engines: INFORMIX,
    example: 'SELECT SKIP 20 FIRST 10 * FROM pedidos ORDER BY id',
  }),
  kw(
    'ROWNUM',
    'Número de fila que Oracle asigna **antes** de ordenar: `WHERE ROWNUM <= 10 ORDER BY …` no da los diez primeros. Para eso, `FETCH FIRST`.',
    {
      engines: ['oracle'],
    },
  ),
  kw('DUAL', 'Tabla de una sola fila para consultas que no leen de ninguna tabla.', {
    engines: ['oracle'],
    example: 'SELECT SYSDATE FROM DUAL',
  }),
  kw('SYSDATE', 'Fecha y hora actuales del servidor. Se escribe sin paréntesis.', {
    engines: ['oracle'],
  }),
  kw('TODAY', 'La fecha de hoy, sin hora. Se escribe sin paréntesis.', { engines: INFORMIX }),
  kw('CURRENT', 'Fecha y hora actuales. Se escribe sin paréntesis.', { engines: INFORMIX }),
  kw(
    'RETURNING',
    'Devuelve las filas que el `INSERT`, `UPDATE` o `DELETE` acaba de tocar, como un `SELECT`.',
    {
      engines: ['postgresql', 'sqlite'],
      example: "INSERT INTO clientes (nombre) VALUES ('Ana') RETURNING id",
    },
  ),
  kw(
    'OUTPUT',
    'Devuelve las filas que el `INSERT`, `UPDATE` o `DELETE` acaba de tocar, con `inserted.` y `deleted.`.',
    {
      engines: ['sqlserver'],
      example: "INSERT INTO clientes (nombre) OUTPUT inserted.id VALUES ('Ana')",
    },
  ),
  kw(
    'ON CONFLICT',
    'Qué hacer si el `INSERT` choca con una clave única: `DO NOTHING` o `DO UPDATE SET …`. `EXCLUDED` es la fila que se intentaba insertar.',
    {
      engines: ['postgresql', 'sqlite'],
    },
  ),
  kw(
    'ON DUPLICATE KEY UPDATE',
    'Si el `INSERT` choca con una clave única, actualiza la fila que ya estaba.',
    {
      engines: ['mysql'],
    },
  ),
  kw(
    'MERGE',
    'Inserta, actualiza o borra según una fila de origen exista o no en el destino. Termina con `;` obligatorio.',
    {
      engines: ['sqlserver', 'oracle', ...INFORMIX],
    },
  ),
  kw(
    'CROSS APPLY',
    'Como un `JOIN` contra una subconsulta que puede usar las columnas de la fila actual. Descarta las filas sin resultado.',
    {
      engines: ['sqlserver'],
    },
  ),
  kw(
    'OUTER APPLY',
    'Como `CROSS APPLY`, pero conserva las filas sin resultado, con NULL. Es el `LEFT JOIN` de los `APPLY`.',
    {
      engines: ['sqlserver'],
    },
  ),
  kw('LATERAL', 'Deja que una subconsulta del `FROM` use las columnas de las tablas anteriores.', {
    engines: ['postgresql', 'mysql', 'oracle'],
  }),
  kw(
    'CONNECT BY',
    'Recorre una jerarquía (padre e hijo en la misma tabla). Con `START WITH` se elige la raíz y `PRIOR` marca el padre.',
    {
      engines: ['oracle'],
      example: 'START WITH jefe_id IS NULL CONNECT BY PRIOR id = jefe_id',
    },
  ),
  kw(
    'PRAGMA',
    'Consulta o cambia un ajuste de la base, como `PRAGMA table_info(tabla)` o `PRAGMA foreign_keys = ON`.',
    {
      engines: ['sqlite'],
    },
  ),
  kw(
    'WITHOUT ROWID',
    'Tabla sin la columna oculta `rowid`, guardada por su clave primaria. Exige clave primaria.',
    {
      engines: ['sqlite'],
    },
  ),
];

export const SQL_REFERENCE_ES: readonly SqlReferenceEntry[] = [...FUNCTIONS, ...KEYWORDS];
