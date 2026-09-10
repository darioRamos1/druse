import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import {
  DatabaseEngine,
  EngineCapabilities,
  EngineInfo,
  SavedConnection,
} from '../../../shared/models/workspace';
import { ConnectionDialog } from './connection-dialog';

/** Lo que declara un motor de servidor corriente. */
const CORRIENTES: EngineCapabilities = {
  requiresHost: true,
  requiresUsername: true,
  requiresDatabase: false,
  usesFilePath: false,
  canCreateDatabase: false,
  requiresLogicalServer: false,
  supportsIntegratedSecurity: false,
  supportsSshTunnel: true,
  supportsTransportEncryption: true,
  enforcesReadOnlySessions: false,
};

function motor(
  id: DatabaseEngine,
  name: string,
  defaultPort: number,
  defaultDatabase: string,
  capabilities: Partial<EngineCapabilities> = {},
): EngineInfo {
  return {
    id,
    name,
    defaultPort,
    defaultDatabase,
    capabilities: { ...CORRIENTES, ...capabilities },
  };
}

/**
 * Lo que contestaría la API con los cuatro motores compilados.
 *
 * El formulario ya no lleva su propia lista, así que sin esto no habría ni una
 * tarjeta que pulsar: es la misma dependencia que tiene la aplicación de verdad.
 */
const ENGINES: readonly EngineInfo[] = [
  motor('postgresql', 'PostgreSQL', 5432, 'postgres', { enforcesReadOnlySessions: true }),
  motor('sqlserver', 'SQL Server', 1433, 'master', { supportsIntegratedSecurity: true }),
  motor('mysql', 'MySQL', 3306, '', { enforcesReadOnlySessions: true }),
  motor('informix', 'Informix (DRDA)', 9089, 'sysmaster'),
  motor('informixsqli', 'Informix', 9088, 'sysmaster', { requiresLogicalServer: true }),
  // El que no es un servidor: sin host, sin usuario, con ruta obligatoria y sin
  // nada que cifrar ni por donde tunelar.
  motor('sqlite', 'SQLite', 0, '', {
    requiresHost: false,
    requiresUsername: false,
    requiresDatabase: true,
    usesFilePath: true,
    canCreateDatabase: true,
    supportsSshTunnel: false,
    supportsTransportEncryption: false,
    enforcesReadOnlySessions: true,
  }),
];

describe('ConnectionDialog', () => {
  let fixture: ComponentFixture<ConnectionDialog>;
  const store = {
    engines: signal(ENGINES),
    secretStore: signal({ available: true, description: 'Administrador de credenciales' }),
    notice: signal<string | null>(null),
    testConnection: vi.fn(),
    testTunnel: vi.fn(),
    connectionDatabases: vi.fn(),
    connect: vi.fn(),
    saveConnection: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    store.testConnection.mockResolvedValue('Conexión correcta con SQL Server 16 en 12 ms.');
    store.testTunnel.mockResolvedValue('Túnel correcto: se llegó a db.interna:5432 en 30 ms.');
    store.connectionDatabases.mockResolvedValue({ databases: [], error: null });
    store.connect.mockResolvedValue(true);
    store.saveConnection.mockResolvedValue(true);
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

  it('deja conectar sin base: vacía significa la primera a la que se tenga acceso', async () => {
    setInput(0, 'PostgreSQL local');
    setInput(1, 'localhost');
    setInput(4, 'postgres');

    button('Probar conexión').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', database: '' }),
    );
    expect(fixture.nativeElement.querySelector('.field__error')).toBeNull();
  });

  it('ofrece las bases a las que se tiene acceso', async () => {
    store.connectionDatabases.mockResolvedValue({
      databases: ['compras', 'ventas'],
      error: null,
    });

    setInput(0, 'PostgreSQL local');
    setInput(1, 'localhost');
    setInput(4, 'postgres');

    button('Buscar bases de datos').click();
    await fixture.whenStable();
    fixture.detectChanges();

    const opciones = [
      ...fixture.nativeElement.querySelectorAll('#connection-databases option'),
    ].map((option: HTMLOptionElement) => option.value);

    expect(opciones).toEqual(['compras', 'ventas']);
    expect(
      fixture.nativeElement.querySelector('#connection-database-detail')?.textContent,
    ).toContain('2 bases disponibles');
  });

  it('con una sola base la deja puesta, que no hay nada que elegir', async () => {
    store.connectionDatabases.mockResolvedValue({ databases: ['ventas'], error: null });

    setInput(0, 'PostgreSQL local');
    setInput(1, 'localhost');
    setInput(4, 'postgres');

    button('Buscar bases de datos').click();
    await fixture.whenStable();
    fixture.detectChanges();

    button('Probar conexión').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ database: 'ventas' }),
    );
  });

  it('si no se puede preguntar, lo dice en lugar de callarse', async () => {
    store.connectionDatabases.mockResolvedValue({
      databases: [],
      error: 'La contraseña no es correcta.',
    });

    setInput(0, 'PostgreSQL local');
    setInput(1, 'localhost');
    setInput(4, 'postgres');

    button('Buscar bases de datos').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#connection-database-detail')?.textContent,
    ).toContain('La contraseña no es correcta.');
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

    // «Cifrado» a secas exige cifrar y **no** comprueba el certificado: es lo que
    // significa `require` en los cuatro motores, y por eso ya no se llama
    // «verificado» en la pantalla.
    button('Cifrado').click();
    button('Probar conexión').click();
    await fixture.whenStable();

    expect(store.testConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ sslMode: 'require' }),
    );

    // Comprobar de verdad con quién se habla es el último modo.
    button('Certificado y nombre').click();
    button('Probar conexión').click();
    await fixture.whenStable();

    expect(store.testConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ sslMode: 'verifyfull' }),
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

  describe('editando un perfil guardado', () => {
    const saved: SavedConnection = {
      id: 'perfil-1',
      name: 'FENIX PREPROD',
      engine: 'sqlserver',
      host: 'sql-fenix.database.windows.net',
      port: 1433,
      database: 'sqldb-fenix',
      username: 'lector',
      authentication: 'password',
      sslMode: 'require',
      environment: 'production',
      readOnly: true,
      hasStoredPassword: true,
      sshTunnel: {
        host: 'bastion.empresa.com',
        port: 2222,
        username: 'operador',
        authentication: 'privatekey',
        privateKeyPath: 'C:\\claves\\id_ed25519',
      },
      hasStoredSshSecret: true,
    };

    beforeEach(() => {
      fixture.componentRef.setInput('connection', saved);
      fixture.detectChanges();
    });

    it('precarga todos los campos del perfil, incluido el túnel', () => {
      const values = [...fixture.nativeElement.querySelectorAll('.field__input')].map(
        (input: HTMLInputElement) => input.value,
      );

      expect(fixture.nativeElement.querySelector('.head__title').textContent).toContain(
        'Editar conexión',
      );
      expect(values).toContain('FENIX PREPROD');
      expect(values).toContain('sql-fenix.database.windows.net');
      expect(values).toContain('bastion.empresa.com');
      expect(values).toContain('2222');
      expect(values).toContain('C:\\claves\\id_ed25519');
      expect(selected('Cifrado')).toBe(true);
      expect(selected('Clave privada')).toBe(true);
    });

    it('guarda sin escribir contraseñas y las conserva', async () => {
      button('Guardar cambios').click();
      await fixture.whenStable();

      // `undefined` es lo que le dice al servidor que no toque los secretos
      // guardados; una cadena vacía los borraría.
      expect(store.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'perfil-1',
          password: undefined,
          sshSecret: undefined,
          sslMode: 'require',
          readOnly: true,
          environment: 'production',
        }),
      );
      expect(store.connect).not.toHaveBeenCalled();
    });

    it('envía la contraseña nueva cuando se escribe una', async () => {
      const password = [...fixture.nativeElement.querySelectorAll('.field__input')].find(
        (input: HTMLInputElement) => input.type === 'password',
      ) as HTMLInputElement;

      password.value = 'otra-secreta';
      password.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      button('Guardar cambios').click();
      await fixture.whenStable();

      expect(store.saveConnection).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'otra-secreta' }),
      );
    });

    it('no ofrece dejar de guardar una conexión que ya está guardada', () => {
      const labels = [...fixture.nativeElement.querySelectorAll('.checkbox')].map(
        (element: Element) => element.textContent,
      );

      expect(labels.some((text: string) => text.includes('Guardar esta conexión'))).toBe(false);
    });
  });

  describe('ver la contraseña', () => {
    function passwordField(): HTMLInputElement {
      return fixture.nativeElement.querySelector('.secret .field__input') as HTMLInputElement;
    }

    function toggle(): HTMLButtonElement {
      return fixture.nativeElement.querySelector('.secret__toggle') as HTMLButtonElement;
    }

    it('empieza oculta', () => {
      expect(passwordField().type).toBe('password');
      expect(toggle().getAttribute('aria-label')).toBe('Ver la contraseña');
    });

    /**
     * Una contraseña larga escrita a mano solo se comprueba fallando al
     * conectar, y ahí no se distingue una letra de más de una credencial
     * equivocada.
     */
    it('se puede mirar y volver a ocultar', () => {
      toggle().click();
      fixture.detectChanges();

      expect(passwordField().type).toBe('text');
      expect(toggle().getAttribute('aria-label')).toBe('Ocultar la contraseña');

      toggle().click();
      fixture.detectChanges();

      expect(passwordField().type).toBe('password');
    });
  });

  function selected(label: string): boolean {
    return button(label).classList.contains('is-selected');
  }

  function checkbox(label: string): HTMLInputElement {
    const found = [...fixture.nativeElement.querySelectorAll('.checkbox')].find(
      (candidate: Element) => candidate.textContent?.includes(label),
    ) as HTMLElement;

    return found.querySelector('input') as HTMLInputElement;
  }

  describe('probar el túnel', () => {
    /** Marca la casilla del túnel, que es lo que hace aparecer el botón. */
    function activarTunel(): void {
      const etiqueta = [...fixture.nativeElement.querySelectorAll('label.checkbox')].find(
        (candidata: Element) => candidata.textContent?.includes('servidor SSH'),
      ) as HTMLElement;

      etiqueta.querySelector('input')!.click();
      fixture.detectChanges();
    }

    /**
     * Sin servidor intermedio no hay nada que probar.
     *
     * Un botón que siempre contesta lo mismo enseña a no leerlo, así que ni
     * siquiera se ofrece.
     */
    it('el botón no está cuando la conexión va directa', () => {
      expect(button('Probar túnel')).toBeUndefined();
    });

    it('aparece al activar el servidor intermedio', () => {
      activarTunel();

      expect(button('Probar túnel')).toBeDefined();
    });

    /**
     * No exige el formulario entero.
     *
     * Quien está peleándose con el salto todavía no tiene por qué saber el
     * usuario de la base ni qué base quiere abrir; sí el destino, que es lo que
     * se comprueba que se alcanza.
     */
    it('avisa de lo que falta del túnel sin pedir el resto del formulario', async () => {
      activarTunel();
      button('Probar túnel').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.testTunnel).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('servidor intermedio');
    });
  });

  describe('Informix por su protocolo nativo', () => {
    /** Elige un motor por el nombre que se ve en la lista. */
    function elegirMotor(nombre: string): void {
      const opcion = [...fixture.nativeElement.querySelectorAll('.engine')].find(
        (candidata: Element) =>
          candidata.querySelector('.engine__name')?.textContent?.trim() === nombre,
      ) as HTMLElement;

      opcion.click();
      fixture.detectChanges();
    }

    function campo(etiqueta: string): HTMLInputElement | undefined {
      return [...fixture.nativeElement.querySelectorAll('.field')]
        .find((f: Element) => f.querySelector('.field__label')?.textContent?.trim() === etiqueta)
        ?.querySelector('input') as HTMLInputElement | undefined;
    }

    /**
     * El servidor lógico solo se pide donde hace falta.
     *
     * Por DRDA no existe ese concepto, y enseñar un campo que no se usa invita a
     * rellenarlo y a buscar el fallo donde no está.
     */
    it('solo Informix SQLI muestra los campos Host y Server separados', () => {
      elegirMotor('PostgreSQL');
      expect(campo('Host')).toBeUndefined();
      expect(campo('Server (INFORMIXSERVER)')).toBeUndefined();

      elegirMotor('Informix');
      expect(campo('Host')).toBeDefined();
      expect(campo('Server (INFORMIXSERVER)')).toBeDefined();
    });

    it('cambiar a SQLI propone su puerto y no el de DRDA', async () => {
      elegirMotor('Informix');

      // `ngModel` escribe en el DOM en su propio turno: sin esperar, se leería
      // el valor de antes del clic.
      await fixture.whenStable();
      fixture.detectChanges();

      // 9088 es SQLI y 9089 DRDA: poner el del otro da un error que parece de
      // credenciales.
      expect(campo('Puerto')?.value).toBe('9088');
    });

    it('sin servidor lógico no se llama a la API y se dice qué falta', async () => {
      elegirMotor('Informix');

      button('Probar conexión').click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.testConnection).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain('sqlhosts');
    });

    it('envía Host y Server como datos distintos de la conexión Informix', async () => {
      elegirMotor('Informix');
      escribir('Nombre', 'Reportes Informix');
      escribir('Host', '192.168.99.76');
      escribir('Server (INFORMIXSERVER)', 'vehi_tcp');
      escribir('Base de datos', 'bas_reportes');
      escribir('Usuario', 'casuistica');

      button('Probar conexión').click();
      await fixture.whenStable();

      expect(store.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          engine: 'informixsqli',
          host: '192.168.99.76',
          informixServer: 'vehi_tcp',
          database: 'bas_reportes',
          username: 'casuistica',
        }),
      );
    });

    it('recupera el Server al editar una conexión Informix guardada', async () => {
      const saved: SavedConnection = {
        id: 'informix-1',
        name: 'Reportes Informix',
        engine: 'informixsqli',
        host: '192.168.99.76',
        port: 9010,
        database: 'bas_reportes',
        username: 'casuistica',
        informixServer: 'vehi_tcp',
        authentication: 'password',
        sslMode: 'disable',
        environment: 'production',
        readOnly: false,
        hasStoredPassword: true,
      };

      fixture.componentRef.setInput('connection', saved);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(campo('Host')?.value).toBe('192.168.99.76');
      expect(campo('Server (INFORMIXSERVER)')?.value).toBe('vehi_tcp');
      expect(campo('Puerto')?.value).toBe('9010');
    });

    function escribir(etiqueta: string, valor: string): void {
      const input = campo(etiqueta);

      if (!input) {
        throw new Error(`No se encontró el campo ${etiqueta}.`);
      }

      input.value = valor;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }
  });

  it('conserva cifrado y datos de acceso al plegar las opciones avanzadas', () => {
    setInput(0, 'Conexión de pruebas');
    button('Opciones avanzadas').click();
    fixture.detectChanges();
    button('Cifrado').click();
    fixture.detectChanges();
    button('Opciones avanzadas').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.advanced').hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('.advanced-toggle').textContent).toContain(
      'Cifrado',
    );
    button('Opciones avanzadas').click();
    fixture.detectChanges();
    expect(button('Cifrado').getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.field__input').value).toBe('Conexión de pruebas');
  });

  it('agrupa Informix y conserva DRDA al volver a pulsar su tarjeta', async () => {
    // Cinco tarjetas para seis motores: Informix agrupa sus dos protocolos en
    // una, que es lo que esta prueba comprueba.
    expect(fixture.nativeElement.querySelectorAll('.engine')).toHaveLength(5);
    button('Informix').click();
    fixture.detectChanges();
    button('DRDA').click();
    fixture.detectChanges();
    expect(button('DRDA').getAttribute('aria-pressed')).toBe('true');
    button('Informix').click();
    fixture.detectChanges();
    expect(button('DRDA').getAttribute('aria-pressed')).toBe('true');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.field__input')[2].value).toBe('9089');
    expect(fixture.nativeElement.textContent).not.toContain('Server (INFORMIXSERVER)');
    button('SQLI (JDBC)').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.field__input')[2].value).toBe('9088');
    expect(fixture.nativeElement.textContent).toContain('Server (INFORMIXSERVER)');
  });

  it('abre las opciones avanzadas si hay errores SSH ocultos', () => {
    button('Opciones avanzadas').click();
    fixture.detectChanges();
    checkbox('Conectar a través de un servidor SSH').click();
    fixture.detectChanges();
    button('Opciones avanzadas').click();
    fixture.detectChanges();
    button('Probar conexión').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.advanced').hidden).toBe(false);
    expect(store.testConnection).not.toHaveBeenCalled();
  });

  function button(label: string): HTMLButtonElement {
    const buttons = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
    ];
    return (buttons.find((candidate) => candidate.textContent?.trim() === label) ??
      buttons.find((candidate) => candidate.textContent?.includes(label))) as HTMLButtonElement;
  }

  function setInput(index: number, value: string): void {
    const input = fixture.nativeElement.querySelectorAll('.field__input')[
      index
    ] as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
