import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { ApplicationGateway } from './core/application-gateway/application-gateway';
import { HttpApplicationGateway } from './core/application-gateway/http-application-gateway';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    // El transporte se elige aquí y en ningún otro sitio: cambiar HTTP por IPC
    // en la Fase 7 debe ser un cambio de una línea.
    { provide: ApplicationGateway, useClass: HttpApplicationGateway },
  ],
};
