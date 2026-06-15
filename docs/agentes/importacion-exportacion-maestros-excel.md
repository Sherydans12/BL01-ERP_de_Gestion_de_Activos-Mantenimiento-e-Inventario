# Importacion / exportacion de maestros Excel BaseLogic

Fecha: 2026-06-09

## Objetivo

Permitir traspasos y ediciones masivas controladas desde Excel para:

- **Flota:** equipos, contratos/subcontratos, tipos de equipo, medidores y documentacion.
- **Inventario:** catalogo maestro de articulos, unidades/categorias, proveedores, bodegas/bins y stock por bodega.

El flujo correcto siempre es:

1. Exportar maestro desde BaseLogic.
2. Editar el Excel manteniendo la hoja oculta `_bl_import_contract`.
3. Importar en modo validacion.
4. Resolver requisitos bloqueantes.
5. Confirmar commit con opciones explicitas.

## Ubicacion en UI

- **Flota:** `/app/flota` incluye `EXPORTAR EXCEL` e `IMPORTAR EXCEL`.
- **Importador de flota:** `/app/flota/importar`.
- **Inventario / articulos:** `/app/articulos` incluye `EXPORTAR EXCEL` e `IMPORTAR EXCEL`.
- **Inventario / stock:** `/app/inventario/stock` incluye `Maestro Excel` e `Importar maestro`.
- **Importador de inventario:** `/app/inventario/importar`.

Inventario se expone en ambos lugares porque el Excel afecta dos superficies: catalogo maestro de articulos y saldos por bodega.

## Backend

### Flota

- `GET /api/equipments/export/master`
- `POST /api/equipments/import/validate`
- `POST /api/equipments/import/commit`

Permisos:

- Exportar: `operations:equipment:read`
- Validar/confirmar: `operations:equipment:update`

Requisitos bloqueantes:

- El contrato debe existir.
- El subcontrato debe existir bajo el contrato informado.
- El tipo de equipo debe existir en Catalogos Maestros (`EQUIPMENT_TYPE`).
- No debe haber duplicados de ID sistema, numero interno o patente en el Excel.

Bajas:

- Un equipo existente que no venga en el Excel queda como `deleteCandidate`.
- Por defecto no se elimina.
- Si se activa `allowDeletes`, el importador exige revisar impacto.
- Si tiene OT, disponibilidad, fallas, lubricantes, medidores, costos o compras asociadas, se requiere `forceDeleteWithAssociations`.
- Con fuerza activada, se eliminan registros asociados operativos y se desvinculan compras donde corresponde.

### Inventario

- `GET /api/inventory-items/export/master`
- `POST /api/inventory-items/import/validate`
- `POST /api/inventory-items/import/commit`

Permisos:

- Exportar: `inventory:item:read`
- Validar: `inventory:item:update`
- Confirmar: `inventory:stock:adjust`

Requisitos bloqueantes:

- Familia y subcategoria deben existir.
- Unidad de medida debe existir.
- Bodega debe existir si se informa stock.
- No debe haber filas duplicadas para el mismo articulo/bodega.

Autocreacion controlada:

- Bin/ubicacion faltante bajo una bodega existente se informa como advertencia y se crea automaticamente al confirmar si `autoCreateBins=true`.
- Proveedor habitual faltante se informa como advertencia y se crea automaticamente al confirmar si `autoCreateSuppliers=true`.
- Si esas opciones se desactivan y el Excel requiere crear bins/proveedores, el commit se bloquea.

Bajas:

- Un articulo existente que no venga en el Excel queda como `deleteCandidate`.
- Por defecto no se elimina.
- Inventario no permite eliminacion fisica destructiva desde importacion si existe historial o asociaciones: kardex, stocks, reservas, OT, lubricantes, transferencias, requerimientos, OC o adjuntos.
- Solo se eliminan articulos ausentes sin impacto cuando `allowItemDeletes=true`.

Stock:

- Cambios de cantidad generan `InventoryTransaction` tipo `ADJUST`.
- El ajuste conserva `previousStock`, `newStock`, usuario y nota de auditoria.
- Cambios de stock son configurables con `allowStockAdjustments`.

Altas desde exportacion:

- Para crear articulos nuevos desde el Excel exportado, agregar filas en `Inventario` dejando vacios `ID articulo`, `Codigo inventario` y `QR payload`.
- El commit asigna automaticamente el siguiente `IN####` y `INV:<uuid>`; si el usuario informa manualmente SKU/QR en una fila nueva, se ignoran y se muestra advertencia.
- Si un articulo nuevo se informa en varias bodegas dentro del mismo Excel, se crea una sola ficha de articulo y se aplican las filas de stock por bodega.
- La vista previa del importador prioriza errores, altas y cambios para que las filas nuevas agregadas al final del Excel sean visibles aunque el maestro tenga cientos de filas.

## Contrato Excel

Cada workbook BaseLogic exportado incluye:

- Hoja principal: `Flota` o `Inventario`.
- Encabezados en fila 5.
- Datos desde fila 6.
- Comentarios/descriptores en encabezados.
- Columnas de sistema protegidas contra edicion accidental en la hoja principal.
- Hoja muy oculta `_bl_import_contract` con:
  - `domain`
  - `version`
  - `generatedAt`
  - `primarySheet`
  - `headerRow`
  - `firstDataRow`

El importador rechaza archivos sin contrato BaseLogic o con dominio incorrecto.

## Archivos principales

- Export util compartido: `backend/src/common/excel/baselogic-master-export.util.ts`
- Import util compartido: `backend/src/common/excel/baselogic-master-import.util.ts`
- Flota Excel: `backend/src/features/equipments/fleet-master-excel.generator.ts`
- Inventario Excel: `backend/src/features/inventory-items/inventory-master-excel.generator.ts`
- Flota backend: `backend/src/features/equipments/equipments.service.ts`
- Inventario backend: `backend/src/features/inventory-items/inventory-items.service.ts`
- Flota UI: `frontend/src/app/features/fleet/fleet-master-import/fleet-master-import.component.ts`
- Inventario UI: `frontend/src/app/features/inventory-items/inventory-master-import/inventory-master-import.component.ts`
