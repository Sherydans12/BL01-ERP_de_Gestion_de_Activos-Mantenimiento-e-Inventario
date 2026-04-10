import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  if (!authService.hasValidSession()) {
    router.navigate(['/auth/login'], {
      queryParams: { returnUrl: state.url },
    });
    return false;
  }

  const expectedRoles = route.data['roles'] as Array<string> | undefined;
  if (expectedRoles?.length && !authService.hasRole(expectedRoles)) {
    router.navigate(['/app/dashboard']);
    return false;
  }

  return true;
};
