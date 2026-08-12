import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConnectionForm, DatabaseEngine } from '../../../shared/models/workspace';
import { EngineBadge } from '../../../shared/ui/engine-badge/engine-badge';
import { WorkspaceStore } from '../../../core/workspace/workspace-store';

interface EngineOption {
  readonly id: DatabaseEngine;
  readonly name: string;
  readonly versions: string;
  readonly defaultPort: number;
  readonly available: boolean;
}

/** Motores que se ofrecen. MySQL aparece pero deshabilitado hasta la Fase 8. */
const ENGINES: readonly EngineOption[] = [
  { id: 'sqlserver', name: 'SQL Server', versions: '2016 – 2022', defaultPort: 1433, available: false },
  { id: 'postgresql', name: 'PostgreSQL', versions: '12 – 18', defaultPort: 5432, available: true },
  { id: 'mysql', name: 'MySQL', versions: '8.0+', defaultPort: 3306, available: false },
];

/**
 * Diálogo de nueva conexión, según el mockup.
 *
 * La contraseña vive en el formulario y se entrega al store, que la pasa al
 * gateway y la olvida. No se guarda en ningún sitio hasta que exista el almacén
 * seguro del sistema (Fase 3).
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

  protected readonly engine = signal<DatabaseEngine>('postgresql');
  protected readonly name = signal('');
  protected readonly host = signal('127.0.0.1');
  protected readonly port = signal(5432);
  protected readonly database = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly readOnly = signal(false);

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
    };
  }
}
