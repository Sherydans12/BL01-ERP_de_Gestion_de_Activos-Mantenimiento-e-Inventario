# Operaciones × Inventario — cobertura E2E Playwright y pendientes

**Versión:** 1.2 · **Actualizado:** 2026-06-05

Guía para continuar la suite **Playwright** (`e2e/`) tras el hardening de caos/resiliencia y ciclo de vida integrado (M1 → W2W → OT → medidor).

---

## 1. Inventario actual (67 tests · suite completa)

| Paquete | Specs | Script npm | Qué valida |
|---------|-------|------------|------------|
| **Compras PBAC** | `tests/compras/*.spec.ts` (6 archivos) | `npm run test:compras` | Navegación PBAC, P2P UI, gobernanza OC, páginas módulo |
| **Inventario PBAC** | `tests/inventario/*.spec.ts` (4) | `npm run test:inventario` | Catálogo, W2W, umbrales, ghost forms + **403 W2W lectura** |
| **OT × Inventario** | `tests/operaciones/cross-module-ot-inventory.spec.ts` | `npm run test:operaciones:ot-inventory` | Reserva → consumo → `WORK_ORDER_ISSUE`, aislamiento contrato |
| **Ciclo integrado** | `tests/e2e-operations-lifecycle.spec.ts` | `npm run test:operations:lifecycle` | Bodega móvil → ingreso → W2W → **M1 UI** → OT → historial medidor |
| **Caos / resiliencia** | `tests/e2e-chaos-resilience.spec.ts` | `npm run test:chaos` | Concurrencia M1, cronología medidor, fuga stock OT, bulk-sync horómetro |
| **P0 integridad** | `tests/e2e-operations-p0-integrity.spec.ts` | `npm run test:operations:p0` | `blockNegativeStock` M1+OT, M3 falla ALTA, correlativos `RCL-` / `RF-` |
| **P1 M2 disponibilidad** | `tests/e2e-operations-p1-m2-availability.spec.ts` | `npm run test:operations:p1` | Monitor Pendientes→Reportados, batch 2 equipos, `hasNightShift=false`, toggles empresa |

**Prerrequisitos locales:**

```bash
cd backend && npm run seed:inventario-pbac-personas && npm run seed:operaciones-pbac-personas
# Backend :3000 + frontend :4200
cd e2e && E2E_SKIP_WEBSERVER=1 npm test
```

**Helpers clave:** `e2e/helpers/api-operations-lifecycle.ts` (`resolveE2EPrimaryContractId`, `x-site-id` en OT), `api-tenant-config.ts` (`patchOperationalConfig`), `api-fault-reports.ts`, `api-equipment-availability.ts` (`getShiftBoard`, `batchCreateAvailability`), `operations-lifecycle.pom.ts` (`setReactiveInput`, modal flota **VER** → Historial de Medidores), `ui.ts` (`parseUiNumber` es-CL).

---

## 2. Puntos ciegos detectados (2026-06-04)

Estos huecos motivaron fallos reales o riesgo de regresión; parte ya está cubierta, el resto sigue pendiente de spec dedicado.

### 2.1 Backend / datos

| Punto ciego | Riesgo | Mitigación actual | Spec E2E pendiente |
|-------------|--------|-------------------|-------------------|
| **`sequence_counters.document_type` VARCHAR(10)** | POST M1/M3 → P2000 si el tipo supera 10 chars (`LUBE_REPORT`, `FAULT_REPORT`) | Códigos **`LUBE_RCL`**, **`FAULT_REP`** en servicios | **`test:operations:p0`** §4 smoke `RCL-` / `RF-` |
| **Contrato del fixture ≠ contrato planificador** | OT creada OK pero PATCH/status → «Orden no encontrada» (PBAC `allowedContracts`) | Bootstrap alineado vía `resolveE2EPrimaryContractId()` + header `x-site-id` | — (cubierto en chaos/lifecycle) |
| **`blockNegativeStock` por tenant** | M1/OT rechazan o permiten saldo negativo según toggle | **`test:operations:p0`** (API + UI M1) | — |
| **Reserva OT vs consumo real** | Patch qty > reserva + cierre silencioso | Chaos #3 (API) | UI: editar repuestos en OT en curso con badge stock |

### 2.2 Frontend / Playwright

| Punto ciego | Riesgo | Mitigación actual | Spec E2E pendiente |
|-------------|--------|-------------------|-------------------|
| **Reactive Forms + `type="number"`** | `fill()` no actualiza FormControl (M1 qty, registro horas) | Helper `setReactiveInput()` | Extender a OT repuestos/fluidos si fallan en CI |
| **Formato numérico es-CL en UI** | `5.020` parseado como `5.02` | `parseUiNumber()` en aserciones | Snapshot de tabla medidor con locale fijo |
| **Modal flota: HOJA DE VIDA ≠ ficha** | Test abría PDF, no historial | Click en ficha del equipo (`VER` / nombre) | Documentado en POM; no repetir selector HOJA DE VIDA |
| **Kardex OT en helpers** | Sumar solo `OUT` omitía `WORK_ORDER_ISSUE` | Fix en `sumLedgerOutQuantity` | — |

### 2.3 Infra / flakiness

| Punto ciego | Síntoma | Mitigación |
|-------------|---------|------------|
| Run largo (~10 min) | `ECONNRESET`, backend caído | Retry en `apiLogin`, `fetchWithRetry`, `gotoAppShell` |
| Captcha / rate limit login | 429 en suites PBAC | `PBAC_LOGIN_DELAY_MS`, retry captcha en `auth.ts` |
| Frontend no levantado | `ERR_ABORTED` / `ECONNREFUSED :4200` | `E2E_SKIP_WEBSERVER=1` solo si `:4200` y `:3000` activos |

---

## 3. Pruebas críticas a crear (prioridad sugerida)

### P0 — Integridad transversal — HECHO (2026-06-05)

Implementado en `tests/e2e-operations-p0-integrity.spec.ts` (`npm run test:operations:p0`). `beforeAll` activa `blockNegativeStock` vía API y restaura al finalizar.

1. ~~**`blockNegativeStock=true` — M1**~~ — API 400 + UI (botón deshabilitado o POST rechazado); kardex sin movimiento.
2. ~~**`blockNegativeStock=true` — OT cierre**~~ — consumo &gt; disponible → cierre 400; kardex delta 0.
3. ~~**M3 falla ALTA**~~ — `isOperational=false` + OT `NO_PROGRAMADA_REACTIVA`.
4. ~~**Correlativos M1/M3**~~ — smoke `RCL-` / `RF-`.

### P1 — M2 Disponibilidad y ajustes empresa — HECHO (2026-06-05)

Implementado en `tests/e2e-operations-p1-m2-availability.spec.ts` (`npm run test:operations:p1`). Turno **DAY** fijado en monitor/form para evitar desalineación nocturna; query `?tab=REPORTED` soportada en monitor.

| Ítem | Escenario | Estado |
|------|-----------|--------|
| 5 | Tab Pendientes → link **Reportar** (fila) → batch → tab Reportados | ✓ |
| 6 | Batch API 2 equipos `OPERATIONAL` en shift-board | ✓ |
| 7 | `hasNightShift=false` — sin selector turno; NIGHT → 400 | ✓ |
| 8 | Ajustes empresa: toggles persisten tras reload | ✓ |

Registro horas (salto regresivo) sigue cubierto parcialmente en **`test:chaos`** §4.

### P2 — Inventario × operaciones

1. **W2W + M1 misma bodega móvil** — transferencia parcial luego despacho M1 (stock coherente en picker).
2. **Consumo OT desde bodega otro contrato** — ya hay API en `cross-module-ot-inventory`; añadir variante UI planificador.
3. **PBAC M1 lectura** — usuario solo lectura no puede POST `/lube-reports` (403), análogo inventario W2W.

### P3 — Roadmap integrado (ver [`sistema-integrado-roadmap.md`](sistema-integrado-roadmap.md))

- Dashboard KPIs cruzados (equipos detenidos, fallas OPEN) — smoke de tiles + deep link.
- Push **EQUIPMENT_DOWN** / Sprint 4.2 anti-spam — fuera de Playwright; tests unitarios + contract API.
- Compras × flota (`AssetCostRecord` visible en modal) — assert en pestaña Consumos.

---

## 4. Convenciones para nuevos specs

1. **Contrato:** usar `resolveE2EPrimaryContractId()` al bootstrap; pasar `contractId` en APIs OT (`x-site-id`).
2. **Inputs Angular:** preferir `setReactiveInput()` sobre `fill()` en cantidades y medidores.
3. **Aserciones UI numéricas:** `parseUiNumber()` para horómetros con separador de miles.
4. **Teardown:** borrar equipos/ítems efímeros (`deleteEquipmentApi`, `teardownChaosFixture`) en `afterAll`/`finally`.
5. **Ledger OT:** incluir tipos `OUT`, `TRANSFER_OUT`, **`WORK_ORDER_ISSUE`** al sumar salidas.
6. **Documentar** nuevos specs en este archivo y en [`decisiones.md`](decisiones.md) si cambian reglas de negocio.

---

## 5. Referencias

| Recurso | Ruta |
|---------|------|
| Inventario PBAC E2E | [`inventario-pbac-pruebas-api-e2e.md`](inventario-pbac-pruebas-api-e2e.md) |
| Compras PBAC E2E | [`compras-pbac-pruebas-api-e2e.md`](compras-pbac-pruebas-api-e2e.md) |
| Roadmap integración | [`sistema-integrado-roadmap.md`](sistema-integrado-roadmap.md) |
| Pruebas unitarias dominio | [`pruebas-unitarias.md`](pruebas-unitarias.md) |
| Scripts Playwright | `e2e/package.json` |
