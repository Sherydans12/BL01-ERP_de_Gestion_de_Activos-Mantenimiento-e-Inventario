# Decisiones de diseño (ligero)

Añadí entradas con fecha cuando un chat o una reunión fije algo importante. Formato sugerido:

```
## YYYY-MM-DD — Título corto
- Contexto: …
- Decisión: …
- Consecuencias: …
```

## 2026-05-22 — Suite N+6: SRC create/duplicate/selectQuotation + catálogo

- **Decisión:** `purchase-requisitions` +7 (`create`, `duplicate`, `selectQuotation`); `inventory-items` +7 (`search`, `create`, `remove`).
- **Consecuencias:** Suite dominio **203 tests**. Siguiente: `update` SRC, `quickCreate` artículo, cobertura CI opcional.

## 2026-05-22 — Suite N+5: SRC cancel/cotizaciones, regularización inventario

- **Decisión:** `purchase-requisitions.service.spec` +13 (`cancel`, `startQuoting`, `addQuotation`, `findAll`); `inventory-stock` +4 (IRA tope, regularización pendiente).
- **Consecuencias:** Suite dominio **189 tests**. Siguiente: `selectQuotation`, `create` SRC, cobertura CI opcional.

## 2026-05-22 — Suite N+4: stock bodega, PDF conteo, SRC adjudicación/envío

- **Decisión:** Nuevo `purchase-requisitions.service.spec.ts` (7); +6 en `inventory-stock` (`getStockByWarehouse`, `buildPhysicalCountSheetPdf` con generator mockeado).
- **Consecuencias:** Suite dominio **172 tests** (12 archivos). Siguiente: `cancel`/`startQuoting` SRC, listados deuda inventario.

## 2026-05-22 — Suite N+3: IRA, findAll recepciones, SRC→OC split, push batch

- **Decisión:** +12 tests: `getInventoryRecordAccuracy` (3), `warehouse-receipts.findAll` (3), `createOrdersFromRequisition` (4), `notifyApproversForPendingSignatureBatch` (2).
- **Consecuencias:** Suite dominio **159 tests**. Mock `purchase-quotation-status-sync.util`; `purchase-contract-access.util` con `requireActual` en spec recepciones para `buildPurchaseContractScopeFilter`.

## 2026-05-22 — Suite N+2: génesis ledger, recepción create/update, alertas, listado W2W

- **Decisión:** +15 tests: `findItemLedger` génesis (2), `warehouse-receipts` `create`/`updateItems` (7), `getSupplyAlerts` (2), `listTransfers`/`getTransferById` (4).
- **Consecuencias:** Suite dominio **147 tests**. Siguiente: `getInventoryRecordAccuracy`, `createFromRequisition`, listado recepciones.

## 2026-05-22 — Suite ledger + recepción: findItemLedger, confirm, trace

- **Contexto:** Roadmap §0 en `pruebas-unitarias-backend.md` apuntaba a kardex por artículo, confirmación de guías y trazabilidad en listado por bodega.
- **Decisión:** Tres ampliaciones: `inventory-items.service.spec.ts` (5, `findItemLedger`), `warehouse-receipts.service.spec.ts` (4, `confirm` con delta `quantityConfirmed`), +2 tests en `inventory-stock` (`enrichTransactionsTrace` vía `getTransactionsByWarehouse`).
- **Consecuencias:** Suite dominio crítico **132 tests** (inventario 54 + compras 78). Siguiente: génesis en ledger, `updateItems` recepción, `getSupplyAlerts`, `listTransfers`.

## 2026-05-22 — Suite unitaria backend: inventario stock + jest-mock-extended

- **Contexto:** Kardex y movimientos (`InventoryStockService`) son críticos; no había specs de negocio ni convención documentada para mocks Prisma.
- **Decisión:** Añadir `inventory-stock.service.spec.ts` (23 tests) con `mockDeep<PrismaService>()`; instalar `jest-mock-extended` con `--legacy-peer-deps` (Jest 30). Mantener inventario vivo en `docs/agentes/pruebas-unitarias-backend.md`.
- **Consecuencias:** Siguiente bloque de tests planificado en compras: `approve`, `upsertPolicies`, `resolveApprovalPolicyForUser`. Los specs smoke existentes (auth, users, sites) no sustituyen cobertura de dominio.

## 2026-05-22 — Suite unitaria compras: ACL, matriz y `approve`

- **Contexto:** Gobernanza de OC (usuarios explícitos por nivel, `minAmount`, orden de firmas) documentada en `PURCHASE-GOVERNANCE.md` sin tests automatizados.
- **Decisión:** Tres specs: `tenant-role-defaults.spec.ts` (5), `purchase-settings.service.spec.ts` (6), `purchase-orders.service.spec.ts` — bloque `approve` (11). Mock de `assertUserHasContractAccess`. Inventario actualizado en `pruebas-unitarias-backend.md` §4.
- **Consecuencias:** Suite dominio crítico ampliada a 62 tests (+ `reject`, `getSettings`/`updateSettings`, `signature.util`, `validateInvoiceMatch`). Ver `pruebas-unitarias-backend.md` §4.5–4.6. Pendiente: `cancel` OC, `overruleThreeWayMatch`.

## 2026-05-22 — Suite compras: cancel, envío proveedor, overrule 3-way

- **Contexto:** Pendientes de `pruebas-unitarias-backend.md` tras bloque ACL/`approve`.
- **Decisión:** Ampliar `purchase-orders.service.spec` (`cancel`, `markAsSentToSupplier`) y `purchase-invoices.service.spec` (`overruleThreeWayMatch`). Suite dominio = **76 tests**.
- **Consecuencias:** Documentado en §4.4–4.6. Pendiente: notas de crédito 3-way, push post-firma, `resetToDraft`.

## 2026-05-22 — Suite compras: NC, resetToDraft, forceClose, push

- **Decisión:** `purchase-credit-notes.service.spec.ts` (8), ampliación `purchase-orders` (+6: reset, forceClose, notificación). Suite dominio **91 tests**. Roadmap §0 en `pruebas-unitarias-backend.md`.
- **Siguiente paso:** `InventoryTransferService` + `InventoryAdjustmentService` (ver §0 doc pruebas).

## 2026-05-22 — Pruebas `InventoryTransferService` (W2W)

- **Decisión:** `inventory-transfer.service.spec.ts` (12): `executeTransfer` (OUT, stock origen, UoM entera) y `confirmReception` (CPP ponderado destino, TRANSFER_IN, política nueva fila).
- **Siguiente paso:** `InventoryAdjustmentService` (ver §0 `pruebas-unitarias-backend.md`). Suite dominio: **103 tests**.

## 2026-05-22 — Pruebas `InventoryAdjustmentService` (saldo pendiente)

- **Decisión:** `inventory-adjustment.service.spec.ts` (12): `CONTEO` vía `performTransaction`; `SALDO_PENDIENTE` en transacción Serializable con sync `receiptItem` / `warehouseReceipt` / `purchaseOrder`.
- **Siguiente paso:** `PurchaseOrdersService.updateSensitiveFields`. Suite dominio: **115 tests**.

## 2026-05-22 — Pruebas `updateSensitiveFields` (OC)

- **Decisión:** +6 tests en `purchase-orders.service.spec.ts`: limpieza de firmas, umbral 2/3, líneas, push al reabrir firma.
- **Siguiente paso:** `InventoryItemsService.findItemLedger`. Suite dominio: **121 tests**.

## 2026-05-19 — Recepciones parciales persistentes con delta de stock

- **Contexto:** El módulo de recepciones creaba una nueva guía por cada recepción parcial, forzando al usuario a volver al listado "Nueva recepción" para continuar. Además el historial de eventos era genérico y usaba "ítem(s)".
- **Decisión:** Una guía de recepción (`WarehouseReceipt`) permanece editable mientras su estado sea `PENDING` o `PARTIAL`; solo `COMPLETED` es de solo lectura. Se agrega el campo `quantityConfirmed` a `ReceiptItem` para trackear el delta ya movido a stock. Cada llamada a `confirm()` solo mueve `quantityReceived − quantityConfirmed` al kardex, evitando doble conteo.
- **Consecuencias:**
  - Migration `20260519000000_receipt_item_quantity_confirmed` agrega la columna con backfill de registros existentes.
  - `forceClose` de OC también cierra guías PENDING/PARTIAL asociadas.
  - Frontend en modo PARTIAL muestra "Agregar ahora" (delta=0 inicial) y el tope es `quantityExpected − quantityConfirmed`. El botón "Guardar avance" fue eliminado; solo existe "Confirmar Recepción" (verde para completa, ámbar para parcial).
  - Historial: eventos separados `warehouse_receipt_partial` vs `warehouse_receipt_completed` con cantidades exactas por artículo.
  - Columnas de tabla fija (7 edit / 6 readonly) para evitar desalineación por columnas condicionales.

## 2026-05-19 — Alcance por contrato para rol base `USER`

- **Contexto:** Usuarios con `role: USER` + TenantRole con todos los permisos PBAC veían listados vacíos en Compras (SRC, OC, etc.) y Operaciones.
- **Decisión:** El alcance de datos no depende del enum `UserRole` salvo bypass `ADMIN` / `SUPER_ADMIN`. Cualquier otro rol usa `allowedContracts` del JWT (filas `UserContract`). Util compartido `backend/src/common/contract-scope.util.ts`. En admin de usuarios, la UI de “Contratos permitidos” aplica también a `baseRole === USER`.
- **Consecuencias:** Sin contratos asignados el listado sigue vacío (sentinel UUID). Tras asignar contratos, el usuario debe **volver a iniciar sesión** para refrescar el JWT. No se concede tenant-wide solo por tener permisos PBAC.

## 2026-05-19 — Indicador visual de qty y modal de ficha de artículo

- **Contexto:** Usuario quería feedback inmediato al ingresar cantidades y poder consultar el catálogo sin salir de la vista.
- **Decisión:** Columna "Estado" con badge coloreado por fila (`sin ingresar`, `parcial: X de Y`, `✓ completo`). Click en nombre del artículo abre un modal con datos del catálogo y tabla de cantidades en contexto.
- **Consecuencias:** Clases CSS con `/` (Tailwind) no se pueden usar en `[class.xxx]` de Angular; se definieron `.row-qty-complete` / `.row-qty-partial` en `styles.scss` y se usa `[ngClass]`.
