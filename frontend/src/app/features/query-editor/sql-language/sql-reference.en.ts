import { DatabaseEngine } from '../../../shared/models/workspace';
import { INFORMIX, SqlReferenceEntry, fn, kw } from './sql-reference-types';

/**
 * The SQL reference in English, translated from the Spanish original.
 *
 * Same entries, same parameters and the same examples as `sql-reference.es.ts`:
 * `sql-reference.spec.ts` checks it, because a reference that drifts is worse
 * than one that is missing — it explains a function the engine does not have.
 */

/** Documented functions, in the same order as the original. */
const FUNCTIONS: readonly SqlReferenceEntry[] = [
  // --- Aggregates ------------------------------------------------------------
  fn(
    'COUNT',
    'Counts rows. `COUNT(*)` counts them all; `COUNT(column)` skips the nulls.',
    [['expression', '`*`, a column or `DISTINCT column`.']],
    { example: 'SELECT COUNT(*) FROM orders' },
  ),
  fn(
    'SUM',
    'Adds up the values of the group. Nulls do not count; with no rows it returns NULL, not 0.',
    [['expression', 'A numeric column or calculation.']],
    { example: 'SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id' },
  ),
  fn('AVG', 'Average of the values in the group, not counting nulls.', [
    ['expression', 'A numeric column or calculation.'],
  ]),
  fn('MIN', 'The smallest value in the group. Works with dates and text too.', [
    ['expression', 'A column or calculation.'],
  ]),
  fn('MAX', 'The largest value in the group. Works with dates and text too.', [
    ['expression', 'A column or calculation.'],
  ]),

  // --- Nulls -----------------------------------------------------------------
  fn(
    'COALESCE',
    'Returns the first value that is not null.',
    [
      ['value', 'What is looked at first.'],
      ['fallback', 'What is used when everything before it is null.'],
    ],
    { variadic: true, example: "COALESCE(phone, mobile, 'no phone')" },
  ),
  fn(
    'NULLIF',
    'Returns NULL when both values are equal; otherwise the first one. Avoids dividing by zero.',
    [
      ['value', 'What is normally returned.'],
      ['equal_to', 'When `value` equals this, NULL comes out.'],
    ],
    { example: 'total / NULLIF(quantity, 0)' },
  ),
  fn(
    'ISNULL',
    'Swaps a null for another value. It takes only two arguments; for more, `COALESCE`.',
    [
      ['value', 'What is looked at.'],
      ['replacement', 'What comes out when `value` is null.'],
    ],
    { engines: ['sqlserver'], example: 'ISNULL(discount, 0)' },
  ),
  fn(
    'IFNULL',
    'Swaps a null for another value.',
    [
      ['value', 'What is looked at.'],
      ['replacement', 'What comes out when `value` is null.'],
    ],
    { engines: ['mysql', 'sqlite'], example: 'IFNULL(discount, 0)' },
  ),
  fn(
    'NVL',
    'Swaps a null for another value.',
    [
      ['value', 'What is looked at.'],
      ['replacement', 'What comes out when `value` is null.'],
    ],
    { engines: ['oracle', ...INFORMIX], example: 'NVL(discount, 0)' },
  ),
  fn(
    'NVL2',
    'Chooses between two values depending on whether the first one is null.',
    [
      ['value', 'What is looked at.'],
      ['if_not_null', 'What comes out when `value` has something.'],
      ['if_null', 'What comes out when `value` is null.'],
    ],
    { engines: ['oracle'], example: "NVL2(end_date, 'closed', 'active')" },
  ),

  // --- Conversion and conditions ---------------------------------------------
  fn(
    'CAST',
    'Converts a value to another type.',
    [['value AS type', 'What is converted, `AS` and the target type.']],
    { example: 'CAST(amount AS DECIMAL(10,2))' },
  ),
  fn(
    'CONVERT',
    'Converts a value to another type; with dates, the style picks the format.',
    [
      ['type', 'Target type, such as `varchar(10)`.'],
      ['value', 'What is converted.'],
      ['style', 'Optional. Date format: 103 is dd/mm/yyyy, 23 is yyyy-mm-dd.'],
    ],
    { engines: ['sqlserver'], example: 'CONVERT(varchar(10), date, 103)' },
  ),
  fn(
    'IIF',
    'When the condition holds it returns the second argument; otherwise the third.',
    [
      ['condition', 'The comparison that is evaluated.'],
      ['if_true', 'What comes out when it holds.'],
      ['if_false', 'What comes out when it does not.'],
    ],
    { engines: ['sqlserver'], example: "IIF(stock > 0, 'in stock', 'sold out')" },
  ),
  fn(
    'DECODE',
    'Compares an expression with several values and returns the result of the one that matches. It is a shorthand `CASE`.',
    [
      ['expression', 'What is compared.'],
      ['search', 'A value it is compared with.'],
      ['result', 'What comes out when it matches.'],
      ['default', 'Optional, at the end: what comes out when nothing matches.'],
    ],
    {
      variadic: true,
      engines: ['oracle', ...INFORMIX],
      example: "DECODE(status, 'A', 'Active', 'C', 'Closed', 'Other')",
    },
  ),

  // --- Text ------------------------------------------------------------------
  fn('LOWER', 'Turns the text into lower case.', [['text', 'The source text.']]),
  fn('UPPER', 'Turns the text into upper case.', [['text', 'The source text.']]),
  fn('TRIM', 'Removes the spaces at the start and at the end.', [['text', 'The source text.']]),
  fn('LENGTH', 'Number of characters in the text.', [['text', 'The text that is measured.']], {
    engines: ['postgresql', 'mysql', 'oracle', 'sqlite', ...INFORMIX],
  }),
  fn(
    'LEN',
    'Number of characters in the text, not counting the trailing spaces.',
    [['text', 'The text that is measured.']],
    { engines: ['sqlserver'] },
  ),
  fn(
    'SUBSTRING',
    'A piece of a text. Positions start at 1.',
    [
      ['text', 'The source text.'],
      ['start', 'Position of the first character, counting from 1.'],
      ['length', 'How many characters are taken.'],
    ],
    { engines: ['postgresql', 'sqlserver', 'mysql', 'sqlite'], example: 'SUBSTRING(tax_id, 1, 3)' },
  ),
  fn(
    'SUBSTR',
    'A piece of a text. Positions start at 1.',
    [
      ['text', 'The source text.'],
      ['start', 'Position of the first character, counting from 1.'],
      ['length', 'Optional. How many characters are taken; without it, up to the end.'],
    ],
    {
      engines: ['oracle', 'sqlite', 'mysql', 'postgresql', ...INFORMIX],
      example: 'SUBSTR(tax_id, 1, 3)',
    },
  ),
  fn(
    'REPLACE',
    'Changes every appearance of one text for another.',
    [
      ['text', 'The source text.'],
      ['search', 'What is looked for.'],
      ['replacement', 'What is put in its place.'],
    ],
    { example: "REPLACE(phone, '-', '')" },
  ),
  fn(
    'CONCAT',
    'Joins several texts into one. Nulls are treated as empty text.',
    [
      ['text', 'The first piece.'],
      ['text', 'The next piece.'],
    ],
    {
      variadic: true,
      engines: ['postgresql', 'mysql', 'sqlserver'],
      example: "CONCAT(first_name, ' ', last_name)",
    },
  ),
  fn(
    'STRING_AGG',
    'Joins the values of the group into a single text, with a separator.',
    [
      ['expression', 'What is joined.'],
      ['separator', "The text between values, such as `', '`."],
    ],
    { engines: ['postgresql', 'sqlserver'], example: "STRING_AGG(name, ', ')" },
  ),
  fn(
    'GROUP_CONCAT',
    'Joins the values of the group into a single text, separated by commas.',
    [['expression', 'What is joined. In MySQL it takes `ORDER BY` and `SEPARATOR` inside.']],
    { engines: ['mysql', 'sqlite'], example: 'GROUP_CONCAT(name)' },
  ),
  fn(
    'LISTAGG',
    'Joins the values of the group into a single text, with a separator.',
    [
      ['expression', 'What is joined.'],
      ['separator', "The text between values, such as `', '`."],
    ],
    { engines: ['oracle'], example: "LISTAGG(name, ', ') WITHIN GROUP (ORDER BY name)" },
  ),
  fn(
    'ARRAY_AGG',
    'Gathers the values of the group into an array.',
    [['expression', 'What is gathered.']],
    { engines: ['postgresql'] },
  ),

  // --- Numbers ---------------------------------------------------------------
  fn('ABS', 'Absolute value.', [['number', 'The source number.']]),
  fn(
    'ROUND',
    'Rounds to the given number of decimals.',
    [
      ['number', 'The source number.'],
      ['decimals', 'How many decimals are left. A negative value rounds to tens, hundreds…'],
    ],
    { example: 'ROUND(price * 1.19, 2)' },
  ),
  fn('FLOOR', 'Rounds down to the nearest integer.', [['number', 'The source number.']]),
  fn('CEIL', 'Rounds up to the nearest integer.', [['number', 'The source number.']], {
    engines: ['postgresql', 'mysql', 'oracle', 'sqlite', ...INFORMIX],
  }),
  fn('CEILING', 'Rounds up to the nearest integer.', [['number', 'The source number.']], {
    engines: ['sqlserver', 'postgresql', 'mysql'],
  }),

  // --- Dates -----------------------------------------------------------------
  fn('NOW', 'The current date and time.', [], { engines: ['postgresql', 'mysql'] }),
  fn('GETDATE', "The server's current date and time, as `datetime`.", [], {
    engines: ['sqlserver'],
  }),
  fn('SYSDATETIMEOFFSET', 'The current date and time with its time zone.', [], {
    engines: ['sqlserver'],
  }),
  fn('CURDATE', "Today's date, without the time.", [], { engines: ['mysql'] }),
  fn(
    'EXTRACT',
    'Takes one part out of a date: the year, the month, the day…',
    [['field FROM date', 'The part (`YEAR`, `MONTH`, `DAY`…), `FROM` and the date.']],
    { engines: ['postgresql', 'mysql', 'oracle'], example: 'EXTRACT(YEAR FROM order_date)' },
  ),
  fn(
    'DATE_TRUNC',
    'Trims a date back to the start of its day, month, year…',
    [
      ['unit', "`'day'`, `'month'`, `'year'`…"],
      ['date', 'A date or a timestamp.'],
    ],
    { engines: ['postgresql'], example: "DATE_TRUNC('month', order_date)" },
  ),
  fn(
    'DATEADD',
    'Adds a number of days, months, years… to a date.',
    [
      ['part', '`day`, `month`, `year`, `hour`…, without quotes.'],
      ['amount', 'How much is added; negative to subtract.'],
      ['date', 'The starting date.'],
    ],
    { engines: ['sqlserver'], example: 'DATEADD(day, -30, GETDATE())' },
  ),
  fn(
    'DATEDIFF',
    'How many units there are between two dates.',
    [
      ['part', '`day`, `month`, `year`…, without quotes.'],
      ['start', 'The starting date.'],
      ['end', 'The finishing date.'],
    ],
    { engines: ['sqlserver'], example: 'DATEDIFF(day, order_date, GETDATE())' },
  ),
  fn(
    'DATEDIFF',
    'Days between two dates. **Careful: the end date goes first**, the other way round from SQL Server.',
    [
      ['end', 'The finishing date.'],
      ['start', 'The starting date.'],
    ],
    { engines: ['mysql'], example: 'DATEDIFF(CURDATE(), order_date)' },
  ),
  fn(
    'DATE_FORMAT',
    'Writes a date with the given format.',
    [
      ['date', 'The source date.'],
      ['format', "A pattern such as `'%d/%m/%Y'`."],
    ],
    { engines: ['mysql'], example: "DATE_FORMAT(order_date, '%d/%m/%Y')" },
  ),
  fn(
    'FORMAT',
    'Writes a number or a date with the given format.',
    [
      ['value', 'A number or a date.'],
      ['format', "A .NET pattern, such as `'dd/MM/yyyy'` or `'N2'`."],
    ],
    { engines: ['sqlserver'], example: "FORMAT(order_date, 'dd/MM/yyyy')" },
  ),
  fn(
    'TO_CHAR',
    'Writes a date or a number with the given format.',
    [
      ['value', 'A date or a number.'],
      ['format', "A pattern such as `'DD/MM/YYYY'`."],
    ],
    {
      engines: ['postgresql', 'oracle', ...INFORMIX],
      example: "TO_CHAR(order_date, 'DD/MM/YYYY')",
    },
  ),
  fn(
    'TO_DATE',
    'Reads a date written as text, with the given format.',
    [
      ['text', "The date as written, such as `'31/12/2025'`."],
      ['format', "How it is written, such as `'DD/MM/YYYY'`."],
    ],
    {
      engines: ['postgresql', 'oracle', ...INFORMIX],
      example: "TO_DATE('31/12/2025', 'DD/MM/YYYY')",
    },
  ),
  fn(
    'TO_NUMBER',
    'Reads a number written as text.',
    [
      ['text', 'The number as written.'],
      ['format', 'Optional. How it is written.'],
    ],
    { engines: ['oracle', 'postgresql'] },
  ),
  fn(
    'TRUNC',
    'With a date, it drops the time (or trims it to the month, the year…). With a number, it cuts the decimals.',
    [
      ['value', 'A date or a number.'],
      [
        'format',
        "Optional. With dates, `'MM'` or `'YYYY'`; with numbers, the decimals that are left.",
      ],
    ],
    { engines: ['oracle', ...INFORMIX], example: 'TRUNC(SYSDATE)' },
  ),
  fn(
    'MDY',
    'Builds a date out of the month, the day and the year.',
    [
      ['month', '1 to 12.'],
      ['day', '1 to 31.'],
      ['year', 'With four digits.'],
    ],
    { engines: INFORMIX, example: 'MDY(12, 31, 2025)' },
  ),
  fn(
    'EXTEND',
    'Changes the precision of a date or time: which parts it carries, from the first to the last.',
    [
      ['value', 'A date or a `DATETIME`.'],
      ['first TO last', 'Such as `YEAR TO DAY` or `HOUR TO MINUTE`.'],
    ],
    { engines: INFORMIX, example: 'EXTEND(order_date, YEAR TO MONTH)' },
  ),
  fn(
    'DBINFO',
    'Information about the session or about the last statement.',
    [['what', "Such as `'sqlca.sqlerrd1'`, the last serial inserted."]],
    { engines: INFORMIX, example: "DBINFO('sqlca.sqlerrd1')" },
  ),
  fn(
    'strftime',
    'Writes a date with the given format. In SQLite dates are text.',
    [
      ['format', "A pattern such as `'%Y-%m'`."],
      ['date', "A date, or `'now'`."],
      ['modifier', "Optional, such as `'-1 day'` or `'start of month'`."],
    ],
    { variadic: true, engines: ['sqlite'], example: "strftime('%Y-%m', order_date)" },
  ),
  fn(
    'date',
    'The date, without the time, after applying the modifiers.',
    [
      ['date', "A date, or `'now'`."],
      ['modifier', "Optional, such as `'-7 days'`."],
    ],
    { variadic: true, engines: ['sqlite'], example: "date('now', '-7 days')" },
  ),
  fn(
    'julianday',
    'The date as a number of days. Subtracting two gives the days between them.',
    [['date', "A date, or `'now'`."]],
    { engines: ['sqlite'], example: "julianday('now') - julianday(order_date)" },
  ),
  fn(
    'GENERATE_SERIES',
    'Generates one row per value between the start and the end.',
    [
      ['start', 'The first value (a number or a date).'],
      ['end', 'The last value.'],
      ['step', "Optional. With dates, an interval such as `'1 day'`."],
    ],
    {
      engines: ['postgresql'],
      example: "GENERATE_SERIES('2025-01-01'::date, '2025-12-31', '1 month')",
    },
  ),
];

/**
 * Reserved words that are worth explaining.
 *
 * Not all of them: `SELECT` or `FROM` need no tooltip. These are the ones that
 * change from engine to engine and the ones that often get used wrong.
 */
const KEYWORDS: readonly SqlReferenceEntry[] = [
  kw(
    'DISTINCT',
    'Removes the repeated rows from the result. It looks at every column of the `SELECT`, not only the first one.',
  ),
  kw(
    'GROUP BY',
    'Groups the rows with the same values so aggregates can be computed. Every column of the `SELECT` that is not an aggregate has to be here.',
    {
      example: 'SELECT status, COUNT(*) FROM orders GROUP BY status',
    },
  ),
  kw(
    'HAVING',
    'Filters the groups after grouping. `WHERE` filters rows before; `HAVING` can use aggregates.',
    {
      example: 'GROUP BY customer_id HAVING COUNT(*) > 5',
    },
  ),
  kw(
    'ORDER BY',
    'Sorts the result. Without it the order is not guaranteed, even when it looks stable.',
  ),
  kw(
    'EXISTS',
    'Holds when the subquery returns at least one row. It is usually faster than `IN` with large subqueries.',
    {
      example: 'WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)',
    },
  ),
  kw(
    'IN',
    'Holds when the value is in the list. **Careful with `NOT IN`**: when the list carries a NULL, it returns nothing.',
  ),
  kw(
    'BETWEEN',
    'Between two values, **both ends included**. With dates that carry a time, the last day only counts up to 00:00.',
  ),
  kw(
    'LIKE',
    '`%` is any text and `_` a single character. Whether it is case sensitive depends on the collation of the column.',
    {
      example: "WHERE name LIKE 'Ann%'",
    },
  ),
  kw('ILIKE', 'Like `LIKE`, but case insensitive.', { engines: ['postgresql'] }),
  kw('MATCHES', 'Comparison with Unix-style wildcards: `*` is any text and `?` one character.', {
    engines: INFORMIX,
    example: "WHERE name MATCHES 'Ann*'",
  }),
  kw(
    'UNION',
    'Puts the results of two queries together **and removes the duplicates**, which forces a sort. When that is not needed, `UNION ALL` is faster.',
  ),
  kw('UNION ALL', 'Puts the results of two queries together as they are, duplicates included.'),
  kw(
    'CASE',
    'Picks a value according to conditions. The first one that holds wins; without `ELSE`, NULL comes out.',
    {
      example: "CASE WHEN total > 1000 THEN 'high' ELSE 'normal' END",
    },
  ),
  kw('WITH', 'Declares named queries (CTEs) that are then used as if they were tables.'),
  kw(
    'TRUNCATE TABLE',
    'Empties the whole table in one go. It takes no `WHERE` and on several engines it cannot be undone.',
  ),
  kw('LIMIT', 'How many rows to return at most. It goes at the end of the query.', {
    engines: ['postgresql', 'mysql', 'sqlite'],
    example: 'SELECT * FROM orders ORDER BY order_date DESC LIMIT 10',
  }),
  kw(
    'OFFSET',
    'How many rows to skip before starting to return. For paging, together with `ORDER BY`.',
    {
      engines: ['postgresql', 'mysql', 'sqlite', 'sqlserver', 'oracle'],
    },
  ),
  kw('TOP', 'How many rows to return at most. It goes right after `SELECT`.', {
    engines: ['sqlserver'],
    example: 'SELECT TOP 10 * FROM orders ORDER BY order_date DESC',
  }),
  kw('FETCH NEXT', 'With `OFFSET`, how many rows to return. It requires `ORDER BY`.', {
    engines: ['sqlserver', 'oracle'],
    example: 'ORDER BY id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
  }),
  kw('FETCH FIRST', 'How many rows to return at most. It goes at the end of the query.', {
    engines: ['oracle'],
    example: 'SELECT * FROM orders ORDER BY order_date DESC FETCH FIRST 10 ROWS ONLY',
  }),
  kw('FIRST', 'How many rows to return at most. It goes right after `SELECT`, not at the end.', {
    engines: INFORMIX,
    example: 'SELECT FIRST 10 * FROM orders ORDER BY order_date DESC',
  }),
  kw('SKIP', 'How many rows to skip. It goes after `SELECT` and before `FIRST`.', {
    engines: INFORMIX,
    example: 'SELECT SKIP 20 FIRST 10 * FROM orders ORDER BY id',
  }),
  kw(
    'ROWNUM',
    'The row number Oracle assigns **before** sorting: `WHERE ROWNUM <= 10 ORDER BY …` does not give the first ten. For that, `FETCH FIRST`.',
    {
      engines: ['oracle'],
    },
  ),
  kw('DUAL', 'A single-row table for queries that read from no table at all.', {
    engines: ['oracle'],
    example: 'SELECT SYSDATE FROM DUAL',
  }),
  kw('SYSDATE', "The server's current date and time. It is written without parentheses.", {
    engines: ['oracle'],
  }),
  kw('TODAY', "Today's date, without the time. It is written without parentheses.", {
    engines: INFORMIX,
  }),
  kw('CURRENT', 'The current date and time. It is written without parentheses.', {
    engines: INFORMIX,
  }),
  kw(
    'RETURNING',
    'Returns the rows the `INSERT`, `UPDATE` or `DELETE` has just touched, like a `SELECT`.',
    {
      engines: ['postgresql', 'sqlite'],
      example: "INSERT INTO customers (name) VALUES ('Ann') RETURNING id",
    },
  ),
  kw(
    'OUTPUT',
    'Returns the rows the `INSERT`, `UPDATE` or `DELETE` has just touched, with `inserted.` and `deleted.`.',
    {
      engines: ['sqlserver'],
      example: "INSERT INTO customers (name) OUTPUT inserted.id VALUES ('Ann')",
    },
  ),
  kw(
    'ON CONFLICT',
    'What to do when the `INSERT` clashes with a unique key: `DO NOTHING` or `DO UPDATE SET …`. `EXCLUDED` is the row that was being inserted.',
    {
      engines: ['postgresql', 'sqlite'],
    },
  ),
  kw(
    'ON DUPLICATE KEY UPDATE',
    'When the `INSERT` clashes with a unique key, it updates the row that was already there.',
    {
      engines: ['mysql'],
    },
  ),
  kw(
    'MERGE',
    'Inserts, updates or deletes depending on whether a source row exists in the destination. It ends with a mandatory `;`.',
    {
      engines: ['sqlserver', 'oracle', ...INFORMIX],
    },
  ),
  kw(
    'CROSS APPLY',
    'Like a `JOIN` against a subquery that can use the columns of the current row. It drops the rows with no result.',
    {
      engines: ['sqlserver'],
    },
  ),
  kw(
    'OUTER APPLY',
    'Like `CROSS APPLY`, but it keeps the rows with no result, filled with NULL. It is the `LEFT JOIN` of the `APPLY`s.',
    {
      engines: ['sqlserver'],
    },
  ),
  kw('LATERAL', 'Lets a subquery in the `FROM` use the columns of the tables before it.', {
    engines: ['postgresql', 'mysql', 'oracle'],
  }),
  kw(
    'CONNECT BY',
    'Walks a hierarchy (parent and child in the same table). `START WITH` picks the root and `PRIOR` marks the parent.',
    {
      engines: ['oracle'],
      example: 'START WITH manager_id IS NULL CONNECT BY PRIOR id = manager_id',
    },
  ),
  kw(
    'PRAGMA',
    'Reads or changes a setting of the database, such as `PRAGMA table_info(table)` or `PRAGMA foreign_keys = ON`.',
    {
      engines: ['sqlite'],
    },
  ),
  kw(
    'WITHOUT ROWID',
    'A table with no hidden `rowid` column, stored by its primary key. It requires a primary key.',
    {
      engines: ['sqlite'],
    },
  ),
];

export const SQL_REFERENCE_EN: readonly SqlReferenceEntry[] = [...FUNCTIONS, ...KEYWORDS];
