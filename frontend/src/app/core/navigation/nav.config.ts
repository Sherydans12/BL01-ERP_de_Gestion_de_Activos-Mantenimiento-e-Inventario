import { P } from '../constants/purchases-permissions';
import { I } from '../constants/inventory-permissions';

/** Roles disponibles en el sistema (deben coincidir con Prisma UserRole). */
export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'MECHANIC' | 'USER';

/** Descripción de cada rol para mostrar en la interfaz. */
export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  MECHANIC: 'Mecánico',
  USER: 'Usuario base',
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  SUPER_ADMIN: 'Acceso total al sistema. Gestiona múltiples tenants.',
  ADMIN: 'Control total sobre el tenant. Gestiona usuarios, contratos y configuración de la empresa.',
  SUPERVISOR: 'Supervisa operaciones: órdenes de trabajo, flota, inventario y pautas de mantenimiento.',
  MECHANIC: 'Opera en terreno: ejecuta órdenes de trabajo asignadas y consulta flota y stock.',
  USER: 'Sin privilegios por defecto. Configure menú y permisos PBAC según el perfil.',
};

/** Filtra ítems de menú según PBAC (tras rutas/roles legacy). */
export function filterNavItemsByPermission(
  items: NavItem[],
  hasPermission: (p: string | string[]) => boolean,
  hasPermissionAny: (p: string | string[]) => boolean,
): NavItem[] {
  return items.filter((item) => {
    if (item.permissionsAny) {
      const any = Array.isArray(item.permissionsAny)
        ? item.permissionsAny
        : [item.permissionsAny];
      return hasPermissionAny(any);
    }
    if (item.permissions) {
      return hasPermission(item.permissions);
    }
    return true;
  });
}

export interface NavItem {
  label: string;
  route: string;
  /** SVG path `d` attribute for the icon (Heroicons outline 24px). */
  icon: string;
  /** Si true, routerLinkActive aplica exact matching. */
  exact?: boolean;
  /**
   * Roles que pueden ver este ítem (permisos por defecto).
   * `undefined` → visible para todos los roles autenticados.
   * Estos defaults se sobreescriben si el tenant tiene `sidebarPermissions` configurados.
   */
  roles?: AppRole[];
  /** PBAC: requiere todos los permisos (AND). Bypass ADMIN / SUPER_ADMIN en `AuthService`. */
  permissions?: string | string[];
  /** PBAC: requiere al menos uno (OR). */
  permissionsAny?: string | string[];
}

export interface NavSection {
  label: string;
  /**
   * Roles que pueden ver toda la sección (permisos por defecto).
   * `undefined` → visible para todos los roles autenticados.
   */
  roles?: AppRole[];
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// SVG icon paths (Heroicons outline 24px)
// ---------------------------------------------------------------------------
const ICONS = {
  home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  truck: 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  cog: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  cube: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  archive: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
  chartBar: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  collection: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  documentText: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  adjustments: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4',
  users: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  shieldCheck: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  calendar: 'M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
};

/**
 * Definición centralizada de la barra de navegación lateral.
 *
 * Matriz de permisos por defecto:
 *
 * Módulo                 | MECHANIC | SUPERVISOR | ADMIN | SUPER_ADMIN
 * ---------------------- | -------- | ---------- | ----- | -----------
 * Dashboard              |    ✓     |     ✓      |   ✓   |      ✓
 * Maestro de Flota       |    ✓     |     ✓      |   ✓   |      ✓
 * Órdenes de Trabajo     |    ✓     |     ✓      |   ✓   |      ✓
 * Config. Pautas (PM)    |    –     |     ✓      |   ✓   |      ✓
 * Catálogo Maestro       |    –     |     ✓      |   ✓   |      ✓
 * Gestión de Bodegas     |    –     |     ✓      |   ✓   |      ✓
 * Control de Stock       |    ✓     |     ✓      |   ✓   |      ✓
 * Catálogos Maestros     |    –     |     –      |   ✓   |      ✓
 * Maestro de Contratos   |    –     |     –      |   ✓   |      ✓
 * Config. Empresa        |    –     |     –      |   ✓   |      ✓
 * Gestión de Usuarios    |    –     |     –      |   ✓   |      ✓
 * Roles y Permisos       |    –     |     –      |   ✓   |      ✓
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Principal',
    items: [
      {
        label: 'Dashboard',
        route: '/app/dashboard',
        icon: ICONS.home,
        exact: true,
      },
      {
        label: 'Mi cuenta',
        route: '/app/configuracion',
        icon: ICONS.adjustments,
      },
      {
        label: 'Seguridad global',
        route: '/app/admin/security',
        icon: ICONS.shieldCheck,
        roles: ['SUPER_ADMIN', 'ADMIN'],
      },
      {
        label: 'Empresas (Tenants)',
        route: '/app/admin/platform-data',
        icon: ICONS.collection,
        roles: ['SUPER_ADMIN'],
      },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { label: 'Maestro de Flota', route: '/app/flota', icon: ICONS.truck },
      {
        label: 'Registro de horómetros',
        route: '/app/flota/registro-horas',
        icon: ICONS.clock,
        roles: ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'],
      },
      { label: 'Órdenes de Trabajo', route: '/app/ots', icon: ICONS.clipboard },
      {
        label: 'Backlog OT',
        route: '/app/ots/backlog',
        icon: ICONS.collection,
      },
      {
        label: 'Confiabilidad OT',
        route: '/app/ots/analytics',
        icon: ICONS.chartBar,
      },
    ],
  },
  {
    label: 'Mantenimiento',
    items: [
      {
        label: 'Config. Pautas (PM)',
        route: '/app/kits',
        icon: ICONS.cog,
        roles: ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'],
      },
    ],
  },
  {
    label: 'Inventario',
    items: [
      {
        label: 'Catálogo Maestro de Artículos',
        route: '/app/articulos',
        icon: ICONS.cube,
        permissions: I.ITEM_READ,
      },
      {
        label: 'Gestión de Bodegas',
        route: '/app/inventario/bodegas',
        icon: ICONS.archive,
        permissions: I.WAREHOUSE_READ,
      },
      {
        label: 'Transferencias entre Bodegas',
        route: '/app/inventario/transferencias',
        icon: ICONS.collection,
        permissions: I.TRANSFER_READ,
      },
      {
        label: 'Configuración de categorías',
        route: '/app/inventario/configuracion',
        icon: ICONS.adjustments,
        permissions: I.CATEGORY_READ,
      },
      {
        label: 'Control de Stock',
        route: '/app/inventario/stock',
        icon: ICONS.chartBar,
        permissions: I.STOCK_READ,
      },
      {
        label: 'Abastecimiento',
        route: '/app/inventario/abastecimiento',
        icon: ICONS.clipboard,
        permissions: I.STOCK_READ,
      },
    ],
  },
  {
    label: 'Compras',
    roles: ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'],
    items: [
      {
        label: 'Requerimientos',
        route: '/app/compras/requerimientos',
        icon: ICONS.documentText,
        permissions: P.REQUISITION_READ,
      },
      {
        label: 'Analítica',
        route: '/app/compras/analytics',
        icon: ICONS.chartBar,
        permissions: P.ANALYTICS_READ,
      },
      {
        label: 'Facturas',
        route: '/app/compras/facturas',
        icon: ICONS.documentText,
        permissions: P.INVOICE_READ,
      },
      {
        label: 'Calendario de Pagos',
        route: '/app/compras/calendario-pagos',
        icon: ICONS.calendar,
        permissions: P.INVOICE_READ,
      },
      {
        label: 'Órdenes de Compra',
        route: '/app/compras/ordenes',
        icon: ICONS.clipboard,
        permissions: P.ORDER_READ,
      },
      {
        label: 'Recepciones',
        route: '/app/compras/recepciones',
        icon: ICONS.archive,
        permissions: P.RECEIPT_READ,
      },
      {
        label: 'Proveedores',
        route: '/app/compras/proveedores',
        icon: ICONS.users,
        roles: ['SUPER_ADMIN', 'ADMIN'],
        permissions: P.VENDOR_READ,
      },
      {
        label: 'Config. Compras',
        route: '/app/compras/configuracion',
        icon: ICONS.cog,
        roles: ['SUPER_ADMIN', 'ADMIN'],
        permissions: P.SETTING_READ,
      },
    ],
  },
  {
    label: 'Configuración',
    roles: ['SUPER_ADMIN', 'ADMIN'],
    items: [
      {
        label: 'Catálogos Maestros',
        route: '/app/catalogos',
        icon: ICONS.collection,
      },
      {
        label: 'Maestro de Contratos',
        route: '/app/configuracion/contratos',
        icon: ICONS.documentText,
        exact: true,
      },
      {
        label: 'Empresa',
        route: '/app/configuracion/empresa',
        icon: ICONS.adjustments,
      },
      {
        label: 'Notificaciones',
        route: '/app/configuracion/notificaciones',
        icon: ICONS.shieldCheck,
        roles: ['SUPER_ADMIN', 'ADMIN'],
      },
    ],
  },
  {
    label: 'Administración',
    roles: ['SUPER_ADMIN', 'ADMIN'],
    items: [
      { label: 'Gestión de Usuarios', route: '/app/usuarios', icon: ICONS.users },
      {
        label: 'Roles y Seguridad',
        route: '/app/configuracion/gobernanza-roles',
        icon: ICONS.shieldCheck,
      },
    ],
  },
];
