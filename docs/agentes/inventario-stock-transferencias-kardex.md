# Inventario: artículos, stock por bodega, ajustes, transferencias W2W y kardex

Guía de **dominio y rutas de código** para agentes que toquen maestro de artículos, movimientos de stock, kardex o transferencias entre bodegas. Complementa `tpm-arquitectura.mdc` (tenant/site) y el esquema en `backend/prisma/schema.prisma`.

## Modelos Prisma relevantes

| Modelo | Rol breve |
|--------|-----------|
| `InventoryItem` | Maestro de artículo por tenant (`tenantId`). Categoría, UoM, `inventoryCode`, `partNumber` (opcional), `qrCode`, flags seriado/consumible, etc. |
| `Warehouse` | Bodega ligada a contrato (`contractId`); stock y movimientos se filtran por bodega. |
| `ItemStock` | Saldo **físico** por par (`warehouseId`, `itemId`) único; `quantity`, `unitCost` (CPP en esa bodega), `minStock`/`maxStock`, `location`. |
| `StockReservation` | Reservas activas (p. ej. OT); el disponible operativo puede ser físico − reservado (ver servicios de listados/picker). |
| `InventoryTransaction` | **Kardex inmutable**: una fila por movimiento con `type`, `quantity`, `previousStock`, `newStock`, `warehouseId`, `itemId`, `userId`, `date`, `notes`, `referenceId` + `referenceType`. |
| `InventoryTransfer` | Cabecera W2W: `originWarehouseId`, `destinationWarehouseId`, `status` (`SHIPPED` \| `COMPLETED` \| `CANCELLED`), `createdById`. |
| `InventoryTransferLine` | Línea: `itemId`, `quantity`, `unitCost` (CPP tomado en origen al enviar). |
| `UnitOfMeasure` | `abbreviation` único por tenant; **`allowsDecimals`**: si `false`, cantidades de negocio en UN enteras; si `true` (p. ej. KG, LT), se permiten fracciones en UI y validación de transferencia. |

## Tipos de transacción (`TransactionType`)

Incluyen entre otros: `IN`, `OUT`, `ADJUST`, `RETURN`, `PURCHASE_RECEIPT`, `WORK_ORDER_ISSUE`, `WORK_ORDER_RETURN`, **`TRANSFER_OUT`**, **`TRANSFER_IN`**.

Para **transferencias W2W**, al **enviar** se crea `TRANSFER_OUT` en la bodega **origen**; al **confirmar recepción** se crea `TRANSFER_IN` en la bodega **destino**. Ambas filas llevan `referenceType = 'INVENTORY_TRANSFER'` y `referenceId = inventoryTransfer.id`.

## Flujo transferencias (backend)

- **Módulo:** `backend/src/features/inventory-transfer/` (`InventoryTransferController`, `InventoryTransferService`).
- **API:** `GET /inventory-transfers` (listado **paginado**), `GET /inventory-transfers/:id` (detalle con líneas, artículos y metadatos de recepción), `POST /inventory-transfers` (crear envío), `POST /inventory-transfers/:id/receive` (confirmar recepción). Roles: ver controlador (`ADMIN`, `SUPERVISOR`, `SUPER_ADMIN` en envío).
- **Listado:** respuesta `{ data, total, page, pageSize }`. Query opcional: `page` (default 1), `pageSize` (default 25, máx. 100), `sort` = `createdAt` \| `origin` \| `dest` \| `status`, `dir` = `asc` \| `desc`. Cada fila incluye `createdBy` (`id`, `name`, `email`), `originWarehouse` / `destinationWarehouse` con `contractId`, y `lineCount` (cantidad de líneas). **No** incluye el detalle de cada artículo (usar `GET :id`).
- **Detalle (`GET :id`):** mismas cabeceras de acceso que el listado; incluye `lines` con `item` (código inventario, part number, nombre, UoM). Si `status = COMPLETED`, añade `reception`: fecha/hora del último `TRANSFER_IN` en destino y usuario que ejecutó la recepción (alineado al kardex / `inventory_transactions`).
- **Ejecutar envío (`executeTransfer`):** transacción Prisma: crea `InventoryTransfer` en `SHIPPED`, descuenta stock origen, crea líneas, crea **`InventoryTransaction`** `TRANSFER_OUT` por ítem con notas tipo `Transferencia {orig} → {dest} · Traslado de …`.
- **Recepción (`confirmReception`):** valida acceso al contrato de la bodega destino; incrementa/upsert `ItemStock` destino con **CPP ponderado**; crea `TRANSFER_IN`; pasa transfer a `COMPLETED`.

Validación de cantidad: si la UoM del artículo no admite decimales, el servicio rechaza cantidades no enteras (`Number.isInteger`).

**Pruebas unitarias:** `backend/src/features/inventory-transfer/inventory-transfer.service.spec.ts` — inventario en [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) §3.3.

## Kardex / historial por artículo (global al ítem)

- **Endpoint:** `GET /inventory-items/:id/ledger` (query opcional: `warehouseId`, `page`, `pageSize`) → `InventoryItemsService.findItemLedger`.
- Lista **todas** las `InventoryTransaction` del `itemId` (todas las bodegas), paginadas, orden `date desc`.
- Enriquece `reference` para `WORK_ORDER`, `PURCHASE_RECEIPT`, **`INVENTORY_TRANSFER`** (etiquetas con códigos/nombres de bodega origen/destino según `TRANSFER_OUT` / `TRANSFER_IN`).
- Si `referenceType = 'PURCHASE_RECEIPT'` y **`type = 'ADJUST'`** (cierre de saldo pendiente desde stock), `reference.kind` = **`ADJUST_SALDO_PENDIENTE`** y `label` describe recepción + OC; incluye `warehouseReceiptId` / `purchaseOrderId` para enlaces WR/OC en UI (misma forma que una recepción de compra “normal” en ledger).

**Frontend:** pestaña «Historial de movimientos» en `inventory-item-form` y modal de catálogo (`loadLedger` → `getItemLedger`). Título de fila: `ledgerMovementTitle` (p. ej. «Ajuste · saldo pendiente (recepción)» cuando `reference.kind === 'ADJUST_SALDO_PENDIENTE'`). Cantidades con signo (`ledgerSignedQty`); bloque dedicado para transferencias con notas y enlace a `/app/inventario/transferencias`.

**Pruebas unitarias:** `backend/src/features/inventory-items/inventory-items.service.spec.ts` — [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) §3.5.

## Kardex por bodega (gestión de stock)

- **Endpoint:** `GET /inventory-stock/warehouse/:warehouseId/transactions` (query opcional: `itemId`, y con `itemId` también `page`, `pageSize`) → `getTransactionsByWarehouse` + **`enrichTransactionsTrace`**.
- **Sin `itemId`:** hasta **100** movimientos de la bodega (array JSON), sin paginar.
- **Con `itemId`:** respuesta **`{ data, total, page, pageSize }`** (defecto `page=1`, `pageSize=25`, máx. 100 por página), orden `date desc`. Cada fila incluye **`user`** (`id`, `name`, `email`) y, vía enriquecido, **`trace`** cuando aplica.
- Añade `trace` para recepciones, OT y **transferencias** (`trace.transfer` con códigos/nombres y `direction` OUT/IN según bodega de la fila).
- Para un `ADJUST` con `referenceType = 'PURCHASE_RECEIPT'` cerrado como saldo pendiente, `trace.saldoPendienteAdjust = true` (además de `trace.warehouseReceipt` / `trace.purchaseOrder` cuando aplica) para subtítulo en kardex por bodega.

**Frontend:** modal «Ver kardex» en `stock-dashboard` (`openKardexModal`, `loadKardexPage`, `kardexMovementTitle`); paginación Anterior/Siguiente alineada al total del servidor.

**Pruebas unitarias:** `enrichTransactionsTrace` en `inventory-stock.service.spec.ts` — [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) §3.2. Recepción → kardex: `warehouse-receipts.service.spec.ts` §4.8.

## Ajustes de inventario

- Movimientos `type = ADJUST` con referencias según implementación (`INVENTORY_ADJUSTMENT` u otros); detalle en UI con modal de ajuste en `inventory-item-form`. No confundir con transferencias.

**Pruebas unitarias ajustes:** `backend/src/features/inventory-adjustment/inventory-adjustment.service.spec.ts` — [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) §3.4.

### Motivo «Saldo pendiente» (compra / recepción incompleta)

- **API:** `POST /inventory-adjustments` (`InventoryAdjustmentService`). Requiere `reason: 'SALDO_PENDIENTE'`, `purchaseOrderId`, `purchaseReceiptId` y comentario; valida tenant, que la recepción pertenezca a esa OC y a la **misma bodega** del ajuste. La recepción debe estar **confirmada** (no en borrador `PENDING`): el ajuste incrementa stock físico por la diferencia respecto a lo ya ingresado en compras.
- **Sincronía con compras (misma transacción Prisma que el `ADJUST`):** además del movimiento de inventario, se ejecuta la lógica que **incrementa `quantity_received`** en las líneas de la guía (`receipt_items`), recalcula el estado de la **`WarehouseReceipt`** (`PENDING` / `PARTIAL` / `COMPLETED`) y, si el estado de la **`PurchaseOrder`** lo permite (`SENT`, `ORDERED`, `SENT_TO_SUPPLIER`, `PARTIALLY_RECEIVED`), lo avanza a **`PARTIALLY_RECEIVED`** o **`RECEIVED`** cuando la OC queda totalmente cubierta. Así, cerrar saldo desde **control de stock** alinea pendientes con lo que verías si completaras cantidades desde el **módulo de recepciones** (sin duplicar confirmaciones: no se reutiliza el flujo de `confirm` de una guía ya cerrada para volver a cargar stock).
- **Kardex / trazabilidad:** `referenceId` = id de `WarehouseReceipt`; `referenceType = 'PURCHASE_RECEIPT'` reutiliza el enriquecido `trace` (OC + guía) en listados por bodega y marca `trace.saldoPendienteAdjust` en ese caso. El movimiento sigue siendo **`type = ADJUST`** (no sustituye las filas `PURCHASE_RECEIPT` del ingreso original al bodega).
- **Ledger por artículo:** `findItemLedger` expone `reference.kind = 'ADJUST_SALDO_PENDIENTE'` para distinguir visualmente el ajuste vinculado a compras.
- **Texto en `notes` (legible en UI y parseable):**  
  `Ajuste [Saldo pendiente] (OC: #<correlativo>): <comentario>`  
  donde `<correlativo>` es `PurchaseOrder.correlative` (no el UUID). El parser compartido está en `frontend/src/app/core/utils/inventory-adjustment-notes.ts` (`parseInventoryAdjustmentNotes`).
- **UI:** motivo y selectores de OC/recepción en `stock-dashboard` (modal **Corregir físico**). Umbrales mín/máx: modal **Umbrales** o edición inline de ubicación — ver [control-stock-umbrales-vs-correccion-fisica.md](control-stock-umbrales-vs-correccion-fisica.md).

## Selector global de artículos (`GlobalItemPicker`)

- **Componente:** `frontend/src/app/shared/components/global-item-picker/`.
- **API:** `GET /inventory-items/picker` con `search`, `categoryId`, `warehouseId`, paginación; **`onlyWithStock=1`** restringe a artículos con **`ItemStock.quantity > 0`** en esa bodega (requiere `warehouseId`). Opcional **`workOrderId`**: ítems con salida (`OUT` / `WORK_ORDER_ISSUE`) a esa OT desde esa bodega y cantidad neta aún devolvible (alineado con `performReturn`). Opcional **`fieldReentryOutstanding=1`**: ítems con saldo neto pendiente de reingreso desde terreno (OUT `FIELD_DISPATCH` − IN `FIELD_RETURN`) en esa bodega (requiere `warehouseId`).
- **Inputs:** `allowQuickAdd`, `onlyWithStockInWarehouse`, `workOrderIdForReturn`, `fieldReentryOutstandingOnly`, `warehouseId`, `strictFamilyFirst`, etc.

**Transferencias:** se usa con `allowQuickAdd=false`, `onlyWithStockInWarehouse=true` y `warehouseId` = bodega origen.

## Transferencias — frontend

- **Ruta:** `/app/inventario/transferencias` → `inventory-transfer.component`.
- **Listado:** orden por columnas (origen, destino, estado, envío), paginación Anterior/Siguiente, columna de envío con fecha + usuario creador, conteo de ítems (`lineCount`). Acciones: **Detalle** (modal con líneas, recepción si aplica, enlaces a `/app/articulos/:id`) y **Confirmar recepción** cuando el estado es en tránsito y el usuario puede operar sobre el **contrato de la bodega destino** (misma regla que el backend: `ADMIN` / `SUPER_ADMIN` sin depender del contrato seleccionado en el header; otros roles vía `allowedContracts`). La UI **no** infiere permisos solo con la lista de bodegas del contrato activo del selector superior.
- **Formulario:** señal `formRevision` + `merge(valueChanges, statusChanges)` para integrar Reactive Forms con `computed` (`canSubmit`, `originWarehouseIdForPicker`).
- **Líneas:** datos del picker (stock en origen, ubicación, código inventario, `allowsDecimals` de la UoM) y validación de no superar saldo origen antes de enviar.

## Salida / reingreso «a terreno» (no OT)

- **Trazabilidad en kardex:** `inventory_transactions.reference_type` = `FIELD_DISPATCH` en **`OUT`** (material que sale de bodega hacia faena sin OT) y `FIELD_RETURN` en **`IN`** (vuelve a bodega). El pendiente por ítem/bodega es Σ OUT(`FIELD_DISPATCH`) − Σ IN(`FIELD_RETURN`).
- **Salidas históricas** sin `reference_type` no entran en el cómputo hasta que exista backfill o se registren nuevas salidas con la marca.
- **API stock por bodega:** `GET /inventory-stock/warehouse/:id` incluye por fila `fieldDispatchOutstandingQty` (pendiente terreno). En **Control de stock** hay columna «Pend. terreno» y filtro de estado «Pendiente reingreso (terreno)».
- **Transacción manual:** `POST /inventory-stock/transaction` con `type`/`referenceType` coherentes; el backend valida reingreso (cantidad ≤ pendiente, `unitCost` &gt; 0 para `FIELD_RETURN`).

## Seeds / UoM

- `backend/prisma/seed-inventory-masters.ts`: UoM de ejemplo con `allowsDecimals` coherente (UN entero, KG/LT/MT decimales).
- Migración `20260513120000_uom_allows_decimals`: columna `allows_decimals` + backfill por abreviatura.

## Archivos clave (referencia rápida)

| Tema | Ruta principal |
|------|----------------|
| Ledger ítem | `backend/src/features/inventory-items/inventory-items.service.ts` (`findItemLedger`) |
| Transacciones por bodega | `backend/src/features/inventory-stock/inventory-stock.service.ts` (`getTransactionsByWarehouse`, `enrichTransactionsTrace`) |
| Transferencias API | `backend/src/features/inventory-transfer/inventory-transfer.service.ts` |
| Picker API | `backend/src/features/inventory-items/inventory-items.service.ts` (`findForPicker`) |
| Cliente ledger | `frontend/src/app/core/services/inventory-items/inventory-items.service.ts` (`getItemLedger`) |
| Historial artículo | `frontend/src/app/features/inventory-items/inventory-item-form/` |
| Transferencias UI | `frontend/src/app/features/inventory-transfer/` |
| Kardex bodega UI | `frontend/src/app/features/inventory-stock/stock-dashboard/` |
| Umbrales vs corrección física (doc) | [control-stock-umbrales-vs-correccion-fisica.md](control-stock-umbrales-vs-correccion-fisica.md) |

## Reglas para el agente

1. **Multi-tenant:** cualquier consulta Prisma nueva debe filtrar por `tenantId` del usuario (y site/contrato según reglas del módulo).
2. **Kardex:** no borrar `InventoryTransaction`; nuevos movimientos = nuevas filas.
3. **Transferencias:** si se cambia el contrato de referencias o tipos, actualizar **esta guía**, `findItemLedger`, `enrichTransactionsTrace` y las plantillas HTML que interpretan `reference` / `trace`.
