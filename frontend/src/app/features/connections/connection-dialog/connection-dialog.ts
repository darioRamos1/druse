import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { WorkspaceStore } from '../../../core/workspace/workspace-store';
import {
  ConnectionEnvironment,
  ConnectionForm,
  DatabaseEngine,
} from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';

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
  imports: [FormsModule, EngineBadge],
  templateUrl: './connection-dialog.html',
  styleUrl: './connection-dialog.scss',
})
export class ConnectionDialog {
  private readonly _store = inject(WorkspaceStore);

  readonly closed = output<void>();

  protected readonly engines = ENGINES;
  protected readonly environments = ENVIRONMENTS;

  protected readonly secretStore = this._store.secretStore;

  protected readonly engine = signal<DatabaseEngine>('postgresql');
  protected readonly name = signal('');
  protected readonly host = signal('127.0.0.1');
  protected readonly port = signal(5432);
  protected readonly database = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly readOnly = signal(false);
  protected readonly environment = signal<ConnectionEnvironment>('development');
  protected readonly save = signal(true);
  protected readonly storePassword = signal(true);

  protected readonly testing = signal(false);
  protected readonly connecting = signal(false);
  protected readonly feedback = signal<string | null>(null);

  protected selectEngine(option: EngineOption): void {
    if (!option.available) {
      return;
    }

    this.engine.set(option.id);
    this.port.set(option.defaultPort);
    this.feedback.set(null);
  }

  protected async test(): Promise<void> {
    this.testing.set(true);
    this.feedback.set(null);

    try {
      this.feedback.set(await this._store.testConnection(this.toForm()));
    } finally {
      this.testing.set(false);
    }
  }

  protected async connect(): Promise<void> {
    this.connecting.set(true);
    this.feedback.set(null);

    try {
      const connected = await this._store.connect(this.toForm());

      if (connected) {
        this.closed.emit();
      } else {
        this.feedback.set('No se pudo abrir la conexión.');
      }
    } finally {
      this.connecting.set(false);
    }
  }

  protected close(): void {
    this.closed.emit();
  }

  private toForm(): ConnectionForm {
    return {
      name: this.name(),
      engine: this.engine(),
      host: this.host(),
      port: this.port(),
      database: this.database(),
      username: this.username(),
      password: this.password(),
      readOnly: this.readOnly(),
      environment: this.environment(),
      save: this.save(),
      // Sin almacén del sistema no se guarda la contraseña, aunque se pida:
      // fingir que quedó a salvo sería peor que decir que no se guardó.
      storePassword: this.save() && this.storePassword() && (this.secretStore()?.available ?? false),
    };
  }
}
