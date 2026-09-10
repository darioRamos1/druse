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
  EngineCapabilities,
  EngineInfo,
  SavedConnection,
  SshAuthenticationMode,
  SslMode,
} from '../../../shared/models/workspace';
import {
  ENGINE_FAMILIES,
  ENGINE_NAMES,
  ENGINE_ORDER,
  ENGINE_TRANSPORTS,
  ENGINE_VERSIONS,
  EngineBadge,
  isKnownEngine,
} from '../../../shared/ui/engine-badge/engine-badge';
import { Icon } from '../../../shared/ui/icon/icon';
import { DialogFocus } from '../../../shared/a11y/dialog-focus';
import { DialogBackdrop } from '../../../shared/a11y/dialog-backdrop';

/**
 * Un motor tal y como se ofrece en el formulario.
 *
 * Junta lo que dice la API —que existe y en qué puerto escucha— con lo que dice
 * la interfaz —cómo se llama y qué versiones se anuncian—. Ninguna de las dos
 * mitades puede escribir la otra: el proveedor no sabe qué versión se probó, y
 * el navegador no sabe qué está compilado en el servidor.
 */
interface EngineOption {
  readonly id: DatabaseEngine;
  readonly name: string;
  readonly versions: string;
  readonly defaultPort: number;
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
  | 'informixServer'
  | 'sshHost'
  | 'sshPort'
  | 'sshUsername'
  | 'sshPrivateKeyPath';

/**
 * Lo que se supone de un motor mientras la API no ha contestado, o del que esta
 * versión de la interfaz no conoce.
 *
 * Describe al motor corriente: un servidor con host y usuario. Es la misma
 * suposición que hace el validador del servidor, y por el mismo motivo: pecar de
 * exigente deja al usuario un campo de más, y pecar de permisivo le deja mandar
 * un perfil que no se puede abrir.
 */
const CAPACIDADES_CORRIENTES: EngineCapabilities = {
  requiresHost: true,
  requiresUsername: true,
  requiresDatabase: false,
  usesFilePath: false,
  requiresLogicalServer: false,
  supportsIntegratedSecurity: false,
  supportsSshTunnel: true,
  supportsTransportEncryption: true,
  enforcesReadOnlySessions: false,
};

/** Dónde va cada motor en la lista. Lo no declarado, al final. */
function posicion(engine: DatabaseEngine): number {
  const indice = ENGINE_ORDER.indexOf(engine);

  return indice === -1 ? ENGINE_ORDER.length : indice;
}

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
    label: 'Cifra si puede',
    hint: 'Cifra si el servidor lo ofrece, y sigue adelante si no.',
  },
  {
    id: 'require',
    label: 'Cifrado',
    hint:
      'Exige cifrado, pero no comprueba el certificado: protege de quien escucha el ' +
      'cable, no de quien se hace pasar por el servidor.',
  },
  {
    id: 'verifyca',
    label: 'Certificado de confianza',
    hint:
      'Exige que el certificado lo firme una autoridad de confianza. No comprueba que ' +
      'el nombre sea el de este servidor.',
  },
  {
    id: 'verifyfull',
    label: 'Certificado y nombre',
    hint:
      'Comprueba además que el certificado sea el de este servidor. Es el único modo ' +
      'que protege de un intermediario, y lo que piden los servicios en la nube.',
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
  imports: [DialogBackdrop, DialogFocus, FormsModule, EngineBadge, Icon],
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

  /**
   * Los motores que la API dice tener, en el orden en que se ofrecen y sin los
   * que esta interfaz no sabría dibujar.
   */
  private readonly available = computed<readonly EngineOption[]>(() => {
    const known = this._store
      .engines()
      .filter((info) => isKnownEngine(info.id))
      .map<EngineOption>((info) => ({
        id: info.id,
        // El nombre lo pone la interfaz cuando lo tiene: la API llama «Informix»
        // a los dos transportes y aquí hay que distinguirlos.
        name: ENGINE_NAMES[info.id] ?? info.name,
        versions: ENGINE_VERSIONS[info.id],
        defaultPort: info.defaultPort,
      }));

    return [...known].sort((a, b) => posicion(a.id) - posicion(b.id));
  });

  /**
   * Una tarjeta por familia, no por motor.
   *
   * Informix son dos motores para un solo producto —DRDA y SQLI— y ofrecer dos
   * tarjetas haría elegir un protocolo a quien solo quería elegir una base de
   * datos. El protocolo se pregunta después, y solo si hay más de uno.
   */
  protected readonly engines = computed<readonly EngineOption[]>(() => {
    const vistas = new Set<string>();

    return this.available().filter((option) => {
      const familia = ENGINE_FAMILIES[option.id];

      if (vistas.has(familia)) {
        return false;
      }

      vistas.add(familia);

      return true;
    });
  });

  /** Los caminos de la familia elegida, o vacío si solo hay uno. */
  protected readonly transports = computed<readonly EngineOption[]>(() => {
    const familia = ENGINE_FAMILIES[this.engine()];
    const hermanos = this.available().filter((option) => ENGINE_FAMILIES[option.id] === familia);

    return hermanos.length > 1 ? hermanos : [];
  });

  /** Cómo se llama el camino de este motor dentro de su familia. */
  protected transportName(engine: DatabaseEngine): string {
    return ENGINE_TRANSPORTS[engine] ?? ENGINE_NAMES[engine];
  }

  /** La tarjeta de esta familia está elegida, sea cual sea el camino. */
  protected isSelected(option: EngineOption): boolean {
    return ENGINE_FAMILIES[option.id] === ENGINE_FAMILIES[this.engine()];
  }

  /** El motor elegido, tal y como lo describe la API. */
  private readonly selected = computed<EngineInfo | undefined>(() =>
    this._store.engines().find((info) => info.id === this.engine()),
  );

  /**
   * Lo que el motor elegido necesita.
   *
   * Es lo que sustituye a los condicionales por motor que había repartidos por
   * el formulario. Mientras la API no contesta se usa lo corriente: el diálogo
   * se abre mucho después del arranque, así que en la práctica siempre hay
   * respuesta.
   */
  protected readonly capabilities = computed<EngineCapabilities>(
    () => this.selected()?.capabilities ?? CAPACIDADES_CORRIENTES,
  );
  protected readonly advancedOpen = signal(false);
  protected readonly advancedSummary = computed(
    () =>
      (SSL_MODES.find((option) => option.id === this.sslMode())?.label ?? '') +
      ' · ' +
      (this.sshEnabled() ? 'SSH activado' : 'Sin túnel SSH'),
  );
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

  /**
   * Qué garantiza «solo lectura» en el motor elegido.
   *
   * PostgreSQL y MySQL tienen sesiones de solo lectura: Druse las pide y el
   * servidor rechaza cualquier escritura, incluida la que el analizador de SQL no
   * vería —un procedimiento que escribe por dentro, un `SELECT INTO`—. SQL Server
   * e Informix no tienen nada equivalente, así que allí es solo un aviso.
   *
   * Se dice cuál de las dos cosas es. Enseñar la misma frase en los cinco casos
   * sería prometer lo que solo dos cumplen.
   */
  protected readonly readOnlyHint = computed(() => {
    if (!this.capabilities().enforcesReadOnlySessions) {
      return (
        'Este motor no tiene sesiones de solo lectura: Druse avisa antes de ejecutar, ' +
        'pero la garantía es un usuario con permisos restringidos en el servidor.'
      );
    }

    // En un motor que es un archivo el candado es el más fuerte de todos: se
    // abre sin permiso de escritura y no hay instrucción que pueda saltárselo.
    return this.esArchivo()
      ? 'El archivo se abre sin permiso de escritura: no hay forma de tocarlo desde aquí.'
      : 'Druse pone la sesión en solo lectura: el servidor rechaza cualquier escritura.';
  });
  protected readonly environment = signal<ConnectionEnvironment>('development');
  protected readonly save = signal(true);
  protected readonly storePassword = signal(true);

  protected readonly sshAuthentications = SSH_AUTHENTICATIONS;
  protected readonly sslModes = SSL_MODES;

  protected readonly sslMode = signal<SslMode>('prefer');

  /** El `INFORMIXSERVER`. Solo se pide —y solo se manda— con Informix por SQLI. */
  protected readonly informixServer = signal('');

  /** El motor pide además el nombre del servidor lógico. */
  protected readonly usaSqli = computed(() => this.capabilities().requiresLogicalServer);

  /**
   * El motor es un archivo del disco y no un servidor.
   *
   * Cambia medio formulario: sin servidor, sin puerto, sin identidad y sin nada
   * que cifrar ni por donde tunelar. Lo que queda es un nombre y una ruta.
   */
  protected readonly esArchivo = computed(() => this.capabilities().usesFilePath);

  /** Hay servidor al que apuntar, así que hay servidor y puerto que escribir. */
  protected readonly pideServidor = computed(() => this.capabilities().requiresHost);

  /** Hay identidad que dar, así que hay usuario y contraseña. */
  protected readonly pideIdentidad = computed(() => this.capabilities().requiresUsername);

  /**
   * Queda algo que enseñar en las opciones avanzadas.
   *
   * En un motor que es un archivo, no: ni transporte que cifrar ni servidor
   * intermedio por el que pasar. Enseñar la sección vacía sería ofrecer dos
   * decisiones que no existen.
   */
  protected readonly hayAvanzadas = computed(
    () => this.capabilities().supportsTransportEncryption || this.capabilities().supportsSshTunnel,
  );

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

  /** Señal propia y no compartida con `testing`: son dos pruebas distintas
   * y el usuario tiene que ver cuál está corriendo. */
  protected readonly testingTunnel = signal(false);

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

  /**
   * Elige la familia sin tocar el camino ya elegido dentro de ella.
   *
   * Pulsar la tarjeta de Informix estando en DRDA no debe devolver a SQLI: el
   * usuario ya dijo por dónde entra, y la tarjeta solo dice qué producto es.
   */
  protected selectEngineFamily(option: EngineOption): void {
    if (this.isSelected(option)) {
      return;
    }

    this.selectEngine(option);
  }

  protected selectEngine(option: EngineOption): void {
    this.engine.set(option.id);
    this.port.set(option.defaultPort);
    this.feedback.set(null);

    // Cambiar a un motor que no admite la identidad del sistema debe devolver el
    // formulario a usuario y contraseña; si no, quedaría elegido un método que
    // ya no se puede ver ni corregir.
    if (!this.capabilities().supportsIntegratedSecurity) {
      this.authentication.set('password');
    }
  }

  /** El motor admite elegir cómo se identifica el usuario. */
  protected supportsWindowsAuth(): boolean {
    return this.capabilities().supportsIntegratedSecurity;
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
    if (this.esArchivo()) {
      return 'La ruta del archivo, por ejemplo C:\\datos\\ventas.db. Druse no lo crea: tiene que existir.';
    }

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

  /**
   * Prueba el túnel a solas.
   *
   * No exige que el formulario entero sea válido, solo lo que hace falta para
   * llegar al servidor intermedio: quien está peleándose con el salto todavía no
   * tiene por qué saber el usuario de la base ni qué base quiere abrir.
   */
  protected async testTunnel(): Promise<void> {
    const form = this.tunnelOnlyForm();

    if (!form) {
      return;
    }

    this.testingTunnel.set(true);
    this.feedback.set(null);

    try {
      const message = await this._store.testTunnel(form);
      this.feedbackKind.set(message.startsWith('Túnel correcto') ? 'success' : 'error');
      this.feedback.set(message);
    } finally {
      this.testingTunnel.set(false);
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
          this._store.notice() ??
            'No se pudo abrir la conexión. Revisa los datos e inténtalo de nuevo.',
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
    this.informixServer.set(profile.informixServer ?? '');
    this.authentication.set(profile.authentication ?? 'password');
    this.sslMode.set(profile.sslMode ?? 'prefer');
    this.readOnly.set(profile.readOnly);
    this.environment.set(profile.environment);

    // Un perfil que se edita ya está guardado, y su contraseña se sigue
    // recordando si la había: desmarcarlo aquí la borraría al guardar.
    this.save.set(true);
    this.storePassword.set(profile.hasStoredPassword);

    const tunnel = profile.sshTunnel;

    this.advancedOpen.set(!!tunnel);

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
    return `${ENGINE_NAMES[this.engine()] ?? 'Base de datos'} — Desarrollo`;
  }

  /**
   * La base que se propone es **la que el motor usa para preguntar qué bases
   * hay**, que es la única que se sabe que existe antes de conectar.
   *
   * MySQL conecta sin nombrar base y la deja vacía a propósito: ahí el ejemplo
   * sería una base concreta de un servidor que aún no se ha visto.
   */
  protected databasePlaceholder(): string {
    return this.esArchivo() ? 'ruta del archivo .db' : (this.selected()?.defaultDatabase ?? '');
  }

  /** Cómo se llama aquí lo que en un servidor es «la base de datos». */
  protected databaseLabel(): string {
    return this.esArchivo() ? 'Archivo' : 'Base de datos';
  }

  private validForm(): ConnectionForm | null {
    this.validationVisible.set(true);
    const errors = this.validationErrors();

    if (Object.keys(errors).length > 0) {
      if (Object.keys(errors).some((field) => field.startsWith('ssh'))) {
        this.advancedOpen.set(true);
      }
      this.feedbackKind.set('error');
      this.feedback.set('Revisa los campos marcados antes de continuar.');
      return null;
    }

    return this.toForm();
  }

  /**
   * El formulario, exigiendo solo lo que hace falta para probar el túnel.
   *
   * Quien está peleándose con el salto no tiene por qué haber rellenado el
   * usuario de la base ni el nombre de la conexión: eso se pide para guardar y
   * para conectar, no para saber si el servidor intermedio deja pasar. Sí se
   * exige el destino —servidor y puerto—, porque es lo que se comprueba que se
   * alcanza desde el otro lado.
   */
  private tunnelOnlyForm(): ConnectionForm | null {
    this.validationVisible.set(true);

    if (!this.sshEnabled()) {
      this.feedbackKind.set('error');
      this.feedback.set('Activa el servidor intermedio para poder probarlo.');
      return null;
    }

    const errors = this.validationErrors();
    const relevantes: readonly ConnectionField[] = [
      'host',
      'port',
      'sshHost',
      'sshPort',
      'sshUsername',
      'sshPrivateKeyPath',
    ];

    if (relevantes.some((campo) => errors[campo])) {
      this.advancedOpen.set(true);
      this.feedbackKind.set('error');
      this.feedback.set('Revisa los campos del servidor intermedio y del destino.');
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
    if (this.capabilities().requiresHost && !this.host().trim()) {
      errors.host = 'Indica el servidor o la dirección IP.';
    }

    // En un servidor, la base vacía significa «la primera a la que tenga
    // acceso». En un motor que es un archivo no hay tal cosa: sin la ruta no hay
    // nada que abrir.
    if (this.capabilities().requiresDatabase && !this.database().trim()) {
      errors.database = this.esArchivo()
        ? 'Indica el archivo de la base de datos.'
        : 'Indica la base de datos.';
    }
    if (
      this.capabilities().requiresHost &&
      !namedSqlServer &&
      (!Number.isInteger(port) || port! < 1 || port! > 65_535)
    ) {
      errors.port = 'Indica un puerto entre 1 y 65535.';
    } else if (port !== null && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
      errors.port = 'Indica un puerto entre 1 y 65535.';
    }
    // Con autenticación de Windows el usuario lo pone el sistema y el campo ni
    // siquiera se muestra, así que no hay nada que exigir. Y hay motores que no
    // tienen usuarios en absoluto.
    if (
      this.capabilities().requiresUsername &&
      !this.usesWindowsAuth() &&
      !this.username().trim()
    ) {
      errors.username = 'Indica el usuario de la base de datos.';
    }

    // En SQLI el driver no puede deducirlo, y sin él su error habla de red y
    // manda a mirar el cortafuegos cuando lo que falta es este campo.
    if (this.usaSqli() && !this.informixServer().trim()) {
      errors.informixServer =
        'Indica el servidor Informix del `sqlhosts` (por ejemplo, `vehi_tcp`).';
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
      // Solo con su motor: mandarlo con otro guardaría un dato que nadie usa y
      // que confundiría al releer el perfil.
      informixServer: this.usaSqli() ? this.informixServer().trim() : undefined,
      environment: this.environment(),
      save: this.save(),
      // Sin almacén del sistema no se guarda la contraseña, aunque se pida:
      // fingir que quedó a salvo sería peor que decir que no se guardó.
      storePassword:
        !windows && this.save() && this.storePassword() && (this.secretStore()?.available ?? false),
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
