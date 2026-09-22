import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { prepareLocale } from './app/core/i18n/i18n.service';
import { applyAppearance, cachedAppearance } from './app/core/theme/theme.service';

// El aspecto se pone antes de arrancar Angular, y no dentro de un componente:
// para cuando el primer componente existe, la ventana ya se ha pintado una vez,
// y esa vez sería siempre con la paleta de partida. La CSP de la aplicación de
// escritorio prohíbe los scripts en línea, así que este es el punto más temprano
// disponible.
applyAppearance(cachedAppearance());

// El idioma, por lo mismo: se decide y se carga su catálogo antes de arrancar,
// o la primera pantalla saldría en español y saltaría al elegido medio segundo
// después.
prepareLocale()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
