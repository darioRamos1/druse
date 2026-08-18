import { TestBed } from '@angular/core/testing';

import { DesktopHost } from '../application-gateway/desktop-host';
import { SqlFileService } from './sql-file.service';

describe('SqlFileService', () => {
  const desktop = {
    isDesktop: true,
    openSqlFile: vi.fn(),
    saveSqlFile: vi.fn(),
    saveSqlFileAs: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({ providers: [{ provide: DesktopHost, useValue: desktop }] });
  });

  it('abre el documento elegido por el host', async () => {
    const document = { documentId: 'sql-1', fileName: 'ventas.sql', contents: 'SELECT 1;' };
    desktop.openSqlFile.mockResolvedValue(document);

    await expect(TestBed.inject(SqlFileService).open()).resolves.toEqual(document);
  });

  it('guarda directamente una pestaña que ya tiene documento', async () => {
    desktop.saveSqlFile.mockResolvedValue({ documentId: 'sql-1', fileName: 'ventas.sql' });

    await TestBed.inject(SqlFileService).save({
      documentId: 'sql-1',
      fileName: 'ventas.sql',
      title: 'ventas.sql',
      contents: 'SELECT 2;',
    });

    expect(desktop.saveSqlFile).toHaveBeenCalledWith('sql-1', 'SELECT 2;');
    expect(desktop.saveSqlFileAs).not.toHaveBeenCalled();
  });

  it('usa Guardar como para una consulta nueva o cuando se fuerza', async () => {
    desktop.saveSqlFileAs.mockResolvedValue({ documentId: 'sql-2', fileName: 'copia.sql' });
    const service = TestBed.inject(SqlFileService);

    await service.save({ title: 'Query 1', contents: 'SELECT 1;' });
    await service.save(
      {
        documentId: 'sql-1',
        fileName: 'ventas.sql',
        title: 'ventas.sql',
        contents: 'SELECT 2;',
      },
      true,
    );

    expect(desktop.saveSqlFileAs).toHaveBeenNthCalledWith(1, 'Query 1.sql', 'SELECT 1;', undefined);
    expect(desktop.saveSqlFileAs).toHaveBeenNthCalledWith(
      2,
      'ventas.sql',
      'SELECT 2;',
      'sql-1',
    );
  });

  /**
   * El camino del navegador, que es el que se usa fuera del envoltorio y el que
   * no tenía ninguna prueba: se elegía el archivo y no se abría nunca.
   */
  describe('en el navegador', () => {
    beforeEach(() => {
      desktop.isDesktop = false;
    });

    afterEach(() => {
      desktop.isDesktop = true;
      document.body.querySelectorAll('input[type="file"]').forEach((input) => input.remove());
    });

    function fileInput(): HTMLInputElement {
      return document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
    }

    function choose(input: HTMLInputElement, file: File): void {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
    }

    it('abre el contenido del archivo elegido', async () => {
      const opened = TestBed.inject(SqlFileService).open();

      choose(fileInput(), new File(['SELECT 1;'], 'ventas.sql', { type: 'text/sql' }));

      await expect(opened).resolves.toEqual({
        documentId: '',
        fileName: 'ventas.sql',
        contents: 'SELECT 1;',
      });
    });

    /**
     * La regresión que rompía abrir: el navegador devuelve el foco a la ventana
     * **antes** de despachar el `change`, y con eso se daba por cancelado.
     */
    it('recuperar el foco antes de elegir no cancela la apertura', async () => {
      const opened = TestBed.inject(SqlFileService).open();
      const input = fileInput();

      window.dispatchEvent(new Event('focus'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      choose(input, new File(['SELECT 2;'], 'ventas.sql', { type: 'text/sql' }));

      const document_ = await opened;

      expect(document_?.contents).toBe('SELECT 2;');
    });

    it('cerrar el diálogo sin elegir no abre nada', async () => {
      const opened = TestBed.inject(SqlFileService).open();

      fileInput().dispatchEvent(new Event('cancel'));

      await expect(opened).resolves.toBeNull();
    });

    it('un archivo que no es .sql se rechaza con su motivo', async () => {
      const opened = TestBed.inject(SqlFileService).open();

      choose(fileInput(), new File(['hola'], 'notas.txt', { type: 'text/plain' }));

      await expect(opened).rejects.toThrow('extensión .sql');
    });
  });
});
