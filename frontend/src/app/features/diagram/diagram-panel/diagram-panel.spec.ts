import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import {
  ApplicationGateway,
  SavedDiagram,
} from '../../../core/application-gateway/application-gateway';
import { FileSaveService } from '../../../core/files/file-save.service';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { DatabaseObject, ExplorerNode, SchemaGraph } from '../../../shared/models/workspace';
import { DiagramPanel } from './diagram-panel';

function tabla(schema: string, name: string): DatabaseObject {
  return {
    id: `Table:${schema}.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema,
    hasChildren: true,
  };
}

function esquema(name: string): DatabaseObject {
  return {
    id: `schema:${name}`,
    name,
    kind: 'schema',
    database: 'druse_test',
    schema: name,
    hasChildren: true,
  };
}

const base: DatabaseObject = {
  id: 'db:druse_test',
  name: 'druse_test',
  kind: 'database',
  database: 'druse_test',
  hasChildren: true,
};

/** El nodo del árbol tal y como llega desde el explorador. */
function nodo(source: DatabaseObject): ExplorerNode {
  return {
    id: `connection-1|${source.id}`,
    connectionId: 'connection-1',
    label: source.name,
    kind: source.kind,
    depth: 1,
    expandable: true,
    expanded: false,
    loading: false,
    source,
  } as ExplorerNode;
}

/**
 * Una base con dos esquemas, cada uno con una tabla que se llama igual.
 *
 * Es el caso que motiva todo esto: `dbo.orders` y `ventas.orders` conviven en la
 * misma base y hay que poder distinguirlas al elegir.
 */
const hijos = new Map<string, readonly DatabaseObject[]>([
  ['db:druse_test', [esquema('dbo'), esquema('ventas')]],
  ['schema:dbo', [tabla('dbo', 'orders')]],
  ['schema:ventas', [tabla('ventas', 'orders'), tabla('ventas', 'clientes')]],
]);

const grafoVacio: SchemaGraph = { tables: [], missing: [], suggestions: [] };

describe('DiagramPanel', () => {
  let fixture: ComponentFixture<DiagramPanel>;
  let guardados: SavedDiagram[];
  let escritos: SavedDiagram[];
  let archivos: { save: ReturnType<typeof vi.fn> };

  function crear(source: DatabaseObject): void {
    fixture = TestBed.createComponent(DiagramPanel);
    fixture.componentRef.setInput('connectionId', 'connection-1');
    fixture.componentRef.setInput('sessionId', 'session-1');
    fixture.componentRef.setInput('target', nodo(source));
    fixture.detectChanges();
  }

  /** Deja terminar la lectura del catálogo, que es asíncrona. */
  async function asentar(): Promise<void> {
    for (let intento = 0; intento < 20; intento++) {
      await Promise.resolve();
    }

    fixture.detectChanges();
  }

  function elegibles(): string[] {
    return [...fixture.nativeElement.querySelectorAll('.pick')].map((pick: Element) =>
      (pick.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  beforeEach(async () => {
    guardados = [];
    escritos = [];
    archivos = {
      save: vi.fn().mockResolvedValue({ saved: true, path: 'C:\\export\\diagrama.svg' }),
    };

    const gateway = {
      getChildren: (_session: string, parent: DatabaseObject) => of(hijos.get(parent.id) ?? []),
      getDiagrams: () => of(guardados),
      saveDiagram: (diagram: SavedDiagram): Observable<void> => {
        escritos.push(diagram);
        return of(undefined);
      },
      deleteDiagram: () => of(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [DiagramPanel],
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        { provide: WorkspaceStore, useValue: { schemaGraph: async () => grafoVacio } },
        { provide: FileSaveService, useValue: archivos },
      ],
    }).compileComponents();
  });

  it('sobre una base reúne las tablas de todos sus esquemas', async () => {
    crear(base);
    await asentar();

    expect(elegibles()).toHaveLength(3);
  });

  /**
   * Dentro de un esquema el nombre basta; con dos esquemas delante, dos filas
   * que dicen «orders» no distinguen nada.
   */
  it('con varios esquemas, cada tabla dice de cuál es', async () => {
    crear(base);
    await asentar();

    expect(elegibles()).toEqual(['dbo.orders', 'ventas.orders', 'ventas.clientes']);
  });

  it('dentro de un esquema no se repite el esquema en cada fila', async () => {
    crear(esquema('ventas'));
    await asentar();

    expect(elegibles()).toEqual(['orders', 'clientes']);
  });

  /**
   * Una base y un esquema pueden llamarse igual. Si la clave no dijera de qué
   * clase es, el diagrama guardado de uno se abriría al pedir el del otro.
   */
  it('el diagrama de una base se guarda con una clave propia', async () => {
    crear(base);
    await asentar();

    await fixture.componentInstance['save']();

    expect(escritos).toHaveLength(1);
    expect(JSON.parse(escritos[0].model).target).toBe('database:druse_test');
  });

  it('lo guardado para un esquema no se abre al pedir la base', async () => {
    guardados = [
      {
        id: 'diagrama-1',
        connectionId: 'connection-1',
        name: 'druse_test',
        model: JSON.stringify({ target: 'schema:druse_test', tables: ['dbo.orders'] }),
      } as SavedDiagram,
    ];

    crear(base);
    await asentar();

    // Sigue preguntando qué entra: no ha reconocido ese diagrama como suyo.
    expect(elegibles()).toHaveLength(3);
  });

  /**
   * Exportar el diagrama iba por un enlace `download`, que **dentro de la
   * ventana empaquetada no escribe nada y tampoco falla**: decía «Se descargó»
   * sin haber guardado ningún archivo. Ahora pasa por `FileSaveService`, que es
   * quien sabe distinguir el navegador del escritorio.
   */
  describe('exportar', () => {
    it('guarda por el servicio de archivos, no por un enlace', async () => {
      crear(base);
      await asentar();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');

      await fixture.componentInstance['download']({
        name: 'diagrama.svg',
        blob: new Blob(['<svg />'], { type: 'image/svg+xml' }),
      });

      expect(archivos.save).toHaveBeenCalledWith('diagrama.svg', expect.any(Blob));
      expect(click).not.toHaveBeenCalled();

      click.mockRestore();
    });

    it('el aviso dice dónde quedó el archivo', async () => {
      crear(base);
      await asentar();

      await fixture.componentInstance['download']({
        name: 'diagrama.svg',
        blob: new Blob(['<svg />']),
      });

      expect(fixture.componentInstance['notice']()).toBe(
        'Se guardó diagrama.svg en C:\\export\\diagrama.svg',
      );
    });

    it('cerrar el diálogo sin elegir no anuncia ningún guardado', async () => {
      archivos.save.mockResolvedValue({ saved: false });
      crear(base);
      await asentar();

      await fixture.componentInstance['download']({
        name: 'diagrama.svg',
        blob: new Blob(['<svg />']),
      });

      expect(fixture.componentInstance['notice']()).toBe('No se guardó nada.');
    });
  });
});
