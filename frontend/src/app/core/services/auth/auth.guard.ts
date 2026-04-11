import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // hasValidSession() ya devuelve false en SSR (sin localStorage). Antes se
  // devolvía true aquí y el servidor renderizaba /app/* sin token → 401 en
  // tenant-config, catálogos, OTs, etc.
  if (!authService.hasValidSession()) {
    if (isPlatformBrowser(platformId)) {
      router.navigate(['/auth/login'], {
        queryParams: { returnUrl: state.url },
      });
    }
    return false;
  }

  const expectedRoles = route.data['roles'] as Array<string> | undefined;
  if (expectedRoles?.length) {
    // hasRole ya incluye bypass para SUPER_ADMIN
    if (!authService.hasRole(expectedRoles)) {
      router.navigate(['/app/dashboard']);
      return false;
    }
  }

  return true;
};
