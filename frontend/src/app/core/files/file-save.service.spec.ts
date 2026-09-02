import { TestBed } from '@angular/core/testing';

import { DesktopHost } from '../application-gateway/desktop-host';
import { FileSaveService } from './file-save.service';

describe('FileSaveService', () => {
  const desktop = {
    isDesktop: false,
    saveExport: vi.fn(),
  };

  function create(): FileSaveService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DesktopHost, useValue: desktop }],
    });

    return TestBed.inject(FileSaveService);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    desktop.isDesktop = false;
  });

  it('en el navegador descarga con un enlace', async () => {
    const click = vi.fn();
    const link = { href: '', download: '', click } as unknown as HTMLAnchorElement;

    vi.spyOn(document, 'createElement').mockReturnValue(link);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const saved = await create().save('ventas.csv', new Blob(['a,b']));

    // En el navegador no hay ruta que dar: el archivo va a donde descargue.
    expect(saved).toEqual({ saved: true, path: null });
    expect(link.download).toBe('ventas.csv');
    expect(click).toHaveBeenCalled();
    // Sin revocar, el navegador conserva el archivo en memoria hasta recargar.
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    expect(desktop.saveExport).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  /**
   * En la ventana empaquetada el enlace de descarga no hace nada y **tampoco
   * falla**, así que la aplicación anunciaba «Exportado» sin escribir nada. Aquí
   * se comprueba que ese camino ya no se toma.
   */
  it('en escritorio se lo pide al envoltorio, sin usar el enlace', async () => {
    desktop.isDesktop = true;
    desktop.saveExport.mockResolvedValue('C:\\Users\\dario\\ventas.xlsx');

    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      click,
    } as unknown as HTMLAnchorElement);

    const saved = await create().save('ventas.xlsx', new Blob([new Uint8Array([1, 2, 3])]));

    // La ruta vuelve para poder decirle al usuario dónde quedó el archivo.
    expect(saved).toEqual({ saved: true, path: 'C:\\Users\\dario\\ventas.xlsx' });
    expect(click).not.toHaveBeenCalled();

    const [name, bytes] = desktop.saveExport.mock.calls[0];

    expect(name).toBe('ventas.xlsx');
    // Los bytes viajan intactos: un XLSX es binario y pasarlo por una cadena lo
    // corrompería.
    expect([...bytes]).toEqual([1, 2, 3]);

    vi.restoreAllMocks();
  });

  it('cancelar el diálogo no cuenta como guardado', async () => {
    desktop.isDesktop = true;
    desktop.saveExport.mockResolvedValue(null);

    expect(await create().save('ventas.csv', new Blob(['a']))).toEqual({ saved: false });
  });
});
