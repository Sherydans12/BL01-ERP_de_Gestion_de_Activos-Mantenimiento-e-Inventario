import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { NotificationService } from '../services/notification/notification.service';
import { AuthService } from '../services/auth/auth.service';

/** Rutas de autenticación pública: 401 aquí no significa “sesión inválida”. */
function isPublicAuthRequest(url: string): boolean {
  return /\/auth\/(login|activate|forgot-password|reset-password)(\/|$|\?)/.test(
    url,
  );
}

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isPublicAuthRequest(req.url)) {
        authService.forceLogout();
        return throwError(() => error);
      }

      // Las rutas públicas de auth manejan su propia notificación en el servicio/componente.
      // No mostrar toast genérico aquí para evitar duplicados.
      if (isPublicAuthRequest(req.url)) {
        return throwError(() => error);
      }

      let errorMessage = 'Ocurrió un error inesperado.';

      if (error.error && typeof error.error.message === 'string') {
        // Validation errors form NestJS (BadRequestException, etc)
        errorMessage = error.error.message;
      } else if (error.error && Array.isArray(error.error.message)) {
        // Class Validator array errors
        errorMessage = error.error.message.join(', ');
      } else if (error.status === 0) {
        errorMessage =
          'No se pudo conectar con el servidor. Verifica tu conexión.';
      } else {
        errorMessage = `Error del Servidor (${error.status}): ${error.message}`;
      }

      notificationService.error(errorMessage, 6000);

      return throwError(() => error);
    }),
  );
};
