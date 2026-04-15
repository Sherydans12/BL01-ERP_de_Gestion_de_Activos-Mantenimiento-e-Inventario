import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();
  const contractId = authService.currentContractId();

  let headers = req.headers;

  if (token) {
    headers = headers.set('Authorization', `Bearer ${token}`);
  }

  /** No sobrescribir si el caller fijó ya el contrato (p. ej. formulario con contrato distinto al contexto global). */
  if (
    !headers.has('x-contract-id') &&
    contractId &&
    contractId !== 'ALL'
  ) {
    headers = headers.set('x-contract-id', contractId);
  }

  const cloned = req.clone({ headers });
  return next(cloned);
};
