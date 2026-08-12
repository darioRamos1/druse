import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { apiInterceptor } from './core/application-gateway/api-interceptor';
import { ApplicationGateway } from './core/application-gateway/application-gateway';
import { DesktopHost } from './core/application-gateway/desktop-host';
import { HttpApplicationGateway } from './core/application-gateway/http-application-gateway';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),

    // El transporte se elige aquí y en ningún otro sitio.
    { provide: ApplicationGateway, useClass: HttpApplicationGateway },

    // Dentro del envoltorio de escritorio hay que preguntarle a Tauri en qué
    // puerto quedó la API y con qué token. Se hace antes de arrancar para que
    // la primera petición ya salga bien dirigida.
    provideAppInitializer(() => inject(DesktopHost).initialize()),
  ],
};
