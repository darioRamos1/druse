import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  TransferSetOrder,
  TransferSetRequest,
} from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject } from '../../../shared/models/workspace';
import { TransferSetDialog } from './transfer-set-dialog';

function folder(name: string, schema = 'public'): DatabaseObject {
  return {
    id: `Folder:${schema}.${name}`,
    name,
    kind: 'folder',
    database: 'druse_test',
    schema,
    hasChildren: true,
  };
}

function table(name: string, schema = 'public'): DatabaseObject {
  return {
    id: `Table:${schema}.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema,
    hasChildren: false,
  };
}

/**
 * Un catálogo con tres tablas en el origen y dos de ellas en el destino.
 *
 * La que falta es a propósito: es el caso que la pantalla tiene que contar en
 * lugar de dejar una pasada que parece completa y no lo es.
 */
class FakeGateway implements Partial<ApplicationGateway> {
  lastSet: TransferSetRequest | null = null;

  order: TransferSetOrder = {
    tables: ['public.clientes', 'public.pedidos'],
    cycles: [],
  };

  getDatabases(): Observable<readonly DatabaseObject[]> {
    return of([
      {
        id: 'db:druse_test',
        name: 'druse_test',
        kind: 'database',
        database: 'druse_test',
        hasChildren: true,
      },
    ]);
  }

  getChildren(sessionId: string, parent: DatabaseObject): Observable<readonly DatabaseObject[]> {
    if (parent.kind === 'database') {
      return of([folder('Tables')]);
    }

    return of(
      sessionId === 'sesion-dev'
        ? [table('pedidos'), table('clientes'), table('facturas')]
        : [table('pedidos'), table('clientes')],
    );
  }

  orderTransferSet(request: TransferSetRequest): Observable<TransferSetOrder> {
    this.lastSet = request;

    return of(this.order);
  }

  runTransferSet(request: TransferSetRequest): Observable<string> {
    this.lastSet = request;

    return of('traslado-1');
  }

  getTransferStatus(): Observable<never> {
    return new Observable<never>();
  }
}

const workspace = {
  connections: () => [
    { id: 'dev', name: 'Desarrollo', sessionId: 'sesion-dev' },
    { id: 'prod', name: 'Producción', sessionId: 'sesion-prod' },
  ],
  sessionForConnection: (connectionId: string) =>
    connectionId === 'dev' ? 'sesion-dev' : 'sesion-prod',
};

async function settle(fixture: ComponentFixture<TransferSetDialog>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('TransferSetDialog', () => {
  let fixture: ComponentFixture<TransferSetDialog>;
  let element: HTMLElement;
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [TransferSetDialog],
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: WorkspaceStore, useValue: workspace },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransferSetDialog);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('node', folder('Tables'));
    fixture.componentRef.setInput('connectionId', 'dev');
    fixture.detectChanges();
    await settle(fixture);
  });

  function boton(texto: string): HTMLButtonElement {
    return [...element.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(texto),
    ) as HTMLButtonElement;
  }

  /** Va al destino y elige la carpeta donde viven sus tablas. */
  async function elegirDestino(): Promise<void> {
    boton('Elegir destino').click();
    await settle(fixture);

    const conexion = element.querySelector<HTMLSelectElement>('.field select')!;
    conexion.value = 'prod';
    conexion.dispatchEvent(new Event('change'));
    await settle(fixture);

    // Se baja hasta donde viven las tablas: la base primero, su carpeta después.
    element.querySelectorAll<HTMLButtonElement>('.browser__item')[0].click();
    await settle(fixture);

    element.querySelectorAll<HTMLButtonElement>('.browser__item')[0].click();
    await settle(fixture);

    boton('Migrar a').click();
    await settle(fixture);
  }

  it('empieza con todas las tablas del sitio marcadas', () => {
    const casillas = [...element.querySelectorAll<HTMLInputElement>('.tables input')];

    expect(casillas.length).toBe(3);
    expect(casillas.every((casilla) => casilla.checked)).toBe(true);
    expect(element.textContent).toContain('3 de 3 marcadas');
  });

  /**
   * Quitar una tabla de la pasada es lo primero que se hace: se abre el sitio
   * entero y se descartan las que no viajan.
   */
  it('se puede quitar una tabla de la pasada', async () => {
    element.querySelectorAll<HTMLInputElement>('.tables input')[2].click();
    await settle(fixture);

    expect(element.textContent).toContain('2 de 3 marcadas');
  });

  /**
   * El destino es **el sitio**, no una tabla: cada una se empareja con la que se
   * llama igual al otro lado.
   */
  it('empareja por nombre y enseña el orden antes de copiar', async () => {
    await elegirDestino();

    expect(element.textContent).toContain('Se copian en este orden');
    expect(element.querySelector('.plan__list')?.textContent).toContain('public.clientes');

    // La que no está al otro lado se queda fuera, y se dice cuál.
    expect(element.textContent).toContain('facturas');
    expect(boton('Copiar 2 tablas')).toBeTruthy();
  });

  /** Un ciclo no se resuelve: se avisa, con los nombres delante. */
  it('dice qué tablas se apuntan entre sí', async () => {
    gateway.order = {
      tables: ['public.pedidos', 'public.clientes'],
      cycles: ['public.pedidos', 'public.clientes'],
    };

    await elegirDestino();

    expect(element.querySelector('.warn')?.textContent).toContain('se apuntan entre sí');
  });

  it('manda la pasada con las tablas emparejadas y el orden pedido', async () => {
    await elegirDestino();
    boton('Copiar 2 tablas').click();
    await settle(fixture);

    expect(gateway.lastSet?.ordered).toBe(true);
    expect(gateway.lastSet?.tables.map((table) => table.source.name)).toEqual([
      'pedidos',
      'clientes',
    ]);
    expect(gateway.lastSet?.tables.every((table) => table.confirmed)).toBe(true);
    expect(gateway.lastSet?.tables.every((table) => table.targetSessionId === 'sesion-prod')).toBe(
      true,
    );
  });

  /**
   * Vaciar y cargar no se ofrece aquí.
   *
   * El proceso local exige escribir el nombre de cada tabla que se vacía, y con
   * seis marcadas eso son seis confirmaciones: se hace de una en una, que es
   * donde esa confirmación significa algo.
   */
  it('no ofrece vaciar y cargar en una pasada', async () => {
    await elegirDestino();

    const modos = [...element.querySelectorAll('.options option')].map(
      (option) => (option as HTMLOptionElement).value,
    );

    expect(modos).toEqual(['Insert', 'Upsert', 'SkipExisting']);
    expect(element.textContent).toContain('hazlo tabla a tabla');
  });
});
