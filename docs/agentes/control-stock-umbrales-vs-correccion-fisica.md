# Control de stock — umbrales vs corrección física

En **Control de stock** (`/app/inventario/stock`, `stock-dashboard`) conviene no mezclar dos intenciones de usuario:

| Intención | Acción en tabla | API / efecto |
|-----------|-----------------|----------------|
| Definir **mínimo / máximo** de alerta y **ubicación** en la bodega (sin tocar cantidades) | Botón **Umbrales** | `PATCH` vía `InventoryStockService.updateStockLevels` → `minStock`, `maxStock`, `location` en `ItemStock` |
| Corregir **cantidad física** (conteo, merma, daño, saldo pendiente) | Botón **Corregir físico** | `createPhysicalAdjustment` únicamente (sin `updateStockLevels` desde este modal) |

## Reglas para el agente

1. **No volver a unificar** en un solo formulario obligatorio el campo «Nuevo stock físico contado» con los umbrales mín/máx: genera fricción y mensajes de confirmación incorrectos (valorización / kardex) para quien solo quiere política de reposición.
2. La **edición rápida de ubicación** en la columna «Ubicación» (inline) y el modal **Umbrales** son los únicos sitios para cambiar pasillo/estante; el modal **Corregir físico** solo muestra ubicación en **solo lectura**.
3. El modal **Corregir físico** muestra los umbrales actuales en **solo lectura** y remite al botón **Umbrales** para editarlos.
4. El diálogo de confirmación del ajuste físico aplica solo cuando hay **delta de cantidad** respecto al sistema.

## Archivos

- `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.ts` — `policyLevelsForm`, `openPolicyLevelsModal`, `submitPolicyLevels`, `submitAdjustment` / `confirmAdjustment` (solo `createPhysicalAdjustment`).
- `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.html` — dos botones en «Acciones» y dos `<dialog>`.

## Flujos relacionados en el mismo módulo

- **Regularizaciones pendientes** (`pending-regularization-modal`): abre **Corregir físico** (`openAdjustModal`) porque el caso de negocio es discrepancia de cantidad, no umbrales.
- **Operación de almacén** (entrada/salida en el mismo dashboard): distinta intención (movimiento IN/OUT); no toca esta separación.
- **Salida a terreno** (`FIELD_OUT`): el `GlobalItemPicker` usa `onlyWithStockInWarehouse=true` y `allowQuickAdd=false` (solo ítems con saldo en la bodega seleccionada; sin alta rápida). Entrada por compra y devolución OT siguen el catálogo global (`GLOBAL_ITEM_PICKER_CATALOG`).
