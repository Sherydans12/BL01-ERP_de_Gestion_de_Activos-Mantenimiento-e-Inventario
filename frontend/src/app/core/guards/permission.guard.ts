import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

/**
 * Guard de rutas por permiso PBAC.
 * - `data.permissions`: string o string[] (AND).
 * - `data.permissionsAny`: string o string[] (OR).
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const requiredAny = route.data['permissionsAny'] as string | string[] | undefined;
  const requiredAll = route.data['permissions'] as string | string[] | undefined;

  if (requiredAny !== undefined && requiredAny !== null) {
    if (!auth.hasPermissionAny(requiredAny)) {
      void router.navigate(['/app/dashboard']);
      return false;
    }
    return true;
  }

  if (requiredAll === undefined || requiredAll === null) {
    return true;
  }

  if (auth.hasPermission(requiredAll)) {
    return true;
  }

  void router.navigate(['/app/dashboard']);
  return false;
};
