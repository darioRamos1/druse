import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { DatabaseEngine } from '../../models/workspace';

const ENGINE_LABELS: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'PG',
  sqlserver: 'MS',
  mysql: 'MY',
  informix: 'IX',
  informixsqli: 'IX',
  oracle: 'OR',
  sqlite: 'SL',
};

/**
 * Cómo se llama cada motor cuando hay que escribirlo entero.
 *
 * Se exporta porque **es la única lista**: la barra de estado lo escribía por su
 * cuenta con un condicional de tres ramas y todo lo que no fuera PostgreSQL o SQL
 * Server acababa llamándose «MySQL», Informix incluido.
 */
export const ENGINE_NAMES: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'PostgreSQL',
  sqlserver: 'SQL Server',
  mysql: 'MySQL',
  informix: 'Informix (DRDA)',
  informixsqli: 'Informix',
  oracle: 'Oracle',
  sqlite: 'SQLite',
};

/**
 * Versiones que se anuncian de cada motor.
 *
 * Es texto de la interfaz, no un dato del servidor, y por eso vive aquí y no
 * viaja por la API: cuál es la versión mínima soportada se decide al probarla,
 * no lo sabe el proveedor.
 *
 * Está declarado como registro exhaustivo a propósito. Junto a los otros dos de
 * este archivo y a los colores del tema, es lo que hace que **un motor nuevo no
 * compile hasta que alguien decida cómo se dibuja**, en lugar de aparecer en el
 * formulario sin nombre, sin color y sin versiones.
 */
export const ENGINE_VERSIONS: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: '12 – 18',
  sqlserver: '2016 – 2022',
  mysql: '8.0+ · MariaDB',
  informix: '12.10+ · protocolo DRDA',
  informixsqli: '12.10+',
  oracle: '12c – 23ai',
  sqlite: '3.16+ · archivo local',
};

/**
 * A qué producto pertenece cada motor.
 *
 * Casi siempre a sí mismo. La excepción es Informix, que son **dos motores para
 * un solo producto**: DRDA y SQLI cambian por dónde se entra y nada más. El
 * formulario ofrece una tarjeta por familia, porque quien elige motor está
 * eligiendo base de datos, no protocolo.
 */
export const ENGINE_FAMILIES: Readonly<Record<DatabaseEngine, string>> = {
  postgresql: 'postgresql',
  sqlserver: 'sqlserver',
  mysql: 'mysql',
  informix: 'informix',
  informixsqli: 'informix',
  oracle: 'oracle',
  sqlite: 'sqlite',
};

/**
 * Cómo se llama el camino de cada motor, cuando su familia tiene más de uno.
 *
 * `null` en los motores que son el único camino a su producto: ahí no hay nada
 * que preguntar y el formulario no enseña la elección.
 */
export const ENGINE_TRANSPORTS: Readonly<Record<DatabaseEngine, string | null>> = {
  postgresql: null,
  sqlserver: null,
  mysql: null,
  informix: 'DRDA',
  informixsqli: 'SQLI (JDBC)',
  oracle: null,
  sqlite: null,
};

/**
 * Orden en el que se ofrecen los motores.
 *
 * La API los devuelve alfabéticamente, que no es el orden en el que la gente los
 * busca. Lo que no esté aquí va al final, en el orden que llegara: un motor
 * nuevo se ve aunque nadie se acuerde de colocarlo.
 */
export const ENGINE_ORDER: readonly DatabaseEngine[] = [
  'sqlserver',
  'postgresql',
  'mysql',
  'informixsqli',
  'informix',
  'oracle',
  'sqlite',
];

/**
 * Si la interfaz sabe dibujar este motor.
 *
 * La lista de motores la manda la API, así que puede traer uno que este
 * navegador no conozca —una compilación del servidor más nueva que la del
 * paquete—. Enseñarlo daría una tarjeta sin nombre, sin color y sin distintivo;
 * es mejor no ofrecerlo que ofrecerlo roto.
 */
export function isKnownEngine(engine: string): engine is DatabaseEngine {
  return engine in ENGINE_NAMES;
}

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

    :host([data-engine='informix']),
    :host([data-engine='informixsqli']) {
      background: var(--dr-engine-informix-tint);
      border: 1px solid var(--dr-engine-informix-line);
      color: var(--dr-engine-informix);
    }

    :host([data-engine='oracle']) {
      background: var(--dr-engine-oracle-tint);
      border: 1px solid var(--dr-engine-oracle-line);
      color: var(--dr-engine-oracle);
    }

    :host([data-engine='sqlite']) {
      background: var(--dr-engine-sqlite-tint);
      border: 1px solid var(--dr-engine-sqlite-line);
      color: var(--dr-engine-sqlite);
    }
  `,
})
export class EngineBadge {
  readonly engine = input.required<DatabaseEngine>();
  readonly size = input(17);

  protected readonly label = computed(() => ENGINE_LABELS[this.engine()]);
  protected readonly name = computed(() => ENGINE_NAMES[this.engine()]);
}
