import { TestBed } from '@angular/core/testing';

import {
  AvailableUpdate,
  DesktopAppInfo,
  DesktopHost,
  UpdateProgress,
} from '../application-gateway/desktop-host';
import { AUTO_CHECK_PREFERENCE, UpdateService } from './update.service';

describe('UpdateService', () => {
  const info: DesktopAppInfo = {
    version: '0.1.0',
    variant: 'completo',
    variantLabel: 'Completa (incluye Informix)',
    updatesEnabled: true,
    updatesDisabledReason: null,
  };

  function setup(update: AvailableUpdate | null = null): {
    service: UpdateService;
    host: {
      appInfo: ReturnType<typeof vi.fn>;
      checkForUpdate: ReturnType<typeof vi.fn>;
      downloadAndInstallUpdate: ReturnType<typeof vi.fn>;
      listenForUpdateProgress: ReturnType<typeof vi.fn>;
    };
  } {
    const host = {
      appInfo: vi.fn().mockResolvedValue(info),
      checkForUpdate: vi.fn().mockResolvedValue(update),
      downloadAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
      listenForUpdateProgress: vi.fn().mockResolvedValue(() => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: DesktopHost, useValue: host }] });

    return { service: TestBed.inject(UpdateService), host };
  }

  /** Lo que hace el arranque: leer las preferencias antes de tocar la red. */
  function autorizado(service: UpdateService): void {
    service.adopt({ [AUTO_CHECK_PREFERENCE]: 'true' });
  }

  it('no consulta nada mientras nadie haya elegido', async () => {
    const { service, host } = setup();

    await service.initialize();

    expect(service.state()).toBe('undecided');
    expect(host.checkForUpdate).not.toHaveBeenCalled();
  });

  it('tampoco consulta si la respuesta fue que no', async () => {
    const { service, host } = setup();
    service.adopt({ [AUTO_CHECK_PREFERENCE]: 'false' });

    await service.initialize();

    expect(service.state()).toBe('idle');
    expect(host.checkForUpdate).not.toHaveBeenCalled();
  });

  it('un valor guardado que ya no significa nada se trata como sin decidir', async () => {
    const { service, host } = setup();
    service.adopt({ [AUTO_CHECK_PREFERENCE]: 'quizás' });

    await service.initialize();

    expect(service.autoCheck()).toBeNull();
    expect(host.checkForUpdate).not.toHaveBeenCalled();
  });

  it('enseña que la versión instalada está al día', async () => {
    const { service } = setup();
    autorizado(service);

    await service.initialize();

    expect(service.info()).toEqual(info);
    expect(service.state()).toBe('current');
  });

  it('conserva los metadatos de una actualización disponible', async () => {
    const update = { version: '0.2.0', notes: 'Más motores', date: null };
    const { service } = setup(update);
    autorizado(service);

    await service.initialize();

    expect(service.state()).toBe('available');
    expect(service.available()).toEqual(update);
  });

  it('activarlo busca ya, sin esperar al siguiente arranque', async () => {
    const { service, host } = setup();

    await service.initialize();
    await service.setAutoCheck(true);

    expect(host.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(service.state()).toBe('current');
  });

  it('desactivarlo deja de anunciar la versión encontrada', async () => {
    const update = { version: '0.2.0', notes: null, date: null };
    const { service } = setup(update);
    autorizado(service);

    await service.initialize();
    await service.setAutoCheck(false);

    expect(service.available()).toBeNull();
    expect(service.state()).toBe('idle');
  });

  it('una distribución que no se actualiza no pregunta nada', async () => {
    const { service, host } = setup();
    host.appInfo.mockResolvedValue({
      ...info,
      updatesEnabled: false,
      updatesDisabledReason: 'La distribución portable se actualiza descargando una nueva copia.',
    });
    autorizado(service);

    await service.initialize();

    expect(service.state()).toBe('disabled');
    expect(host.checkForUpdate).not.toHaveBeenCalled();
  });

  it('refleja el progreso mientras descarga e instala', async () => {
    const update = { version: '0.2.0', notes: null, date: null };
    const { service, host } = setup(update);
    autorizado(service);
    let report!: (progress: UpdateProgress) => void;
    host.listenForUpdateProgress.mockImplementation(async (handler) => {
      report = handler;
      return () => undefined;
    });
    host.downloadAndInstallUpdate.mockImplementation(async () => {
      report({ event: 'started', total: 100 });
      report({ event: 'progress', downloaded: 40 });
    });

    await service.initialize();
    await service.apply();

    expect(service.downloaded()).toBe(40);
    expect(service.percent()).toBe(40);
    expect(service.state()).toBe('installing');
  });
});
