import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { DatabaseEngine } from '../../models/workspace';

const ENGINE_LABELS: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'PG',
  sqlserver: 'MS',
  mysql: 'MY',
  informix: 'IX',
  informixsqli: 'IX',
};

const ENGINE_NAMES: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  mysql: 'MySQL',
  informix: 'Informix',
  informixsqli: 'Informix (SQLI)',
};

/**
 * Distintivo de dos letras con el color propio de cada motor.
 *
 * Centraliza el color por motor: es lo único del sistema que puede depender del
 * motor en la interfaz, y por eso vive en un solo componente en lugar de
 * repartirse en condicionales por las plantillas (plan §13). El color concreto
 * lo pone el tema —`--dr-engine-*`—, porque los tonos que funcionan sobre negro
 * no son los mismos que funcionan sobre blanco.
 */
@Component({
  selector: 'app-engine-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '{{ label() }}',
  host: {
    '[attr.data-engine]': 'engine()',
    '[attr.title]': 'name()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      border-radius: 5px;
      font-family: var(--dr-font-mono);
      font-size: 9.5px;
      font-weight: 700;
      line-height: 1;
    }

    :host([data-engine='postgresql']) {
      background: var(--dr-engine-postgresql-tint);
      border: 1px solid var(--dr-engine-postgresql-line);
      color: var(--dr-engine-postgresql);
    }

    :host([data-engine='sqlserver']) {
      background: var(--dr-engine-sqlserver-tint);
      border: 1px solid var(--dr-engine-sqlserver-line);
      color: var(--dr-engine-sqlserver);
    }

    :host([data-engine='mysql']) {
      background: var(--dr-engine-mysql-tint);
      border: 1px solid var(--dr-engine-mysql-line);
      color: var(--dr-engine-mysql);
    }

    :host([data-engine='informix']) {
      background: var(--dr-engine-informix-tint);
      border: 1px solid var(--dr-engine-informix-line);
      color: var(--dr-engine-informix);
    }
  `,
})
export class EngineBadge {
  readonly engine = input.required<DatabaseEngine>();
  readonly size = input(17);

  protected readonly label = computed(() => ENGINE_LABELS[this.engine()]);
  protected readonly name = computed(() => ENGINE_NAMES[this.engine()]);
}
