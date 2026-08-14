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
});
