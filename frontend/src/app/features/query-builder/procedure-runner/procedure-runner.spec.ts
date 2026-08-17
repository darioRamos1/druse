import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import {
  DatabaseEngine,
  DatabaseObject,
  RoutineSignature,
} from '../../../shared/models/workspace';
import { ProcedureRunner } from './procedure-runner';

const procedure: DatabaseObject = {
  id: 'Procedure:dbo.registrar',
  name: 'registrar',
  kind: 'procedure',
  database: 'druse_test',
  schema: 'dbo',
  hasChildren: false,
};

const conEntradaYSalida: RoutineSignature = {
  name: 'registrar',
  schema: 'dbo',
  isFunction: false,
  parameters: [
    { name: '@entrada', dataType: 'int', direction: 'input', ordinal: 1, hasDefault: false },
    {
      name: '@salida',
      dataType: 'varchar(30)',
      direction: 'output',
      ordinal: 2,
      hasDefault: false,
    },
  ],
};

let signature: RoutineSignature | null = conEntradaYSalida;
const requests: DatabaseObject[] = [];

const store = {
  routineSignature: (_connectionId: string, routine: DatabaseObject) => {
    requests.push(routine);
    return Promise.resolve(signature);
  },
};

async function create(engine: DatabaseEngine = 'sqlserver'): Promise<ComponentFixture<ProcedureRunner>> {
  const fixture = TestBed.createComponent(ProcedureRunner);

  fixture.componentRef.setInput('procedure', procedure);
  fixture.componentRef.setInput('engine', engine);
  fixture.componentRef.setInput('connectionId', 'connection-1');

  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return fixture;
}

function sqlOf(fixture: ComponentFixture<ProcedureRunner>): string {
  return (fixture.nativeElement.querySelector('.sql') as HTMLTextAreaElement).value;
}

describe('ProcedureRunner', () => {
  beforeEach(async () => {
    signature = conEntradaYSalida;
    requests.length = 0;

    await TestBed.configureTestingModule({
      imports: [ProcedureRunner],
      providers: [{ provide: WorkspaceStore, useValue: store }],
    }).compileComponents();
  });

  it('pide un valor por cada parámetro de entrada, y ninguno por los de salida', async () => {
    const fixture = await create();
    const nombres = [...fixture.nativeElement.querySelectorAll('.parameter .name')].map(
      (element: Element) => element.textContent?.trim(),
    );

    expect(nombres).toEqual(['@entrada']);
  });

  it('compone la llamada con lo que se escribe', async () => {
    const fixture = await create();
    const input = fixture.nativeElement.querySelector('.value .field') as HTMLInputElement;

    input.value = '7';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const sql = sqlOf(fixture);

    expect(sql).toContain('@entrada = 7');
    expect(sql).toContain('DECLARE @out_salida varchar(30);');
    expect(sql).toContain('SELECT @out_salida AS [salida];');
  });

  it('NULL y valor son estados distintos', async () => {
    const fixture = await create();
    const [, nulo] = [...fixture.nativeElement.querySelectorAll('.modes button')];

    (nulo as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(sqlOf(fixture)).toContain('@entrada = NULL');
  });

  it('avisa de que Informix no recoge las salidas', async () => {
    const fixture = await create('informix');

    expect(fixture.nativeElement.querySelector('.note')?.textContent).toContain(
      'solo entrega los parámetros de salida dentro de otro procedimiento',
    );
    expect(sqlOf(fixture)).toContain('EXECUTE PROCEDURE');
  });

  it('un valor sin escribir se señala antes de ejecutar', async () => {
    const fixture = await create();

    expect(fixture.nativeElement.querySelector('.warning')?.textContent).toContain(
      'Falta el valor de 1 parámetro',
    );
  });

  it('lo escrito a mano en el SQL se conserva hasta tocar el formulario', async () => {
    const fixture = await create();
    const textarea = fixture.nativeElement.querySelector('.sql') as HTMLTextAreaElement;

    textarea.value = 'EXEC otra_cosa;';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(sqlOf(fixture)).toBe('EXEC otra_cosa;');

    const input = fixture.nativeElement.querySelector('.value .field') as HTMLInputElement;
    input.value = '3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Al cambiar un valor se vuelve a componer: mantener el texto viejo enseñaría
    // un SQL que ya no se corresponde con el formulario.
    expect(sqlOf(fixture)).toContain('@entrada = 3');
  });

  it('si no se pueden leer los parámetros, lo dice y no ofrece ejecutar', async () => {
    signature = null;

    const fixture = await create();
    const ejecutar = fixture.nativeElement.querySelector('.primary') as HTMLButtonElement;

    expect(fixture.nativeElement.querySelector('.state')?.textContent).toContain(
      'No se pudieron leer los parámetros',
    );
    expect(ejecutar.disabled).toBe(true);
  });

  it('emite la llamada al ejecutar', async () => {
    const fixture = await create();
    const emitidas: string[] = [];

    fixture.componentInstance.run.subscribe((sql) => emitidas.push(sql));
    (fixture.nativeElement.querySelector('.primary') as HTMLButtonElement).click();

    expect(emitidas).toHaveLength(1);
    expect(emitidas[0]).toContain('EXEC [dbo].[registrar]');
  });
});
