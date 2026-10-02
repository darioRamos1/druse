import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { AiStore } from '../../../core/ai/ai-store';
import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { AiModelList, AiProbeResult, AiStreamEvent } from '../../../shared/models/ai';
import { AiProviderDialog } from './ai-provider-dialog';

describe('comprobación de respuesta del proveedor', () => {
  let fixture: ComponentFixture<AiProviderDialog>;
  let element: HTMLElement;
  let stream: Subject<AiStreamEvent>;
  let probe: Subject<AiProbeResult>;
  const gateway = {
    getCliSession: vi.fn(),
    listAiModels: vi.fn(),
    testAiProvider: vi.fn(),
    streamAiProviderTest: vi.fn(),
  };

  beforeEach(async () => {
    stream = new Subject();
    probe = new Subject();
    gateway.getCliSession
      .mockReset()
      .mockReturnValue(
        of({
          installed: true,
          loggedIn: true,
          version: 'codex-cli 0.150.1',
          account: 'ChatGPT',
          detail: 'Con sesión',
        }),
      );
    gateway.listAiModels.mockReset().mockReturnValue(of({ models: ['gpt-6.1-sol', 'gpt-6-sol'] }));
    gateway.testAiProvider.mockReset().mockReturnValue(probe);
    gateway.streamAiProviderTest.mockReset().mockReturnValue(stream);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApplicationGateway, useValue: gateway },
        {
          provide: AiStore,
          useValue: {
            providers: signal([]),
            canStoreKeys: signal(true),
            storeDescription: signal(''),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AiProviderDialog);
    element = fixture.nativeElement;
    await fixture.whenStable();
    await choose('Tu cuenta ChatGPT');
  });

  function button(text: string): HTMLButtonElement {
    return Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === text,
    )!;
  }
  async function choose(name: string): Promise<void> {
    const label = Array.from(element.querySelectorAll('.option__name')).find(
      (item) => item.textContent?.trim() === name,
    )!;
    (label.closest('button') as HTMLButtonElement).click();
    await fixture.whenStable();
  }
  async function model(value: string): Promise<void> {
    const field = Array.from(element.querySelectorAll('.field')).find(
      (item) => item.querySelector('.field__label')?.textContent?.trim() === 'Modelo',
    )!;
    const input = field.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }
  async function start(): Promise<void> {
    button('Probar respuesta').click();
    await fixture.whenStable();
  }

  it('instalación, sesión y catálogo no generan inferencias ni verifican el modelo', async () => {
    expect(element.querySelector<HTMLInputElement>('.field__input')?.value).toBe('Tu cuenta ChatGPT');
    expect(element.textContent).toContain('codex-cli 0.150.1');
    button('Comprobar configuración').click();
    probe.next({
      reachable: true,
      detail: 'Configuración local correcta; respuesta sin comprobar.',
      elapsedMs: 1,
      modelVerified: false,
    });
    probe.complete();
    await fixture.whenStable();
    expect(gateway.streamAiProviderTest).not.toHaveBeenCalled();
    expect(element.textContent).not.toContain('Respuesta del modelo comprobada');
    expect(element.textContent).toContain('respuesta sin comprobar');
  });

  it.each(['unsupportedModel', 'authentication', 'quota', 'network'])(
    'explica el fallo %s y conserva el detalle para copiar',
    async (code) => {
      await start();
      stream.next({
        kind: 'error',
        code,
        message: 'mensaje original',
        detail: '{"error":"detalle original"}',
      });
      stream.complete();
      await fixture.whenStable();
      expect(element.querySelector('.diagnostic .is-bad')).not.toBeNull();
      expect(element.querySelector('.diagnostic pre')?.textContent).toBe(
        '{"error":"detalle original"}',
      );
      expect(element.textContent).not.toContain('Respuesta del modelo comprobada');
      expect(gateway.streamAiProviderTest.mock.calls[0][0].model).toBe('gpt-6.1-sol');
      expect(button('gpt-6.1-sol').classList.contains('is-selected')).toBe(true);
    },
  );

  it('solo confirma una respuesta completa con texto y muestra modelo y versión', async () => {
    await start();
    stream.next({ kind: 'chunk', text: 'OK' });
    await fixture.whenStable();
    expect(element.textContent).not.toContain('Respuesta del modelo comprobada');
    stream.next({ kind: 'done' });
    stream.complete();
    await fixture.whenStable();
    expect(element.querySelector('.diagnostic')?.textContent).toContain(
      'Respuesta del modelo comprobada',
    );
    expect(element.querySelector('.diagnostic')?.textContent).toContain('gpt-6.1-sol');
    expect(element.querySelector('.diagnostic')?.textContent).toContain('codex-cli 0.150.1');
    await model('gpt-6-sol');
    expect(element.textContent).not.toContain('Respuesta del modelo comprobada');
  });

  it.each(['vacío', 'incompleto'])('rechaza un flujo %s', async (mode) => {
    await start();
    if (mode === 'vacío') stream.next({ kind: 'done' });
    else stream.next({ kind: 'chunk', text: 'parcial' });
    stream.complete();
    await fixture.whenStable();
    expect(element.querySelector('.diagnostic .is-bad')).not.toBeNull();
    expect(element.textContent).toContain('sin completarse');
  });

  it.each(['cancelar', 'modelo', 'cuenta', 'cerrar', 'destruir'])(
    'corta la petición al %s',
    async (action) => {
      await start();
      expect(stream.observers).toHaveLength(1);
      if (action === 'cancelar') button('Cancelar prueba').click();
      else if (action === 'modelo') await model('gpt-6-sol');
      else if (action === 'cuenta')
        (element.querySelectorAll('.accounts .pill')[1] as HTMLButtonElement).click();
      else if (action === 'cerrar')
        (element.querySelector('.head__close') as HTMLButtonElement).click();
      else fixture.destroy();
      expect(stream.observers).toHaveLength(0);
      stream.next({ kind: 'chunk', text: 'tardío' });
      stream.next({ kind: 'done' });
      expect(element.textContent).not.toContain('Respuesta del modelo comprobada');
    },
  );

  it('un resultado local tardío no se aplica a otro modelo', async () => {
    button('Comprobar configuración').click();
    await model('otro modelo');
    probe.next({ reachable: true, detail: 'resultado viejo', elapsedMs: 1 });
    probe.complete();
    await fixture.whenStable();
    expect(element.textContent).not.toContain('resultado viejo');
  });

  it('un catálogo tardío no reemplaza el proveedor actual', async () => {
    const models = new Subject<AiModelList>();
    gateway.listAiModels.mockReturnValue(models);
    button('Ver los suyos').click();
    await choose('Tu cuenta Claude');
    models.next({ models: ['modelo de otra cuenta'] });
    models.complete();
    await fixture.whenStable();
    expect(element.textContent).not.toContain('modelo de otra cuenta');
  });
});
