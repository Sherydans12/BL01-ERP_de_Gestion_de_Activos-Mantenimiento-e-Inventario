# Matriz de verificación PBAC — TPM / BL01

**Fecha:** 2026-05-24  
**Decisión de producto:** menú lateral derivado **100 % de permisos PBAC** (opción B). La pestaña «Accesos de menú» en gobernanza fue retirada en el sprint Fase 0–1.

**Reglas transversales**

| Regla | Detalle |
|-------|---------|
| Menú | Cada ítem exige su permiso `*:read` (o `platformRoles` solo en rutas de plataforma `/app/admin/*`). |
| API | `PermissionsGuard` + llaves en JWT; bypass solo `ADMIN` / `SUPER_ADMIN`. |
| Contratos | `USER` (y perfiles con `baseRole: USER`) requieren `UserContract`; `ADMIN` tenant-wide. |
| Cambios de rol | Tras editar `TenantRole.permissions`, el usuario debe **cerrar sesión y volver a entrar**. |

---

## Personas de prueba (matriz funcional)

| Persona | `User.role` | `TenantRole` sugerido | Contratos | Permisos clave (mínimo) | Flujos a probar |
|---------|-------------|----------------------|-----------|-------------------------|-----------------|
| **Jefe de Compras** | `USER` | `Jefe de Compras` (custom) | Contrato A (y B opcional) | `purchases:requisition:read`, `create`, `update-purchasing`, `start-quoting`, `manage-quotations`, `award-lines`, `purchases:order:read`, `approve`, `purchases:receipt:read`, `register`, `purchases:invoice:read`, `purchases:analytics:read`, `purchases:document:read` | Menú Compras visible; listar/crear SRC; cotizar y adjudicar; generar OC; aprobar si está en matriz ACL; recepción parcial; ver facturas; dashboard analítica; adjuntos OC/SRC. **Negativo:** quitar `purchases:order:approve` → botón aprobar oculto + `POST approve` → 403. |
| **Operador Bodega** | `USER` | `Operador Bodega` | Contrato A | `inventory:warehouse:read`, `inventory:stock:read`, `inventory:stock:adjust`, `inventory:transfer:read`, `create`, `approve`, `purchases:receipt:read`, `register` | Menú Inventario + Recepciones; stock por bodega; ajuste/conteo; W2W despacho/recepción; confirmar guía. **Negativo:** sin `inventory:stock:adjust` → formulario ajuste solo lectura + `POST transaction` → 403. |
| **Mecánico terreno** | `USER` | `Mecánico` (custom, sustituto futuro de enum `MECHANIC`) | Contrato A | `operations:work-order:read`, `execute`, `close`, `operations:equipment:read`, `inventory:stock:read`, `operations:meter-reading:read`, `create` | Menú OT + Flota + Control stock; ejecutar/cerrar OT asignada; ver flota; lectura stock sin costo (cuando se migre máscara a permiso). **Negativo:** sin `operations:work-order:close` → no puede cerrar OT. |
| **Admin Empresa** | `ADMIN` | (sin custom, o espejo `Sistema · ADMIN`) | Ninguno (tenant-wide) | Bypass PBAC en API/UI | Todo el menú según permisos efectivos del bypass; gestión usuarios, gobernanza, contratos, configuración empresa, compras e inventario completos. **Negativo:** no aplica quitar permisos individuales (bypass). Validar `x-contract-id: ALL` en listados. |

### Checklist por persona (E2E — otro agente / Playwright)

1. Login con credenciales seed.
2. Verificar ítems del sidebar vs matriz (solo rutas con permiso `read`).
3. Abrir formulario principal del módulo → acciones de escritura visibles según permisos.
4. En gobernanza: desactivar **un** permiso crítico → guardar → re-login.
5. Repetir pasos 2–3 (debe fallar en UI y/o API 403).
6. Para `USER`: sin contrato asignado → listados compras/operaciones vacíos (sentinel).

---

## Inventario de deuda técnica — roles `MECHANIC` / `SUPERVISOR`

Resultado de auditoría (`grep` en repo, 2026-05-24). **Próximo sprint:** sustituir por permisos PBAC o `baseRole` de `TenantRole`, no por enum `UserRole`.

### Backend — servicios (Fase 2 aplicada 2026-05-24)

| Archivo | Estado |
|---------|--------|
| `inventory-items.service.ts` | ✅ `inventory:stock:view_cost` |
| `inventory-stock.service.ts` | ✅ `inventory:stock:view_cost` |
| `inventory-adjustment.service.ts` | ✅ `inventory:stock:adjust` |
| `inventory-transfer.service.ts` | ✅ `inventory:transfer:create` |
| `work-orders.service.ts` | ✅ ABAC supervisor de turno + `operations:work-order:update\|assign` |
| `purchase-requisitions.service.ts` | ✅ `purchases:requisition:update-purchasing` |
| `users.service.ts` | ✅ JSON `permissions` + OR transición legacy enum |

### Backend — otros

| Archivo | Uso |
|---------|-----|
| `backend/src/features/tenant-roles/tenant-role-defaults.ts` | Espejos `Sistema · SUPERVISOR` / `MECHANIC` |
| `backend/src/features/auth/totp-policy.ts` | Enum TOTP incluye ambos roles |
| `backend/prisma/schema.prisma` | Enum `UserRole`, defaults `MECHANIC` |
| `backend/prisma/clean-and-bootstrap-tpm-users.ts`, `seed-p2p-test-users.ts` | Seeds legacy |

### Frontend — componentes / servicios

| Archivo | Uso |
|---------|-----|
| `frontend/.../work-order-form.component.ts` | Filtros mecánico/supervisor por rol y `customRole.baseRole` |
| `frontend/.../stock-dashboard.component.ts` | `hasRole(['ADMIN','SUPERVISOR','SUPER_ADMIN'])` |
| `frontend/.../purchase-order-detail.component.ts` | Varias comprobaciones `SUPERVISOR` |
| `frontend/.../requisition-form.component.ts` | `['ADMIN','SUPER_ADMIN','SUPERVISOR']` |
| `frontend/.../requisition-detail.component.ts` | `hasRole(['ADMIN','SUPERVISOR'])` |
| `frontend/.../global-item-picker.component.ts` | `hasRole` con `SUPERVISOR` |
| `frontend/.../work-order-analytics-dashboard.component.ts` | Excluye `SUPERVISOR` |
| `frontend/.../layout.component.html` | Selector contrato visible para `SUPERVISOR` |
| `frontend/.../auth.service.ts` | Tipo JWT y lógica `SUPERVISOR` |
| `frontend/.../user-management.component.ts` | Badges y contratos por `baseRole` |
| `frontend/.../roles.component.ts` | UI legacy roles + `sidebarPermissions` |
| `frontend/.../push-notifications.service.ts` | `APPROVER_ROLES` incluye `SUPERVISOR` |
| `frontend/.../nav.config.ts` | Labels/descripciones enum (hasta deprecar) |
| `frontend/.../role-governance.component.html` | Opciones create `MECHANIC`/`SUPERVISOR` en modal |

### Tests / docs / previews (no bloquean producto)

| Archivo | Notas |
|---------|--------|
| `inventory-stock.service.spec.ts`, `inventory-transfer.service.spec.ts`, `inventory-adjustment.service.spec.ts` | Fixtures `MECHANIC`/`SUPERVISOR` |
| `backend/src/common/email/preview-renderer.ts`, `docs/email-previews/*.html` | Solo previews |

### Controladores — estado post Fase 1

| Controlador | Estado |
|-------------|--------|
| `inventory-analytics.controller.ts` | ✅ Migrado a PBAC |
| `inventory-suppliers.controller.ts` | ✅ Migrado a PBAC |
| `purchase-documents.controller.ts` | ✅ Migrado a PBAC |
| `purchases-analytics.controller.ts` | ✅ Migrado a PBAC |
| `purchase-credit-notes.controller.ts` | ✅ Migrado a PBAC |
| `security-admin.controller.ts` | ⏸️ `@Roles` (plataforma; fuera de alcance sprint) |
| `platform-data-admin.controller.ts` | ⏸️ `@Roles('SUPER_ADMIN')` |

### Permisos nuevos (Fase 1)

| Llave | Uso |
|-------|-----|
| `inventory:supplier:read` | `GET /inventory-suppliers` |
| `inventory:supplier:manage` | `POST` / `DELETE` proveedores inventario |
| `inventory:analytics:read` | Valorización, proveedores, búsqueda global |
| `inventory:analytics:report` | Reporte cierre contable PDF/XLSX, ahorro |

---

## Referencias

- Catálogo maestro: [`docs/RBAC-PERMISSIONS-CATALOG.md`](../RBAC-PERMISSIONS-CATALOG.md)
- Frontend: [`docs/FRONTEND-SECURITY.md`](../FRONTEND-SECURITY.md)
- Decisión contratos + USER: [`decisiones.md`](decisiones.md) (2026-05-19)
