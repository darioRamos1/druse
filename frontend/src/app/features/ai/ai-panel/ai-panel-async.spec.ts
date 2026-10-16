import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { AiStore } from '../../../core/ai/ai-store';
import { AiBusinessNote, AiProvider } from '../../../shared/models/ai';
import { AiPanel } from './ai-panel';

describe('Preparación de las notas del chat', () => {
  for (const action of ['cancelar', 'cambiar de base', 'cerrar el panel']) {
    it(`no envía una pregunta pendiente después de ${action}`, async () => {
      const notes = new Subject<readonly AiBusinessNote[]>();
      let requests = 0;
      const provider: AiProvider = {
        id: 'p1',
        name: 'Pruebas',
        kind: 'localcli',
        command: 'codex',
        baseUrl: '',
        model: 'modelo',
        disclosure: 'schema',
        shareBusinessNotes: true,
        ownSession: false,
        isDefault: true,
        hasStoredKey: false,
      };
      TestBed.configureTestingModule({
        providers: [
          {
            provide: ApplicationGateway,
            useValue: {
              getAiProviders: () =>
                of({ providers: [provider], canStoreKeys: false, storeDescription: '' }),
              getAiNotes: () => notes,
              streamAiChat: () => {
                requests++;
                return of({ kind: 'done' });
              },
            },
          },
        ],
      });
      TestBed.overrideComponent(AiPanel, { set: { template: '' } });
      await TestBed.inject(AiStore).refresh();
      const fixture = TestBed.createComponent(AiPanel);
      const context = {
        sql: '',
        schema: '',
        tables: [],
        database: 'ventas',
        sessionId: 's1',
        source: { connectionId: 'c1', connectionName: 'Pruebas', database: 'ventas' },
      };
      fixture.componentRef.setInput('context', context);
      fixture.detectChanges();
      const panel = fixture.componentInstance;
      panel['draft'].set('Pregunta pendiente');
      const sending = panel['send']();
      expect(panel['preparing']()).toBe(true);
      if (action === 'cancelar') panel['cancel']();
      else if (action === 'cerrar el panel') fixture.destroy();
      else {
        fixture.componentRef.setInput('context', {
          ...context,
          database: 'otra',
          source: { ...context.source, database: 'otra' },
        });
        fixture.detectChanges();
      }
      notes.next([]);
      notes.complete();
      await sending;
      expect(requests).toBe(0);
      expect(panel['draft']()).toBe('Pregunta pendiente');
    });
  }
});
