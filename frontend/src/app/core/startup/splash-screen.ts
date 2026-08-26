import { Injectable } from '@angular/core';

/** El elemento que `index.html` deja pintado antes de que Angular exista. */
const SPLASH_ID = 'druse-splash';

/** La clase que dispara el desvanecido. La transición está en `index.html`. */
const LEAVING_CLASS = 'is-leaving';

/** Lo mismo que dura la transición de salida, para retirar el elemento después. */
const FADE_MS = 260;

/**
 * Lo mínimo que la pantalla se deja ver, contado desde que abrió la ventana.
 *
 * Con la API local ya caliente, el arranque puede resolverse en menos de cien
 * milisegundos: sin este suelo, la pantalla aparecería y se iría en el mismo
 * parpadeo, que se lee como un defecto y no como una transición.
 */
const MINIMUM_VISIBLE_MS = 450;

/**
 * Cuánto se espera como mucho antes de retirarla por las malas.
 *
 * El arranque puede quedarse a medias —la API local no levanta, una lectura no
 * vuelve— y entonces nadie llamaría a `dismiss`. Es preferible una interfaz a
 * medio poblar, donde el usuario ve el error y puede reintentar, que una
 * pantalla de carga eterna delante de una aplicación que no va a arrancar.
 */
const SAFETY_MS = 12_000;

/**
 * Retira la pantalla de carga cuando la aplicación termina de arrancar.
 *
 * La pantalla no la pinta Angular: está en `index.html` porque tiene que existir
 * antes que el paquete de la aplicación. Lo único que ocurre aquí es el final de
 * su vida, y ocurre en un servicio y no en el componente que arranca porque
 * quien decide cuándo hay algo que enseñar —el shell, al terminar sus lecturas—
 * no tiene por qué saber cómo se desvanece un elemento que no es suyo.
 *
 * Si el elemento no está en el documento —las pruebas de componentes, o un
 * `index.html` que no lo traiga— todo lo de aquí es inofensivo: no hay nada que
 * retirar y no se arma ningún temporizador.
 */
@Injectable({ providedIn: 'root' })
export class SplashScreen {
  private readonly _element = document.getElementById(SPLASH_ID);

  private _safety: ReturnType<typeof setTimeout> | null = null;
  private _dismissed = false;

  constructor() {
    if (!this._element) {
      return;
    }

    this._safety = setTimeout(() => this.dismiss(), SAFETY_MS);
  }

  /** `true` mientras la pantalla siga delante de la aplicación. */
  get visible(): boolean {
    return !!this._element && !this._dismissed;
  }

  /**
   * Da el arranque por terminado y quita la pantalla.
   *
   * Llamarlo dos veces no hace nada la segunda: el arranque puede darse por
   * bueno por varios caminos —las lecturas terminan, o vence el plazo— y el
   * primero que llegue es el que manda.
   */
  dismiss(): void {
    if (!this._element || this._dismissed) {
      return;
    }

    this._dismissed = true;

    if (this._safety !== null) {
      clearTimeout(this._safety);
      this._safety = null;
    }

    // `performance.now()` cuenta desde que empezó la navegación, que es justo
    // cuando la pantalla se pintó: no hace falta apuntar el momento aparte.
    const shown = Math.max(0, MINIMUM_VISIBLE_MS - performance.now());

    setTimeout(() => this.fadeOut(), shown);
  }

  private fadeOut(): void {
    const element = this._element;

    if (!element) {
      return;
    }

    element.classList.add(LEAVING_CLASS);

    // Se quita del documento en vez de dejarlo transparente: invisible seguiría
    // siendo un elemento a pantalla completa por encima de todo lo demás.
    setTimeout(() => element.remove(), FADE_MS);
  }
}
