# Catálogo maestro de permisos (PBAC) — TPM / BL01

Documento de referencia para definir capacidades granulares en `TenantRole.permissions`, el enum `SystemPermissions` (`backend/src/features/auth/constants/permissions.enum.ts`) y los decoradores `@RequirePermissions` en controladores NestJS.

> **Estado del motor:** JWT + `PermissionsGuard` implementados. Este catálogo describe el **objetivo** del próximo sprint; la columna *Estado* indica si la llave ya existe en código.

---

## Convención de nombres

Todas las llaves siguen el patrón estricto:

```text
modulo:recurso:accion
```

| Segmento | Regla | Ejemplo (Compras) |
|----------|--------|-------------------|
| **módulo** | Dominio funcional del ERP | `purchases` |
| **recurso** | Entidad o agregado REST | `requisition`, `order`, `receipt`, `invoice` |
| **acción** | Verbo en infinitivo, `kebab-case` si es compuesto | `create`, `start-quoting`, `mark-paid` |

**Prefijo API:** todas las rutas REST viven bajo `/api` (véase `main.ts`).

**Convivencia con roles legacy:** mientras dure la migración, `@Roles('ADMIN', …)` y PBAC pueden coexistir en el mismo controlador. El guard PBAC exige **todos** los permisos listados (AND). `SUPER_ADMIN` y `ADMIN` hacen bypass del `PermissionsGuard` (aislamiento por tenant en servicios).

**Reglas ABAC (servicio):** varios flujos mantienen validación por **estado del documento** y **propiedad** (p. ej. solo el solicitante edita un borrador). El permiso PBAC autoriza *intentar* la operación; el servicio sigue rechazando transiciones inválidas.

---

## Módulo: Compras (`purchases`)

### Requerimientos de compra (`requisition`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:requisition:read` | `GET /api/purchase-requisitions`<br>`GET /api/purchase-requisitions/:id`<br>`GET /api/purchase-requisitions/:id/pdf`<br>`GET /api/purchase-requisitions/:id/logs` | Ver listados, detalle, PDF e historial de auditoría de requerimientos dentro del alcance de contratos del usuario. |
| 🔲 | `purchases:requisition:create` | `POST /api/purchase-requisitions` | Crear un requerimiento de compra en estado **borrador** (`DRAFT`) con líneas e ítems iniciales. |
| 🔲 | `purchases:requisition:update-own` | `PATCH /api/purchase-requisitions/:id` | Editar contenido del requerimiento en **borrador** siendo **solicitante** (owner) o administrador de tenant; incluye ítems, prioridad y datos generales. No aplica en fases de cotización. |
| 🔲 | `purchases:requisition:update-purchasing` | `PATCH /api/purchase-requisitions/:id` | Editar requerimiento en nombre de **compras** cuando el estado es `QUOTING`, `PENDING_APPROVAL` o `PARTIALLY_PURCHASED` (ajuste de líneas, cantidades, catálogo). Reemplaza la comprobación actual por rol `ADMIN`/`SUPERVISOR`. |
| 🔲 | `purchases:requisition:update-asset-link` | `PATCH /api/purchase-requisitions/:id` (campos `workOrderId` / `equipmentId`) | Vincular o corregir OT/equipo en estados `DRAFT` o `SUBMITTED`; solo solicitante o admin (regla ABAC actual en servicio). |
| 🔲 | `purchases:requisition:submit` | `POST /api/purchase-requisitions/:id/submit` | Enviar el requerimiento: pasa de borrador a **enviado** (`SUBMITTED`) para revisión/compras. |
| 🔲 | `purchases:requisition:cancel` | `POST /api/purchase-requisitions/:id/cancel` | Cancelar un requerimiento activo (motivo opcional); hoy restringido a `ADMIN`/`SUPERVISOR`/`SUPER_ADMIN`. |
| 🔲 | `purchases:requisition:start-quoting` | `POST /api/purchase-requisitions/:id/start-quoting` | Iniciar fase de **cotización** (`QUOTING`): compras toma el requerimiento para gestionar proveedores. |
| 🔲 | `purchases:requisition:manage-quotations` | `POST /api/purchase-requisitions/:id/quotations`<br>`POST /api/purchase-requisitions/:id/quotations/:qId/select` | Registrar cotizaciones de proveedores (con adjunto) y seleccionar cotización ganadora a nivel cabecera. |
| 🔲 | `purchases:requisition:award-lines` | `POST /api/purchase-requisitions/:id/line-awards` | **Adjudicar líneas** del requerimiento (asignar proveedor/cantidad/precio por ítem) antes de generar la OC. |

#### Permisos complementarios — requerimientos (API existente)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:requisition:duplicate` | `POST /api/purchase-requisitions/:id/duplicate` | Duplicar un requerimiento como plantilla en borrador. |

---

### Órdenes de compra (`order`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:order:read` | `GET /api/purchase-orders`<br>`GET /api/purchase-orders/:id`<br>`GET /api/purchase-orders/:id/pdf`<br>`GET /api/purchase-orders/:id/logs`<br>`GET /api/purchase-orders/eligible-for-receipt` | Ver OC, PDF, historial y listado de OCs elegibles para recepción. |
| 🔲 | `purchases:order:create-from-requisition` | `POST /api/purchase-orders/from-requisition/:requisitionId` | Generar una **orden de compra** a partir de un requerimiento adjudicado. |
| 🔲 | `purchases:order:create-from-quotation` | `POST /api/purchase-orders` (`body.quotationId`) | Crear OC directamente desde una cotización seleccionada. |
| 🔲 | `purchases:order:approve` | `POST /api/purchase-orders/:id/approve` | **Aprobar** la OC en el flujo de firmas (nivel de política / monto según `ApprovalPolicy`). |
| 🔲 | `purchases:order:send-to-supplier` | `POST /api/purchase-orders/:id/sent-to-supplier` | Marcar la OC como **enviada al proveedor** (orden formal emitida). |
| 🔲 | `purchases:order:cancel` | `POST /api/purchase-orders/:id/cancel` | Cancelar una OC antes de su cierre total (motivo opcional). |
| 🔲 | `purchases:order:force-close` | `POST /api/purchase-orders/:id/force-close` | **Forzar cierre** de OC con recepciones/facturas pendientes (motivo obligatorio); cierra guías de recepción abiertas asociadas. |

#### Permisos complementarios — órdenes de compra (API existente)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:order:reject` | `POST /api/purchase-orders/:id/reject` | Rechazar OC en flujo de aprobación (devuelve a estado revisable). |
| 🔲 | `purchases:order:reset-draft` | `POST /api/purchase-orders/:id/reset` | Revertir OC a borrador (operación sensible, hoy solo `ADMIN`/`SUPER_ADMIN`). |
| 🔲 | `purchases:order:update-logistics` | `PATCH /api/purchase-orders/:id/logistics` | Actualizar dirección de entrega y condiciones de pago logísticas. |
| 🔲 | `purchases:order:update-sensitive` | `PATCH /api/purchase-orders/:id/sensitive` | Modificar montos, proveedor o líneas en estados permitidos (control financiero). |
| 🔲 | `purchases:order:link-catalog` | `PATCH /api/purchase-orders/:id/items/:itemId/link-catalog` | Vincular línea de OC sin catálogo a un `InventoryItem` existente o nuevo. |

---

### Recepciones de bodega (`receipt`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:receipt:read` | `GET /api/warehouse-receipts`<br>`GET /api/warehouse-receipts/:id`<br>`GET /api/warehouse-receipts/:id/logs` | Ver guías de recepción, detalle e historial de movimientos/auditoría. |
| 🔲 | `purchases:receipt:create` | `POST /api/warehouse-receipts` | Abrir una **nueva guía** de recepción contra una OC y bodega destino (`purchaseOrderId`, `warehouseId`). |
| 🔲 | `purchases:receipt:register` | `PATCH /api/warehouse-receipts/:id/items`<br>`POST /api/warehouse-receipts/:id/confirm` | **Registrar recepción en bodega**: capturar cantidades (parcial o total) y **confirmar** para mover stock al kardex (delta `quantityReceived − quantityConfirmed`). |

> Una misma capacidad `register` cubre edición de ítems y confirmación; si en el futuro se separan roles “captura” vs “confirma”, dividir en `purchases:receipt:update-items` y `purchases:receipt:confirm`.

---

### Facturas y conciliación financiera (`invoice`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:invoice:read` | `GET /api/purchase-invoices`<br>`GET /api/purchase-invoices/:id`<br>`GET /api/purchase-invoices/payment-calendar` | Ver facturas, detalle y calendario de vencimientos de pago por contrato. |
| 🔲 | `purchases:invoice:create` | `POST /api/purchase-invoices` | **Cargar / registrar** factura de proveedor (PDF, montos, OC asociada, proveedor). |
| 🔲 | `purchases:invoice:update` | `PATCH /api/purchase-invoices/:id` | Corregir datos de factura no pagada (montos, fechas, reemplazo de PDF). |
| 🔲 | `purchases:invoice:validate` | `POST /api/purchase-invoices/:id/validate` | Ejecutar **validación 3-Way Match** (OC ↔ recepción ↔ factura) y actualizar estado de conciliación. |
| 🔲 | `purchases:invoice:overrule` | `POST /api/purchase-invoices/:id/three-way-match/overrule` | **Autorizar discrepancias** del 3-way match (short shipment, tolerancias excedidas). Hoy además exige flag de usuario `canOverruleThreeWayMatch` o `SUPER_ADMIN`; el permiso PBAC reemplazará/acompañará ese flag. |
| 🔲 | `purchases:invoice:mark-paid` | `POST /api/purchase-invoices/:id/mark-paid`<br>`POST /api/purchase-invoices/:id/pay` | Marcar factura como **pagada** (simple o con referencia y `paidAt`). |

#### Permisos complementarios — facturas (API existente)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:invoice:delete` | `DELETE /api/purchase-invoices/:id` | Eliminar factura no pagada (auditoría previa en servicio). |
| 🔲 | `purchases:credit-note:manage` | `GET /api/purchase-credit-notes`<br>`POST /api/purchase-credit-notes`<br>`DELETE /api/purchase-credit-notes/:id` | Gestionar notas de crédito de una OC y re-disparar 3-way match. |

---

### Configuraciones y proveedores (`setting` / `vendor`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:setting:read` | `GET /api/purchase-settings`<br>`GET /api/purchase-settings/policies` | Ver parámetros de compras del tenant (umbrales, moneda, tolerancia de match) y matriz de **políticas de aprobación**. |
| 🔲 | `purchases:setting:update` | `PUT /api/purchase-settings`<br>`PUT /api/purchase-settings/policies` | Modificar configuración P2P y niveles de firma (`minAmount`, usuarios por nivel). |
| 🔲 | `purchases:vendor:read` | `GET /api/vendors`<br>`GET /api/vendors/:id` | Consultar maestro de proveedores (activos/inactivos según query). |
| 🔲 | `purchases:vendor:create` | `POST /api/vendors` | Alta de proveedor en el catálogo del tenant. |
| 🔲 | `purchases:vendor:update` | `PATCH /api/vendors/:id` | Editar datos del proveedor. |
| 🔲 | `purchases:vendor:delete` | `DELETE /api/vendors/:id` | Desactivar/eliminar proveedor (según reglas del servicio). |

#### Permisos complementarios — transversal compras

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `purchases:document:read` | `GET /api/purchase-documents`<br>`GET /api/purchase-documents/:id/file` | Listar y descargar adjuntos P2P (OC, SRC, factura, etc.). |
| 🔲 | `purchases:document:manage` | `POST /api/purchase-documents`<br>`DELETE /api/purchase-documents/:id` | Subir y eliminar documentos adjuntos en entidades de compras. |
| 🔲 | `purchases:analytics:read` | `GET /api/purchases/analytics/dashboard`<br>`GET /api/purchases/analytics/report/pdf` | Ver tablero y reportes PDF de compras. |

---

## Matriz resumida — casos de uso obligatorios (checklist sprint)

Marca cada fila al migrar `permissions.enum.ts` + controlador.

### Requerimientos

- [x] Ver → `purchases:requisition:read`
- [x] Crear → `purchases:requisition:create`
- [x] Editar (owner) → `purchases:requisition:update-own`
- [x] Editar (compras) → `purchases:requisition:update-purchasing`
- [x] Enviar → `purchases:requisition:submit`
- [x] Cancelar → `purchases:requisition:cancel`
- [x] Iniciar cotización → `purchases:requisition:start-quoting`
- [x] Adjudicar líneas → `purchases:requisition:award-lines`

### Órdenes de compra

- [x] Ver → `purchases:order:read` (PoC: `purchase-orders.controller.ts`)
- [x] Crear desde requerimiento → `purchases:order:create-from-requisition`
- [x] Aprobar flujo → `purchases:order:approve`
- [x] Enviar a proveedor → `purchases:order:send-to-supplier`
- [x] Cancelar → `purchases:order:cancel`
- [x] Forzar cierre → `purchases:order:force-close`

### Recepciones

- [x] Ver → `purchases:receipt:read`
- [x] Registrar recepción → `purchases:receipt:register` (+ `purchases:receipt:create`)

### Facturas

- [x] Ver → `purchases:invoice:read`
- [x] Cargar factura → `purchases:invoice:create`
- [x] Validar 3-Way Match → `purchases:invoice:validate`
- [x] Autorizar discrepancias → `purchases:invoice:overrule`
- [x] Marcar como pagada → `purchases:invoice:mark-paid`

### Configuración / proveedores

- [x] Configuración compras → `purchases:setting:read` / `purchases:setting:update`
- [x] Proveedores → `purchases:vendor:read` / `create` / `update` / `delete`

---

## Llaves legacy en código (deprecar)

| Llave actual en `permissions.enum.ts` | Reemplazo propuesto |
|---------------------------------------|---------------------|
| `purchases:quote` | `purchases:requisition:manage-quotations` + `purchases:requisition:start-quoting` |
| `purchases:approve` | `purchases:order:approve` |

---

## Próximos módulos (plantilla)

Al extender el catálogo, duplicar la misma estructura de tablas con prefijos:

| Módulo | Prefijo | Recursos previstos |
|--------|---------|-------------------|
| Inventario | `inventory:` | `item`, `stock`, `transfer`, `adjustment`, … |
| Operaciones / EAM | `operations:` | `equipment`, `work-order`, `pm-kit`, … |

---

## Cobertura frontend (Compras)

Desde la auditoría PBAC UI (2026-05-19), el módulo Compras aplica:

- Menú lateral: `permissions` por ítem en `nav.config.ts` + `filterNavItemsByPermission` en `layout.component.ts`.
- Rutas: `permissionGuard` en todas las rutas `app/compras/*` (`app.routes.ts`).
- CTAs: `*appHasPermission` / `*appHasAnyPermission` en listados, detalle y formularios; panel de adjuntos con `purchases:document:manage`.

Guía de implementación para nuevos módulos: [`docs/FRONTEND-SECURITY.md`](FRONTEND-SECURITY.md).

Llaves del checklist anterior tienen paridad FE cuando el flujo expone botón o ruta dedicada (p. ej. `duplicate`, `reject`, `reset-draft`, `link-catalog`, `credit-note` solo vía API hasta que exista pantalla).

## Referencias

- Infraestructura PBAC: `backend/src/features/auth/guards/permissions.guard.ts`, `decorators/permissions.decorator.ts`
- Frontend PBAC: [`docs/FRONTEND-SECURITY.md`](FRONTEND-SECURITY.md)
- Flujos de negocio P2P: [`docs/PURCHASE-FLOWS.md`](PURCHASE-FLOWS.md)
- Gobernanza de firmas: [`docs/PURCHASE-GOVERNANCE.md`](PURCHASE-GOVERNANCE.md)
- Decisiones de diseño: [`docs/agentes/decisiones.md`](agentes/decisiones.md)

**Leyenda estado:** 🔲 pendiente de implementar en enum + guards · ✅ implementado
