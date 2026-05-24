# Decisiones de diseño (ligero)

Añadí entradas con fecha cuando un chat o una reunión fije algo importante. Formato sugerido:

```
## YYYY-MM-DD — Título corto
- Contexto: …
- Decisión: …
- Consecuencias: …
```

## 2026-05-24 — Migración W2W: ALTER condicional (orden vs tablas futuras)

- **Contexto:** `20260414170504` hacía `ALTER TABLE unit_of_measures` antes de que existiera la tabla (`20260417100000`); QA en bucle P3018.
- **Decisión:** ALTER/índices de `item_categories`, `unit_of_measures`, `warehouse_bins` solo si la tabla/columna existe; script `prisma-migration-checksum.mjs` para prod si cambia checksum.
- **Consecuencias:** QA: redeploy backend o borrar `pgdata-qa`. Prod ya migrado: actualizar checksum en `_prisma_migrations` tras deploy.

## 2026-05-24 — Dominios QA: `qa.baselogic.cl` + `qa-api.baselogic.cl`

- **Contexto:** `qa.app.*` / `qa.api.*` no entran en el wildcard gratuito `*.baselogic.cl` de Cloudflare (dos niveles).
- **Decisión:** Front `https://qa.baselogic.cl`, API `https://qa-api.baselogic.cl`; plantilla `deploy/qa.env.example` y [coolify-qa-setup.md](coolify-qa-setup.md) actualizados.
- **Consecuencias:** Tras cambio DNS, actualizar variables Coolify y **rebuild** frontend (`QA_API_URL`, `FRONTEND_URL`).

## 2026-05-22 — Stack Coolify QA (`docker-compose.qa.yml`)

- **Decisión:** Compose QA, `environment.qa.ts` + build args en `frontend/Dockerfile`, plantilla `deploy/qa.env.example`, guía [coolify-qa-setup.md](coolify-qa-setup.md).
- **Consecuencias:** Coolify puede desplegar rama `develop` con dominios QA aislados; usuario completa DNS + variables en panel.

## 2026-05-22 — Smoke Jest + CI GitHub + rama `develop` (QA)

- **Decisión:** `backend/test/jest-setup.ts` (mock `file-type`); specs smoke con deps/guards; workflow `.github/workflows/backend-tests.yml` (`test:domain` + `npm test` en `main`/`develop`); rama remota **`develop`** para staging.
- **Consecuencias:** Suite completa **220 tests** verde. Pendiente usuario: subdominio QA + segunda app Coolify (checklist §4 en `entornos-git-despliegue.md`).

## 2026-05-22 — Suite N+16: downtime OT + factura parcial 3-way + OC elegibles recepción

- **Decisión:** OT +3 (fechas invertidas, `cumulativeDowntimeHours`); `purchase-invoices.create` +3 (encadena 3-way en `PARTIALLY_RECEIVED`); `findEligibleForWarehouseReceipt` +2; mock `purchase-contract-access` con `requireActual` en specs OC.
- **Consecuencias:** Suite dominio **263 tests**.

## 2026-05-22 — Suite N+15: validaciones cierre OT + costo equipo en recepción

- **Decisión:** `work-orders` +4 (detención, atención mecánica, operativo, `assetCostRecord`); `warehouse-receipts.confirm` +1 (imputación `PURCHASE` con `equipmentId`).
- **Consecuencias:** Suite dominio **255 tests** (OT 12, recepción 19).

## 2026-05-22 — Suite N+14: OT fluidos/medidor/garantía + recepción multi-línea

- **Decisión:** `work-orders.service.spec` +5 (fluidos, medidor, `applyCurrentMeterChange`, correo `POSIBLE_GARANTIA`); `warehouse-receipts.confirm` +1 (mix inventario/gasto directo).
- **Consecuencias:** Suite dominio **250 tests** (OT 8, recepción 18).

## 2026-05-22 — Suite N+13: cierre OT con stock + revoca overrule 3-way

- **Decisión:** Nuevo `work-orders.service.spec` (3, cierre CLOSED); `validateInvoiceMatch` revoca overrule si `!matchReceived`; `test:domain` con 13 suites.
- **Consecuencias:** Suite dominio **244 tests**.

## 2026-05-22 — Suite N+12: recepción confirm + 3-way facturas

- **Decisión:** `warehouse-receipts` +3 (`confirm` sobre-recepción, bodega inactiva, gasto directo); `purchase-invoices` +4 (tolerancia, NC neto, overrule ACL y tope recepción).
- **Consecuencias:** Suite dominio **240 tests** (recepción 17, facturas 16 en spec).

## 2026-05-22 — Suite N+11: resetToDraft, edición OC post-envío, W2W recepción

- **Decisión:** `purchase-orders` +3; `inventory-transfer` +4 (validaciones execute/confirm + política destino).
- **Consecuencias:** Suite dominio **233 tests**. `updateSensitiveFields` no valida recepciones (solo estados); anulación sí (`cancel`).

## 2026-05-22 — Suite N+10: OC parcial, SRC delete línea, performReturn sin stock

- **Decisión:** `purchase-orders` +4 (reject vs recepción parcial, cancel sin guías, forceClose audit); `purchase-requisitions` +1 (delete línea); `inventory-stock` +1 (política en primera devolución).
- **Consecuencias:** Suite dominio **227 tests**.

## 2026-05-22 — Suite N+9: SRC post-adjudicación + update sin política bodega

- **Decisión:** `purchase-requisitions` +3 (`PENDING_APPROVAL` permisos/cantidad; `PARTIALLY_PURCHASED` línea nueva); `inventory-items` +1 (DTO `update` omite `warehouseId`/min-max).
- **Consecuencias:** Suite dominio **222 tests**. Política de stock en alta sigue solo en `create`/`quickCreate`.

## 2026-05-22 — Suite N+8: SRC `update` SUBMITTED + `InventoryItemsService.update`

- **Decisión:** `purchase-requisitions` +2 (`update` SUBMITTED OT/equipo, forbidden vínculos); `inventory-items` +4 (`update`: código fijo, PN, nombre, lookup `IN####`). UUIDs de fixture en formato v4 válido (`UUID_PARAM_RE`).
- **Consecuencias:** Suite dominio **218 tests**. Siguiente N+9: edición SRC post-adjudicación, política bodega en update.

## 2026-05-22 — Suite N+7: SRC `update` + `quickCreate` catálogo

- **Decisión:** `purchase-requisitions` +5 (`update`: permisos QUOTING/SUBMITTED/DRAFT, líneas, cotización); `inventory-items` +4 (`quickCreate`: validaciones, política bodega, PN duplicado).
- **Consecuencias:** Suite dominio **212 tests** (inventario 93 + compras 119). Pendiente commit/push; siguiente N+8: `update` SUBMITTED happy path, `InventoryItemsService.update`.

## 2026-05-22 — Suite N+6: SRC create/duplicate/selectQuotation + catálogo

- **Decisión:** `purchase-requisitions` +7 (`create`, `duplicate`, `selectQuotation`); `inventory-items` +7 (`search`, `create`, `remove`).
- **Consecuencias:** Suite dominio **203 tests**. Siguiente: `update` SRC, `quickCreate` artículo, cobertura CI opcional.

## 2026-05-22 — Documentación y reglas maestras de testing + scripts `test:domain`

- **Contexto:** Suite de dominio ~212 tests; reglas del usuario (BaseLogic EAM) y necesidad de que agentes ejecuten Jest al editar sin depender de PostgreSQL.
- **Decisión:** Índice [`pruebas-unitarias.md`](pruebas-unitarias.md), regla Cursor `testing-baselogic.mdc`, workflow en `tpm-arquitectura.mdc` §6; scripts `npm run test:domain` y `test:domain:watch` en `backend/package.json`; doc frontend y [`entornos-git-despliegue.md`](entornos-git-despliegue.md) para QA futuro.
- **Consecuencias:** Agentes deben correr `test:domain` al cerrar cambios de dominio; `npm test` completo puede fallar en smoke de controladores (ESM `file-type`) hasta remediar.

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
