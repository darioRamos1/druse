import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApplicationGateway } from '../application-gateway/application-gateway';
import { AiBusinessNote, AiSource } from '../../shared/models/ai';
import { AiSelectedTable } from './ai-catalog';
import { AiNotesStore, eligibleNotes } from './ai-notes-store';

const source: AiSource = { connectionId: 'c1', connectionName: 'Pruebas', database: 'ventas' };
const note: AiBusinessNote = {
  id: 'n1',
  connectionId: 'c1',
  database: 'ventas',
  text: 'Importes sin IVA',
  enabled: true,
  reference: null,
  updatedAtUtc: '2026-10-16T00:00:00Z',
  formatVersion: 1,
};
const selected: AiSelectedTable = {
  table: { id: 't1', schema: 'public', name: 'facturas', kind: 'table', hasChildren: true },
  loading: false,
  detail: {
    table: { id: 't1', name: 'facturas', kind: 'table', hasChildren: true },
    columns: [
      { name: 'importe', dataType: 'numeric', isNullable: false, isPrimaryKey: false, ordinal: 0 },
    ],
    structure: { indexes: [], foreignKeys: [], uniqueConstraints: [], checkConstraints: [] },
  },
};
const tableNote: AiBusinessNote = {
  ...note,
  id: 'n2',
  reference: {
    objectId: 't1',
    schema: 'public',
    table: 'facturas',
    kind: 'table',
    column: 'importe',
  },
};

describe('Notas que acompañan a una pregunta', () => {
  it('incluye las generales y solo las columnas comprobadas de tablas seleccionadas', () => {
    expect(eligibleNotes([note, tableNote], source, [])).toEqual([note]);
    expect(eligibleNotes([note, tableNote], source, [selected])).toEqual([note, tableNote]);
    expect(
      eligibleNotes([tableNote], source, [{ ...selected, detail: undefined, error: 'fallo' }]),
    ).toEqual([]);
    expect(
      eligibleNotes(
        [{ ...tableNote, reference: { ...tableNote.reference!, column: 'renombrada' } }],
        source,
        [selected],
      ),
    ).toEqual([]);
  });
  it('no mezcla conexiones, bases, formatos desconocidos ni notas desactivadas', () => {
    for (const patch of [
      { connectionId: 'c2' },
      { database: 'otra' },
      { enabled: false },
      { formatVersion: 2 },
    ])
      expect(eligibleNotes([{ ...note, ...patch }], source, [selected])).toEqual([]);
  });
  it('no reasigna una tabla por nombre si cambió su identidad, esquema o tipo', () => {
    for (const patch of [
      { id: 'nueva' },
      { schema: 'otro' },
      { kind: 'view' as const },
      { name: 'renombrada' },
    ])
      expect(
        eligibleNotes([tableNote], source, [
          { ...selected, table: { ...selected.table, ...patch } },
        ]),
      ).toEqual([]);
  });
});

describe('AiNotesStore', () => {
  it('carga notas persistidas y actualiza o elimina una sin sustituir las demás', async () => {
    let reads = 0;
    const saved = { ...note, text: 'Nueva regla' };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApplicationGateway,
          useValue: {
            getAiNotes: () => {
              reads++;
              return of([note, tableNote]);
            },
            saveAiNote: () => of(saved),
            deleteAiNote: () => of(undefined),
          },
        },
      ],
    });
    const store = TestBed.inject(AiNotesStore);
    expect(await store.load()).toBe(true);
    await store.load();
    expect(reads).toBe(1);
    expect(await store.save(saved)).toBe(true);
    expect(store.notes()).toEqual([saved, tableNote]);
    await store.remove(saved.id);
    expect(store.notes()).toEqual([tableNote]);
  });
  it('conserva los datos al fallar una escritura y permite reintentar una lectura fallida', async () => {
    let fail = true;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApplicationGateway,
          useValue: {
            getAiNotes: () => (fail ? throwError(() => new Error('Sin conexión')) : of([note])),
            saveAiNote: () => throwError(() => new Error('Disco lleno')),
            deleteAiNote: () => throwError(() => new Error('Disco lleno')),
          },
        },
      ],
    });
    const store = TestBed.inject(AiNotesStore);
    expect(await store.load()).toBe(false);
    fail = false;
    expect(await store.load()).toBe(true);
    expect(await store.save({ ...note, text: 'Cambio' })).toBe(false);
    expect(await store.remove(note.id)).toBe(false);
    expect(store.notes()).toEqual([note]);
    expect(store.error()).not.toBe('');
  });
});
