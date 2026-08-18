import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  RestoreInspection,
  RestoreProgress,
  RestoreRequest,
} from '../../../core/application-gateway/application-gateway';
import { ExplorerNode } from '../../../shared/models/workspace';
import { RestoreDialog } from './restore-dialog';

const database: ExplorerNode = {
  id: 'connection-1|db:druse_test',
  label: 'druse_test',
  kind: 'database',
  depth: 1,
  expandable: true,
  expanded: false,
  loading: false,
  source: {
    id: 'db:druse_test',
    name: 'druse_test',
    kind: 'database',
    database: 'druse_test',
    hasChildren: true,
  },
  connectionId: 'connection-1',
};

const limpio: RestoreInspection = {
  path: 'C:/respaldos/tienda.sql',
  layout: 'SingleFile',
  compressed: false,
  manifest: {
    formatVersion: 1,
    engine: 'PostgreSql',
    serverVersion: '18.4',
    database: 'druse_test',
    createdAt: '2026-08-18T00:00:00Z',
    tables: 3,
    tablesWithData: 1,
    rows: 13,
    outcome: 'Completed',
    consistentSnapshot: true,
  },
  statements: 12,
  tables: ['tienda.cat_paises', 'tienda.clientes'],
  collisions: [],
  rejections: [],
  warnings: [],
  canRestore: true,
};

class FakeGateway implements Partial<ApplicationGateway> {
  inspection: RestoreInspection = limpio;
  started: RestoreRequest[] = [];
  status: RestoreProgress = {
    id: 'r1',
    step: 'Applying',
    outcome: 'Running',
    statementsDone: 3,
    statementsTotal: 12,
    rowsWritten: 4,
    elapsedMilliseconds: 300,
    applied: 3,
    warnings: [],
  };

  inspectRestore(): Observable<RestoreInspection> {
    return of(this.inspection);
  }

  runRestore(request: RestoreRequest): Observable<string> {
    this.started.push(request);

    return of('r1');
  }

  getRestoreStatus(): Observable<RestoreProgress> {
    return of(this.status);
  }

  cancelRestore(): Observable<void> {
    return of(undefined);
  }
}

/** Espera al primer sondeo del estado, que va medio segundo por detrás. */
async function polled(fixture: ComponentFixture<RestoreDialog>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700));

  fixture.detectChanges();
}

async function settle(fixture: ComponentFixture<RestoreDialog>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('RestoreDialog', () => {
  let fixture: ComponentFixture<RestoreDialog>;
  let element: HTMLElement;
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [RestoreDialog],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();

    fixture = TestBed.createComponent(RestoreDialog);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('target', database);
    fixture.componentRef.setInput('sessionId', 'sesion-1');
    fixture.detectChanges();
  });

  /** Escribe una ruta y pulsa «Mirar». */
  async function inspect(): Promise<void> {
    const input = element.querySelector<HTMLInputElement>('.picker__path')!;

    input.value = 'C:/respaldos/tienda.sql';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    [...element.querySelectorAll<HTMLButtonElement>('.picker button')]
      .find((button) => button.textContent?.includes('Mirar'))
      ?.click();

    await settle(fixture);
  }

  it('no deja restaurar hasta haber mirado el respaldo', () => {
    const run = [...element.querySelectorAll<HTMLButtonElement>('.foot button')].at(-1);

    expect(run?.textContent).toContain('Restaurar');
    expect(run?.disabled).toBe(true);
  });

  it('al mirarlo enseña de qué motor viene y qué trae', async () => {
    await inspect();

    expect(element.querySelector('.facts')?.textContent).toContain('PostgreSql');
    expect(element.textContent).toContain('12 instrucciones');
  });

  /**
   * Lo que de verdad hay que ver antes de aceptar. Las filas van con las tablas
   * porque «tres tablas» no dice nada y «tres tablas con 40.000 filas» sí.
   */
  it('avisa de las tablas que ya existen, con sus filas', async () => {
    gateway.inspection = {
      ...limpio,
      collisions: [
        { table: 'tienda.clientes', rows: 40000 },
        { table: 'tienda.pedidos', rows: 2000 },
      ],
    };

    await inspect();

    const collisions = element.querySelector('.collisions');

    expect(collisions?.textContent).toContain('2 tabla(s) ya existen');
    expect(collisions?.textContent).toContain('42000 filas');
    expect(collisions?.textContent).toContain('tienda.clientes');
  });

  it('un respaldo de otro motor no se puede lanzar, y dice por qué', async () => {
    gateway.inspection = {
      ...limpio,
      canRestore: false,
      rejections: [
        {
          reason: 'DifferentEngine',
          message: 'El respaldo es de SqlServer y esta conexión es de PostgreSql.',
        },
      ],
    };

    await inspect();

    expect(element.querySelector('.reject')?.textContent).toContain('SqlServer');

    const run = [...element.querySelectorAll<HTMLButtonElement>('.foot button')].at(-1);

    expect(run?.disabled).toBe(true);
  });

  it('lanzar manda la ruta que se miró', async () => {
    await inspect();

    [...element.querySelectorAll<HTMLButtonElement>('.foot button')]
      .at(-1)
      ?.click();

    await settle(fixture);

    expect(gateway.started).toHaveLength(1);
    expect(gateway.started[0].path).toBe('C:/respaldos/tienda.sql');
  });

  it('mientras corre enseña el progreso y dice que se puede cerrar', async () => {
    await inspect();
    [...element.querySelectorAll<HTMLButtonElement>('.foot button')].at(-1)?.click();
    await settle(fixture);

    expect(element.querySelector('app-operation-progress')).not.toBeNull();
    expect(element.textContent).toContain('la restauración sigue');
  });

  /**
   * El criterio de la fase: si falla, se sabe dónde y se puede seguir desde ahí.
   */
  it('al fallar dice en qué instrucción y ofrece reanudar', async () => {
    gateway.status = {
      ...gateway.status,
      step: 'Done',
      outcome: 'Failed',
      statementsDone: 5,
      applied: 4,
      failure: {
        index: 5,
        statement: 'INSERT INTO tienda.pedidos (id) VALUES (1)',
        message: 'relation "tienda.pedidos" does not exist',
      },
    };

    await inspect();
    [...element.querySelectorAll<HTMLButtonElement>('.foot button')].at(-1)?.click();
    await settle(fixture);

    // El estado final llega en el primer sondeo, medio segundo después: hasta
    // entonces la pantalla enseña lo que sabía al lanzar, que es lo correcto.
    await polled(fixture);

    expect(element.textContent).toContain('Se paró en la instrucción 5');
    expect(element.querySelector('.sql')?.textContent).toContain('INSERT INTO tienda.pedidos');

    const resume = [...element.querySelectorAll<HTMLButtonElement>('.actions button')]
      .find((button) => button.textContent?.includes('Reanudar'));

    expect(resume?.textContent).toContain('5');

    resume?.click();
    await settle(fixture);

    // Se reanuda **antes** de la que falló: la 5 se vuelve a intentar y las
    // cuatro anteriores no se repiten.
    expect(gateway.started.at(-1)?.resumeFrom).toBe(4);
  });
});
