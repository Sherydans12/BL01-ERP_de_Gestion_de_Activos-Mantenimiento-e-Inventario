import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { NotificationService } from '../services/notification/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notificationService = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
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
