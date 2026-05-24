# Matriz de verificación PBAC — TPM / BL01

**Fecha:** 2026-05-24 (Fase 3 — roles legacy eliminados)  
**Decisión de producto:** menú lateral derivado **100 % de permisos PBAC** (opción B). La pestaña «Accesos de menú» en gobernanza fue retirada en el sprint Fase 0–1.

**Reglas transversales**

| Regla | Detalle |
|-------|---------|
| Menú | Cada ítem exige su permiso `*:read` (o `platformRoles` solo en rutas de plataforma `/app/admin/*`). |
| API | `PermissionsGuard` + llaves en JWT; bypass solo `ADMIN` / `SUPER_ADMIN`. |
| Contratos | `USER` (y perfiles con `baseRole: USER`) requieren `UserContract`; `ADMIN` tenant-wide. |
| Cambios de rol | Tras editar `TenantRole.permissions`, el usuario debe **cerrar sesión y volver a entrar**. |
| Enum `UserRole` | Solo `SUPER_ADMIN`, `ADMIN`, `USER` (migración `20260524120000_remove_legacy_roles`). |

---

## Personas de prueba (matriz funcional)

| Persona | `User.role` | `TenantRole` sugerido | Contratos | Permisos clave (mínimo) | Flujos a probar |
|---------|-------------|----------------------|-----------|-------------------------|-----------------|
| **Jefe de Compras** | `USER` | `Jefe de Compras` (custom) | Contrato A (y B opcional) | `purchases:requisition:read`, `create`, `update-purchasing`, `start-quoting`, `manage-quotations`, `award-lines`, `purchases:order:read`, `approve`, `purchases:receipt:read`, `register`, `purchases:invoice:read`, `purchases:analytics:read`, `purchases:document:read` | Menú Compras visible; listar/crear SRC; cotizar y adjudicar; generar OC; aprobar si está en matriz ACL; recepción parcial; ver facturas; dashboard analítica; adjuntos OC/SRC. **Negativo:** quitar `purchases:order:approve` → botón aprobar oculto + `POST approve` → 403. |
| **Operador Bodega** | `USER` | `Operador Bodega` | Contrato A | `inventory:warehouse:read`, `inventory:stock:read`, `inventory:stock:adjust`, `inventory:transfer:read`, `create`, `approve`, `purchases:receipt:read`, `register` | Menú Inventario + Recepciones; stock por bodega; ajuste/conteo; W2W despacho/recepción; confirmar guía. **Negativo:** sin `inventory:stock:adjust` → formulario ajuste solo lectura + `POST transaction` → 403. |
| **Mecánico terreno** | `USER` | `Mecánico` (custom) | Contrato A | `operations:work-order:read`, `execute`, `close`, `operations:equipment:read`, `inventory:stock:read`, `operations:meter-reading:read`, `create` | Menú OT + Flota + Control stock; ejecutar/cerrar OT asignada; ver flota; lectura stock sin costo sin `inventory:stock:view_cost`. **Negativo:** sin `operations:work-order:close` → no puede cerrar OT. |
| **Admin Empresa** | `ADMIN` | (sin custom, o espejo `Sistema · ADMIN`) | Ninguno (tenant-wide) | Bypass PBAC en API/UI | Todo el menú según permisos efectivos del bypass; gestión usuarios, gobernanza, contratos, configuración empresa, compras e inventario completos. **Negativo:** no aplica quitar permisos individuales (bypass). Validar `x-contract-id: ALL` en listados. |

### Checklist por persona (E2E — otro agente / Playwright)

1. Login con credenciales seed.
2. Verificar ítems del sidebar vs matriz (solo rutas con permiso `read`).
3. Abrir formulario principal del módulo → acciones de escritura visibles según permisos.
4. En gobernanza: desactivar **un** permiso crítico → guardar → re-login.
5. Repetir pasos 2–3 (debe fallar en UI y/o API 403).
6. Para `USER`: sin contrato asignado → listados compras/operaciones vacíos (sentinel).

---

## Fases PBAC — estado (2026-05-24)

| Fase | Alcance | Estado |
|------|---------|--------|
| **0–1** | Menú 100 % PBAC; controladores compras/inventario analytics/suppliers/documents/credit-notes | ✅ |
| **2** | Costos (`view_cost`), ajustes, W2W, SRC compras, ABAC OT; UI sin `hasRole` legacy | ✅ |
| **3** | Enum `UserRole` sin `MECHANIC`/`SUPERVISOR`; migración datos; espejos tenant solo ADMIN+USER (+ SUPER_ADMIN en seed) | ✅ |

### Backend — servicios (post Fase 2–3)

| Archivo | Permiso / regla |
|---------|-----------------|
| `inventory-items.service.ts` | `inventory:stock:view_cost` |
| `inventory-stock.service.ts` | `inventory:stock:view_cost` |
| `inventory-adjustment.service.ts` | `inventory:stock:adjust` |
| `inventory-transfer.service.ts` | `inventory:transfer:create` + alcance contrato |
| `work-orders.service.ts` | ABAC supervisor de turno + `operations:work-order:update\|assign` |
| `purchase-requisitions.service.ts` | `purchases:requisition:update-purchasing` |
| `users.service.ts` | `findAssignableForOt` solo JSON `permissions` (OT execute/assign/update) |
| `tenant-role-defaults.ts` | Espejos `Sistema · ADMIN` / `Sistema · USER`; `ensureSuperAdminMirrorRole` en seed |

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

### Permisos nuevos (Fase 1–2)

| Llave | Uso |
|-------|-----|
| `inventory:supplier:read` / `manage` | Proveedores inventario |
| `inventory:analytics:read` / `report` | Valorización, reportes |
| `inventory:stock:view_cost` | Ver CPP / costos en kardex y stock |
| `inventory:stock:adjust` | Ajustes y conteos |
| `inventory:transfer:create` | Despacho W2W |
| `purchases:requisition:update-purchasing` | Editar SRC en estados de compras |

### Residuos documentales (no código producto)

- `docs/email-previews/*.html` — textos de ejemplo con roles antiguos (solo previews estáticos).
- `report.service.ts` — etiqueta PDF «FIRMA SUPERVISOR / JEFE TALLER» (texto operativo, no enum).

---

## Referencias

- Catálogo maestro: [`docs/RBAC-PERMISSIONS-CATALOG.md`](../RBAC-PERMISSIONS-CATALOG.md)
- Frontend: [`docs/FRONTEND-SECURITY.md`](../FRONTEND-SECURITY.md)
- Decisión contratos + USER: [`decisiones.md`](decisiones.md) (2026-05-19)
- Suite dominio: [`pruebas-unitarias.md`](pruebas-unitarias.md) — **282 tests** (`test:domain`)
