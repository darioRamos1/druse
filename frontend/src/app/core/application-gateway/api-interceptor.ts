import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';

import { DesktopHost } from './desktop-host';
import { UpdateService } from '../update/update.service';

/**
 * Dirige las llamadas a la API y les añade el token cuando hace falta.
 *
 * En desarrollo no toca nada: las rutas relativas las resuelve el proxy del
 * servidor de Angular, que además inyecta la cabecera. Dentro del envoltorio de
 * escritorio no hay proxy, así que aquí se antepone el host real y se añade el
 * token que Tauri obtuvo de la API.
 *
 * Es el único sitio del frontend que conoce esta diferencia; ni el gateway ni
 * los componentes saben si están en un navegador o en una ventana de escritorio.
 */
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) {
    return next(request);
  }

  if (inject(UpdateService).blocksDatabaseOperations()) {
    return throwError(
      () => new Error('Druse se está actualizando y no puede iniciar una operación nueva.'),
    );
  }

  const { baseUrl, token } = inject(DesktopHost).connection();

  if (!baseUrl && !token) {
    return next(request);
  }

  return next(
    request.clone({
      url: baseUrl ? `${baseUrl}${request.url}` : request.url,
      setHeaders: token ? { 'X-Druse-Token': token } : {},
    }),
  );
};
