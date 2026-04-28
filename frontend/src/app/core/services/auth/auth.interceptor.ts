import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';
import { TenantService } from '../tenant/tenant.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const tenantService = inject(TenantService);
  const token = authService.getToken();
  const contractId = authService.currentContractId();

  let headers = req.headers;

  if (token) {
    headers = headers.set('Authorization', `Bearer ${token}`);
  }

  const tenantId = tenantService.getTenantId();
  if (tenantId && !headers.has('x-tenant-id')) {
    headers = headers.set('x-tenant-id', tenantId);
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
