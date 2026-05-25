# Operaciones × Inventario — pruebas E2E Playwright (OT / kardex / reservas)

**Fecha:** 2026-05-24  
**Estado:** **CERRADO** — suite cruzada OT × inventario en verde (`5/5`), commit local en `develop` (sin push).  
**Alcance:** ciclo reserva → consumo parcial → cierre con `WORK_ORDER_ISSUE`, negativos de horómetro y aislamiento bodega/contrato.

| Capa | Comando | Resultado |
|------|---------|-----------|
| **E2E Playwright** | `E2E_SKIP_WEBSERVER=1 npm run test:operaciones:ot-inventory` | **5/5 verdes** (1 spec serial + negativos) |

Relacionado: [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md), [control-stock-umbrales-vs-correccion-fisica.md](control-stock-umbrales-vs-correccion-fisica.md), [pbac-matriz-verificacion.md](pbac-matriz-verificacion.md), [inventario-pbac-pruebas-api-e2e.md](inventario-pbac-pruebas-api-e2e.md).

---

## Prerrequisitos

| Requisito | Detalle |
|-----------|---------|
| Backend | `cd backend && npm run start:dev` → `:3000` |
| Frontend | `cd frontend && npm start` → `:4200` |
| Tenant | `TENANT_CODE=TPM`, contratos activos (≥2 para test de aislamiento), bodegas con stock |
| Seeds | `npm run seed:operaciones-pbac-personas` + `npm run seed:inventario-pbac-personas` (admin inventario para top-up de stock E2E) |

---

## 1. Personas seed (Operaciones)

```bash
cd backend
npm run seed:operaciones-pbac-personas
```

| Email | Permisos clave | Rol en E2E |
|-------|----------------|------------|
| `pbac-operaciones-planificador@test.com` | `work-order:create/update/assign/close`, `inventory:stock:read`, `warehouse:read` | Fase A/C — crear OT, asignar supervisor, cerrar |
| `pbac-operaciones-mecanico@test.com` | `work-order:execute/close`, lectura inventario | Fase B — `IN_PROGRESS`, ajuste qty repuestos |

**Contraseña:** `PBAC_TEST_PASSWORD` (default `Test1234!`).

Bootstrap incluido: equipo **CA-01** (si no hay equipos en contrato primario) y bodega en contrato secundario para probes de aislamiento.

---

## 2. Suite E2E — `e2e/tests/operaciones/cross-module-ot-inventory.spec.ts`

```bash
cd e2e
E2E_SKIP_WEBSERVER=1 npm run test:operaciones:ot-inventory
# o grupo completo operaciones:
E2E_SKIP_WEBSERVER=1 npm run test:operaciones
```

### Escenarios

| # | Test | Qué valida |
|---|------|------------|
| 1 | fase A — planificador | UI crea OT con 5 repuestos → `StockReservation` (+5 reservado, físico intacto, disponible −5) |
| 2 | fase B — mecánico supervisor | `IN_PROGRESS`, qty 3 en pestaña repuestos → reserva actualizada a 3, físico aún intacto |
| 3 | fase C — cierre | API `CLOSED` + badge `CERRADA` → reserva liberada, físico −3, kardex `WORK_ORDER_ISSUE` |
| 4 | negativo horómetro | API rechaza cierre si `finalMeter < initialMeter` |
| 5 | negativo contrato | POST OT con bodega de otro contrato → 400 |

Constantes: `RESERVE_QTY=5`, `CONSUME_QTY=3`.

### Comportamiento real del producto (vs. guion ideal)

| Expectativa operativa | Implementación TPM actual |
|-----------------------|---------------------------|
| Estado `PENDING_ASSIGNMENT` | Estado inicial **`OPEN`** |
| Botón «Registrar consumo» | Consumo = editar cantidad en **Repuestos y stock** + guardar; descuento físico al **cerrar** |
| Reserva al guardar repuestos | Sí, vía `stock_reservations` si hay `warehouseId` |
| Cierre UI «Firmar y cerrar OT» | Puede no renderizarse tras `loadWorkOrder` (computed `canCloseOt` no reacciona al patch del formulario); fase C usa **API** `PATCH …/status` con `closureEquipmentOperational` |

---

## 3. Helpers y “page objects” ligeros

No hay clases Page Object formales; helpers reutilizables en `e2e/helpers/`:

| Archivo | Responsabilidad |
|---------|-----------------|
| [`e2e/helpers/auth.ts`](../../e2e/helpers/auth.ts) | `apiLogin`, `seedBrowserSession`, `seedBrowserSessionWithContract`, `OPERACIONES_USERS` |
| [`e2e/helpers/api-operaciones.ts`](../../e2e/helpers/api-operaciones.ts) | `buildOtE2ESetup`, stock/reservas/ledger OT, `updateWorkOrderStatus`, `findWarehouseInOtherContract` |
| [`e2e/helpers/ot-form.ts`](../../e2e/helpers/ot-form.ts) | `fillOtCreateForm`, `addPartLineWithPicker`, `saveOtForm`, `closeOtFromForm` |
| [`e2e/helpers/item-picker.ts`](../../e2e/helpers/item-picker.ts) | `pickCatalogItem` — dialog `[open]`, búsqueda picker |
| [`e2e/helpers/ui.ts`](../../e2e/helpers/ui.ts) | `waitForPageReady`, `selectOptionWhenReady`, `selectFirstNonEmptyOption` |
| [`e2e/helpers/api-inventario.ts`](../../e2e/helpers/api-inventario.ts) | `performStockIn`, `getWarehouseStock`, `getItemLedger` (top-up vía admin inventario) |
| [`e2e/fixtures/operaciones.fixture.ts`](../../e2e/fixtures/operaciones.fixture.ts) | Extiende Playwright con probe `backendAvailable` |

### Sesión multi-usuario

1. `apiLogin(email)` — captcha + JWT con permisos PBAC.  
2. `seedBrowserSessionWithContract(page, email, contractId)` — inyecta `tpm_token`, `tpm_user` (con `permissions`), `tpm_contract_id`.  
3. Cambio de persona entre fases: nueva llamada a `seedBrowserSessionWithContract` (sin logout UI).

### Tiempos de espera (Angular 18 / Signals)

| Acción | Timeout típico | Notas |
|--------|----------------|-------|
| `waitForPageReady` | 15–25 s | Tras `goto` en layout autenticado |
| Picker catálogo | 10–25 s | `dialog[open]` + respuesta `/inventory-items/picker` |
| Select bodega post-equipo | 800 ms + 20 s enable | Label «Bodega de consumo» (no `formControlName`) |
| Guardar OT | 30 s | `Promise.all` click + `waitForResponse` POST/PATCH |
| Listado OT / badge | 20–25 s | Correlativo o texto `CERRADA` |

---

## 4. Fix backend descubierto en E2E

Al vincular repuestos cuyo ítem solo tiene `inventoryCode` (sin `partNumber`), `WorkOrdersService.create` fallaba con Prisma (`partNumber` requerido). Corrección: `resolveWorkOrderPartNumber()` usa `partNumber → inventoryCode → name` en create/update.

---

## 5. Checklist agente

- [ ] `develop` activa, backend + frontend locales  
- [ ] Seeds operaciones + inventario  
- [ ] `E2E_SKIP_WEBSERVER=1 npm run test:operaciones:ot-inventory` → exit 0  
- [ ] No incluir `.xlsx` untracked en commits  
