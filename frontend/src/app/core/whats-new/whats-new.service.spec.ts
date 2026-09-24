import { TestBed } from '@angular/core/testing';

import { RELEASE_NOTES } from './release-notes';
import { WHATS_NEW_PREFERENCE, WhatsNewService } from './whats-new.service';

describe('WhatsNewService', () => {
  const latest = RELEASE_NOTES[0].version;
  let service: WhatsNewService;

  beforeEach(() => {
    service = TestBed.inject(WhatsNewService);
  });

  it('no decide nada hasta leer las preferencias', () => {
    expect(service.shouldShow(latest)).toBe(false);
  });

  it('las enseña si se vieron las de otra versión', () => {
    service.adopt({ [WHATS_NEW_PREFERENCE]: '0.0.1' });

    expect(service.shouldShow(latest)).toBe(true);
  });

  it('las enseña la primera vez, sin nada guardado', () => {
    service.adopt({});

    expect(service.shouldShow(latest)).toBe(true);
  });

  it('no las repite para la versión ya vista', () => {
    service.adopt({ [WHATS_NEW_PREFERENCE]: latest });

    expect(service.shouldShow(latest)).toBe(false);
  });

  it('calla si la versión no tiene notas', () => {
    service.adopt({});

    expect(service.shouldShow('0.0.0-sin-notas')).toBe(false);
  });

  it('las versiones van de la más nueva a la más antigua, sin repetirse', () => {
    const versions = RELEASE_NOTES.map((note) => note.version);

    expect(new Set(versions).size).toBe(versions.length);
    expect(RELEASE_NOTES.every((note) => note.items.length > 0)).toBe(true);
  });
});
