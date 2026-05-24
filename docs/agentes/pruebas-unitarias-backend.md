# Pruebas unitarias — backend NestJS (Jest)

Inventario vivo de **servicios críticos**, archivos `.spec.ts` y convenciones para ampliar cobertura sin PostgreSQL real.

**Índice maestro (reglas + flujo agente + watch):** [pruebas-unitarias.md](pruebas-unitarias.md) · Regla Cursor: `.cursor/rules/testing-baselogic.mdc`

**Última actualización:** 2026-05-22

---

## 0. Cómo vamos (cobertura dominio crítico)

**Suite ejecutable hoy:** **280 tests** en **13** archivos (sin PostgreSQL real).

| Módulo | Avance estimado | Tests | Estado |
|--------|-----------------|-------|--------|
| **Inventario — stock/kardex** | ~88 % del núcleo | 41 | Stock, devoluciones OT, IRA, PDF (§3.2) |
| **Compras — SRC** | ~92 % flujo completo | 38 | Ciclo + `update` post-adjudicación (§4.9) |
| **Inventario — catálogo** | ~55 % CRUD búsqueda | 23 | `search`, `create`, `update`, `quickCreate`, `remove` + ledger (§3.5) |
| **Inventario — ledger artículo** | ~75 % `findItemLedger` | 7 | Referencias + `ITEM_GENESIS` última página (§3.5) |
| **Inventario — transferencias W2W** | ~90 % mutación/recepción | 20 | W2W + validaciones recepción (§3.3) |
| **Inventario — ajustes / saldo pendiente** | ~75 % `create` | 12 | `CONTEO`, `SALDO_PENDIENTE` + sync recepción/OC (§3.4) |
| **Compras — recepción bodega** | ~92 % flujo físico | 19 | `confirm` + imputación equipo OC (§4.8) |
| **Compras — gobernanza OC** | ~92 % firma/edición/SRC | 54 | ACL, elegibles recepción, ciclo OC (§4.4) |
| **Compras — 3-way / facturas** | ~90 % | 30 | CRUD factura + 3-way + pago (§4) |
| **Mantenimiento — OT cierre** | ~92 % cierre + backlog | 22 | CLOSED, `IN_PROGRESS`, `promoteBacklogItem` (§3.6) |
| **Compras — util firma** | 100 % util | 4 | `signature.util` |
| **Auth / users / sites** | Smoke only | — | No sustituyen dominio |

```bash
cd backend
npm run test:domain
# Sesión larga (agente o dev):
npm run test:domain:watch
```

### Iteración N+7 (2026-05-22) — hecho

- **`PurchaseRequisitionsService.update`** (+5): QUOTING solo compras; SUBMITTED solo OT/equipo; DRAFT descripción + reemplazo líneas; ítem en cotización no borrable.
- **`InventoryItemsService.quickCreate`** (+4): validaciones nombre/min-max; alta con política bodega + SKU; PN duplicado.

### Iteración N+8 (2026-05-22) — hecho

- **`PurchaseRequisitionsService.update`** (+2): `SUBMITTED` vincula OT/equipo + audit; no solicitante → `Forbidden`.
- **`InventoryItemsService.update`** (+4): `inventoryCode` inmutable; PN duplicado; edición nombre; resolución por código `IN####`.

### Iteración N+9 (2026-05-22) — hecho

- **`PurchaseRequisitionsService.update`** (+3): `PENDING_APPROVAL` solo compras; actualiza cantidad; `PARTIALLY_PURCHASED` agrega línea.
- **`InventoryItemsService.update`** (+1): `UpdateInventoryItemDto` no incluye política bodega (`warehouseId` / min-max ignorados en servicio).

### Iteración N+10 (2026-05-22) — hecho

- **`PurchaseOrdersService`** (+4): `reject` no aplica en `PARTIALLY_RECEIVED`; `cancel` en parcial sin guías; `forceClose` not found + audit `closedOpenReceipts`.
- **`PurchaseRequisitionsService.update`** (+1): elimina línea sin cotización en `PENDING_APPROVAL`.
- **`InventoryStockService.performReturn`** (+1): alta de `itemStock` con política del artículo.

### Iteración N+11 (2026-05-22) — hecho

- **`PurchaseOrdersService`** (+3): `resetToDraft` not found; `updateSensitiveFields` bloquea `SENT` / `PARTIALLY_RECEIVED`.
- **`InventoryTransferService`** (+4): usuario/bodega inválidos en `executeTransfer`; usuario sin id en `confirmReception`; `clearItemStockPolicy` post-recepción.

### Iteración N+12 (2026-05-22) — hecho

- **`warehouse-receipts.confirm`** (+3): sobre-recepción al confirmar; bodega inactiva; gasto directo sin stock + audit.
- **`purchase-invoices`** (+4): tolerancia MATCHED; NC en monto neto; overrule sin contrato; overrule bloqueado si supera recepción.

### Iteración N+13 (2026-05-22) — hecho

- **`WorkOrdersService.updateStatus` (CLOSED)** (+3): bodega obligatoria con repuestos; OT ya cerrada; `WORK_ORDER_ISSUE` + reservas.
- **`validateInvoiceMatch`** (+1): revoca `threeWayMatchOverruled` si recepción insuficiente.
- **`npm run test:domain`**: incluye `work-orders.service.spec` (13 suites).

### Iteración N+14 (2026-05-22) — hecho

- **`WorkOrdersService.updateStatus` (CLOSED)** (+5): bodega con fluidos; consumo fluido `WORK_ORDER_ISSUE`; medidor final inválido; `applyCurrentMeterChange`; correo `POSIBLE_GARANTIA`.
- **`warehouse-receipts.confirm`** (+1): multi-línea inventario + gasto directo (solo una línea a stock).

### Iteración N+15 (2026-05-22) — hecho

- **`WorkOrdersService.updateStatus` (CLOSED)** (+4): detención y atención mecánica obligatorias; equipo operativo; `assetCostRecord` por consumibles.
- **`warehouse-receipts.confirm`** (+1): `assetCostRecord` tipo `PURCHASE` si OC tiene `equipmentId`.

### Iteración N+16 (2026-05-22) — hecho

- **`WorkOrdersService.updateStatus` (CLOSED)** (+3): fechas invertidas detención/atención; `cumulativeDowntimeHours` con `affectsAvailability: SI`.
- **`PurchaseInvoicesService.create`** (+3): OC no facturable; encadena 3-way en `PARTIALLY_RECEIVED`; recepción parcial vs monto OC.
- **`PurchaseOrdersService.findEligibleForWarehouseReceipt`** (+2): estados recepcionables; filtro por contrato USER.

### Iteración N+17 (2026-05-22) — hecho

- **`WorkOrdersService.updateStatus` (IN_PROGRESS)** (+4): `isOperational: false` con `affectsAvailability: SI`; sin efecto si `NO`; idempotencia; OT no encontrada.
- **`PurchaseInvoicesService`** (+5): `update` (PAID, sin campos, revoca overrule + revalida); `markPaid` (solo MATCHED, éxito PAID).

### Iteración N+18 (2026-05-22) — hecho

- **`PurchaseInvoicesService`** (+5): `recordPayment` (ref obligatoria, solo MATCHED, PAID); `remove` (bloquea PAID, delete).
- **`WorkOrdersService.promoteBacklogItem`** (+3): rechaza no PENDING; `TO_TASK`; `TO_NEW_OT`.

### Siguiente paso recomendado (iteración N+19)

1. **`work-orders.update`**: reservas de stock al cambiar repuestos.
2. **`purchase-credit-notes`**: flujo create/apply contra factura.
3. Cobertura CI (`test:cov`) con umbral en carpetas críticas (opcional).

---

## 1. Convenciones obligatorias

| Regla | Detalle |
|-------|---------|
| Framework | Jest 30 + `@nestjs/testing` |
| Base de datos | **Nunca** conectar a PostgreSQL en unit tests |
| Mock Prisma | `jest-mock-extended`: `mockDeep<PrismaService>()` y `DeepMockProxy<Prisma.TransactionClient>` para callbacks de `$transaction` |
| Dependencia | `jest-mock-extended@3` en `backend/package.json` (instalación con `--legacy-peer-deps` por peer Jest 30) |
| Foco | Lógica de negocio aislada: validaciones, CPP, ACL de compras, orden de firmas, etc. |
| Estructura | `describe()` por método o flujo; `it()` con comportamiento esperado en español o inglés consistente con el spec vecino |

### Ejecutar pruebas

```bash
cd backend
npm run test:domain                   # bloque crítico (recomendado)
npm run test:domain:watch             # mismo bloque, watch
npm test                              # suite completa (~220 tests, smoke + dominio)
npm test -- inventory-stock.service.spec   # un archivo
npm run test:cov                      # cobertura (opcional)
```

**Setup global:** `backend/test/jest-setup.ts` (mock `file-type`). Smoke: mocks de `PrismaService`, guards (`JwtAuthGuard`, `ThrottlerGuard`) y deps faltantes en auth/users/sites.

### Patrón `$transaction`

```typescript
prisma.$transaction.mockImplementation(async (fn, opts) => {
  // opts: isolationLevel, timeout — asertar si aplica
  return (fn as (client: typeof tx) => Promise<unknown>)(tx);
});
```

### Mocks de módulos auxiliares

Si el servicio importa helpers puros o con Prisma, usar `jest.mock('ruta/al/helper')` y `jest.mocked(fn)` (véase `inventory-stock.service.spec.ts`).

---

## 2. Estado de la suite (inventario)

| Archivo spec | Servicio / ámbito | Tests | Notas |
|--------------|-------------------|-------|-------|
| `features/inventory-stock/inventory-stock.service.spec.ts` | **Inventario — stock y kardex** | **41** | Movimientos, devoluciones OT, IRA, PDF (§3.2) |
| `features/purchases/purchase-requisitions.service.spec.ts` | **Compras — SRC** | **38** | Ciclo SRC + `update` (§4.9) |
| `features/inventory-items/inventory-items.service.spec.ts` | **Inventario — catálogo + ledger** | **23** | `search`, `create`, `update`, `quickCreate`, ledger (§3.5) |
| `features/inventory-transfer/inventory-transfer.service.spec.ts` | **Inventario — W2W** | **20** | Mutación, recepción, listado (§3.3) |
| `features/inventory-adjustment/inventory-adjustment.service.spec.ts` | **Inventario — ajustes** | **12** | `CONTEO`, `SALDO_PENDIENTE`, sync compras (§3.4) |
| `features/purchases/warehouse-receipts.service.spec.ts` | **Compras — recepción** | **17** | `findAll`, `create`, `updateItems`, `confirm` (§4.8) |
| `features/tenant-roles/tenant-role-defaults.spec.ts` | **Compras — `resolveApprovalPolicyForUser`** | **5** | Función pura ACL (ver §4) |
| `features/purchases/purchase-settings.service.spec.ts` | **Compras — matriz ACL** | **8** | `getSettings`, `updateSettings`, `upsertPolicies` (§4) |
| `features/purchases/purchase-orders.service.spec.ts` | **Compras — OC** | **52** | Firmas, ciclo OC, edición sensible (§4.4) |
| `features/purchases/purchase-invoices.service.spec.ts` | **Compras — 3-way match** | **17** | `validateInvoiceMatch`, `overruleThreeWayMatch` (§4) |
| `features/work-orders/work-orders.service.spec.ts` | **Mantenimiento — OT** | **3** | `updateStatus` CLOSED + consumo stock (§3.6) |
| `features/purchases/purchase-credit-notes.service.spec.ts` | **Compras — NC** | **8** | `create`/`remove`, P2002, revalidación 3-way (§4) |
| `common/crypto/signature.util.spec.ts` | **Firma OC (hash)** | **4** | `generateSignatureHash` / `verifySignatureIntegrity` (§4) |
| `features/auth/auth.service.spec.ts` | Auth | 1 | Smoke (`should be defined`) |
| `features/auth/auth.controller.spec.ts` | Auth controller | — | Smoke |
| `features/users/users.service.spec.ts` | Users | 1 | Smoke |
| `features/users/users.controller.spec.ts` | Users controller | — | Smoke |
| `features/sites/sites.service.spec.ts` | Sites | 1 | Smoke |
| `features/sites/sites.controller.spec.ts` | Sites controller | — | Smoke |
| `app.controller.spec.ts` | App | — | Smoke |
| `prisma/prisma.service.spec.ts` | PrismaService | — | Smoke |

**Suite dominio crítico (2026-05-22):** 280 tests passed (inventario 103 + compras 155 + OT 22).

---

## 3. Inventario: servicios y pruebas

### 3.1 Mapa de servicios (dominio)

| Servicio | Ruta | Rol |
|----------|------|-----|
| **`InventoryStockService`** | `features/inventory-stock/inventory-stock.service.ts` | **Núcleo:** `performTransaction` / `performTransactionCore` (IN, OUT, ADJUST), CPP en entradas, stock negativo + `isPendingRegularization`, devoluciones OT (`performReturn`), kardex por bodega, alertas de abastecimiento, IRA, PDF conteo |
| `InventoryItemsService` | `features/inventory-items/inventory-items.service.ts` | Maestro de artículos; **ledger global** (`findItemLedger`) |
| `InventoryTransferService` | `features/inventory-transfer/inventory-transfer.service.ts` | Traslados W2W (`TRANSFER_OUT` / `TRANSFER_IN`) |
| `InventoryAdjustmentService` | `features/inventory-adjustment/inventory-adjustment.service.ts` | Ajustes físicos, saldo pendiente compras |
| `InventoryAnalyticsService` | `features/inventory-analytics/inventory-analytics.service.ts` | Reportes / agregados |

Documentación de dominio: [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md).

### 3.2 Spec: `inventory-stock.service.spec.ts`

**Última ejecución:** 40 passed (2026-05-22).

#### Bloques `describe` y casos

| Bloque | Qué valida |
|--------|------------|
| `clearPendingRegularizationFlags` | No-op si saldo &lt; 0; `updateMany` si saldo ≥ 0 |
| `performTransactionCore` | Usuario requerido; cantidad &gt; 0 (excepto ADJUST); bodega válida; **IN** + CPP ponderado; **OUT** + flag regularización; **ADJUST** negativo; **FIELD_DISPATCH** solo OUT; **FIELD_RETURN** costo y tope terreno; política min/max al crear `item_stock` |
| `performTransaction` | `$transaction` con `Serializable` |
| `performReturn` | Cantidad positiva; sin salidas OT; tope vs consumo; happy path `WORK_ORDER_RETURN`; enmascaramiento costo **MECHANIC** |
| `updateStockLevels` | Bodega inexistente; payload vacío; max &lt; min |
| `getTransactionsByWarehouse — enrichTransactionsTrace` | Trace recepción/OC; transferencia IN; `saldoPendienteAdjust` en ADJUST |
| `getSupplyAlerts` | Filtro bajo mínimo; `suggestedOrderQty`; sin `groupBy` si no hay alertas |
| `getInventoryRecordAccuracy` | IRA 30 días; denominador cero; tope 0–100%; filtro bodega |
| `regularización pendiente` | `getPendingRegularizations`, `getPendingCount`, página paginada |
| `getStockByWarehouse` | Reservas, terreno, costo MECHANIC, filtro ubicación |
| `buildPhysicalCountSheetPdf` | Bodega inexistente; generador mockeado + filename |
| `getStockPosition` | Ubicación normalizada; quantity 0 sin fila |

#### Helpers mockeados en el spec

- `../inventory-items/inventory-item-stock-policy.helper` — `getPolicyThresholdsForNewItemStockRow`, `clearItemStockPolicyIfMatchesWarehouse`
- `../../common/inventory/field-dispatch-outstanding` — `getFieldDispatchOutstandingForItem`

### 3.3 Spec: `inventory-transfer.service.spec.ts`

**Última ejecución:** 16 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `executeTransfer` | Rol MECHANIC; origen=destino; sin líneas; cantidad inválida; UoM sin decimales; stock insuficiente; happy path `SHIPPED` + `TRANSFER_OUT` + línea con `unitCost` origen |
| `confirmReception` | Not found; estado ≠ `SHIPPED`; contrato destino; **CPP ponderado** en destino (6×10 + 4×5 → 8); stock nuevo en destino con política; `TRANSFER_IN` + `clearPendingRegularizationFlags` |
| `listTransfers` | Paginación + `lineCount`; filtro contratos SUPERVISOR |
| `getTransferById` | Not found; `reception` en `COMPLETED` vía último `TRANSFER_IN` |

Mocks: `InventoryStockService.clearPendingRegularizationFlags`; `inventory-item-stock-policy.helper`.

### 3.4 Spec: `inventory-adjustment.service.spec.ts`

**Última ejecución:** 12 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| Validaciones | Rol; comentario; MERMAS/DANO mín. 15 chars; SALDO sin OC/recepción; sin delta; bodega |
| `CONTEO` | `performTransaction` con `ADJUST` y `INVENTORY_ADJUSTMENT` |
| `SALDO_PENDIENTE` | Guía `PENDING`; bodega distinta; pendiente insuficiente; **transacción única** (`performTransactionCore` + `syncSaldoPendienteIntoReceiptAndPo`); guía `COMPLETED` + OC `RECEIVED` |

Mock: `InventoryStockService.performTransaction` / `performTransactionCore`.

### 3.5 Spec: `inventory-items.service.spec.ts`

**Última ejecución:** 23 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `findItemLedger` | Código `IN`, bodega, OT, saldo pendiente, W2W, génesis |
| `search` | Query corta; sin hits; orden por ranking trgm |
| `create` | Categoría/UoM; part number duplicado; no `inventoryCode` manual |
| `update` | `inventoryCode` fijo; PN duplicado; nombre; lookup `IN####`; sin política bodega |
| `quickCreate` | Nombre; min/max bodega; SKU + política; PN duplicado |
| `remove` | FK → mensaje historial stock |

#### Pendiente (inventario)

- [ ] `performTransaction` integración con reservas (si se expone regla nueva)

### 3.6 Spec: `work-orders.service.spec.ts`

**Última ejecución:** 22 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `updateStatus` CLOSED / IN_PROGRESS | Cierre, downtime, stock, medidor, garantía, disponibilidad |
| `promoteBacklogItem` | `TO_TASK`, `TO_NEW_OT`, validación PENDING |

Mocks: `equipment-meter-sync` (`applyCurrentMeterChange`); `inventory-item-stock-policy.helper`; `EmailService` + `WARRANTY_NOTIFY_EMAILS`.

#### Pendiente (mantenimiento)

- [ ] `update` con reemplazo de repuestos y `stockReservation`

---

## 4. Compras: gobernanza y aprobaciones

Documentación de negocio: [../PURCHASE-GOVERNANCE.md](../PURCHASE-GOVERNANCE.md). Flujos operativos: [../PURCHASE-FLOWS.md](../PURCHASE-FLOWS.md).

### 4.1 Servicios y funciones clave

| Pieza | Ruta | Rol en gobernanza |
|-------|------|-------------------|
| **`PurchaseOrdersService.approve`** | `features/purchases/purchase-orders.service.ts` | Motor de firma OC: ACL, `minAmount`, orden de niveles, estados `PENDING_APPROVAL` / `PARTIALLY_APPROVED` / `APPROVED`, hash de integridad |
| **`PurchaseSettingsService`** | `features/purchases/purchase-settings.service.ts` | Matriz ACL: `getSettings`, `upsertPolicies` (deleteMany + createMany por nivel), validación usuarios del tenant |
| **`resolveApprovalPolicyForUser`** | `features/tenant-roles/tenant-role-defaults.ts` | Función **pura**: primera política (menor `level`) donde `user.id` ∈ `allowedUsers` |
| Paridad frontend | `frontend/src/app/core/utils/approval-policy.util.ts` | Misma semántica que `resolveApprovalPolicyForUser` |

Modelos Prisma: `PurchaseSettings`, `ApprovalPolicy`, `ApprovalPolicyUser`, `PurchaseOrderApproval`.

### 4.2 Spec: `tenant-role-defaults.spec.ts`

**Última ejecución:** 5 passed (2026-05-22). Sin Prisma.

| Caso | Comportamiento |
|------|----------------|
| Usuario en niveles 1 y 2 | Devuelve política de **menor level** (1) |
| Usuario solo en nivel 2 | Devuelve nivel 2 |
| Usuario ausente del ACL | `undefined` |
| `allowedUsers` vacío | Sin match |
| Arreglo desordenado | Documenta que el caller debe enviar `orderBy: level asc` |

### 4.3 Spec: `purchase-settings.service.spec.ts`

**Última ejecución:** 8 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `getSettings` | Bootstrap de `PurchaseSettings` si no existe fila por tenant |
| `updateSettings` | Moneda y `invoiceMatchTolerancePercent` (3-way) |
| Validaciones `upsertPolicies` | Niveles duplicados; nivel sin `userIds`; `userId` de otro tenant |
| Transacción `upsertPolicies` | Reemplazo ACL; bloqueo al eliminar nivel con firmas históricas; creación de política nueva |

### 4.4 Spec: `purchase-orders.service.spec.ts`

**Última ejecución:** 47 passed (2026-05-22).

Mocks: `jest.mock('./purchase-contract-access.util')`; `AuditService.log`; servicios de notificación/correo/storage en stub.

| Caso | Resultado |
|------|-----------|
| OC inexistente | `NotFoundException` |
| Estado no pendiente | `BadRequestException` |
| Doble firma mismo usuario | `ConflictException` |
| Sin política ACL | `ForbiddenException` |
| Nivel usuario &gt; `requiredSignatures` | `BadRequestException` |
| `totalAmount` &lt; `minAmount` | `BadRequestException` |
| Nivel 2 sin firma previa nivel 1 | `BadRequestException` |
| Nivel ya firmado por otro | `ConflictException` |
| Firma nivel 1, `requiredSignatures: 2` | `PARTIALLY_APPROVED` + `PurchaseOrderApproval` |
| Única firma requerida | `APPROVED` |
| Sin acceso al contrato | `ForbiddenException` antes de cargar políticas |

#### `describe` reject

| Caso | Resultado |
|------|-----------|
| OC inexistente | `NotFoundException` |
| Estado no pendiente | `BadRequestException` |
| Happy path | `REJECTED` + `audit.log` STATUS_CHANGE |
| Sin motivo | Conserva `notes` previas |

#### `describe` cancel

| Caso | Resultado |
|------|-----------|
| OC inexistente | `NotFoundException` |
| Sin motivo | `BadRequestException` |
| Estado RECEIVED/CLOSED/CANCELLED | `BadRequestException` |
| Recepciones PARTIAL/COMPLETED | `BadRequestException` |
| Happy path | `CANCELLED` + auditoría |
| Con SRC vinculado | `requisitionItem.updateMany` libera adjudicación + audit REQUISITION |

#### `describe` markAsSentToSupplier

| Caso | Resultado |
|------|-----------|
| OC inexistente | `NotFoundException` |
| No APPROVED | `BadRequestException` |
| Happy path | `SENT` + `sentAt` + audit `marked_sent_to_supplier` |

#### `describe` updateSensitiveFields

| Caso | Resultado |
|------|-----------|
| OC inexistente | `NotFoundException` |
| Estado no editable | `BadRequestException` |
| Con firmas previas | `deleteMany` aprobaciones + `PENDING_APPROVAL` |
| Monto ≥ umbral tenant | `requiredSignatures: 3` |
| Cambio de líneas | `deleteMany`/`createMany` + audit `po_line_quantity_changed` |
| Tras edición | Web Push `PURCHASE_ORDER_PENDING_SIGNATURE` |

#### `describe` resetToDraft / forceClose / notificaciones

| Bloque | Casos clave |
|--------|-------------|
| `resetToDraft` | Solo `REJECTED`; borra `purchaseOrderApproval`; `DRAFT` |
| `forceClose` | Solo `PARTIALLY_RECEIVED`; justificación; `CLOSED` + cierra guías `PENDING`/`PARTIAL` |
| `notificaciones post-firma` | Tras `approve` parcial → push `PURCHASE_ORDER_PENDING_SIGNATURE` al nivel 2 |

### 4.5 Spec: `purchase-credit-notes.service.spec.ts`

**Última ejecución:** 8 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `create` | Monto/fecha inválidos; OC/factura; `P2002` → `ConflictException`; audit + `validateInvoiceMatch` × N facturas activas |
| `remove` | Not found; delete + revalidación |
| `findByPurchaseOrder` | Listado con acceso a contrato |

### 4.6 Spec: `signature.util.spec.ts`

**Última ejecución:** 4 passed (2026-05-22). Sin Nest/Prisma.

Hash SHA-256 determinista, sensibilidad a cambios de payload, `verifySignatureIntegrity`.

### 4.7 Spec: `purchase-invoices.service.spec.ts`

**Última ejecución:** 12 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `computeReceivedAmountForPurchaseOrder` | Suma qty×costo; cero sin recepciones |
| `validateInvoiceMatch` | Not found; PAID; **MATCHED** (OC + factura + recepción); **DISCREPANCY** por monto vs OC; DISCREPANCY por factura &gt; recepcionado |

Mock: `purchase-requisition-auto-close.util`, `purchase-contract-access.util`; `activityLog.findMany` para `attachInvoiceMeta`.

#### `describe` overruleThreeWayMatch

| Caso | Resultado |
|------|-----------|
| Justificación &lt; 15 caracteres | `BadRequestException` |
| Factura inexistente | `NotFoundException` |
| Estado ≠ DISCREPANCY | `BadRequestException` |
| Factura &gt; recepcionado | `BadRequestException` |
| Short-shipment (factura ≤ recepción, ≠ OC) | `MATCHED` + `threeWayMatchOverruled` + activity log |

### 4.8 Spec: `warehouse-receipts.service.spec.ts`

**Última ejecución:** 14 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `findAll` | ADMIN tenant-wide; USER `allowedContracts`; búsqueda `correlative` |
| `confirm` | Sin delta; guía completada; delta parcial + CPP; OC `RECEIVED` |
| `updateItems` | Guía `COMPLETED`; bajo `quantityConfirmed`; sobre-recepción OC; `receipt_progress_saved` |
| `create` | Guía `PENDING` duplicada; bodega otro contrato; `quantityExpected` con recepciones previas |

Mocks: `findById` (spy), `purchase-contract-access.util`, `inventory-item-stock-policy.helper`, `InventoryStockService.clearPendingRegularizationFlags`.

#### `describe` createOrdersFromRequisition / notify batch (en `purchase-orders.service.spec.ts`)

| Bloque | Casos |
|--------|-------|
| `createOrdersFromRequisition` | SRC inexistente; sin adjudicación; idempotente; split OC + audit + push batch |
| `notifyApproversForPendingSignatureBatch` | `PURCHASE_ORDER_BATCH_PENDING_SIGNATURE`; vacío → no-op |

### 4.9 Spec: `purchase-requisitions.service.spec.ts`

**Última ejecución:** 38 passed (2026-05-22).

| Bloque | Casos |
|--------|-------|
| `create` | Contrato inválido; sin líneas; borrador + correlativo |
| `duplicate` | Delega en `create` con `[Copia]` |
| `selectQuotation` | Estado; cotización inexistente; ganadora + `PENDING_APPROVAL` |
| `saveLineAwards` | Estado inválido; duplicados; cotización incorrecta; `PENDING_APPROVAL` |
| `submit` | No DRAFT; sin líneas; `SUBMITTED` + audit |
| `cancel` | Motivo; estados; OC vinculada; happy path |
| `startQuoting` | Solo `SUBMITTED`; pasa a `QUOTING` |
| `addQuotation` | Estado; ítems; total; crea cotización + `QUOTING` |
| `findAll` | Filtro contrato; `USER` + `allowedContracts` |
| `update` | DRAFT/QUOTING/SUBMITTED; `PENDING_APPROVAL` / `PARTIALLY_PURCHASED` (compras); ítem en cotización |

Mocks: `purchase-quotation-status-sync.util`, `purchase-requisition-reconciliation.util`, `purchase-contract-access.util` (`requireActual`).

#### Pendiente (compras)

- [ ] PDF OC / recepción (Playwright en CI)

---

## 5. Checklist al añadir un spec nuevo

1. Crear `*.service.spec.ts` junto al servicio (o `*.util.spec.ts` para funciones puras).
2. Registrar el archivo en la tabla §2 de este documento.
3. Documentar bloques `describe` en §3 / §4 según módulo.
4. Ejecutar `npm test -- <nombre>.spec` y anotar fecha + conteo de tests pasando.
5. No commitear secretos ni `.env` en fixtures.

---

## 6. Referencias

- Índice maestro y flujo watch: [pruebas-unitarias.md](pruebas-unitarias.md).
- Reglas agente: `.cursor/rules/testing-baselogic.mdc`, `tpm-arquitectura.mdc` §6.
- Inventario dominio: [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md).
- Compras ACL: [../PURCHASE-GOVERNANCE.md](../PURCHASE-GOVERNANCE.md).
- Git / QA futuro: [entornos-git-despliegue.md](entornos-git-despliegue.md).
