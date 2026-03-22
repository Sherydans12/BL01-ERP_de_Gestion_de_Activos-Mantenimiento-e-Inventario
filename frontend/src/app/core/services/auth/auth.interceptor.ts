import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();
  const siteId = authService.currentSiteId();

  if (token) {
    let headers = req.headers.set('Authorization', `Bearer ${token}`);

    if (siteId && siteId !== 'ALL') {
      headers = headers.set('x-site-id', siteId);
    }

    const cloned = req.clone({ headers });
    return next(cloned);
  }

  return next(req);
};
