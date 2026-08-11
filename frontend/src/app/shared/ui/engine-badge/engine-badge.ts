import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { DatabaseEngine } from '../../models/workspace';

const ENGINE_LABELS: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'PG',
  sqlserver: 'MS',
  mysql: 'MY',
};

const ENGINE_NAMES: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  mysql: 'MySQL',
};

/**
 * Distintivo de dos letras con el color propio de cada motor.
 *
 * Centraliza el color por motor: es lo único del sistema que puede depender del
 * motor en la interfaz, y por eso vive en un solo componente en lugar de
 * repartirse en condicionales por las plantillas (plan §13).
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
      background: rgb(86 140 214 / 16%);
      border: 1px solid rgb(86 140 214 / 34%);
      color: #7faee8;
    }

    :host([data-engine='sqlserver']) {
      background: rgb(217 90 90 / 14%);
      border: 1px solid rgb(217 90 90 / 30%);
      color: #e07a7a;
    }

    :host([data-engine='mysql']) {
      background: rgb(214 164 86 / 13%);
      border: 1px solid rgb(214 164 86 / 30%);
      color: #d9ae6a;
    }
  `,
})
export class EngineBadge {
  readonly engine = input.required<DatabaseEngine>();
  readonly size = input(17);

  protected readonly label = computed(() => ENGINE_LABELS[this.engine()]);
  protected readonly name = computed(() => ENGINE_NAMES[this.engine()]);
}
