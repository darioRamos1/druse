import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  BackupProfile,
  BackupProfileInput,
  BackupProfileResolution,
} from '../../../core/application-gateway/application-gateway';
import { DatabaseObject, ExplorerNode } from '../../../shared/models/workspace';
import { BackupDialog } from './backup-dialog';

function table(name: string, schema = 'tienda'): DatabaseObject {
  return {
    id: `Table:${schema}.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema,
    hasChildren: false,
  };
}

const schemaNode: ExplorerNode = {
  id: 'connection-1|schema:tienda',
  label: 'tienda',
  kind: 'schema',
  depth: 2,
  expandable: true,
  expanded: false,
  loading: false,
  source: {
    id: 'schema:tienda',
    name: 'tienda',
    kind: 'schema',
    database: 'druse_test',
    schema: 'tienda',
    hasChildren: true,
  },
  connectionId: 'connection-1',
};

const guardado: BackupProfile = {
  id: 'perfil-1',
  name: 'Estructura a desarrollo',
  database: 'druse_test',
  selection: [{ kind: 'Schema', schema: 'tienda' }],
  dataMode: 'StructureOnly',
  dataOverrides: { 'tienda.cat_paises': 'StructureAndData' },
  layout: 'FolderByKind',
  dataFormat: 'Inserts',
  compress: true,
  destination: 'C:/respaldos/desarrollo',
  createdAtUtc: '2026-02-01T10:00:00Z',
  updatedAtUtc: '2026-02-01T10:00:00Z',
  lastRunAtUtc: '2026-08-01T10:00:00Z',
};

/** Catálogo con dos tablas y un perfil guardado que resuelve tres. */
class FakeGateway implements Partial<ApplicationGateway> {
  saved: BackupProfileInput[] = [];
  deleted: string[] = [];
  runs: string[] = [];
  profiles: BackupProfile[] = [guardado];

  resolution: BackupProfileResolution = {
    profile: guardado,
    tables: [
      { id: 'Table:tienda.cat_paises', name: 'cat_paises', schema: 'tienda', database: 'druse_test' },
      { id: 'Table:otro.movimientos', name: 'movimientos', schema: 'otro', database: 'druse_test' },
    ],
    gaps: [
      {
        selector: { kind: 'Table', schema: 'tienda', name: 'clientes' },
        reason: 'La tabla «tienda.clientes» ya no existe.',
      },
    ],
    added: ['otro.movimientos'],
  };

  getChildren(_sessionId: string, parent: DatabaseObject): Observable<readonly DatabaseObject[]> {
    // El esquema entrega sus tablas directamente: al asistente le basta con que
    // lleguen, y el recorrido por carpetas ya se prueba contra motores reales.
    return of(parent.kind === 'schema' ? [table('cat_paises'), table('clientes')] : []);
  }

  getBackupProfiles(): Observable<readonly BackupProfile[]> {
    return of(this.profiles);
  }

  saveBackupProfile(profile: BackupProfileInput): Observable<BackupProfile> {
    this.saved.push(profile);

    return of({
      ...guardado,
      ...profile,
      id: profile.id ?? 'perfil-nuevo',
    } as BackupProfile);
  }

  deleteBackupProfile(profileId: string): Observable<void> {
    this.deleted.push(profileId);
    this.profiles = this.profiles.filter((profile) => profile.id !== profileId);

    return of(undefined);
  }

  resolveBackupProfile(): Observable<BackupProfileResolution> {
    return of(this.resolution);
  }

  markBackupProfileRun(profileId: string): Observable<void> {
    this.runs.push(profileId);

    return of(undefined);
  }
}

/**
 * Deja correr las promesas que el diálogo encadena y vuelve a pintar.
 *
 * Cargar el catálogo y resolver un perfil son dos `await` seguidos, y
 * `whenStable` por sí solo devuelve el control antes del segundo.
 */
async function settle(fixture: ComponentFixture<BackupDialog>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

describe('BackupDialog', () => {
  let fixture: ComponentFixture<BackupDialog>;
  let element: HTMLElement;
  let gateway: FakeGateway;

  beforeEach(async () => {
    gateway = new FakeGateway();

    await TestBed.configureTestingModule({
      imports: [BackupDialog],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();

    fixture = TestBed.createComponent(BackupDialog);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('target', schemaNode);
    fixture.componentRef.setInput('sessionId', 'sesion-1');
    fixture.detectChanges();
    await settle(fixture);
  });

  /** Lo que el diálogo mandaría al guardar, sin pasar por la pantalla. */
  function input(): BackupProfileInput {
    return (fixture.componentInstance as unknown as { profileInput: () => BackupProfileInput })
      .profileInput();
  }

  function checkboxes(): HTMLInputElement[] {
    return [...element.querySelectorAll<HTMLInputElement>('.tree input[type="checkbox"]')];
  }

  it('carga las tablas del nodo y las marca todas', () => {
    expect(element.textContent).toContain('2 de 2 tablas marcadas');
  });

  /**
   * La decisión del §3.1: un esquema entero se guarda **como esquema**, para que
   * lo que se cree dentro después también entre. Es lo que separa un perfil de
   * una lista de nombres congelada en el día que se guardó.
   */
  it('con todo el esquema marcado, la selección se guarda como el esquema', () => {
    const selection = input().selection;

    expect(selection).toHaveLength(1);
    expect(selection[0].kind).toBe('Schema');
    expect(selection[0].schema).toBe('tienda');
  });

  it('con una tabla desmarcada, se guardan las tablas por su nombre', async () => {
    // Las casillas son: el esquema, y una por tabla.
    checkboxes()[1].click();
    fixture.detectChanges();

    const selection = input().selection;

    expect(selection.every((selector) => selector.kind === 'Table')).toBe(true);
    expect(selection.map((selector) => selector.name)).toEqual(['clientes']);
  });

  it('lo que se guarda lleva la memoria de lo que resolvía', () => {
    expect(input().knownTables).toEqual(['tienda.cat_paises', 'tienda.clientes']);
  });

  it('los perfiles guardados se ofrecen al abrir', () => {
    expect(element.querySelector('.profiles')?.textContent).toContain('Estructura a desarrollo');
  });

  it('abrir un perfil trae lo que hoy resuelve, y no lo que había debajo del nodo', async () => {
    element.querySelector<HTMLButtonElement>('.profiles__open')?.click();
    await settle(fixture);

    // Las dos tablas del perfil sustituyen a las del nodo: un perfil puede
    // nombrar objetos de otro esquema, y filtrarlos por dónde se hizo clic daría
    // un respaldo distinto del guardado.
    const tree = element.querySelector('.tree')?.textContent ?? '';

    expect(element.textContent).toContain('2 de 2 tablas marcadas');
    expect(tree).toContain('movimientos');
    // La que ya no existe sale del árbol, pero sigue nombrada arriba como aviso.
    expect(tree).not.toContain('clientes');
    expect(element.querySelector('.reconcile--gaps')?.textContent).toContain('clientes');
  });

  /** El criterio de salida: se abre igual, y dice qué falta. */
  it('al abrirlo se dice qué ya no existe y qué ha aparecido', async () => {
    element.querySelector<HTMLButtonElement>('.profiles__open')?.click();
    await settle(fixture);

    const gaps = element.querySelector('.reconcile--gaps');

    expect(gaps?.textContent).toContain('ya no existe');
    expect(element.textContent).toContain('otro.movimientos');
  });

  it('abrir un perfil aplica su formato y su destino', async () => {
    element.querySelector<HTMLButtonElement>('.profiles__open')?.click();
    await settle(fixture);

    const applied = input();

    expect(applied.dataMode).toBe('StructureOnly');
    expect(applied.layout).toBe('FolderByKind');
    expect(applied.compress).toBe(true);
    expect(applied.destination).toBe('C:/respaldos/desarrollo');
    // Guardar después actualiza el mismo perfil en vez de crear otro.
    expect(applied.id).toBe('perfil-1');
  });

  it('borrar un perfil lo quita de la lista', async () => {
    element.querySelector<HTMLButtonElement>('.profiles__delete')?.click();
    await settle(fixture);

    expect(gateway.deleted).toEqual(['perfil-1']);
    expect(element.querySelector('.profiles')).toBeNull();
  });
});
