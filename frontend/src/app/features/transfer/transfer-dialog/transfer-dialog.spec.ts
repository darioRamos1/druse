import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseColumn, DatabaseObject } from '../../../shared/models/workspace';
import { TransferDialog } from './transfer-dialog';

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

function column(name: string, ordinal: number, dataType = 'text'): DatabaseColumn {
  return { name, dataType, isNullable: true, isPrimaryKey: false, ordinal };
}

function key(name: string, ordinal: number): DatabaseColumn {
  return { ...column(name, ordinal), isPrimaryKey: true };
}

/** Un catálogo con una base, un esquema y una tabla, y columnas a los dos lados. */
class FakeGateway implements Partial<ApplicationGateway> {
  sourceColumns: DatabaseColumn[] = [column('id', 1), column('nombre', 2), column('telefono', 3)];
  targetColumns: DatabaseColumn[] = [key('ID', 1), column('nombre', 2), column('cp', 3)];

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

  getChildren(_sessionId: string, parent: DatabaseObject): Observable<readonly DatabaseObject[]> {
    return of(parent.kind === 'database' ? [table('pedidos_destino')] : []);
  }

  getColumns(sessionId: string): Observable<readonly DatabaseColumn[]> {
    return of(sessionId === 'sesion-dev' ? this.sourceColumns : this.targetColumns);
  }
}

/** Dos conexiones abiertas: la de origen y otra, como dev y prod. */
const workspace = {
  connections: () => [
    { id: 'dev', name: 'Desarrollo', sessionId: 'sesion-dev' },
    { id: 'prod', name: 'Producción', sessionId: 'sesion-prod' },
  ],
  sessionForConnection: (connectionId: string) =>
    connectionId === 'dev' ? 'sesion-dev' : 'sesion-prod',
};

/** Deja correr las promesas que el diálogo encadena y vuelve a pintar. */
async function settle(fixture: ComponentFixture<TransferDialog>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('TransferDialog', () => {
  let fixture: ComponentFixture<TransferDialog>;
  let element: HTMLElement;
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [TransferDialog],
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: WorkspaceStore, useValue: workspace },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransferDialog);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('table', table('pedidos'));
    fixture.componentRef.setInput('connectionId', 'dev');
    fixture.detectChanges();
    await settle(fixture);
  });

  /**
   * Cambia a la otra conexión y baja hasta la tabla, como haría el usuario.
   *
   * Va a producción y no se queda en la conexión de partida a propósito: el caso
   * que justifica la función es llevarse las filas a **otra** base, y es donde
   * las columnas pueden llamarse distinto.
   */
  async function elegirDestino(): Promise<void> {
    const conexion = element.querySelector<HTMLSelectElement>('.field select')!;
    conexion.value = 'prod';
    conexion.dispatchEvent(new Event('change'));
    await settle(fixture);

    const base = element.querySelectorAll<HTMLButtonElement>('.browser__item')[0];
    base.click();
    await settle(fixture);

    const tabla = element.querySelectorAll<HTMLButtonElement>('.browser__item')[0];
    tabla.click();
    await settle(fixture);
  }

  function filas(): HTMLTableRowElement[] {
    return [...element.querySelectorAll<HTMLTableRowElement>('.mapping tbody tr')];
  }

  function seleccion(fila: number): HTMLSelectElement {
    return filas()[fila].querySelector<HTMLSelectElement>('select')!;
  }

  it('empieza ofreciendo el catálogo de la conexión desde la que se abrió', () => {
    expect(element.querySelectorAll('.browser__item').length).toBe(1);
    expect(element.textContent).toContain('druse_test');
  });

  /**
   * Al elegir la tabla, las columnas se emparejan por nombre sin distinguir
   * mayúsculas — y lo que no casa se queda **sin destino**, no colocado por
   * posición.
   */
  it('empareja las columnas por nombre y deja sin pareja lo que no casa', async () => {
    await elegirDestino();

    expect(seleccion(0).value).toBe('ID');
    expect(seleccion(1).value).toBe('nombre');
    expect(seleccion(2).value).toBe('');
  });

  it('dice cuáles no se copian en lugar de esconderlas', async () => {
    await elegirDestino();

    expect(element.querySelector('.warn')?.textContent).toContain('telefono');
    expect(element.querySelector('.hint')?.textContent).toContain('2 de 3 columnas');
  });

  /**
   * Una columna del destino ya ocupada no se puede elegir dos veces.
   *
   * El motor solo se quejaría del `INSERT` con la columna repetida, y su mensaje
   * no diría cuál fue el error del asistente.
   */
  it('no deja mandar dos columnas a la misma', async () => {
    await elegirDestino();

    const ocupada = [...seleccion(2).options].find((option) => option.value === 'nombre');

    expect(ocupada?.disabled).toBe(true);
  });

  it('copiar está disponible en cuanto hay al menos una columna emparejada', async () => {
    await elegirDestino();

    const copiar = [...element.querySelectorAll<HTMLButtonElement>('.btn')].find((boton) =>
      boton.textContent?.includes('Copiar las filas'),
    );

    expect(copiar?.disabled).toBe(false);
  });

  /**
   * Vaciar el destino no se puede pedir sin escribir su nombre.
   *
   * Una casilla marcada sin querer no se distingue de una marcada a propósito, y
   * este es el único modo que borra lo que ya había.
   */
  it('vaciar y cargar exige escribir el nombre de la tabla', async () => {
    await elegirDestino();

    const modo = element.querySelector<HTMLSelectElement>('.options select')!;
    modo.value = 'Replace';
    modo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    function copiar(): HTMLButtonElement | undefined {
      return [...element.querySelectorAll<HTMLButtonElement>('.btn')].find((boton) =>
        boton.textContent?.includes('Copiar las filas'),
      );
    }

    expect(copiar()?.disabled).toBe(true);

    const confirmacion = element.querySelector<HTMLInputElement>('.danger input')!;
    confirmacion.value = 'pedidos_destino';
    confirmacion.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(copiar()?.disabled).toBe(false);
  });

  /**
   * Al elegir un modo que reconoce filas aparece con qué columnas se reconocen, y
   * la clave primaria viene marcada: es lo que se quiere casi siempre.
   */
  it('actualizar lo que ya está propone la clave primaria del destino', async () => {
    await elegirDestino();

    const modo = element.querySelector<HTMLSelectElement>('.options select')!;
    modo.value = 'Upsert';
    modo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const claves = element.querySelector('.keys')!;

    expect(claves.textContent).toContain('clave primaria');

    const marcada = [...claves.querySelectorAll<HTMLInputElement>('input')].filter(
      (casilla) => casilla.checked,
    );

    expect(marcada.length).toBe(1);
  });

  /**
   * Sin clave primaria hay que decir qué columnas identifican la fila, y hasta
   * entonces no se puede copiar.
   *
   * Es la puerta que impide el accidente: con una clave que se repite, «actualiza
   * la que ya está» tocaría varias filas a la vez.
   */
  it('sin clave primaria no deja copiar hasta que se eligen columnas', async () => {
    gateway.targetColumns = [column('ID', 1), column('nombre', 2), column('cp', 3)];

    await elegirDestino();

    const modo = element.querySelector<HTMLSelectElement>('.options select')!;
    modo.value = 'SkipExisting';
    modo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    function copiar(): HTMLButtonElement | undefined {
      return [...element.querySelectorAll<HTMLButtonElement>('.btn')].find((boton) =>
        boton.textContent?.includes('Copiar las filas'),
      );
    }

    expect(element.querySelector('.keys .warn')?.textContent).toContain('no tiene clave primaria');
    expect(copiar()?.disabled).toBe(true);

    element.querySelector<HTMLInputElement>('.keys input')!.click();
    fixture.detectChanges();

    expect(copiar()?.disabled).toBe(false);
  });

  it('el aviso de que se borra nombra la tabla que se va a vaciar', async () => {
    await elegirDestino();

    const modo = element.querySelector<HTMLSelectElement>('.options select')!;
    modo.value = 'Replace';
    modo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const aviso = element.querySelector('.danger__text')!.textContent!;

    expect(aviso).toContain('public.pedidos_destino');
    expect(aviso).toContain('no se deshace');
  });
});
