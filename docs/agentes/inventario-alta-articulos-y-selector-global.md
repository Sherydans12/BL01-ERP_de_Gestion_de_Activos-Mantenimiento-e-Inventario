# Alta de artículos, política de stock por bodega y selector global

Resumen de mejoras **2026-05** alineadas con multi-bodega (`item_stocks`) y UX del catálogo.

## 1. Umbrales sin fila `item_stocks` hasta el primer movimiento

- **Problema:** Crear artículo con bodega + mín/máx generaba una fila en `item_stocks` con **cantidad 0**, mezclando “posición real” con “solo política”.
- **Solución:** Tres columnas opcionales en `inventory_items` (migración `20260516210000_inventory_item_stock_policy_columns`):
  - `policy_target_warehouse_id`
  - `policy_min_stock`
  - `policy_max_stock`
- Al guardar desde **POST `/inventory-items`** o **quick-create** con bodega, se persisten esos valores **sin** crear `item_stocks`.
- En el **primer movimiento** que cree la fila en **esa misma bodega** (recepción OC, transferencia entrada, `performTransaction`, devolución OT, cierre OT, ajuste de umbrales en control de stock, etc.), se copian mín/máx a la nueva fila y se **limpian** las tres columnas de política en el maestro.
- Helper compartido: `backend/src/features/inventory-items/inventory-item-stock-policy.helper.ts`.

## 2. Alta maestro `/app/articulos/nuevo`

- Sección opcional (**`<details>`**) para bodega + mín/máx: misma regla que arriba (política pendiente, no posición con saldo 0).
- Textos UI acotados: “no crea fila con cantidad 0”, “al primer ingreso”.

## 3. Modal rápido en compras (`QuickAddItemModal`)

- Sin campos de mín/máx en UI; con `warehouseId` de contexto el backend guarda política **0/0** en el maestro hasta el primer movimiento (mismo modelo que §1).

## 4. Selector / crear artículo: misma base entre módulos

- Constante **`GLOBAL_ITEM_PICKER_CATALOG`** en  
  `frontend/src/app/shared/components/global-item-picker/global-item-picker.catalog.ts`  
  (`strictFamilyFirst`, `allowQuickAdd`, `onlyWithStockInWarehouse`, `titleMaster`).
- **Control de stock** (movimiento de almacén) y **requerimiento de compra** (y **detalle OC** para flags comunes) enlazan esos valores para no desalinear UX.
- **`warehouseId`** sigue siendo responsabilidad de cada pantalla (stock pasa la bodega seleccionada; SRC no tiene bodega fija en el picker).
- **Quick-add desde el picker:** usar **`overlayInsideDialog=false`** en `GlobalItemPicker` (overlay `fixed`). Con `true` se rompe el flujo **Nuevo movimiento** + catálogo (dos `<dialog>` nativos). Ver [ui-quickadd-global-picker-dialogos-nativos.md](ui-quickadd-global-picker-dialogos-nativos.md).

## 5. Rutas de código útiles

| Área | Archivo / ruta |
|------|-----------------|
| Catálogo picker | `frontend/.../global-item-picker/` |
| Stock + movimiento | `frontend/.../stock-dashboard/` |
| SRC | `frontend/.../requisition-form/` |
| OC vincular línea | `frontend/.../purchase-order-detail/` |
| Política + Prisma | `backend/prisma/schema.prisma` (`InventoryItem`), migración citada |
| Crear / quick-create | `backend/.../inventory-items.service.ts` |

## 6. Despliegue

Tras pull: en `backend/` ejecutar **`npx prisma migrate deploy`** (o el flujo del entorno) para aplicar columnas nuevas.

---
*Índice agentes:* [README.md](README.md) · Inventario general: [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md)
