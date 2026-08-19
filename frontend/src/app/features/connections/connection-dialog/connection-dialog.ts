import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import {
  AuthenticationMode,
  ConnectionEnvironment,
  ConnectionForm,
  DatabaseEngine,
  SavedConnection,
  SshAuthenticationMode,
  SslMode,
} from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';
import { Icon } from '../../../shared/ui/icon/icon';

interface EngineOption {
  readonly id: DatabaseEngine;
  readonly name: string;
  readonly versions: string;
  readonly defaultPort: number;
  readonly available: boolean;
}

interface EnvironmentOption {
  readonly id: ConnectionEnvironment;
  readonly label: string;
}

interface AuthenticationOption {
  readonly id: AuthenticationMode;
  readonly label: string;
  readonly hint: string;
}

interface SshAuthenticationOption {
  readonly id: SshAuthenticationMode;
  readonly label: string;
}

interface SslOption {
  readonly id: SslMode;
  readonly label: string;
  readonly hint: string;
}

type ConnectionField =
  | 'name'
  | 'host'
  | 'port'
  | 'database'
  | 'username'
  | 'sshHost'
  | 'sshPort'
  | 'sshUsername'
  | 'sshPrivateKeyPath';

/**
 * Motores que se ofrecen.
 *
 * `available` sigue existiendo aunque hoy los tres lo estén: es lo que permite
 * enseñar un motor por venir sin dejar elegirlo.
 */
const ENGINES: readonly EngineOption[] = [
  { id: 'sqlserver', name: 'SQL Server', versions: '2016 – 2022', defaultPort: 1433, available: true },
  { id: 'postgresql', name: 'PostgreSQL', versions: '12 – 18', defaultPort: 5432, available: true },
  { id: 'mysql', name: 'MySQL', versions: '8.0+ · MariaDB', defaultPort: 3306, available: true },
  // El puerto es el del escuchador DRDA, no el nativo de Informix: Druse se
  // conecta por DRDA, así que 9089 —el de la edición de desarrollo de IBM— es
  // mejor punto de partida que el 1526 que la gente recuerda.
  { id: 'informix', name: 'Informix', versions: '12.10+ · vía DRDA', defaultPort: 9089, available: true },
];

/**
 * Métodos de autenticación.
 *
 * Solo se ofrecen con SQL Server: el resto de motores no acepta la identidad de
 * la sesión de Windows, y enseñar una opción que siempre falla sería peor que no
 * enseñarla.
 */
const AUTHENTICATIONS: readonly AuthenticationOption[] = [
  {
    id: 'password',
    label: 'Autenticación de SQL Server',
    hint: 'Usuario y contraseña definidos en el propio motor.',
  },
  {
    id: 'windows',
    label: 'Autenticación de Windows',
    hint: 'Usa la sesión de Windows con la que abriste el equipo. No hay contraseña que escribir.',
  },
];

/**
 * Métodos de acceso al servidor intermedio.
 *
 * El agente SSH no está: la librería que abre el túnel no habla con él, así que
 * ofrecerlo sería prometer algo que fallaría al conectar.
 */
const SSH_AUTHENTICATIONS: readonly SshAuthenticationOption[] = [
  { id: 'password', label: 'Contraseña' },
  { id: 'privatekey', label: 'Clave privada' },
  { id: 'keyboardinteractive', label: 'Interactivo (2FA)' },
];

/**
 * Exigencia de cifrado hasta el motor.
 *
 * Se describe por lo que ocurre y no por el nombre del parámetro de cada driver:
 * lo que el usuario necesita decidir es si acepta un certificado sin verificar,
 * que es justo lo que separa a `prefer` de `require`.
 */
const SSL_MODES: readonly SslOption[] = [
  {
    id: 'disable',
    label: 'Sin cifrar',
    hint: 'La conversación viaja en claro. Solo para servidores en tu propia máquina.',
  },
  {
    id: 'prefer',
    label: 'Cifrado',
    hint: 'Cifra si el servidor lo ofrece y acepta su certificado sin verificarlo.',
  },
  {
    id: 'require',
    label: 'Cifrado verificado',
    hint: 'Exige un certificado válido. Es lo que piden los servicios en la nube.',
  },
];

const ENVIRONMENTS: readonly EnvironmentOption[] = [
  { id: 'development', label: 'Desarrollo' },
  { id: 'testing', label: 'Pruebas' },
  { id: 'production', label: 'Producción' },
];

/**
 * Diálogo de nueva conexión.
 *
 * La contraseña se entrega al store, que la pasa al gateway. Si el usuario pide
 * recordarla, acaba en el almacén del sistema operativo; nunca en la base local.
 */
@Component({
  selector: 'app-connection-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EngineBadge, Icon],
  templateUrl: './connection-dialog.html',
  styleUrl: './connection-dialog.scss',
})
export class ConnectionDialog {
  private readonly _store = inject(WorkspaceStore);

  /**
   * Perfil que se está editando, o `null` para crear uno nuevo.
   *
   * Nunca trae contraseñas —el almacén del sistema no las devuelve, ni debe—,
   * solo si existen. Por eso editar sin escribirlas las conserva.
   */
  readonly connection = input<SavedConnection | null>(null);

  readonly closed = output<void>();

  /** Está editando un perfil que ya existía. */
  protected readonly editing = computed(() => this.connection() !== null);

  protected readonly engines = ENGINES;
  protected readonly environments = ENVIRONMENTS;
  protected readonly authentications = AUTHENTICATIONS;

  protected readonly secretStore = this._store.secretStore;

  protected readonly engine = signal<DatabaseEngine>('postgresql');
  protected readonly name = signal('');
  protected readonly host = signal('127.0.0.1');
  protected readonly port = signal<number | null>(5432);
  protected readonly database = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');

  /**
   * Se está mirando la contraseña.
   *
   * Empieza oculta y vuelve a ocultarse al cargar otro perfil: el diálogo puede
   * quedar abierto delante de alguien, y lo que se enseña a propósito no debería
   * quedarse enseñado por descuido.
   */
  protected readonly passwordVisible = signal(false);
  protected readonly sshSecretVisible = signal(false);
  protected readonly authentication = signal<AuthenticationMode>('password');
  protected readonly readOnly = signal(false);
  protected readonly environment = signal<ConnectionEnvironment>('development');
  protected readonly save = signal(true);
  protected readonly storePassword = signal(true);

  protected readonly sshAuthentications = SSH_AUTHENTICATIONS;
  protected readonly sslModes = SSL_MODES;

  protected readonly sslMode = signal<SslMode>('prefer');

  protected readonly sshEnabled = signal(false);
  protected readonly sshHost = signal('');
  protected readonly sshPort = signal<number | null>(22);
  protected readonly sshUsername = signal('');
  protected readonly sshAuthentication = signal<SshAuthenticationMode>('password');
  protected readonly sshPrivateKeyPath = signal('');
  protected readonly sshSecret = signal('');
  protected readonly sshVerificationCode = signal('');
  protected readonly storeSshSecret = signal(true);

  protected readonly testing = signal(false);

  /** Bases que estas credenciales pueden abrir. Vacío hasta que se pregunta. */
  protected readonly databases = signal<readonly string[]>([]);

  protected readonly loadingDatabases = signal(false);

  /** Lo que pasó al preguntar, para no dejar el botón mudo. */
  protected readonly databasesNotice = signal<string | null>(null);
  protected readonly connecting = signal(false);
  protected readonly feedback = signal<string | null>(null);
  protected readonly feedbackKind = signal<'success' | 'error'>('error');
  protected readonly validationVisible = signal(false);

  /** Guardando los cambios de un perfil existente. */
  protected readonly saving = signal(false);

  constructor() {
    // El perfil llega como entrada y no por parámetro, así que se vuelca en las
    // señales en cuanto se conoce. Solo la primera vez: después manda lo que el
    // usuario esté escribiendo.
    let loaded = false;

    effect(() => {
      const profile = this.connection();

      if (!profile || loaded) {
        return;
      }

      loaded = true;
      this.load(profile);
    });
  }

  protected selectEngine(option: EngineOption): void {
    if (!option.available) {
      return;
    }

    this.engine.set(option.id);
    this.port.set(option.defaultPort);
    this.feedback.set(null);

    // Cambiar a un motor que no admite la identidad de Windows debe devolver el
    // formulario a usuario y contraseña; si no, quedaría elegido un método que
    // ya no se puede ver ni corregir.
    if (option.id !== 'sqlserver') {
      this.authentication.set('password');
    }
  }

  /** Solo SQL Server admite elegir cómo se identifica el usuario. */
  protected supportsWindowsAuth(): boolean {
    return this.engine() === 'sqlserver';
  }

  protected usesWindowsAuth(): boolean {
    return this.authentication() === 'windows';
  }

  protected selectAuthentication(mode: AuthenticationMode): void {
    this.authentication.set(mode);
    this.feedback.set(null);
  }

  protected selectSslMode(mode: SslMode): void {
    this.sslMode.set(mode);
    this.feedback.set(null);
  }

  /** Lo que hace el modo elegido, para enseñarlo debajo de los botones. */
  protected sslHint(): string {
    return this.sslModes.find((option) => option.id === this.sslMode())?.hint ?? '';
  }

  protected selectSshAuthentication(mode: SshAuthenticationMode): void {
    this.sshAuthentication.set(mode);
    this.feedback.set(null);
  }

  protected usesSshKey(): boolean {
    return this.sshAuthentication() === 'privatekey';
  }

  /** El servidor pregunta y el usuario responde; ahí es donde entra el código. */
  protected usesSshPrompts(): boolean {
    return this.sshAuthentication() === 'keyboardinteractive';
  }

  /**
   * El secreto del túnel se llama distinto según el método.
   *
   * Con clave privada no es una contraseña sino la passphrase que la protege, y
   * llamarlas igual lleva a escribir una donde va la otra.
   */
  protected sshSecretLabel(): string {
    return this.usesSshKey() ? 'Passphrase de la clave' : 'Contraseña SSH';
  }

  /**
   * Pregunta al servidor qué bases puede abrir esta identidad.
   *
   * Necesita conectar, así que se pide a botón: escribiendo el servidor no se
   * puede ir probando credenciales a cada tecla.
   */
  protected async loadDatabases(): Promise<void> {
    const form = this.validForm();

    if (!form) {
      return;
    }

    this.loadingDatabases.set(true);
    this.databasesNotice.set(null);

    try {
      const { databases, error } = await this._store.connectionDatabases(form);

      this.databases.set(databases);
      this.databasesNotice.set(
        error ?? (databases.length === 0 ? 'El servidor no devolvió ninguna base.' : null),
      );

      // Con una sola no hay nada que elegir, y dejar el campo vacío obligaría a
      // escribir el único nombre posible.
      if (databases.length === 1) {
        this.database.set(databases[0]);
      }
    } finally {
      this.loadingDatabases.set(false);
    }
  }

  /**
   * Qué se dice debajo del campo.
   *
   * Lo que hay que dejar claro es que **vacío no es un olvido**: es pedirle a
   * Druse que entre por la primera base a la que se tenga acceso.
   */
  protected databaseHint(): string {
    const notice = this.databasesNotice();

    if (notice) {
      return notice;
    }

    const found = this.databases();

    if (found.length > 0) {
      return found.length === 1
        ? 'Solo hay una base disponible y ya está puesta.'
        : `${found.length} bases disponibles: escribe o elige de la lista.`;
    }

    return 'Si la dejas vacía, se abre la primera a la que tengas acceso.';
  }

  protected async test(): Promise<void> {
    const form = this.validForm();

    if (!form) {
      return;
    }

    this.testing.set(true);
    this.feedback.set(null);

    try {
      const message = await this._store.testConnection(form);
      this.feedbackKind.set(message.startsWith('Conexión correcta') ? 'success' : 'error');
      this.feedback.set(message);
    } finally {
      this.testing.set(false);
    }
  }

  protected async connect(): Promise<void> {
    const form = this.validForm();

    if (!form) {
      return;
    }

    this.connecting.set(true);
    this.feedback.set(null);

    try {
      const connected = await this._store.connect(form);

      if (connected) {
        this.closed.emit();
      } else {
        this.feedbackKind.set('error');
        this.feedback.set(
          this._store.notice() ?? 'No se pudo abrir la conexión. Revisa los datos e inténtalo de nuevo.',
        );
      }
    } finally {
      this.connecting.set(false);
    }
  }

  /** Guarda los cambios sin abrir la conexión. */
  protected async saveChanges(): Promise<void> {
    const form = this.validForm();

    if (!form) {
      return;
    }

    this.saving.set(true);
    this.feedback.set(null);

    try {
      if (await this._store.saveConnection(form)) {
        this.closed.emit();
      } else {
        this.feedbackKind.set('error');
        this.feedback.set(this._store.notice() ?? 'No se pudieron guardar los cambios.');
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  /** Vuelca un perfil guardado en el formulario. */
  private load(profile: SavedConnection): void {
    this.passwordVisible.set(false);
    this.sshSecretVisible.set(false);
    this.engine.set(profile.engine);
    this.name.set(profile.name);
    this.host.set(profile.host);
    this.port.set(profile.port);
    this.database.set(profile.database);
    this.username.set(profile.username);
    this.authentication.set(profile.authentication ?? 'password');
    this.sslMode.set(profile.sslMode ?? 'prefer');
    this.readOnly.set(profile.readOnly);
    this.environment.set(profile.environment);

    // Un perfil que se edita ya está guardado, y su contraseña se sigue
    // recordando si la había: desmarcarlo aquí la borraría al guardar.
    this.save.set(true);
    this.storePassword.set(profile.hasStoredPassword);

    const tunnel = profile.sshTunnel;

    this.sshEnabled.set(!!tunnel);
    this.storeSshSecret.set(profile.hasStoredSshSecret ?? false);

    if (tunnel) {
      this.sshHost.set(tunnel.host);
      this.sshPort.set(tunnel.port);
      this.sshUsername.set(tunnel.username);
      this.sshAuthentication.set(tunnel.authentication);
      this.sshPrivateKeyPath.set(tunnel.privateKeyPath);
    }
  }

  protected fieldError(field: ConnectionField): string | null {
    return this.validationVisible() ? (this.validationErrors()[field] ?? null) : null;
  }

  protected portHint(): string | null {
    return this.engine() === 'sqlserver' && this.host().includes('\\')
      ? 'Opcional para una instancia con nombre, por ejemplo SERVIDOR\\SQLEXPRESS.'
      : null;
  }

  protected namePlaceholder(): string {
    return `${this.engines.find((option) => option.id === this.engine())?.name ?? 'Base de datos'} — Desarrollo`;
  }

  protected databasePlaceholder(): string {
    switch (this.engine()) {
      case 'sqlserver':
        return 'master';
      case 'mysql':
        return 'mysql';
      case 'informix':
        return 'sysmaster';
      default:
        return 'postgres';
    }
  }

  private validForm(): ConnectionForm | null {
    this.validationVisible.set(true);
    const errors = this.validationErrors();

    if (Object.keys(errors).length > 0) {
      this.feedbackKind.set('error');
      this.feedback.set('Revisa los campos marcados antes de continuar.');
      return null;
    }

    return this.toForm();
  }

  private validationErrors(): Partial<Record<ConnectionField, string>> {
    const errors: Partial<Record<ConnectionField, string>> = {};
    const namedSqlServer = this.engine() === 'sqlserver' && this.host().includes('\\');
    const port = this.port();

    if (!this.name().trim()) {
      errors.name = 'Escribe un nombre para identificar esta conexión.';
    }
    if (!this.host().trim()) {
      errors.host = 'Indica el servidor o la dirección IP.';
    }
    if (!namedSqlServer && (!Number.isInteger(port) || port! < 1 || port! > 65_535)) {
      errors.port = 'Indica un puerto entre 1 y 65535.';
    } else if (port !== null && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
      errors.port = 'Indica un puerto entre 1 y 65535.';
    }
    // Con autenticación de Windows el usuario lo pone el sistema y el campo ni
    // siquiera se muestra, así que no hay nada que exigir.
    if (!this.usesWindowsAuth() && !this.username().trim()) {
      errors.username = 'Indica el usuario de la base de datos.';
    }

    if (this.sshEnabled()) {
      const sshPort = this.sshPort();

      if (!this.sshHost().trim()) {
        errors.sshHost = 'Indica el servidor SSH intermedio.';
      }
      if (!Number.isInteger(sshPort) || sshPort! < 1 || sshPort! > 65_535) {
        errors.sshPort = 'Indica un puerto entre 1 y 65535.';
      }
      if (!this.sshUsername().trim()) {
        errors.sshUsername = 'Indica el usuario del servidor SSH.';
      }
      if (this.sshAuthentication() === 'privatekey' && !this.sshPrivateKeyPath().trim()) {
        errors.sshPrivateKeyPath = 'Indica la ruta del archivo de clave privada.';
      }
    }

    return errors;
  }

  private toForm(): ConnectionForm {
    const windows = this.usesWindowsAuth();

    return {
      id: this.connection()?.id,
      name: this.name(),
      engine: this.engine(),
      host: this.host(),
      port: this.port() ?? 0,
      database: this.database(),
      // Lo que quedara escrito antes de cambiar de método no debe viajar: la
      // conexión se abre con la identidad de Windows, no con ese usuario.
      username: windows ? '' : this.username(),
      password: windows ? '' : this.secret(this.password(), this.connection()?.hasStoredPassword),
      authentication: this.authentication(),
      sslMode: this.sslMode(),
      readOnly: this.readOnly(),
      environment: this.environment(),
      save: this.save(),
      // Sin almacén del sistema no se guarda la contraseña, aunque se pida:
      // fingir que quedó a salvo sería peor que decir que no se guardó.
      storePassword:
        !windows &&
        this.save() &&
        this.storePassword() &&
        (this.secretStore()?.available ?? false),
      ...this.tunnelForm(),
    };
  }

  /**
   * Qué se envía en un campo de secreto.
   *
   * Un campo vacío no significa lo mismo en cada caso: al editar un perfil que ya
   * tenía el secreto guardado quiere decir «no lo toques» —el formulario no puede
   * mostrarlo, así que estaría vacío igual—, y en cualquier otro caso quiere decir
   * que no hay secreto. Sin esta distinción, corregir un puerto borraría la
   * contraseña.
   */
  private secret(written: string, stored: boolean | undefined): string | undefined {
    return written === '' && this.editing() && stored ? undefined : written;
  }

  /**
   * Parte del formulario que describe el túnel.
   *
   * Devuelve un objeto vacío cuando está desactivado: enviar el túnel apagado
   * con sus campos a medio rellenar haría que el servidor intentara abrirlo.
   */
  private tunnelForm(): Partial<ConnectionForm> {
    if (!this.sshEnabled()) {
      return {};
    }

    // La passphrase solo tiene sentido con clave, y el código de un solo uso solo
    // con el método que los pide.
    const key = this.sshAuthentication() === 'privatekey';
    const interactive = this.sshAuthentication() === 'keyboardinteractive';

    return {
      sshTunnel: {
        host: this.sshHost(),
        port: this.sshPort() ?? 22,
        username: this.sshUsername(),
        authentication: this.sshAuthentication(),
        privateKeyPath: key ? this.sshPrivateKeyPath() : '',
      },
      sshSecret: this.secret(this.sshSecret(), this.connection()?.hasStoredSshSecret),
      sshVerificationCode: interactive ? this.sshVerificationCode() : '',
      storeSshSecret:
        this.save() && this.storeSshSecret() && (this.secretStore()?.available ?? false),
    };
  }
}
