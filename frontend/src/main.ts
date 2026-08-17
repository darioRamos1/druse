import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { applyTheme, cachedTheme } from './app/core/theme/theme.service';

// El tema se pone antes de arrancar Angular, y no dentro de un componente: para
// cuando el primer componente existe, la ventana ya se ha pintado una vez, y esa
// vez sería siempre oscura. La CSP de la aplicación de escritorio prohíbe los
// scripts en línea, así que este es el punto más temprano disponible.
applyTheme(cachedTheme());

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
