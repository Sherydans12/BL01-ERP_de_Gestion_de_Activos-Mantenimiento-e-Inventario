# Catálogo maestro de permisos (PBAC) — TPM / BL01

Documento de referencia para definir capacidades granulares en `TenantRole.permissions`, el enum `SystemPermissions` (`backend/src/features/auth/constants/permissions.enum.ts`) y los decoradores `@RequirePermissions` en controladores NestJS.

> **Estado del motor:** JWT + `PermissionsGuard` implementados. La columna *Estado* indica si la llave ya existe en `permissions.enum.ts` y está aplicada en controladores.

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

## Módulo: Inventario (`inventory`)

### Artículos — catálogo maestro (`item`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `inventory:item:read` | `GET /api/inventory-items`<br>`GET /api/inventory-items/search`<br>`GET /api/inventory-items/picker`<br>`GET /api/inventory-items/next-inventory-code`<br>`GET /api/inventory-items/:id`<br>`GET /api/inventory-items/:id/ledger`<br>`GET /api/inventory-items/:id/label`<br>`GET /api/inventory-items/:id/attachments` | Consultar catálogo, buscar, picker global, ficha, kardex por ítem, etiqueta PDF y listado de adjuntos. |
| ✅ | `inventory:item:create` | `POST /api/inventory-items`<br>`POST /api/inventory-items/quick-create` | Alta de artículo (formulario completo o creación rápida desde picker/OT). |
| ✅ | `inventory:item:update` | `PUT /api/inventory-items/:id`<br>`POST /api/inventory-items/:id/attachments`<br>`DELETE /api/inventory-items/:id/attachments/:attachmentId` | Editar ficha del artículo y gestionar adjuntos. |
| ✅ | `inventory:item:delete` | `DELETE /api/inventory-items/:id` | Desactivar o eliminar artículo del catálogo (según reglas del servicio). |

---

### Bodegas (`warehouse`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `inventory:warehouse:read` | `GET /api/warehouses`<br>`GET /api/warehouses/:id`<br>`GET /api/warehouses/:warehouseId/bins`<br>`GET /api/warehouses/:warehouseId/bins/:binId` | Listar bodegas, detalle y ubicaciones (bins) por almacén. |
| ✅ | `inventory:warehouse:manage` | `POST /api/warehouses`<br>`PUT /api/warehouses/:id`<br>`DELETE /api/warehouses/:id`<br>`POST /api/warehouses/:warehouseId/bins`<br>`PUT /api/warehouses/:warehouseId/bins/:binId`<br>`DELETE /api/warehouses/:warehouseId/bins/:binId` | Crear, editar y desactivar bodegas y sus ubicaciones internas. |

---

### Categorías / familias (`category`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `inventory:category:read` | `GET /api/item-categories`<br>`GET /api/item-categories/families`<br>`GET /api/item-categories/children/:parentId`<br>`GET /api/item-categories/:id` | Consultar jerarquía de familias, subfamilias y categorías. |
| ✅ | `inventory:category:manage` | `POST /api/item-categories`<br>`PUT /api/item-categories/:id`<br>`DELETE /api/item-categories/:id` | Crear, editar y eliminar nodos de la taxonomía de ítems. |

---

### Transferencias W2W (`transfer`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `inventory:transfer:read` | `GET /api/inventory-transfers`<br>`GET /api/inventory-transfers/:id` | Ver listado y detalle de traslados entre bodegas. |
| ✅ | `inventory:transfer:create` | `POST /api/inventory-transfers` | Solicitar y despachar traslado W2W desde bodega origen. |
| ✅ | `inventory:transfer:approve` | `POST /api/inventory-transfers/:id/receive` | Confirmar recepción en bodega destino (movimiento `TRANSFER_IN` al kardex). |

---

### Stock y ajustes (`stock`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `inventory:stock:read` | `GET /api/inventory-stock/supply-alerts`<br>`GET /api/inventory-stock/inventory-record-accuracy`<br>`GET /api/inventory-stock/pending`<br>`GET /api/inventory-stock/pending/count`<br>`GET /api/inventory-stock/warehouse/:warehouseId`<br>`GET /api/inventory-stock/warehouse/:warehouseId/transactions`<br>`GET /api/inventory-stock/warehouse/:warehouseId/item/:itemId/stock-position`<br>`GET /api/inventory-stock/warehouse/:warehouseId/item/:itemId/reservations`<br>`GET /api/inventory-stock/warehouse/:warehouseId/pending-regularization`<br>`GET /api/inventory-stock/warehouse/:warehouseId/physical-count-sheet/pdf` | Consultar saldos, kardex por bodega, alertas de abastecimiento, reservas OT y reportes operativos de stock. |
| ✅ | `inventory:stock:adjust` | `POST /api/inventory-stock/transaction`<br>`POST /api/inventory-stock/return`<br>`PUT /api/inventory-stock/warehouse/:warehouseId/item/:itemId/levels`<br>`POST /api/inventory-adjustments` | Movimientos manuales de stock, devoluciones vinculadas a OT, políticas min/max por bodega y ajustes de inventario físico (kardex). |

> **PBAC inventario (proveedores / analítica):** `inventory:supplier:read|manage`, `inventory:analytics:read|report` — migrados en sprint 2026-05-24 (Fase 1).

---

## Matriz resumida — Inventario (checklist sprint)

### Artículos

- [x] Ver → `inventory:item:read`
- [x] Crear → `inventory:item:create`
- [x] Editar → `inventory:item:update`
- [x] Desactivar → `inventory:item:delete`

### Bodegas

- [x] Ver → `inventory:warehouse:read`
- [x] Gestionar → `inventory:warehouse:manage`

### Categorías

- [x] Ver → `inventory:category:read`
- [x] Gestionar → `inventory:category:manage`

### Transferencias W2W

- [x] Ver → `inventory:transfer:read`
- [x] Crear → `inventory:transfer:create`
- [x] Confirmar recepción → `inventory:transfer:approve`

### Stock / ajustes

- [x] Ver → `inventory:stock:read`
- [x] Ajustar → `inventory:stock:adjust`

---

## Módulo: Operaciones (`operations`)

### Flota y equipos (`equipment`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:equipment:read` | `GET /api/equipments`<br>`GET /api/equipments/:id`<br>`GET /api/equipments/:id/analytics` | Listar flota, consultar ficha y analytics del activo. |
| ✅ | `operations:equipment:create` | `POST /api/equipments` | Alta de equipo en el maestro de flota. |
| ✅ | `operations:equipment:update` | `PUT /api/equipments/:id` | Editar datos operativos, documentación y atributos del activo. |
| ✅ | `operations:equipment:delete` | `DELETE /api/equipments/:id` | Desactivar o dar de baja un equipo (según reglas del servicio). |

---

### Órdenes de trabajo (`work-order`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:work-order:read` | `GET /api/work-orders`<br>`GET /api/work-orders/stats`<br>`GET /api/work-orders/:id`<br>`GET /api/work-order-analytics/dashboard`<br>`GET /api/work-order-analytics/projected-services` | Ver listados, detalle, KPIs y analítica operativa de OTs. |
| ✅ | `operations:work-order:create` | `POST /api/work-orders` | Crear una nueva orden de trabajo. |
| ✅ | `operations:work-order:update` | `PATCH /api/work-orders/:id` (cabecera/planificación)<br>`GET /api/work-order-analytics/report/monthly/pdf` | Editar planificación, clasificación y reportes de gestión. |
| ✅ | `operations:work-order:assign` | `PATCH /api/work-orders/:id` (`participantUserIds`, `shiftSupervisorUserId`, …) | Asignar personal y responsables en la OT (ABAC en servicio). |
| ✅ | `operations:work-order:execute` | `PATCH /api/work-orders/:id` (consumos, tareas, horas)<br>`PATCH /api/work-orders/:id/status` (transiciones ≠ `CLOSED`) | Ejecutar la OT: repuestos, fluidos, horómetros y cambios de estado operativo. |
| ✅ | `operations:work-order:close` | `PATCH /api/work-orders/:id/status` (`status: CLOSED`) | Cierre técnico/documental con validación de detención y movimiento de stock. |

> El endpoint `PATCH /api/work-orders/:id` admite **UPDATE**, **ASSIGN** o **EXECUTE** (OR en guard). El servicio mantiene ABAC (mecánico asignado, contrato, estado del documento).

---

### Horómetros (`meter-reading`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:meter-reading:read` | `GET /api/equipments/meter-capture-board`<br>`GET /api/equipments/:id/meter-snapshot`<br>`GET /api/meter-adjustments?equipmentId=` | Consultar tablero de captura, snapshot e historial de ajustes/lecturas. |
| ✅ | `operations:meter-reading:create` | `POST /api/equipments/meter-readings/bulk-sync`<br>`POST /api/meter-adjustments` | Registro masivo de lecturas y ajustes justificados de horómetro. |

---

### Pautas de mantenimiento (`maintenance`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:maintenance:read` | `GET /api/maintenance-kits`<br>`GET /api/maintenance-kits/:id` | Consultar kits / pautas PM por marca/modelo. |
| ✅ | `operations:maintenance:manage` | `POST /api/maintenance-kits`<br>`PUT /api/maintenance-kits/:id`<br>`DELETE /api/maintenance-kits/:id` | Crear, editar y eliminar pautas de mantenimiento. |

---

### Backlog de OT (`backlog`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:backlog:read` | `GET /api/work-orders/backlog` | Listar ítems de backlog por contrato/estado. |
| ✅ | `operations:backlog:manage` | `POST /api/work-orders/:id/backlog`<br>`PATCH /api/work-orders/:id/backlog/:itemId`<br>`POST /api/work-orders/:id/backlog/:itemId/promote` | Agregar, marcar hecho y promover ítems de backlog. |

---

## Matriz resumida — Operaciones (checklist sprint)

### Equipos

- [x] Ver → `operations:equipment:read`
- [x] Crear → `operations:equipment:create`
- [x] Editar → `operations:equipment:update`
- [x] Desactivar → `operations:equipment:delete`

### Órdenes de trabajo

- [x] Ver → `operations:work-order:read`
- [x] Crear → `operations:work-order:create`
- [x] Editar planificación → `operations:work-order:update`
- [x] Asignar personal → `operations:work-order:assign`
- [x] Ejecutar → `operations:work-order:execute`
- [x] Cerrar → `operations:work-order:close`

### Horómetros

- [x] Ver → `operations:meter-reading:read`
- [x] Registrar → `operations:meter-reading:create`

### Pautas PM

- [x] Ver → `operations:maintenance:read`
- [x] Gestionar → `operations:maintenance:manage`

### Backlog

- [x] Ver → `operations:backlog:read`
- [x] Gestionar → `operations:backlog:manage`

> **Cobertura frontend:** ✅ (2026-05-19) — `operations-permissions.ts`, `nav.config.ts`, `app.routes.ts`, `*appHasPermission` en flota, OT, horómetros, backlog y kits.

---

## Cobertura frontend (Inventario)

Desde el cierre PBAC Inventario (2026-05-19), **15 llaves** con paridad backend + UI:

| Área | Backend | Frontend |
|------|:-------:|:--------:|
| Artículos (`item`) | ✅ `inventory-items.controller.ts` | ✅ listado, ficha (`isFormReadOnly`), rutas `articulos/*` |
| Bodegas (`warehouse`) | ✅ `warehouses.controller.ts`, `warehouse-bins` | ✅ listado, formulario |
| Categorías (`category`) | ✅ `item-categories.controller.ts` | ✅ `inventory-settings` |
| Transferencias W2W (`transfer`) | ✅ `inventory-transfer.controller.ts` | ✅ listado, despacho, confirmar recepción |
| Stock / ajustes (`stock`) | ✅ `inventory-stock`, `inventory-adjustment` | ✅ `stock-dashboard`, movimientos |

Patrones UI: `nav.config.ts` (`permissions: I.*`), `permissionGuard` en `app.routes.ts`, `*appHasPermission` en CTAs y acciones de fila (links inline, sin menú de tres puntos), `GlobalItemPicker` quick-add condicionado a `inventory:item:create` + `allowQuickAdd`.

Constantes espejo: [`frontend/src/app/core/constants/inventory-permissions.ts`](../frontend/src/app/core/constants/inventory-permissions.ts). Detalle: [`docs/FRONTEND-SECURITY.md`](FRONTEND-SECURITY.md) § Inventario.

> **Fuera de alcance:** `inventory-suppliers`, `inventory-analytics` — siguen `@Roles` legacy.

---

### Reporte de consumo de lubricantes (`lube-report`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:lube-report:read` | `GET /api/lube-reports`<br>`GET /api/lube-reports/:id` | Consultar historial de despachos de aceites/grasas (reservado para implementación futura). |
| ✅ | `operations:lube-report:create` | `POST /api/lube-reports` | Registrar un despacho de lubricante: descuenta stock físico de la bodega origen (fija o virtual/camión), actualiza horómetro del equipo (opcional) e inyecta el movimiento `OUT / LUBE_DISPATCH` en el kardex inmutable. Genera `AssetCostRecord` tipo `LUBE_DISPATCH` para imputar el costo directo al activo. |

> **Multi-tenant y ABAC en servicio:** el `tenantId` es extraído exclusivamente del JWT. El servicio valida que la bodega origen pertenece al tenant y al `contractId` del DTO — un usuario del tenant A no puede despachar desde bodega del tenant B aunque envíe su UUID en el payload.

---

### Disponibilidad operativa diaria (`availability`)

> **Módulo:** `EquipmentAvailabilityModule` — Tabla `equipment_availabilities`. Permite registrar el estado de cada equipo por turno (Día/Noche) y detectar equipos sin reporte en el turno activo.

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `operations:availability:read` | `GET /api/equipment-availability`<br>`GET /api/equipment-availability/:id` | Consultar el historial de reportes de disponibilidad. Disponible para supervisores y administradores; el scope de datos se limita a los contratos del JWT. |
| ✅ | `operations:availability:create` | `POST /api/equipment-availability` | Registrar el estado de un equipo para el turno actual (Operativo, Standby, Reserva sin operador, Detenido por Falla, Detenido por Mantención). Si `meterReading` supera el `currentMeter` del equipo, actualiza el horómetro con `source = AVAILABILITY_REPORT`. Restricción única `(tenantId, equipmentId, reportDate, shift)` — un equipo no puede tener dos reportes para el mismo turno. |
| ✅ | `operations:availability:monitor` | `GET /api/equipment-availability/unreported`<br>`GET /api/equipment-availability/summary` | Acceder al panel de alerta de omisiones: lista los equipos activos del Maestro de Flota que **no tienen reporte** en el turno/fecha consultados. Solo roles gerenciales (Jefe de turno, Admin). |

> **Roles por defecto sugeridos:**
> - `MECHANIC` / Supervisor de turno: `read` + `create`
> - `SUPERVISOR` / Jefe de turno: `read` + `create` + `monitor`
> - `ADMIN`: todos los permisos del grupo
>
> **Regla anti-limbo:** el endpoint `unreported` cruza el Maestro de Flota (`equipments WHERE isOperational = true`) con los registros de `equipment_availabilities` para el turno solicitado. Equipos ya fuera de servicio por OT activa (`isOperational = false`) no generan alerta de omisión.

---

## Módulo: Administración (`admin`)

### Usuarios (`user`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `admin:user:read` | `GET /api/users`<br>`GET /api/users/search-suggestions` | Listar y buscar usuarios del tenant. |
| ✅ | `admin:user:create` | `POST /api/users` | Invitar / crear usuarios. |
| ✅ | `admin:user:update` | `PATCH /api/users/:id`<br>`POST /api/users/:id/resend-activation`<br>`POST /api/users/:id/set-password` | Editar datos, reenviar invitación y restablecer contraseña. |
| ✅ | `admin:user:delete` | `DELETE /api/users/:id` | Eliminar usuarios del tenant. |
| ✅ | `admin:user:manage-roles` | `GET/POST/PATCH/DELETE /api/tenant-roles/*`<br>`GET /api/tenant-roles/permissions-catalog` | Gobernanza de roles PBAC y asignación de roles personalizados. |

> **Autogestión:** rutas `GET/PUT /api/users/me`, `profile`, `change-password`, TOTP y avatar no exigen permisos `admin:*` (solo JWT).

> **Operativo:** `GET /api/users/assignable-for-ot` permanece con JWT (participantes en OT).

### Configuración tenant / empresa (`tenant-config`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `admin:tenant-config:read` | Ruta FE `/app/configuracion/empresa` | Acceder a la pantalla de configuración de empresa (lectura). |
| ✅ | `admin:tenant-config:update` | `PATCH /api/tenant-config`<br>`POST /api/tenant-config/logo*`, `pdf-logo` | Modificar datos y logos. |

> **Shell:** `GET /api/tenant-config` queda con **solo JWT** (branding en layout para todos los autenticados).

### Contratos (`contract`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `admin:contract:read` | Ruta FE `/app/configuracion/contratos` | Maestro de contratos (lectura). |
| ✅ | `admin:contract:manage` | `POST/PUT/DELETE /api/contracts/*`<br>`POST/PUT/DELETE /api/subcontracts/*` | Crear, editar y eliminar contratos y subcontratos. |

> **Shell:** `GET /api/contracts` queda con **solo JWT** (selector de contrato en header; filtrado por `allowedContracts` en cliente).

### Notificaciones (`notification`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `admin:notification:read` | `GET /api/notification-settings/tenant`<br>`GET /api/notification-settings/user`<br>`GET /api/notification-settings/event` | Consultar matriz y suscriptores. |
| ✅ | `admin:notification:manage-settings` | `PUT /api/notification-settings/tenant`<br>`PUT /api/notification-settings/user` (otros usuarios) | Configurar opt-in/CC global y preferencias delegadas. |

> **Autogestión:** `PUT /api/notification-settings/user` sin `targetUserId` (propias preferencias) no exige `manage-settings`.

---

### Registro de fallas — correctivo imprevisto (`fault-report`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| 🔲 | `operations:fault-report:read` | `GET /api/fault-reports`<br>`GET /api/fault-reports/:id` | Listar y consultar detalle de eventos de falla. Filtrables por criticidad, sistema afectado y estado. |
| 🔲 | `operations:fault-report:create` | `POST /api/fault-reports` | Registrar una falla en terreno. Criticidad ALTA → crea OT `NO_PROGRAMADA_REACTIVA` + `isOperational = false`. Criticidad MEDIA → crea OT `NO_PROGRAMADA_CORRECTIVA`. Criticidad BAJA → solo registra el reporte. |
| 🔲 | `operations:fault-report:manage` | `POST /api/fault-reports/:id/create-work-order`<br>`PATCH /api/fault-reports/:id/close` | Gestión por planificador: convertir falla BAJA en OT manualmente o cerrarla sin intervención. |

> **Regla de negocio clave:** La OT generada automáticamente usa `initialRequestDescription` ← `symptomDescription` del reporte, `category = NO_PROGRAMADA_REACTIVA | NO_PROGRAMADA_CORRECTIVA`, `maintenanceType = CORRECTIVO`, `status = OPEN`. La trazabilidad es bidireccional: `FaultReport.workOrderId` y `WorkOrder.faultReport`.

> **Horómetro:** Si `meterAtFault > equipment.currentMeter`, se llama a `applyCurrentMeterChange` con `source = FAULT_REPORT` dentro de la misma transacción.

---

## Módulo: Principal (`core`)

### Dashboard (`dashboard`)

| Estado | Llave del permiso | Acción en el API | Descripción de negocio |
|:------:|-------------------|------------------|-------------------------|
| ✅ | `core:dashboard:read` | Ruta FE `/app/dashboard` | Acceder a la vista principal del ERP. |

> **Cobertura frontend:** ✅ (2026-05-19) — `admin-permissions.ts`, `nav.config.ts`, `app.routes.ts`, `*appHasPermission` en usuarios, empresa, contratos, notificaciones y gobernanza de roles.

Constantes espejo: [`frontend/src/app/core/constants/admin-permissions.ts`](../frontend/src/app/core/constants/admin-permissions.ts).

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
