import { AiRowsRequest, selectRows, rowCell } from './ai-rows';

const request: AiRowsRequest = {
  source: { connectionId: 'c1', connectionName: 'Pruebas', database: 'ventas' },
  executionId: 'e1',
  occurredAtUtc: '2026-10-19T13:00:00Z',
  resultSetIndex: 1,
  resultSet: {
    columns: [
      { name: 'id', dataType: 'bigint', kind: 'number', width: null },
      { name: 'privado', dataType: 'text', kind: 'text', width: null },
      { name: 'binario', dataType: 'blob', kind: 'binary', width: null },
    ],
    rows: [{ number: 1, values: ['9007199254740993', 'sensible', 'contenido binario'] }],
    totalRows: 1,
    durationMs: 1,
    truncated: true,
  },
};

describe('muestras del chat', () => {
  it('no elige filas ni columnas automáticamente y conserva números como texto', () => {
    expect(selectRows(request, [], ['include'], false)).toBeNull();
    expect(selectRows(request, [0], ['exclude'], false)).toBeNull();
    const sample = selectRows(request, [0], ['include', 'exclude', 'exclude'], false)!;
    expect(sample.columns.map((column) => column.name)).toEqual(['id']);
    expect(sample.rows[0].cells).toEqual([{ kind: 'text', value: '9007199254740993' }]);
    expect(sample).toMatchObject({
      executionId: 'e1',
      resultSetIndex: 1,
      availableRows: 1,
      resultTruncated: true,
    });
    expect(JSON.stringify(sample)).not.toContain('sensible');
  });

  it('no lee el contenido de una columna excluida, oculta ni binaria', () => {
    const values = ['id'];
    Object.defineProperty(values, 1, {
      get: () => {
        throw new Error('No debe leer el dato privado');
      },
    });
    Object.defineProperty(values, 2, {
      get: () => {
        throw new Error('No debe leer el binario');
      },
    });
    const local = {
      ...request,
      resultSet: { ...request.resultSet, rows: [{ number: 1, values }] },
    };
    expect(
      selectRows(local, [0], ['include', 'exclude', 'exclude'], false)?.rows[0].cells,
    ).toHaveLength(1);
    expect(selectRows(local, [0], ['include', 'mask', 'include'], false)?.rows[0].cells).toEqual([
      { kind: 'text', value: 'id' },
      { kind: 'masked' },
      { kind: 'binary' },
    ]);
  });

  it('distingue nulos, vacíos y límites exactos de UTF-8 sin partir emojis', () => {
    expect(rowCell(null, false, false)).toEqual({ kind: 'null' });
    expect(rowCell('', false, false)).toEqual({ kind: 'text', value: '' });
    expect(rowCell('á'.repeat(512), false, false).kind).toBe('text');
    const cell = rowCell('a'.repeat(1023) + '😀', false, false);
    expect(cell).toEqual({ kind: 'truncated', value: 'a'.repeat(1023), originalBytes: 1027 });
    expect(rowCell('😀'.repeat(257), false, false)).toEqual({
      kind: 'truncated',
      value: '😀'.repeat(256),
      originalBytes: 1028,
    });
  });

  it('rechaza índices inválidos y exceso de selección sin recortar silenciosamente', () => {
    for (const index of [-1, 1, 0.5, NaN])
      expect(selectRows(request, [index], ['include'], false)).toBeNull();
    const many = {
      ...request,
      resultSet: {
        ...request.resultSet,
        rows: Array.from({ length: 51 }, (_, index) => ({ number: index + 1, values: ['x'] })),
      },
    };
    expect(
      selectRows(
        many,
        Array.from({ length: 51 }, (_, index) => index),
        ['include'],
        false,
      ),
    ).toBeNull();
    expect(selectRows(request, [0, 0], ['include'], false)?.rows).toHaveLength(1);
  });
});
