# Compras — flujos operativos (SRC → OC → recepción)

Documentación de **negocio y pantallas** del circuito de compras distinta de la **matriz de firmas / ACL** (esa parte sigue en [PURCHASE-GOVERNANCE.md](./PURCHASE-GOVERNANCE.md)).

---

## 1. Requerimiento de compra (SRC)

### Catálogo maestro obligatorio por línea

- Cada línea debe tener `inventoryItemId` (artículo existente o creado desde el picker / quick-create).
- Backend: `PurchaseRequisitionsService.ensureRequisitionItemsCatalogLinked` en creación, actualización con ítems y al **enviar** el borrador.

### Cantidad solicitada

- En el formulario de SRC, la **cantidad** es editable cuando la línea ya está vinculada al catálogo; no debe quedar bloqueada como “solo catálogo”.
- Validación: cantidad finita y **> 0** (frontend al guardar; backend en `create`, `update` con ítems y `submit`).

### Trazabilidad hacia recepción en bodega

- La cantidad guardada en **`requisition_items.quantity`** es la que usa el motor al generar la OC desde la adjudicación y al abrir la recepción:
  - Línea de OC: `quantity` desde ítem de requerimiento / cotización adjudicada.
  - Al crear recepción: `receipt_items.quantity_expected` = cantidad de la línea de OC (`WarehouseReceiptsService.create`).
- Si se corrige la cantidad en el SRC **después** de generar la OC, las líneas de OC ya creadas **no** se reescriben solas; el ajuste operativo es en compras/OC según reglas vigentes.

**Referencias:** `frontend/.../requisition-form/`, `backend/.../purchase-requisitions.service.ts`, `backend/.../warehouse-receipts.service.ts`, `backend/.../purchase-orders.service.ts` (generación desde requerimiento).

---

## 2. Detalle del SRC — generar orden(es) de compra

- **Un solo botón** en la UI: el de **Resumen adjudicación** («Generar orden(es) de compra»). No hay segundo botón duplicado en la cabecera del detalle.
- El mismo botón abre un **modal de confirmación** cuyo texto depende del caso:
  - **Adjudicación por ítem guardada** (matriz + “Guardar selección”): `POST /purchase-orders/from-requisition/:requisitionId` — agrupa por proveedor / cotización y omite líneas que ya tienen OC activa.
  - **Cotización ganadora única** sin filas `awardedQuotation_item_id` persistidas aún: `POST /purchase-orders` con `quotationId` de la ganadora (flujo equivalente al antiguo “Generar OC (ganadora única)”).
- Condición de habilitación incluye no tener cambios sin guardar en la matriz (`selectionDirty`) y permisos de compras.

**Referencias:** `frontend/.../requisition-detail/requisition-detail.component.{ts,html}`.

---

## 3. Catálogo maestro — impacto en compras y pickers

Cuando compras o el solicitante **crean** un artículo desde modales (p. ej. quick-create en el selector global):

- **Código de inventario (SKU):** lo asigna **solo el sistema** en alta vía API (`POST` catálogo / `quick-create`); el usuario **no** puede informarlo ni editarlo. Formato **`IN` + 4 dígitos** (`IN0116`, `IN0117`, …). El contador `INV_SKU` se **alinea** con el máximo numérico ya existente en ítems del tenant en códigos `IN####` o legado `INV-#####` (p. ej. tras importar Excel o vaciar y reimportar) para que el siguiente correlativo no colisione.
- **Número de parte:** si se deja vacío en **quick-create**, **no** se genera correlativo automático; queda **`null`** en base (el comportamiento anterior de AUTO-PN se eliminó).

**Referencias:** `backend/.../inventory-items.service.ts` (`create`, `quickCreate`, `ensureInventorySkuCounterFloor`), `backend/.../sequence/sequence.service.ts`, `frontend/.../quick-add-item-modal/`, `frontend/.../global-item-picker/`.

---

## 4. Índice de documentos compras

| Tema | Documento |
|------|-----------|
| Matriz de firmas, ACL por usuario, `minAmount`, `purchase-settings` | [PURCHASE-GOVERNANCE.md](./PURCHASE-GOVERNANCE.md) |
| SRC, OC, recepción, catálogo en líneas, botón único generar OC | Este archivo |
| Inventario, stock, transferencias, kardex | [docs/agentes/inventario-stock-transferencias-kardex.md](./agentes/inventario-stock-transferencias-kardex.md) |
