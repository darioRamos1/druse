import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import { ConnectionDialog } from './connection-dialog';

describe('ConnectionDialog', () => {
  let fixture: ComponentFixture<ConnectionDialog>;
  const store = {
    secretStore: signal({ available: true, description: 'Administrador de credenciales' }),
    notice: signal<string | null>(null),
    testConnection: vi.fn(),
    connect: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    store.testConnection.mockResolvedValue('Conexión correcta con SQL Server 16 en 12 ms.');
    store.connect.mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [ConnectionDialog],
      providers: [{ provide: WorkspaceStore, useValue: store }],
    }).compileComponents();

    fixture = TestBed.createComponent(ConnectionDialog);
    fixture.detectChanges();
  });

  it('marca los campos obligatorios antes de llamar a la API', async () => {
    button('Probar conexión').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const messages = [...fixture.nativeElement.querySelectorAll('.field__error')].map(
      (element: Element) => element.textContent?.trim(),
    );

    expect(store.testConnection).not.toHaveBeenCalled();
    expect(messages).toEqual([
      'Escribe un nombre para identificar esta conexión.',
      'Indica la base de datos inicial.',
      'Indica el usuario de la base de datos.',
    ]);
    expect(fixture.nativeElement.querySelector('.feedback')?.textContent).toContain(
      'Revisa los campos marcados',
    );
  });

  it('permite omitir el puerto en una instancia con nombre de SQL Server', async () => {
    button('SQL Server').click();
    setInput(0, 'SQL Server local');
    setInput(1, 'localhost\\SQLEXPRESS');
    setInput(2, '');
    setInput(3, 'master');
    setInput(4, 'sa');

    button('Probar conexión').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'sqlserver',
        host: 'localhost\\SQLEXPRESS',
        port: 0,
        database: 'master',
        username: 'sa',
      }),
    );
    expect(fixture.nativeElement.querySelector('.feedback')?.dataset['kind']).toBe('success');
  });

  it('con autenticación de Windows no pide usuario ni contraseña', async () => {
    button('SQL Server').click();
    fixture.detectChanges();
    button('Autenticación de Windows').click();
    setInput(0, 'SQL Server corporativo');
    setInput(1, 'srv-datos');
    setInput(3, 'ventas');

    button('Probar conexión').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: 'sqlserver',
        authentication: 'windows',
        username: '',
        password: '',
        storePassword: false,
      }),
    );
    expect(fixture.nativeElement.querySelector('.field__error')).toBeNull();
  });

  it('vuelve a usuario y contraseña al cambiar a un motor que no admite Windows', () => {
    button('SQL Server').click();
    fixture.detectChanges();
    button('Autenticación de Windows').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.auths')).not.toBeNull();

    button('MySQL').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.auths')).toBeNull();
    // El campo de usuario vuelve a estar, que es lo que MySQL necesita.
    expect(fixture.nativeElement.querySelectorAll('.field__input').length).toBe(6);
  });

  it('envía el cifrado elegido y por omisión el intermedio', async () => {
    setInput(0, 'Cifrada');
    setInput(3, 'druse_test');
    setInput(4, 'postgres');

    button('Probar conexión').click();
    await fixture.whenStable();

    // Sin tocar nada, `prefer`: cifra si el servidor lo ofrece sin exigir un
    // certificado válido, que es lo que funciona en la mayoría de servidores.
    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ sslMode: 'prefer' }),
    );

    button('Cifrado verificado').click();
    button('Probar conexión').click();
    await fixture.whenStable();

    expect(store.testConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ sslMode: 'require' }),
    );
  });

  it('no envía túnel mientras la casilla esté desmarcada', async () => {
    setInput(0, 'Directa');
    setInput(3, 'druse_test');
    setInput(4, 'postgres');

    button('Probar conexión').click();
    await fixture.whenStable();

    expect(store.testConnection).toHaveBeenCalledWith(
      expect.not.objectContaining({ sshTunnel: expect.anything() }),
    );
  });

  it('envía el túnel con sus datos cuando se activa', async () => {
    setInput(0, 'Por bastión');
    setInput(3, 'druse_test');
    setInput(4, 'postgres');
    checkbox('Conectar a través de un servidor SSH').click();
    fixture.detectChanges();

    // Los campos del túnel vienen detrás de los seis de la base: servidor SSH,
    // puerto, usuario y secreto.
    setInput(6, 'bastion.empresa.com');
    setInput(8, 'operador');
    setInput(9, 'clave-del-bastion');

    button('Probar conexión').click();
    await fixture.whenStable();

    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        sshTunnel: expect.objectContaining({
          host: 'bastion.empresa.com',
          port: 22,
          username: 'operador',
          authentication: 'password',
        }),
        sshSecret: 'clave-del-bastion',
      }),
    );
  });

  it('exige los datos del túnel antes de llamar a la API', async () => {
    setInput(0, 'Incompleta');
    setInput(3, 'druse_test');
    setInput(4, 'postgres');
    checkbox('Conectar a través de un servidor SSH').click();
    fixture.detectChanges();

    button('Probar conexión').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const messages = [...fixture.nativeElement.querySelectorAll('.field__error')].map(
      (element: Element) => element.textContent?.trim(),
    );

    expect(store.testConnection).not.toHaveBeenCalled();
    expect(messages).toEqual([
      'Indica el servidor SSH intermedio.',
      'Indica el usuario del servidor SSH.',
    ]);
  });

  function checkbox(label: string): HTMLInputElement {
    const found = [...fixture.nativeElement.querySelectorAll('.checkbox')].find(
      (candidate: Element) => candidate.textContent?.includes(label),
    ) as HTMLElement;

    return found.querySelector('input') as HTMLInputElement;
  }

  function button(label: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button')].find((candidate: Element) =>
      candidate.textContent?.includes(label),
    ) as HTMLButtonElement;
  }

  function setInput(index: number, value: string): void {
    const input = fixture.nativeElement.querySelectorAll('.field__input')[index] as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
