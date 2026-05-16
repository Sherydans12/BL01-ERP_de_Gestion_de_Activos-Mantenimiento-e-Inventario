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
- **API:** `GET /inventory-transfers`, `POST /inventory-transfers` (crear envío), `POST /inventory-transfers/:id/receive` (confirmar recepción). Roles: ver controlador (`ADMIN`, `SUPERVISOR`, `SUPER_ADMIN` en envío).
- **Ejecutar envío (`executeTransfer`):** transacción Prisma: crea `InventoryTransfer` en `SHIPPED`, descuenta stock origen, crea líneas, crea **`InventoryTransaction`** `TRANSFER_OUT` por ítem con notas tipo `Transferencia {orig} → {dest} · Traslado de …`.
- **Recepción (`confirmReception`):** valida acceso al contrato de la bodega destino; incrementa/upsert `ItemStock` destino con **CPP ponderado**; crea `TRANSFER_IN`; pasa transfer a `COMPLETED`.

Validación de cantidad: si la UoM del artículo no admite decimales, el servicio rechaza cantidades no enteras (`Number.isInteger`).

## Kardex / historial por artículo (global al ítem)

- **Endpoint:** `GET /inventory-items/:id/ledger` → `InventoryItemsService.findItemLedger`.
- Lista **todas** las `InventoryTransaction` del `itemId` (todas las bodegas), paginadas, orden `date desc`.
- Enriquece `reference` para `WORK_ORDER`, `PURCHASE_RECEIPT`, **`INVENTORY_TRANSFER`** (etiquetas con códigos/nombres de bodega origen/destino según `TRANSFER_OUT` / `TRANSFER_IN`).

**Frontend:** pestaña «Historial de movimientos» en `inventory-item-form` (`loadLedger` → `getItemLedger`). Cantidades mostradas con signo (`ledgerSignedQty`) para lectura tipo kardex; bloque dedicado para transferencias con notas y enlace a `/app/inventario/transferencias`.

## Kardex por bodega (gestión de stock)

- **Endpoint:** `GET /inventory-stock/warehouse/:warehouseId/transactions` (opcional `?itemId=`) → `getTransactionsByWarehouse` + **`enrichTransactionsTrace`**.
- Añade `trace` para recepciones, OT y **transferencias** (`trace.transfer` con códigos/nombres y `direction` OUT/IN según bodega de la fila).

**Frontend:** modal «Ver kardex» en `stock-dashboard` (`openKardexModal`).

## Ajustes de inventario

- Movimientos `type = ADJUST` con referencias según implementación (`INVENTORY_ADJUSTMENT` u otros); detalle en UI con modal de ajuste en `inventory-item-form`. No confundir con transferencias.

### Motivo «Saldo pendiente» (compra / recepción incompleta)

- **API:** `POST /inventory-adjustments` (`InventoryAdjustmentService`). Requiere `reason: 'SALDO_PENDIENTE'`, `purchaseOrderId`, `purchaseReceiptId` y comentario; valida tenant, que la recepción pertenezca a esa OC y a la **misma bodega** del ajuste.
- **Kardex / trazabilidad:** `referenceId` = id de `WarehouseReceipt` asociada al contexto del saldo pendiente; `referenceType = 'PURCHASE_RECEIPT'` permite reutilizar el enriquecido `trace` (OC + correlativo de recepción) en listados. El movimiento sigue siendo **`type = ADJUST`** (no duplica el ingreso contable de la recepción original); es un vínculo documental para auditoría.
- **Texto en `notes` (legible en UI y parseable):**  
  `Ajuste [Saldo pendiente] (OC: #<correlativo>): <comentario>`  
  donde `<correlativo>` es `PurchaseOrder.correlative` (no el UUID). El parser compartido está en `frontend/src/app/core/utils/inventory-adjustment-notes.ts` (`parseInventoryAdjustmentNotes`).
- **UI:** motivo y selectores de OC/recepción en `stock-dashboard` (modal **Corregir físico**). Umbrales mín/máx: modal **Umbrales** o edición inline de ubicación — ver [control-stock-umbrales-vs-correccion-fisica.md](control-stock-umbrales-vs-correccion-fisica.md).

## Selector global de artículos (`GlobalItemPicker`)

- **Componente:** `frontend/src/app/shared/components/global-item-picker/`.
- **API:** `GET /inventory-items/picker` con `search`, `categoryId`, `warehouseId`, paginación; **`onlyWithStock=1`** restringe a artículos con **`ItemStock.quantity > 0`** en esa bodega (requiere `warehouseId`).
- **Inputs:** `allowQuickAdd` (mostrar/ocultar alta rápida), `onlyWithStockInWarehouse`, `warehouseId`, `strictFamilyFirst`, etc.

**Transferencias:** se usa con `allowQuickAdd=false`, `onlyWithStockInWarehouse=true` y `warehouseId` = bodega origen.

## Transferencias — frontend

- **Ruta:** `/app/inventario/transferencias` → `inventory-transfer.component`.
- **Formulario:** señal `formRevision` + `merge(valueChanges, statusChanges)` para integrar Reactive Forms con `computed` (`canSubmit`, `originWarehouseIdForPicker`).
- **Líneas:** datos del picker (stock en origen, ubicación, código inventario, `allowsDecimals` de la UoM) y validación de no superar saldo origen antes de enviar.

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
