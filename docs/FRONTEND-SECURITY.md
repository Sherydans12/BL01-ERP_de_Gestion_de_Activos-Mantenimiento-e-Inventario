# Seguridad en frontend — PBAC (permisos granulares)

Guía para extender el motor de permisos del TPM en Angular 18. Complementa el catálogo maestro en [`RBAC-PERMISSIONS-CATALOG.md`](RBAC-PERMISSIONS-CATALOG.md) y las reglas de backend en `.cursor/rules/tpm-arquitectura.mdc`.

## Fuente de verdad

| Capa | Ubicación |
|------|-----------|
| Llaves de permiso (enum) | `backend/src/features/auth/constants/permissions.enum.ts` |
| Catálogo UI gobernanza | `backend/src/features/auth/constants/permissions-catalog.ts` |
| Constantes FE Compras | `frontend/src/app/core/constants/purchases-permissions.ts` (`P`, `REQUISITION_EDIT_ANY`) |
| JWT | Campo `permissions: string[]` en el payload; se lee en `AuthService` |

Tras cambiar permisos de un `TenantRole`, el usuario debe **volver a iniciar sesión** para que el JWT refleje los cambios.

## Bypass ADMIN / SUPER_ADMIN

`AuthService.hasPermission` y `hasPermissionAny` devuelven `true` si `user.role` es `ADMIN` o `SUPER_ADMIN`. El mismo criterio aplica en backend (`PermissionsGuard`). La UI no debe asumir que un rol custom sin permisos explícitos tiene capacidades de admin.

## API del cliente

```typescript
// AND — todos los permisos requeridos
auth.hasPermission('purchases:order:read');
auth.hasPermission([P.ORDER_APPROVE, P.ORDER_READ]); // poco habitual en FE

// OR — al menos uno
auth.hasPermissionAny([P.REQUISITION_UPDATE_OWN, P.REQUISITION_UPDATE_PURCHASING]);
```

Signals reactivos: `userPermissions` (computed) y `currentUser`; la directiva re-renderiza al cambiar.

## Directivas estructurales

Importar en el `imports` del componente standalone:

```typescript
import {
  HasPermissionDirective,
  HasAnyPermissionDirective,
} from '../../../shared/directives/has-permission.directive';
```

| Directiva | Lógica | Ejemplo |
|-----------|--------|---------|
| `*appHasPermission` | AND | `*appHasPermission="p.REQUISITION_CREATE"` |
| `*appHasAnyPermission` | OR | `*appHasAnyPermission="requisitionEditPerms"` |

Convención en plantillas: exponer `protected readonly p = P` en el `.ts` del componente.

Combinar con reglas de negocio existentes (`@if (canSubmit())`) **además** del permiso PBAC: el permiso autoriza la acción; `canSubmit` valida estado del documento.

## Formularios en solo lectura (sin permiso de escritura)

Los formularios de Compras usan `ngModel` + signals (no `FormGroup` reactivo). Equivalente a `form.disable()`:

1. `isFormReadOnly` (computed) desde `AuthService.hasPermission` / `hasPermissionAny`.
2. `<fieldset [disabled]="isFormReadOnly()">` alrededor de los controles editables.
3. Aviso visual (banner ámbar) cuando `isFormReadOnly()` es true.
4. Guards en métodos TS (`save`, `addPolicy`, etc.) por si el DOM se manipula.
5. Botones de mutación ocultos con `*appHasPermission` o `@if (!isFormReadOnly())`.

Aplicado en: configuración de compras, proveedores, requerimientos, factura desde OC, logística en detalle de OC, cantidades en recepción.

## Guard de rutas

```typescript
import { permissionGuard } from './core/guards/permission.guard';
import { P, REQUISITION_EDIT_ANY } from './core/constants/purchases-permissions';

{
  path: 'compras/requerimientos',
  canActivate: [permissionGuard],
  data: { permissions: P.REQUISITION_READ },
  loadComponent: () => import('...'),
},
{
  path: 'compras/requerimientos/:id/edit',
  canActivate: [permissionGuard],
  data: { permissionsAny: [...REQUISITION_EDIT_ANY] },
  loadComponent: () => import('...'),
},
```

- `data.permissions` → AND (alineado al backend `@RequirePermissions`).
- `data.permissionsAny` → OR (p. ej. edición de SRC con varios permisos de update).
- Sin permiso: redirección a `/app/dashboard`.
- El layout `app` ya usa `authGuard`; `permissionGuard` es adicional por ruta.

## Menú lateral (nav)

En `nav.config.ts`, cada ítem de Compras define `permissions` (lectura del módulo/recurso). `layout.component.ts` → `filteredNav` aplica `filterNavItemsByPermission` **después** del filtro por rol custom / `sidebarPermissions` / roles por defecto.

## Checklist al añadir un flujo nuevo

1. Llave en `permissions.enum.ts` + fila en `RBAC-PERMISSIONS-CATALOG.md`.
2. `@RequirePermissions` en el controlador Nest.
3. Entrada en `permissions-catalog.ts` (panel gobernanza).
4. Constante en `purchases-permissions.ts` (u otro módulo cuando exista).
5. Ruta con `permissionGuard` + `data.permissions` / `permissionsAny`.
6. Ítem de menú con `permissions` si aplica.
7. Botones/CTAs con `*appHasPermission` / `*appHasAnyPermission`.
8. No confiar solo en ocultar UI: el backend sigue siendo la autoridad.

## Módulo Compras (referencia rápida)

Cobertura aplicada en:

- Rutas: bloque `compras/*` en `app.routes.ts`.
- Nav: sección Compras en `nav.config.ts`.
- Vistas: listados y detalle de requerimientos, OC, recepciones, facturas, proveedores, configuración; formularios asociados.
- Adjuntos: `PurchaseDocumentsPanelComponent` usa `purchases:document:manage`.

Ver inventario detallado de llaves en [`RBAC-PERMISSIONS-CATALOG.md`](RBAC-PERMISSIONS-CATALOG.md).
