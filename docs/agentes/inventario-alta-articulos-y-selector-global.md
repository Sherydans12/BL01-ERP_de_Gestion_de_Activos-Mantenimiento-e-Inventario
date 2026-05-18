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
- **Correo `INVENTORY_ITEM_CREATED`:** desde 2026-05-18 el `POST /api/inventory-items/quick-create` dispara el mismo aviso por dispatcher (`ccEmails` del tenant) que el alta maestro `POST /api/inventory-items` (`inventory-items.service` → `quickCreate` / `create`).

### Dónde hay **+ Nuevo artículo** (`allowQuickAdd`)

`QuickAddItemModal` solo se monta dentro de **`app-global-item-picker`** y el botón **+ Nuevo artículo** solo aparece si la pantalla pasa **`[allowQuickAdd]="true"`** (o no lo sobreescribe: el componente default es `true`).

| Pantalla | Módulo (frontend) | Quick-add |
|----------|-------------------|-----------|
| Requerimiento de compra (líneas) | `requisition-form` | Sí (`GLOBAL_ITEM_PICKER_CATALOG`) |
| Detalle OC (vincular línea) | `purchase-order-detail` | Sí (misma constante) |
| Orden de trabajo (repuestos / fluidos) | `work-order-form` | Sí (no se enlaza el input; queda el default `true` del picker) |
| Control de stock — **Entrada por compra** o **Transferencia entre bodegas** (diálogo de movimiento) | `stock-dashboard` | Sí (`PURCHASE_IN`, `TRANSFER`) |
| Control de stock — Salida a terreno / Reingreso desde terreno / Devolución desde OT | `stock-dashboard` | **No** (`transactionItemPickerAllowQuickAdd()` en `false`) |
| Transferencia W2W (pantalla dedicada) | `inventory-transfer` | **No** (`[allowQuickAdd]="false"`; catálogo solo con stock en bodega **origen**) |

La pantalla **Transferencia W2W** (`inventory-transfer`) **no** es el mismo flujo que el radio «Transferencia entre bodegas» dentro del **diálogo de movimiento** de `stock-dashboard`: este último sí puede mostrar quick-add; el formulario W2W dedicado lo desactiva a propósito.

## 4. Selector / crear artículo: misma base entre módulos

- Constante **`GLOBAL_ITEM_PICKER_CATALOG`** en  
  `frontend/src/app/shared/components/global-item-picker/global-item-picker.catalog.ts`  
  (`strictFamilyFirst`, `allowQuickAdd`, `onlyWithStockInWarehouse`, `titleMaster`).
- **Control de stock** enlaza `allowQuickAdd` según tipo de movimiento (ver §3); **requerimiento** y **detalle OC** usan `GLOBAL_ITEM_PICKER_CATALOG`. La pantalla **W2W dedicada** (`inventory-transfer`) monta el mismo picker pero con **`allowQuickAdd` en false**.
- **`warehouseId`** sigue siendo responsabilidad de cada pantalla (stock pasa la bodega seleccionada; SRC no tiene bodega fija en el picker).
- **Quick-add desde el picker:** usar **`overlayInsideDialog=false`** en `GlobalItemPicker` (overlay `fixed`). Con `true` se rompe el flujo **Nuevo movimiento** + catálogo (dos `<dialog>` nativos). Ver [ui-quickadd-global-picker-dialogos-nativos.md](ui-quickadd-global-picker-dialogos-nativos.md).
- **Toasts sobre `<dialog>` nativo:** `NotificationService` + `app-toast` deben verse también con el picker abierto; ver [ui-notificaciones-toasts-top-layer.md](ui-notificaciones-toasts-top-layer.md) (Popover API / top layer).

## 5. Rutas de código útiles

| Área | Archivo / ruta |
|------|-----------------|
| Catálogo picker | `frontend/.../global-item-picker/` |
| Stock + movimiento | `frontend/.../stock-dashboard/` |
| SRC | `frontend/.../requisition-form/` |
| OC vincular línea | `frontend/.../purchase-order-detail/` |
| OT (picker de artículos) | `frontend/.../work-order-form/` |
| Transferencias W2W (picker; sin quick-add) | `frontend/.../inventory-transfer/` |
| Política + Prisma | `backend/prisma/schema.prisma` (`InventoryItem`), migración citada |
| Crear / quick-create | `backend/.../inventory-items.service.ts` |

## 6. Despliegue

Tras pull: en `backend/` ejecutar **`npx prisma migrate deploy`** (o el flujo del entorno) para aplicar columnas nuevas.

## 7. Disparadores HTTP de alta y detalle por `:id`

| Flujo UI típico | HTTP (prefijo global `/api`) |
|------------------|------------------------------|
| `/app/articulos/nuevo` (catálogo maestro) | `POST /inventory-items` → `InventoryItemsService.create` |
| Modal **+ Nuevo artículo** (`QuickAddItemModal` vía picker) | `POST /inventory-items/quick-create` → `quickCreate` |

- **Correo / motor de notificaciones** (`INVENTORY_ITEM_CREATED`): ambos POST disparan el mismo helper `dispatchInventoryItemCreatedMail` (catálogo en [CORREOS-SISTEMA.md](../CORREOS-SISTEMA.md)).
- **Número de parte duplicado** (`@@unique([tenantId, partNumber])`): respuesta **400** con mensaje que incluye **código de inventario (`IN####`) y nombre** del artículo existente; en carrera bajo transacción serializable se mapea **`P2002`** a ese mensaje cuando aplica.
- **`GET` / `PUT` / `DELETE` `/inventory-items/:id`** y subrutas (`:id/ledger`, `:id/attachments`, `:id/label`, etc.): el segmento `:id` acepta **UUID** del registro o **código de inventario** único por tenant (`IN####`), de modo que no se produzca error de tipo UUID en Postgres si el cliente armó la URL con el SKU.

---
*Índice agentes:* [README.md](README.md) · Inventario general: [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md)
