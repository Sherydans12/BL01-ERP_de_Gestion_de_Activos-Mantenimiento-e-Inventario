import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';
import { resolvePostLoginUrl } from '../navigation/app-navigation.util';

/** Redirige `/app` al primer destino accesible (evita asumir dashboard). */
export const appDefaultLandingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return router.parseUrl(resolvePostLoginUrl(auth));
};
