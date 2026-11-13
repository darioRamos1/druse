import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApplicationGateway } from '../../../core/application-gateway/application-gateway';
import { ReportIdentity, ReportIdentityLogo } from '../../../shared/models/reports';
import { emptyIdentity } from '../report-identity-model';
import { ReportIdentityEditor } from './report-identity-editor';

describe('ReportIdentityEditor', () => {
  let fixture: ComponentFixture<ReportIdentityEditor>;
  let saved: ReportIdentity[];
  let logos: { id: string; logo: ReportIdentityLogo }[];
  let removedLogos: string[];
  let deleted: string[];

  const gateway = {
    saveReportIdentity: (identity: ReportIdentity) => {
      saved.push(identity);
      return of({ ...identity, createdAtUtc: '2026-11-12T10:00:00Z', logoUpdatedAtUtc: null });
    },
    saveReportIdentityLogo: (id: string, logo: ReportIdentityLogo) => {
      logos.push({ id, logo });
      return of(undefined);
    },
    deleteReportIdentityLogo: (id: string) => {
      removedLogos.push(id);
      return of(undefined);
    },
    getReportIdentityLogo: () => of({ contentType: 'image/png', data: 'AAAA' }),
    deleteReportIdentity: (id: string) => {
      deleted.push(id);
      return of(undefined);
    },
  };

  const el = <T extends Element = HTMLElement>(selector: string) =>
    fixture.nativeElement.querySelector(selector) as T;

  const button = (text: string) =>
    [...fixture.nativeElement.querySelectorAll('button')].find(
      (item: HTMLButtonElement) => item.textContent?.trim() === text,
    ) as HTMLButtonElement;

  function type(selector: string, value: string): void {
    const input = el<HTMLInputElement>(selector);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function create(identity: ReportIdentity): Promise<void> {
    fixture = TestBed.createComponent(ReportIdentityEditor);
    fixture.componentRef.setInput('identity', identity);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    saved = [];
    logos = [];
    removedLogos = [];
    deleted = [];
    await TestBed.configureTestingModule({
      imports: [ReportIdentityEditor],
      providers: [{ provide: ApplicationGateway, useValue: gateway }],
    }).compileComponents();
  });

  it('una identidad nueva no se guarda sin nombre y guarda los datos limpios', async () => {
    await create(emptyIdentity('id-1'));

    expect(button('Guardar').disabled).toBe(true);

    type('input[placeholder="Comercial Andina S.A.S."]', '  Comercial Andina ');
    type('input[aria-label="Línea de datos 1"]', ' NIT 900 ');
    type('input[aria-label="Línea de datos 3"]', 'Bogotá');
    type('input[aria-label="Color de marca en hexadecimal"]', '0a6cbf');
    button('Guardar').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(saved).toEqual([
      expect.objectContaining({
        id: 'id-1',
        name: 'Comercial Andina',
        details: ['NIT 900', 'Bogotá'],
        brandColor: '#0A6CBF',
        subtitle: null,
      }),
    ]);
    expect(fixture.nativeElement.textContent).toContain('Identidad guardada.');
    expect(button('Guardar').disabled).toBe(true);
  });

  it('un color que no se lee en el tema claro propone el tono más cercano', async () => {
    await create({ ...emptyIdentity('id-2'), name: 'Amarilla' });

    type('input[aria-label="Color de marca en hexadecimal"]', '#FFD400');

    expect(fixture.nativeElement.textContent).toContain('no llega a 3:1');
    const suggestion = [...fixture.nativeElement.querySelectorAll('button')].find(
      (item: HTMLButtonElement) => item.textContent?.trim().startsWith('Usar #'),
    ) as HTMLButtonElement;
    suggestion.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('no llega a 3:1');
    expect(
      el<HTMLInputElement>('input[aria-label="Color de marca en hexadecimal"]').value,
    ).not.toBe('#FFD400');
  });

  it('un color a medio escribir avisa y no cambia el color guardado', async () => {
    await create({ ...emptyIdentity('id-3'), name: 'Andina', brandColor: '#0A6CBF' });

    type('input[aria-label="Color de marca en hexadecimal"]', '#0A6C');

    expect(fixture.nativeElement.textContent).toContain('hexadecimal, como #0A6CBF');
    expect(button('Guardar').disabled).toBe(true);
  });

  it('el logo nuevo se sube al guardar, después de la identidad', async () => {
    await create({ ...emptyIdentity('id-4'), name: 'Andina' });
    const editor = fixture.componentInstance as any;

    editor.logoChange.set({ kind: 'set', data: 'iVBORw0K', contentType: 'image/png' });
    fixture.detectChanges();

    // La vista previa ya lo enseña, en los dos temas, con el nombre como texto alternativo.
    const images = fixture.nativeElement.querySelectorAll('.sample__logo img');
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('alt')).toBe('Andina');

    button('Guardar').click();
    await fixture.whenStable();

    expect(saved).toHaveLength(1);
    expect(logos).toEqual([{ id: 'id-4', logo: { contentType: 'image/png', data: 'iVBORw0K' } }]);
  });

  it('quitar el logo guardado se aplica al guardar', async () => {
    await create({
      ...emptyIdentity('id-5'),
      name: 'Andina',
      createdAtUtc: '2026-11-12T10:00:00Z',
      logoUpdatedAtUtc: '2026-11-12T10:00:00Z',
    });

    expect(fixture.nativeElement.querySelectorAll('.sample__logo img')).toHaveLength(2);
    button('Quitar el logo').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.sample__logo img')).toHaveLength(0);

    button('Guardar').click();
    await fixture.whenStable();

    expect(removedLogos).toEqual(['id-5']);
  });

  it('borrar pide confirmación', async () => {
    await create({
      ...emptyIdentity('id-6'),
      name: 'Andina',
      createdAtUtc: '2026-11-12T10:00:00Z',
    });
    const gone: string[] = [];
    fixture.componentInstance.deleted.subscribe((id) => gone.push(id));

    button('Borrar').click();
    fixture.detectChanges();
    expect(el('.confirm').textContent).toContain('¿Borrar esta identidad?');
    expect(deleted).toEqual([]);

    el('.confirm').querySelector<HTMLButtonElement>('.button--danger')!.click();
    await fixture.whenStable();

    expect(deleted).toEqual(['id-6']);
    expect(gone).toEqual(['id-6']);
  });
});
