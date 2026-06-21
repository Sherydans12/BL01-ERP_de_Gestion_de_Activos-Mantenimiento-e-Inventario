# Auditoria Kardex: motivo de ajuste manual de stock

Fecha: 2026-06-20  
Alcance: auditoria estatica del flujo `/app/inventario/stock` -> `POST /api/inventory-adjustments` -> `InventoryTransaction` -> Kardex por bodega y Kardex global de articulo.

Actualizacion 2026-06-20: se implemento correccion acotada para alinear labels de motivos contables, agregar `ENTREGA_EPP` y mostrar el motivo real en Kardex global y por bodega.

## Resumen ejecutivo

El bug reportado literalmente ("Ajuste por inventario (conteo / hallazgo)" termina mostrado como "Daño o pérdida") **no se confirmo por inspeccion estatica**: en el codigo revisado no existia un label "Daño o pérdida" ni un mapper que convierta ajustes negativos a daño/pérdida. La brecha confirmada era que `CONTEO` se guardaba/parseaba como `Error de conteo`, distinto del label seleccionado por el usuario.

Tras la correccion, si se selecciona `CONTEO`, el frontend envia `reason: 'CONTEO'` y el backend guarda el movimiento `ADJUST` con `referenceType: 'INVENTORY_ADJUSTMENT'` y `notes: "Ajuste [Ajuste por inventario (conteo / hallazgo)]: <comentario>"`.

El parser frontend mantiene compatibilidad con notas antiguas `Ajuste [Error de conteo]: ...`, pero las muestra como `Ajuste por inventario (conteo / hallazgo)`. El motivo sigue embebido en `notes`; no se agrego columna estructurada en `InventoryTransaction`.

## 1. Opciones del select "Motivo contable"

Archivo: `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.html`

Opciones actuales:

| Label UI | Valor enviado |
|---|---|
| Ajuste por inventario (conteo / hallazgo) | `CONTEO` |
| Merma o pérdida | `MERMAS` |
| Daño | `DANO` |
| Entrega de EPP | `ENTREGA_EPP` |
| Saldo pendiente (compra / recepcion incompleta) | `SALDO_PENDIENTE` |

El formulario inicializa `reason: 'CONTEO'` en `stock-dashboard.component.ts`.

## 2. Valor real enviado al backend

Archivo: `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.ts`

`confirmAdjustment()` arma:

- `warehouseId`
- `itemId`
- `newPhysicalQuantity`
- `reason: v.reason`
- `comment`
- `purchaseOrderId` / `purchaseReceiptId` solo si `SALDO_PENDIENTE`

El cliente HTTP tipa `reason` como `'MERMAS' | 'CONTEO' | 'DANO' | 'SALDO_PENDIENTE' | 'ENTREGA_EPP'` en `frontend/src/app/core/services/inventory-stock/inventory-stock.service.ts`.

## 3. DTO/backend que recibe el ajuste

Archivos:

- `backend/src/features/inventory-adjustment/inventory-adjustment.controller.ts`
- `backend/src/features/inventory-adjustment/inventory-adjustment.service.ts`

El controlador expone `POST /inventory-adjustments` y delega el body a `InventoryAdjustmentService.create(dto, user)`.

El DTO esperado contiene:

- `warehouseId`
- `itemId`
- `newPhysicalQuantity`
- `reason`
- `comment`
- referencias de compra opcionales para `SALDO_PENDIENTE`

Codigos validos: `MERMAS`, `CONTEO`, `DANO`, `SALDO_PENDIENTE`, `ENTREGA_EPP`.

## 4. Donde se guarda el motivo

Modelo: `backend/prisma/schema.prisma`, `InventoryTransaction`.

No existe columna `reason` ni `adjustmentReason`. El motivo se guarda solo como texto en `notes`.

Mapeo backend:

| `reason` recibido | `notes` guardado | `referenceType` |
|---|---|---|
| `CONTEO` | `Ajuste [Ajuste por inventario (conteo / hallazgo)]: <comentario>` | `INVENTORY_ADJUSTMENT` |
| `MERMAS` | `Ajuste [Merma o pérdida]: <comentario>` | `INVENTORY_ADJUSTMENT` |
| `DANO` | `Ajuste [Daño]: <comentario>` | `INVENTORY_ADJUSTMENT` |
| `ENTREGA_EPP` | `Ajuste [Entrega de EPP]: <comentario>` | `INVENTORY_ADJUSTMENT` |
| `SALDO_PENDIENTE` | `Ajuste [Saldo pendiente] (OC: #...): <comentario>` | `PURCHASE_RECEIPT` |

La cantidad del movimiento es el delta: `newPhysicalQuantity - stockActual`. Para `ADJUST`, `InventoryStockService.performTransactionCore()` permite delta positivo o negativo, salvo `ENTREGA_EPP`, que se bloquea si `delta >= 0` en `InventoryAdjustmentService`.

## 5. Como se renderiza en Kardex

### Kardex global del articulo

Endpoint: `GET /inventory-items/:id/ledger` -> `InventoryItemsService.findItemLedger`.

Para `referenceType === 'INVENTORY_ADJUSTMENT'`, el backend entrega:

- `reference.kind = 'INVENTORY_ADJUSTMENT'`
- `reference.label = 'Ajuste de inventario'`
- `notes` con el motivo parseable

Frontend: `frontend/src/app/shared/components/item-ledger-table/`.

- Titulo de fila: `movementTitle(row)` muestra el motivo normalizado para `INVENTORY_ADJUSTMENT`, salvo saldo pendiente.
- Columna referencia: para ajustes manuales muestra el mismo motivo normalizado como link de detalle.
- Modal "Detalle de ajuste": parsea `notes` con `parseInventoryAdjustmentNotes()` y muestra `Motivo = Ajuste por inventario (conteo / hallazgo) / Merma o pérdida / Daño / Entrega de EPP / Saldo pendiente`.

Resultado: el motivo real aparece como titulo principal de la fila y en el modal de detalle.

### Kardex por bodega/articulo

Endpoint: `GET /inventory-stock/warehouse/:warehouseId/transactions?itemId=...` -> `InventoryStockService.getTransactionsByWarehouse()` + `enrichTransactionsTrace()`.

Para ajustes manuales `INVENTORY_ADJUSTMENT`, el backend no agrega `trace` especial; retorna `type`, `quantity`, `notes`, `referenceType`, usuario e item.

Frontend: `frontend/src/app/features/inventory-stock/stock-dashboard/`.

- Titulo de fila: `kardexMovementTitle(t)` muestra el motivo normalizado para `ADJUST` manual con `referenceType = 'INVENTORY_ADJUSTMENT'`, salvo saldo pendiente.
- La nota de auditoria se muestra debajo si `t.type === 'ADJUST' && t.notes`, separando `Motivo` y `Comentario`; notas antiguas `Error de conteo` se normalizan al label vigente.

Resultado: el motivo real se ve en titulo y en nota visible.

## 6. Mapper por signo del movimiento

No se encontro mapper que convierta `ADJUST` negativo en `DANO`, `MERMAS`, "Daño o pérdida" o similar.

La logica de signo revisada solo afecta cantidad visual:

- Kardex global: `signedQty(row)` deja `ADJUST` con su signo original.
- Kardex por bodega: `kardexSignedQty(t)` deja `ADJUST` con su signo original.
- Backend: `performTransactionCore()` calcula stock nuevo con `addStockQty(previousQty, dto.quantity)` para `ADJUST`; no cambia motivo segun signo.

## 7. Casos minimos auditados

| Caso | UI permite | Valor FE | Valor backend guardado | Valor mostrado |
|---|---:|---|---|---|
| Ajuste por inventario con delta positivo | Si | `CONTEO` | `ADJUST`, qty positiva, notes `Ajuste [Ajuste por inventario (conteo / hallazgo)]...` | Global y bodega: `Ajuste por inventario (conteo / hallazgo)`; modal/nota igual. |
| Ajuste por inventario con delta negativo | Si | `CONTEO` | `ADJUST`, qty negativa, notes `Ajuste [Ajuste por inventario (conteo / hallazgo)]...` | Igual que arriba; no se infiere daño/pérdida por signo. |
| Daño con delta negativo | Si | `DANO` | `ADJUST`, qty negativa, notes `Ajuste [Daño]...` | Global y bodega: `Daño`; modal/nota: `Daño`. |
| Daño con delta positivo | Si, no hay restriccion por signo | `DANO` | `ADJUST`, qty positiva, notes `Ajuste [Daño]...` | Igual que caso DANO negativo. Posible inconsistencia funcional, pero permitida hoy. |
| Entrega de EPP con delta negativo | Si | `ENTREGA_EPP` | `ADJUST`, qty negativa, notes `Ajuste [Entrega de EPP]...` | Global y bodega: `Entrega de EPP`; modal/nota: `Entrega de EPP`. |
| Entrega de EPP con delta positivo o cero | UI muestra error y backend bloquea | `ENTREGA_EPP` | No guarda movimiento | No aplica. |

Nota: `MERMAS` tambien permite delta positivo o negativo por las mismas reglas, aunque semanticamente una merma positiva es dudosa.

## 8. Causa probable

No hay evidencia estatica de que el sistema guarde o renderice `CONTEO` como "Daño o pérdida". La causa probable del reporte esta en una de estas dos zonas:

1. **Ambiguedad visual del Kardex:** la fila principal dice solo `Ajuste` / `Ajuste de inventario`; si el usuario no abre detalle o no lee la nota, el motivo seleccionado no queda visible como dato principal.
2. **Motivo no estructurado:** `InventoryTransaction` no persiste `reason` como campo; depende de parsear `notes`. Esto hace fragil cualquier vista futura, exportacion o mapper que quiera mostrar el motivo.

Si en ambiente se ve literalmente "Daño o pérdida", no proviene de los archivos revisados en esta rama; conviene revisar build desplegado, cache frontend o cambios paralelos no trackeados/no sincronizados.

## 9. Archivos involucrados

Frontend:

- `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.html`
- `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.ts`
- `frontend/src/app/core/services/inventory-stock/inventory-stock.service.ts`
- `frontend/src/app/shared/components/item-ledger-table/item-ledger-table.component.ts`
- `frontend/src/app/shared/components/item-ledger-table/item-ledger-table.component.html`
- `frontend/src/app/core/utils/inventory-adjustment-notes.ts`
- `frontend/src/app/core/services/inventory-items/inventory-items.service.ts`

Backend:

- `backend/src/features/inventory-adjustment/inventory-adjustment.controller.ts`
- `backend/src/features/inventory-adjustment/inventory-adjustment.service.ts`
- `backend/src/features/inventory-stock/inventory-stock.service.ts`
- `backend/src/features/inventory-items/inventory-items.service.ts`
- `backend/prisma/schema.prisma`

Docs revisados:

- `AGENTS.md`
- `docs/MASTER-CONTEXT.md`
- `docs/agentes/inventario-stock-transferencias-kardex.md`
- `docs/agentes/auditoria-contexto-control-stock.md`
- `docs/agentes/decisiones.md`

## 10. Tests existentes y faltantes

Existentes:

- `backend/src/features/inventory-adjustment/inventory-adjustment.service.spec.ts`: cubre `CONTEO` con delta negativo/positivo y verifica `notes` con `Ajuste por inventario (conteo / hallazgo)`; cubre `ENTREGA_EPP` negativo y bloqueos positivo/cero.
- `backend/src/features/inventory-stock/inventory-stock.service.spec.ts`: cubre `ADJUST` negativo y `saldoPendienteAdjust` para recepciones.
- `backend/src/features/inventory-items/inventory-items.service.spec.ts`: cubre `ADJUST + PURCHASE_RECEIPT` como `ADJUST_SALDO_PENDIENTE`.

Faltantes:

- Backend: quedan por ampliar casos `DANO` delta negativo/positivo y `MERMAS` delta negativo/positivo si se decide validar esos motivos por signo.
- Backend: test de `findItemLedger` para `INVENTORY_ADJUSTMENT` verificando que `notes` se conserva y que no se infiere motivo por signo.
- Backend: test de `getTransactionsByWarehouse` para `INVENTORY_ADJUSTMENT` con `notes` de `CONTEO`.
- Frontend: cubiertos `movementTitle`, `kardexMovementTitle` y `parseInventoryAdjustmentNotes`; queda por ampliar DOM completo si se quiere snapshot visual de tabla/modal.
- Contrato: test o snapshot que garantice que el Kardex muestra el motivo seleccionado por el usuario en la fila principal si esa es la regla de producto.

## 11. Recomendacion de correccion posterior

1. Agregar persistencia estructurada del motivo, idealmente columna `adjustmentReason` en `InventoryTransaction` o metadata JSON si ya existe una politica para no ampliar el modelo.
2. Mientras no exista migracion, exponer un campo derivado en los endpoints de Kardex parseando `notes` con una utilidad compartida backend.
3. Cambiar los titulos de Kardex para ajustes manuales:
   - `CONTEO`: `Ajuste por inventario (conteo / hallazgo)`
   - `MERMAS`: `Merma o pérdida`
   - `DANO`: `Daño`
   - `SALDO_PENDIENTE`: mantener `Ajuste · saldo pendiente (recepcion)`
4. Validar reglas de signo por motivo si negocio lo requiere: por ejemplo, `DANO`/`MERMAS` probablemente deberian ser solo delta negativo; si se permite delta positivo, la UI deberia pedir confirmacion clara.
5. Agregar tests de regresion para los cuatro casos minimos de esta auditoria en backend y frontend.

## 12. Estado del repositorio durante la auditoria

`git status --short` mostro archivos no relacionados y no trackeados:

- `backend/test-generator.js`
- `import_flota.xlsx`
- `import_inventory.xlsx`

No se tocaron ni limpiaron.
