import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
// 1. Asegúrate de importar withFetch
import {
  provideHttpClient,
  withInterceptors,
  withFetch,
} from '@angular/common/http';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { authInterceptor } from './core/services/auth/auth.interceptor';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Service Worker / Web Push: en producción el origen debe servirse por HTTPS (excepción: localhost).
    // Sin HTTPS el SW no se registra de forma fiable en la mayoría de navegadores.
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.serviceWorker,
      registrationStrategy: 'registerWhenStable:30000',
    }),
    // 2. Agregamos withFetch() aquí
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor, errorInterceptor]),
    ),
  ],
};
