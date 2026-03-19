import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    // Check role if required
    const expectedRoles = route.data['roles'] as Array<string>;
    if (expectedRoles && !authService.hasRole(expectedRoles)) {
      router.navigate(['/']); // Redirect to home if no permissions
      return false;
    }
    return true;
  }

  // Not logged in
  router.navigate(['/auth/login']);
  return false;
};
