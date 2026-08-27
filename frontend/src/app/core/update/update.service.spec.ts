import { TestBed } from '@angular/core/testing';

import {
  AvailableUpdate,
  DesktopAppInfo,
  DesktopHost,
  UpdateProgress,
} from '../application-gateway/desktop-host';
import { UpdateService } from './update.service';

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

  it('enseña que la versión instalada está al día', async () => {
    const { service } = setup();

    await service.initialize();

    expect(service.info()).toEqual(info);
    expect(service.state()).toBe('current');
  });

  it('conserva los metadatos de una actualización disponible', async () => {
    const update = { version: '0.2.0', notes: 'Más motores', date: null };
    const { service } = setup(update);

    await service.initialize();

    expect(service.state()).toBe('available');
    expect(service.available()).toEqual(update);
  });

  it('refleja el progreso mientras descarga e instala', async () => {
    const update = { version: '0.2.0', notes: null, date: null };
    const { service, host } = setup(update);
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
