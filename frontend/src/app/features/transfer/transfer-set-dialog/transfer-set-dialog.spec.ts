import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  TransferProfile,
  TransferProfileResolution,
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

function table(
  name: string,
  schema = 'public',
  approximateRowCount?: number | null,
): DatabaseObject {
  return {
    id: `Table:${schema}.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema,
    hasChildren: false,
    approximateRowCount: approximateRowCount ?? undefined,
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

  // --- Migraciones guardadas ------------------------------------------------

  savedProfiles: TransferProfile[] = [];
  lastSavedProfile: TransferProfile | null = null;
  ranProfiles: string[] = [];

  resolution: TransferProfileResolution = {
    profile: profile(),
    tables: [
      {
        source: { id: 'Table:public.clientes', name: 'clientes', schema: 'public' },
        target: { id: 'Table:ventas.clientes', name: 'clientes', schema: 'ventas' },
      },
    ],
    gaps: [{ table: 'facturas', reason: '«facturas» no existe en el destino.' }],
    hasChanges: true,
  };

  getTransferProfiles(): Observable<readonly TransferProfile[]> {
    return of(this.savedProfiles);
  }

  saveTransferProfile(profile: TransferProfile): Observable<TransferProfile> {
    this.lastSavedProfile = profile;

    return of({ ...profile, id: profile.id ?? 'perfil-1' });
  }

  resolveTransferProfile(): Observable<TransferProfileResolution> {
    return of(this.resolution);
  }

  markTransferProfileRun(profileId: string): Observable<void> {
    this.ranProfiles.push(profileId);

    return of(undefined);
  }
}

/** Un perfil guardado, como lo devolvería el proceso local. */
function profile(overrides: Partial<TransferProfile> = {}): TransferProfile {
  return {
    id: 'perfil-1',
    name: 'Ventas a producción',
    sourceConnectionId: 'dev',
    sourceSchema: 'public',
    targetConnectionId: 'prod',
    targetSchema: 'ventas',
    tables: ['clientes', 'facturas'],
    mode: 'Upsert',
    ordered: true,
    atomic: false,
    keepIdentity: true,
    batchSize: 1000,
    ...overrides,
  };
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

  /**
   * El catálogo no siempre sabe cuántas filas hay, y entonces llega `null`. La
   * fila enseñaba «~ filas» —un hueco con tilde— porque solo se comprobaba
   * `undefined`.
   */
  it('sin recuento de filas no se enseña el hueco', () => {
    const filas = [...element.querySelectorAll('.tables__row')];

    expect(filas.length).toBeGreaterThan(0);
    expect(element.textContent).not.toContain('~ filas');
  });

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
   * Cada tabla puede ir a lo suyo.
   *
   * Migrar seis tablas no significa tratarlas igual: de una se lleva el año en
   * curso y de otra todo, y una se actualiza mientras las demás se añaden.
   */
  it('manda el modo y el filtro de cada tabla', async () => {
    await elegirDestino();

    const filas = [...element.querySelectorAll('.each__table tbody tr')];
    const modo = filas[0].querySelector<HTMLSelectElement>('select')!;
    const filtro = filas[1].querySelector<HTMLInputElement>('input')!;

    modo.value = 'Upsert';
    modo.dispatchEvent(new Event('change'));
    filtro.value = 'anio = 2026';
    filtro.dispatchEvent(new Event('change'));
    await settle(fixture);

    boton('Copiar 2 tablas').click();
    await settle(fixture);

    const [primera, segunda] = gateway.lastSet!.tables;

    expect(primera.mode).toBe('Upsert');
    expect(primera.filter).toBeUndefined();
    expect(segunda.mode).toBe('Insert');
    expect(segunda.filter).toEqual({ where: 'anio = 2026' });
  });

  /**
   * Poner en una tabla el mismo modo de la pasada no cuenta como algo distinto.
   *
   * Si contara, cambiar después el modo general dejaría atrás a esa tabla sin que
   * nadie lo hubiera pedido.
   */
  it('elegir el modo de la pasada en una tabla no la separa del resto', async () => {
    await elegirDestino();

    const modo = element.querySelector<HTMLSelectElement>('.each__table select')!;

    modo.value = 'Upsert';
    modo.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(element.querySelector('.each__badge')?.textContent).toContain('1');

    modo.value = 'Insert';
    modo.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(element.querySelector('.each__badge')).toBeNull();
  });

  /**
   * La clave solo se pide donde significa algo.
   *
   * Reconocer la fila que ya está es cosa de actualizar y de omitir; en «añadir»
   * el campo sería una pregunta sin respuesta posible.
   */
  it('pide la clave solo en los modos que reconocen la fila', async () => {
    await elegirDestino();

    expect(element.querySelectorAll('.each__key').length).toBe(0);

    const modo = element.querySelector<HTMLSelectElement>('.each__table select')!;

    modo.value = 'Upsert';
    modo.dispatchEvent(new Event('change'));
    await settle(fixture);

    expect(element.querySelectorAll('.each__key').length).toBe(1);
  });

  /**
   * Y la clave escrita viaja con su tabla.
   *
   * Sincronizar dos entornos se hace por una clave de negocio —el código del
   * artículo, el NIT— y no por el identificador que generó cada base por su
   * cuenta.
   */
  it('manda la clave de negocio de cada tabla', async () => {
    await elegirDestino();

    const modo = element.querySelector<HTMLSelectElement>('.each__table select')!;

    modo.value = 'Upsert';
    modo.dispatchEvent(new Event('change'));
    await settle(fixture);

    const clave = element.querySelector<HTMLInputElement>('.each__key')!;

    clave.value = 'codigo, sucursal';
    clave.dispatchEvent(new Event('change'));
    await settle(fixture);

    boton('Copiar 2 tablas').click();
    await settle(fixture);

    const [primera, segunda] = gateway.lastSet!.tables;

    expect(primera.keyColumns).toEqual(['codigo', 'sucursal']);

    // Y la que no la lleva se queda con la primaria de su destino.
    expect(segunda.keyColumns).toEqual([]);
  });

  /**
   * Guardar la pasada guarda **nombres**, no sesiones.
   *
   * Es la regla del perfil de respaldo y aquí vale igual: esto se reabre meses
   * después, cuando la sesión de hoy hace mucho que se cerró.
   */
  it('guarda la pasada con nombres y no con sesiones', async () => {
    await elegirDestino();

    const filtro = element.querySelector<HTMLInputElement>('.each__where')!;

    filtro.value = 'anio = 2026';
    filtro.dispatchEvent(new Event('change'));
    await settle(fixture);

    const nombre = element.querySelector<HTMLInputElement>('.save input')!;

    nombre.value = 'Ventas a producción';
    nombre.dispatchEvent(new Event('input'));
    await settle(fixture);

    boton('Guardar').click();
    await settle(fixture);

    expect(gateway.lastSavedProfile).toMatchObject({
      name: 'Ventas a producción',
      sourceConnectionId: 'dev',
      targetConnectionId: 'prod',
      tables: ['pedidos', 'clientes'],
      mode: 'Insert',
      ordered: true,
    });

    // Y lo que cada tabla hacía distinto, que olvidarlo sería peligroso: un perfil
    // sin el filtro se llevaría la tabla entera la próxima vez.
    expect(gateway.lastSavedProfile?.tableOptions).toEqual({
      pedidos: { where: 'anio = 2026' },
    });

    // Y ni rastro de sesiones en lo guardado.
    expect(JSON.stringify(gateway.lastSavedProfile)).not.toContain('sesion-');
  });

  /**
   * Abrir un perfil salta al plan, y dice qué de lo que pedía ya no está.
   *
   * Negarse a abrirlo obligaría a rehacerlo entero; abrirlo callando las
   * ausencias haría creer que la pasada se lleva algo que no se lleva.
   */
  it('abre un perfil guardado y cuenta lo que falta', async () => {
    gateway.savedProfiles = [profile()];

    // La lista se lee al abrir el diálogo, así que se rehace con ella dentro.
    fixture = TestBed.createComponent(TransferSetDialog);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('node', folder('Tables'));
    fixture.componentRef.setInput('connectionId', 'dev');
    fixture.detectChanges();
    await settle(fixture);

    boton('Ventas a producción').click();
    await settle(fixture);

    expect(element.querySelector('.plan')).toBeTruthy();
    expect(element.querySelector('.gaps')?.textContent).toContain('no existe en el destino');

    // Y las opciones son las del perfil, no las de por omisión.
    expect(element.querySelector<HTMLSelectElement>('.options select')?.value).toBe('Upsert');
    expect(boton('Copiar 1 tabla')).toBeTruthy();
  });

  /** Lanzar un perfil se anota, y no lo modifica. */
  it('anota que el perfil se lanzó', async () => {
    gateway.savedProfiles = [profile()];

    fixture = TestBed.createComponent(TransferSetDialog);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('node', folder('Tables'));
    fixture.componentRef.setInput('connectionId', 'dev');
    fixture.detectChanges();
    await settle(fixture);

    boton('Ventas a producción').click();
    await settle(fixture);

    boton('Copiar 1 tabla').click();
    await settle(fixture);

    expect(gateway.ranProfiles).toEqual(['perfil-1']);
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
