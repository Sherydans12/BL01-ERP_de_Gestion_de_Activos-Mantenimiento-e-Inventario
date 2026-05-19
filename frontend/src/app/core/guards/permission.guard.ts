import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';
import { resolveAccessDeniedRedirect } from '../navigation/app-navigation.util';

/**
 * Guard de rutas por permiso PBAC.
 * - `data.permissions`: string o string[] (AND).
 * - `data.permissionsAny`: string o string[] (OR).
 * Si falla, redirige a un destino seguro (no siempre al dashboard).
 */
export const permissionGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const requiredAny = route.data['permissionsAny'] as
    | string
    | string[]
    | undefined;
  const requiredAll = route.data['permissions'] as string | string[] | undefined;

  const allowed =
    (requiredAny === undefined || requiredAny === null
      ? true
      : auth.hasPermissionAny(requiredAny)) &&
    (requiredAll === undefined ||
      requiredAll === null ||
      auth.hasPermission(requiredAll));

  if (allowed) {
    return true;
  }

  const fallback = resolveAccessDeniedRedirect(auth, state.url);
  if (fallback === state.url) {
    return router.parseUrl('/app/configuracion');
  }
  return router.parseUrl(fallback);
};
