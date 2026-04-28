# Datos plataforma (SUPER_ADMIN)

Herramienta operativa para **vaciar datos por tenant** desde la UI y la API, sin DDL (no crea ni elimina tablas). Pensada para resets de demo, limpieza post-pruebas y soporte; **solo rol `SUPER_ADMIN`**.

## Ubicación en código

| Capa | Ruta |
|------|------|
| Backend módulo Nest | `backend/src/features/platform-data-admin/` |
| Servicio (lógica de purga + resumen) | `platform-data-admin.service.ts` |
| Controlador REST | `platform-data-admin.controller.ts` |
| DTO confirmación | `dto/purge-tenant-domain.dto.ts` |
| Registro en app | `backend/src/app.module.ts` → `PlatformDataAdminModule` |
| Frontend (standalone) | `frontend/src/app/features/admin/platform-data-admin/` |
| Ruta Angular | `/app/admin/platform-data` (`app.routes.ts`) |
| Navegación | `nav.config.ts` — ítem «Datos plataforma», roles `['SUPER_ADMIN']` |

## API (prefijo global `/api`)

Base: **`/api/super-admin/platform`**

Todas las rutas: `JwtAuthGuard` + `RolesGuard` + `@Roles('SUPER_ADMIN')`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/tenants` | Lista empresas (`id`, `code`, `name`, `isActive`). |
| `GET` | `/tenants/:tenantId/data-summary` | Conteos por módulo (compras, inventario, operaciones, plataforma). |
| `POST` | `/tenants/:tenantId/purge/:domain` | Ejecuta purga del dominio (ver tabla abajo). Cuerpo JSON: `{ "confirmTenantCode": "<Tenant.code exacto>" }`. |

Validación del path `:domain`: debe estar en la constante exportada **`PURGE_DOMAINS`** del servicio (el controlador importa la misma lista).

## Dominios de purga (`:domain`)

Cada purga corre en **`$transaction`** donde aplica. El código de confirmación debe coincidir **exactamente** con `Tenant.code` (trim en validación de negocio: se compara `trim()` con el code almacenado).

| `domain` | Contenido principal | Precondiciones / notas |
|----------|----------------------|-------------------------|
| `purchases` | Documentos de compra, facturas proveedor, costos de activo ligados a OC/recepción, recepciones, OC (y cascadas), cotizaciones, requerimientos, proveedores, contadores `SRC`/`OC`/`WR`. | Ninguna. **No** borra `purchase_settings`. |
| `inventory-warehouses` | Movimientos kardex, transferencias, reservas OT, artículos (cascada adjuntos), bodegas (cascada bins), contadores `INV_SKU`/`INV_ITEM_AUTO`. | **Cero** `warehouse_receipts` para el tenant (purga compras antes si aplica). |
| `work-orders` | Todas las OT del tenant; luego `asset_cost_records` con `type = WORK_ORDER`. | Ninguna. |
| `maintenance-kits` | Kits PM y líneas. | Ninguna. |
| `catalog-items` | `catalog_items` del tenant. | **Cero** OT. |
| `fleet-equipment` | Equipos y cascadas (medidor, ajustes, costos de activo del equipo). | **Cero** OT. |
| `activity-logs` | `activity_logs` del tenant (auditoría UI compras / entidades). | Ninguna. |
| `push-subscriptions` | Suscripciones web push del tenant. | Ninguna. |
| `approval-policies` | `approval_policies` por `tenantId`. | `purchase_settings` permanece. |
| `inventory-masters` | Categorías de artículo (borrado iterativo hoja→raíz) y `unit_of_measures`. | **Cero** `inventory_items`. |

### Qué **no** hace este módulo

- No elimina **usuarios**, **contratos**, **subcontratos**, **`tenant_roles`**, **`purchase_settings`** (salvo políticas en dominio dedicado).
- No borra **archivos** en storage por `purchase_documents` / PDFs: solo filas en BD (posibles huérfanos en volumen; GC futuro si se centraliza).
- No implementa purga de **contratos/faenas**: el resumen solo expone **conteos** de `contracts` / `subcontracts` para contexto.

## Orden sugerido (reset “duro” de datos de negocio)

1. `purchases` (libera recepciones y OC).  
2. `inventory-warehouses`.  
3. `work-orders`.  
4. `maintenance-kits`, `catalog-items`, `fleet-equipment` (catálogo y flota requieren 0 OT).  
5. `inventory-masters` (requiere 0 artículos).  
6. Opcional: `activity-logs`, `push-subscriptions`, `approval-policies`.

Ajustar según si se necesita conservar kits/catálogo/flota.

## Escalamiento: añadir un dominio nuevo

1. **Prisma:** revisar `schema.prisma` (FK `onDelete`, orden de borrado, tablas sin `tenantId` pero alcanzables vía join).
2. **Servicio:**  
   - Añadir literal al union type `PurgeDomain` y al array **`PURGE_DOMAINS`**.  
   - En `getTenantDataSummary`, sumar conteos si el resumen debe mostrarlos.  
   - En `purgeDomain`, nuevo `if (domain === '...')` con `$transaction` y `deleteMany` en orden seguro; extraer helpers privados si el bloque crece.
3. **Controlador:** sin cambios si solo se amplía `PURGE_DOMAINS` (ya importa la lista).
4. **Frontend:**  
   - Extender tipo `PurgeDomain` y `PURGE_COPY` en `platform-data-admin.component.ts`.  
   - Añadir botón en `purgeGroups` y, si aplica, filas en el template del resumen.
5. **Tests (recomendado):** e2e o integración con BD de prueba para el nuevo dominio; hoy el módulo no tiene tests dedicados.
6. **Doc:** actualizar esta tabla y la sección de orden sugerido.

## Seguridad y producto

- Exposición solo a **SUPER_ADMIN**; no reutilizar estos endpoints para `ADMIN` de tenant sin replantear el modelo de amenaza.
- La confirmación por **`Tenant.code`** reduce borrados accidentales; no sustituye auditoría enterprise (IP, ticket, segundo factor) si el producto lo exige más adelante.
- Considerar **registro en `activity_logs`** u otro audit trail cuando se ejecute una purga (hoy no se escribe log explícito de “quién purgó qué”).

## Referencias cruzadas

- Multi-tenant y roles: `.cursor/rules/tpm-arquitectura.mdc`, `AGENTS.md`.
- Módulo de seguridad distinto (ADMIN + SUPER_ADMIN): `backend/src/features/security-admin/` (`/api/admin/security`).
