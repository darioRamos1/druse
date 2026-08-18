import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  FolderListing,
  FolderTarget,
} from '../../../core/application-gateway/application-gateway';
import { FolderPicker } from './folder-picker';

const raices: FolderListing = {
  path: '',
  parent: null,
  separator: '\\',
  canWrite: false,
  folders: [
    { name: 'Escritorio', path: 'C:\\Users\\ana\\Desktop', kind: 'Known' },
    { name: 'C:\\ (Sistema)', path: 'C:\\', kind: 'Drive' },
  ],
};

const escritorio: FolderListing = {
  path: 'C:\\Users\\ana\\Desktop',
  parent: 'C:\\Users\\ana',
  separator: '\\',
  canWrite: true,
  folders: [{ name: 'respaldos', path: 'C:\\Users\\ana\\Desktop\\respaldos', kind: 'Folder' }],
};

class FakeGateway implements Partial<ApplicationGateway> {
  visitadas: (string | undefined)[] = [];
  creadas: { parent: string; name: string }[] = [];
  target: FolderTarget = {
    path: 'C:\\Users\\ana\\Desktop\\respaldo.sql',
    canWrite: true,
    exists: false,
  };

  browseFolders(path?: string): Observable<FolderListing> {
    this.visitadas.push(path);

    return of(path ? escritorio : raices);
  }

  resolveFolderTarget(folder: string, name: string): Observable<FolderTarget> {
    return of({ ...this.target, path: `${folder}\\${name}` });
  }

  createFolder(parent: string, name: string): Observable<FolderTarget> {
    this.creadas.push({ parent, name });

    return of({ path: `${parent}\\${name}`, canWrite: true, exists: true });
  }
}

async function settle(fixture: ComponentFixture<FolderPicker>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('FolderPicker', () => {
  let fixture: ComponentFixture<FolderPicker>;
  let element: HTMLElement;
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [FolderPicker],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();

    fixture = TestBed.createComponent(FolderPicker);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('suggestedName', 'respaldo.sql');
    fixture.detectChanges();
    await settle(fixture);
  });

  function filas(): HTMLButtonElement[] {
    return [...element.querySelectorAll<HTMLButtonElement>('.list .row')];
  }

  function usar(): HTMLButtonElement {
    return element.querySelector<HTMLButtonElement>('.actions .primary')!;
  }

  it('empieza por los sitios conocidos y las unidades', () => {
    expect(gateway.visitadas[0]).toBeUndefined();
    expect(filas().map((fila) => fila.textContent?.trim())).toEqual([
      expect.stringContaining('Escritorio'),
      expect.stringContaining('C:\\'),
    ]);
  });

  /**
   * En las raíces no hay dónde guardar todavía: son sitios a los que entrar. Sin
   * esto, «Usar esta ruta» prometería escribir en «Este equipo».
   */
  it('no deja aceptar mientras no se entre en una carpeta', () => {
    expect(usar().disabled).toBe(true);
  });

  it('al entrar en una carpeta compone la ruta con el nombre propuesto', async () => {
    filas()[0].click();
    await settle(fixture);

    expect(element.querySelector('.here')?.textContent).toContain('Desktop');
    expect(element.querySelector('.result__path')?.textContent).toContain(
      'C:\\Users\\ana\\Desktop\\respaldo.sql',
    );
    expect(usar().disabled).toBe(false);
  });

  it('devuelve la ruta entera al aceptar', async () => {
    const elegidas: string[] = [];

    fixture.componentInstance.chosen.subscribe((ruta) => elegidas.push(ruta));

    filas()[0].click();
    await settle(fixture);

    usar().click();

    expect(elegidas).toEqual(['C:\\Users\\ana\\Desktop\\respaldo.sql']);
  });

  /**
   * Sobrescribir es lo más fácil de lamentar de todo esto, así que se dice antes
   * y no se impide: repetir el respaldo de ayer encima es un caso legítimo.
   */
  it('avisa cuando el destino ya existe, sin bloquearlo', async () => {
    gateway.target = { ...gateway.target, exists: true };

    filas()[0].click();
    await settle(fixture);

    expect(element.querySelector('.result__note')?.textContent).toContain('Ya existe');
    expect(usar().disabled).toBe(false);
  });

  it('no deja aceptar un destino que el proceso local rechaza', async () => {
    gateway.target = { ...gateway.target, canWrite: false, problem: 'No se puede escribir ahí.' };

    filas()[0].click();
    await settle(fixture);

    expect(element.querySelector('.result--bad')).not.toBeNull();
    expect(usar().disabled).toBe(true);
  });

  it('crea una carpeta y se mete dentro', async () => {
    filas()[0].click();
    await settle(fixture);

    element.querySelector<HTMLButtonElement>('.bar .ghost:last-of-type')!.click();
    fixture.detectChanges();

    const nombre = element.querySelector<HTMLInputElement>('.new-name')!;

    nombre.value = 'agosto';
    nombre.dispatchEvent(new Event('input'));

    [...element.querySelectorAll<HTMLButtonElement>('.row--new .ghost')]
      .find((boton) => boton.textContent?.includes('Crear'))!
      .click();

    await settle(fixture);

    expect(gateway.creadas).toEqual([{ parent: 'C:\\Users\\ana\\Desktop', name: 'agosto' }]);
    expect(gateway.visitadas).toContain('C:\\Users\\ana\\Desktop\\agosto');
  });
});
