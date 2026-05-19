import { A } from '../constants/admin-permissions';
import type { AuthService } from '../services/auth/auth.service';
import {
  NAV_SECTIONS,
  filterNavItemsByPermission,
  type AppRole,
  type NavItem,
} from './nav.config';

/** Ruta autenticada sin PBAC (perfil / preferencias del usuario). */
export const APP_ACCOUNT_ROUTE = '/app/configuracion';

const DEFAULT_PREFERRED = '/app/dashboard';

export function normalizeAppPath(url: string): string {
  const path = (url || '').split('?')[0].split('#')[0].trim();
  if (!path || path === '/app' || path === '/app/') {
    return DEFAULT_PREFERRED;
  }
  if (!path.startsWith('/app')) {
    return DEFAULT_PREFERRED;
  }
  return path;
}

function passesNavItemRoles(
  item: NavItem,
  role: AppRole | undefined,
): boolean {
  if (!item.roles?.length) {
    return true;
  }
  return !!role && item.roles.includes(role);
}

function passesNavSectionRoles(
  section: (typeof NAV_SECTIONS)[number],
  role: AppRole | undefined,
): boolean {
  if (!section.roles?.length) {
    return true;
  }
  return !!role && section.roles.includes(role);
}

/** Primer ítem del menú lateral al que el usuario puede acceder (misma lógica base que el layout). */
export function findFirstAccessibleNavRoute(auth: AuthService): string | null {
  const role = auth.currentUser()?.role as AppRole | undefined;

  for (const section of NAV_SECTIONS) {
    if (!passesNavSectionRoles(section, role)) {
      continue;
    }

    const roleFiltered = section.items.filter((item) =>
      passesNavItemRoles(item, role),
    );
    const visible = filterNavItemsByPermission(
      roleFiltered,
      (p) => auth.hasPermission(p),
      (p) => auth.hasPermissionAny(p),
    );

    if (visible.length > 0) {
      return visible[0].route;
    }
  }

  return null;
}

/** Comprueba acceso usando rutas del menú (prefijos para detalle/edición). */
export function canAccessAppPath(auth: AuthService, url: string): boolean {
  const path = normalizeAppPath(url);

  if (path === APP_ACCOUNT_ROUTE) {
    return true;
  }

  if (
    path.startsWith('/app/admin/security') &&
    auth.hasRole(['SUPER_ADMIN', 'ADMIN'])
  ) {
    return true;
  }

  if (
    path.startsWith('/app/admin/platform-data') &&
    auth.hasRole(['SUPER_ADMIN'])
  ) {
    return true;
  }

  const role = auth.currentUser()?.role as AppRole | undefined;

  for (const section of NAV_SECTIONS) {
    if (!passesNavSectionRoles(section, role)) {
      continue;
    }

    for (const item of section.items) {
      if (!passesNavItemRoles(item, role)) {
        continue;
      }

      const matches =
        path === item.route || path.startsWith(`${item.route}/`);
      if (!matches) {
        continue;
      }

      const [allowed] = filterNavItemsByPermission(
        [item],
        (p) => auth.hasPermission(p),
        (p) => auth.hasPermissionAny(p),
      );
      return !!allowed;
    }
  }

  return false;
}

/** Destino seguro cuando falla un guard PBAC (evita rebotar al dashboard sin permiso). */
export function resolveAccessDeniedRedirect(
  auth: AuthService,
  failedUrl?: string,
): string {
  const failed = failedUrl ? normalizeAppPath(failedUrl) : '';
  const dashboard = DEFAULT_PREFERRED;

  if (failed !== dashboard && auth.hasPermission(A.DASHBOARD_READ)) {
    return dashboard;
  }

  const firstNav = findFirstAccessibleNavRoute(auth);
  if (firstNav && firstNav !== failed) {
    return firstNav;
  }

  return APP_ACCOUNT_ROUTE;
}

/** URL post-login o landing por defecto (valida returnUrl y dashboard). */
export function resolvePostLoginUrl(
  auth: AuthService,
  preferred?: string,
): string {
  const raw = preferred?.trim();
  const target = normalizeAppPath(raw || DEFAULT_PREFERRED);

  if (canAccessAppPath(auth, target)) {
    return raw && raw.startsWith('/') ? raw : target;
  }

  return resolveAccessDeniedRedirect(auth, target);
}
