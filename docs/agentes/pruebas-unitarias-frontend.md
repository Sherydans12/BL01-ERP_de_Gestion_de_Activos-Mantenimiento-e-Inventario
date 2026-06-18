# Pruebas unitarias — frontend Angular 18

Complementa el índice maestro [pruebas-unitarias.md](pruebas-unitarias.md). El **foco actual del proyecto** está en el backend de dominio (212 tests); el frontend tiene sobre todo **smoke** (`should be created`).

**Última actualización:** 2026-06-18 (W2W multi-contrato)

**Suite ejecutable hoy:** **187 tests** verificados con `npm run test:ci` el 2026-06-07.

---

## 1. Convenciones obligatorias

| Regla | Detalle |
|-------|---------|
| Framework | Jasmine + Angular `TestBed` (`ng test`) |
| Standalone | `imports: [MiComponente]` — **no** `declarations` ni NgModules |
| Signals | `.set()` / `.update()` en tests; asertar `computed()` |
| HTTP | Mock `HttpClientTestingModule` o spy del servicio |
| PBAC en UI | `*appHasPermission` y guards — mockear permisos o no renderizar según spec |
| Plantillas | Proyecto usa `@if` / `@for`; no reintroducir `*ngIf` en tests de plantilla |
| Estructura | `describe` / `it` en español; happy path + errores (validación, 403, vacío) |

---

## 2. Inventario actual

| Archivo | Tipo | Estado |
|---------|------|--------|
| `app.component.spec.ts` | App | Smoke |
| `core/services/auth/auth.service.spec.ts` | Servicio | Smoke |
| `core/services/warehouses/warehouses.service.spec.ts` | Servicio | Smoke + `getWarehousesForTransfer()` usa `scope=transfer` |
| `core/services/inventory-stock/inventory-stock.service.spec.ts` | Servicio | Smoke |
| `core/services/inventory-items/inventory-items.service.spec.ts` | Servicio | Smoke |
| `features/inventory-items/inventory-item-list.component.spec.ts` | Componente | Smoke |
| `features/inventory-items/inventory-item-form.component.spec.ts` | Componente | Smoke |
| `features/inventory-stock/stock-dashboard.component.spec.ts` | Componente | Smoke |
| `features/inventory-transfer/inventory-transfer.component.spec.ts` | Componente | Carga bodegas W2W por scope, origen A/destino B, usuario solo A, `canConfirmReception` por destino |
| `features/warehouses/warehouse-form.component.spec.ts` | Componente | Smoke |
| `features/warehouses/warehouse-list.component.spec.ts` | Componente | Smoke |
| `features/maintenance-kits/kit-form.component.spec.ts` | Componente | Smoke |
| `features/maintenance-kits/kit-list.component.spec.ts` | Componente | Smoke |
| `features/operations/lube-reports/lube-report-list.component.spec.ts` | Componente | Smoke |
| `features/operations/lube-reports/lube-report-form.component.spec.ts` | Componente | Smoke + horómetro regresivo; líneas con `FormControl`; notifica `FleetService.notifyEquipmentChanged` tras despacho exitoso (8 tests) |
| `shared/components/fluid-quantity-row/` | Componente | *(sin spec dedicado aún — validación vía formularios M1/OT)* |
| `features/operations/availability/availability-form.component.spec.ts` | Componente | Bulk grid, `queryParamMap`, `ShiftService.coerceShift`, `batchCreate`, `sideEffects` y refresh Flota |
| `features/operations/availability/availability-monitor.component.spec.ts` | Componente | Shift-board, summary, pendientes, mocks `ShiftService`/Auth alineados |
| `features/operations/availability/availability-import.component.spec.ts` | Componente | Export/preview/commit Excel, coerción de turno, mocks `ShiftService`/Flota |
| `features/operations/fault-reports/fault-report-form.component.spec.ts` | Componente | Smoke + `notifyEquipmentChanged` HIGH/LOW y limpieza de pendiente M2 (18 tests) |
| `features/operations/fault-reports/fault-report-list.component.spec.ts` | Componente | Smoke |
| `features/fleet/fleet-master/fleet-master.component.spec.ts` | Componente | Smoke — `openDetail`, `fleet()`, `currentPage`; edición de medidor notifica `FleetService.notifyEquipmentChanged` (8 tests) |
| `features/fleet/equipment-detail-modal/equipment-detail-modal.component.spec.ts` | Componente | Smoke — `operationalStatus` HIGH/LOW, tabs lazy, M1/M2/M3, **tab OTs + modal OT embebido**, **consumos `partsConsumed`/`partsTotalCost`**, **costos `costTotal`/`costByType`/`costRecordsSorted`**, **Fase 3 `meterHistoryRows`: delta, orden ASC, traducción fuentes, userLabel, previewRows** (42 tests) |
| `features/fleet/components/equipment-meter-history-table/equipment-meter-history-table.component.spec.ts` | Componente | **Nuevo (Fase 3)** — DOM rendering: 2 filas caos en terreno, delta `+50 Hrs`, `Reporte de falla`/`Reporte de disponibilidad`, clases CSS `text-success`/`text-warning`, símbolo `—`, cabeceras (22 tests) |
| `features/meter-capture/registro-horas.component.spec.ts` | Componente | Captura masiva de horómetro: saltos altos, payload `confirmedLargeJump`, conflictos y notificación a Flota por lecturas aplicadas (8 tests) |
| `features/work-orders/work-order-form/work-order-form.component.spec.ts` | Componente | Banner de fallas `OPEN` (`openFaults`) + **stock de repuestos `stockForItem`/`partRowHasShortage`/`anyPartStockShortage`** (2.3); cierre de OT notifica a Flota cuando actualiza medidor final; sin render de template (componente grande), se prueba la lógica (13 tests) |

---

## 3. Ejecutar

```bash
cd frontend
npm test                 # Karma (watch interactivo en CLI)
ng test --watch=false    # una pasada (CI)
ng test --include='**/inventory-stock.service.spec.ts'  # filtrar (según versión CLI)
```

Para sesión TDD con el agente: terminal dedicada con `ng test` (watch por defecto en muchos setups).

---

## 4. Prioridad de ampliación sugerida

1. Servicios que encapsulan reglas visibles en UI: `inventory-stock`, `inventory-items`, auth (redirect PBAC).
2. Componentes con lógica en Signals: dashboards de stock, formularios con validación cruzada.
3. Paridad con backend: util `approval-policy.util.ts` (espejo de `resolveApprovalPolicyForUser`).

---

## 5. Checklist al añadir spec

1. Spec junto al `.ts` (`foo.component.spec.ts`).
2. Registrar en la tabla §2 de este archivo.
3. `ng test` en el archivo o suite afectada.
4. Alinear con tokens UI (`tpm-arquitectura.mdc` §5) si el test toca clases de tema.

---

## 6. Referencias

- Índice maestro: [pruebas-unitarias.md](pruebas-unitarias.md)
- Backend (fuente de verdad de reglas de negocio): [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md)
