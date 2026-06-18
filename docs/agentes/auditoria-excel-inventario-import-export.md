# Auditoria Excel inventario: import/export maestro y stock

Fecha: 2026-06-18

> Auditoria tecnica-funcional por inspeccion estatica. No se modifico codigo productivo, no se ejecutaron commits ni push.

## 1. Resumen ejecutivo

El flujo actual de Excel de inventario es un **maestro mixto articulo/bodega**: exporta informacion estructural del articulo, catalogos auxiliares, bodega, ubicacion, stock, umbrales y, si el usuario puede ver costos, CPP/valor linea.

La importacion actual **si permite crear articulos**, **si permite editar articulos existentes** y **si permite ajustar stock por bodega**. La eliminacion fisica de articulos esta desactivada por defecto, pero puede habilitarse con `allowItemDeletes=true` solo para articulos ausentes sin historial/asociaciones.

El bloqueo de columnas del Excel exportado es una proteccion de **hoja con celdas bloqueadas por columna**. No bloquea toda la columna como entidad independiente: el generador marca celdas `locked` segun `MasterExportColumn.locked` y luego protege la hoja `Inventario` con password fijo `BaseLogic`. Las columnas bloqueadas actuales son: `ID articulo`, `Codigo inventario`, `Unidad nombre`, `Permite decimales`, `Bodega nombre`, `Contrato`, `Subcontrato`, `Bodega politica`, `QR payload` y, cuando se exportan costos, `Valor linea`.

La regla objetivo recomendada es cambiar el contrato funcional: el Excel debe quedar como herramienta operativa de **ajustes controlados de stock por articulo existente y bodega existente**, no como via de CRUD del maestro de articulos. La UI/API de catalogo debe ser la unica via oficial para alta, edicion estructural y baja/desactivacion de articulos.

## 2. Flujo actual de exportacion

Pantallas que exportan el maestro:

- `/app/articulos`, componente `InventoryItemListComponent`. Boton `EXPORTAR EXCEL` en `frontend/src/app/features/inventory-items/inventory-item-list/inventory-item-list.component.html`; llama `exportMasterExcel()` en el TS.
- `/app/inventario/stock`, componente `StockDashboardComponent`. Boton `Maestro Excel` en `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.html`; llama `exportMasterExcel()` en el TS.

Servicio frontend:

- `InventoryItemsService.downloadInventoryMasterExcel()` hace `GET ${environment.apiUrl}/inventory-items/export/master`.

Endpoint backend:

- `GET /api/inventory-items/export/master`
- Controller: `backend/src/features/inventory-items/inventory-items.controller.ts`
- Permiso: `inventory:item:read`
- Servicio: `InventoryItemsService.getInventoryMasterExcelBuffer(user)`
- Generador: `backend/src/features/inventory-items/inventory-master-excel.generator.ts`
- Util compartido: `backend/src/common/excel/baselogic-master-export.util.ts`

El backend obtiene, por `tenantId`, articulos, categorias, UoM, bodegas y proveedores. No se observa filtro por contrato en la exportacion: es export tenant-wide del maestro para quien tenga permiso de lectura de articulos.

## 3. Flujo actual de importacion

Pantalla:

- `/app/inventario/importar`, componente `InventoryMasterImportComponent`.
- Ruta protegida con `permissionsAny: [inventory:item:update, inventory:stock:adjust]`.

Servicio frontend:

- `validateInventoryMasterImport(file)` -> `POST /api/inventory-items/import/validate`
- `commitInventoryMasterImport(file, options)` -> `POST /api/inventory-items/import/commit`

Endpoints backend:

- `POST /api/inventory-items/import/validate`
  - Permiso: `inventory:item:update`
  - Valida contrato BaseLogic del Excel, dominio `inventory`, requisitos y vista previa.
- `POST /api/inventory-items/import/commit`
  - Permiso: `inventory:stock:adjust`
  - Revalida el archivo, aplica opciones y confirma cambios dentro de una transaccion Prisma.

Opciones actuales de UI por defecto:

- `allowCreates: true`
- `allowUpdates: true`
- `allowStockAdjustments: true`
- `allowItemDeletes: false`
- `autoCreateBins: true`
- `autoCreateSuppliers: true`

Esto confirma que, funcionalmente, hoy el importador esta disenado para permitir altas y actualizaciones de articulo desde Excel.

## 4. Columnas del Excel

Hoja principal: `Inventario`. Encabezados en fila 5; datos desde fila 6. Hoja oculta `veryHidden`: `_bl_import_contract`.

Columnas base:

| Columna | Uso actual |
|---|---|
| `ID articulo` | UUID interno; usado para resolver item existente. |
| `Codigo inventario` | SKU `IN####`; solo lectura en export, pero se lee para warnings/matching bajo ciertas condiciones. |
| `Numero parte` | Identificador natural secundario; se usa para resolver item existente. |
| `Nombre` | Campo estructural editable/importable. |
| `Descripcion` | Campo estructural editable/importable. |
| `Familia` | Debe existir junto con subcategoria. |
| `Subcategoria` | Debe existir bajo la familia. |
| `Unidad` | Abreviatura de UoM; debe existir. |
| `Unidad nombre` | Informativa. |
| `Permite decimales` | Informativa desde UoM. |
| `Marca` | Campo estructural editable/importable. |
| `Compatibilidad` | Campo estructural editable/importable. |
| `Proveedor habitual` | Se vincula por nombre; puede autocrearse. |
| `Inventariable` | Flag estructural editable/importable. |
| `Consumible` | Flag estructural editable/importable. |
| `Activo` | Flag estructural editable/importable. |
| `Serializado` | Flag estructural editable/importable. |
| `Bodega codigo` | Identifica bodega para stock. |
| `Bodega nombre` | Informativa. |
| `Contrato` | Informativa. |
| `Subcontrato` | Informativa. |
| `Ubicacion stock` | Se escribe en `ItemStock.location`. |
| `Bin codigo` | Identifica o autocrea bin. |
| `Bin etiqueta` | Exportada; el commit usa `Bin codigo` y crea label desde ese valor. |
| `Stock` | Cantidad absoluta objetivo por articulo/bodega. |
| `Stock minimo` | Se escribe en `ItemStock.minStock`. |
| `Stock maximo` | Se escribe en `ItemStock.maxStock`. |
| `Bodega politica` | Informativa desde politica de articulo. |
| `Politica minimo` | Se escribe en `InventoryItem.policyMinStock`. |
| `Politica maximo` | Se escribe en `InventoryItem.policyMaxStock`. |
| `QR payload` | Informativo/solo lectura. |

Columnas de costo cuando `userCanViewInventoryCost(user)`:

| Columna | Uso actual |
|---|---|
| `CPP` | Importable: si viene informado, el commit lo usa como `ItemStock.unitCost`. |
| `Valor linea` | Informativa/calculada en export. |

## 5. Columnas protegidas y motivo

Columnas protegidas actuales en `inventory-master-excel.generator.ts`:

- `ID articulo`: UUID interno, evita edicion accidental del identificador.
- `Codigo inventario`: SKU interno; el sistema debe asignarlo.
- `Unidad nombre`: derivada de UoM, no es clave de importacion.
- `Permite decimales`: derivada de UoM, no debe ser cambiada desde Excel.
- `Bodega nombre`: derivada de `Bodega codigo`.
- `Contrato`: derivado de bodega.
- `Subcontrato`: derivado de bodega.
- `Bodega politica`: derivada de la politica de articulo.
- `QR payload`: payload interno `INV:<uuid>`.
- `Valor linea`: derivada de `Stock * CPP`.

Motivo inferido: prevenir cambios accidentales en identificadores internos, datos derivados o campos calculados, manteniendo editables los campos operativos y descriptivos.

## 6. Tipo de proteccion

La proteccion se define en `backend/src/common/excel/baselogic-master-export.util.ts`:

- Cada celda de datos recibe `cell.protection = { locked: col?.locked === true }`.
- Se aplica el mismo criterio sobre un buffer de filas editables futuras: `Math.max(rows.length + 250, 1000)`.
- La hoja se protege con `ws.protect('BaseLogic', ...)`.
- Se permiten seleccionar celdas bloqueadas/no bloqueadas, formatear filas/columnas, insertar filas, ordenar y autofiltro.

Por tanto, el bloqueo efectivo es: **proteccion de hoja + celdas bloqueadas por columnas declaradas**. No hay una regla de proteccion semantica en importacion: si el usuario desprotege o manipula el archivo, el backend igualmente vuelve a validar y decide que campos aceptar.

## 7. Validaciones actuales

Validaciones del parse/contrato:

- El archivo debe ser `.xlsx` valido.
- Debe existir la hoja `_bl_import_contract`.
- `domain` debe ser `inventory`.
- Se usa `primarySheet`, `headerRow` y `firstDataRow` desde el contrato oculto.

Validaciones de maestro:

- `Nombre` requerido.
- `Familia` y `Subcategoria` requeridas; la subcategoria debe existir bajo la familia del tenant.
- `Unidad` requerida; debe existir por abreviatura en el tenant.
- `Bodega codigo`, si se informa, debe existir en el tenant.
- `Bin codigo`, si se informa y no existe bajo la bodega, genera warning/autocreacion si `autoCreateBins=true`.
- `Proveedor habitual`, si no existe, genera warning/autocreacion si `autoCreateSuppliers=true`.
- No debe haber filas duplicadas para el mismo articulo/bodega segun clave de fila.

Validaciones de cantidad/stock:

- `Stock`, `Stock minimo`, `Stock maximo`, `CPP`, `Politica minimo` y `Politica maximo` se parsean como numeros.
- Si un numero no se puede parsear, en varios campos cae a `0` o `null` segun el caso.
- No se observa validacion explicita de cantidades negativas en `Stock`, `Stock minimo`, `Stock maximo`, `Politica minimo`, `Politica maximo` dentro del importador.
- No se observa validacion de `maxStock >= minStock` dentro del importador.
- No se observa validacion explicita de `UnitOfMeasure.allowsDecimals` para rechazar fracciones cuando la UoM no admite decimales.

Validaciones de identidad:

- Identifica articulo por `ID articulo` si existe.
- Con `ID articulo` e `Codigo inventario`, tambien intenta resolver por `Codigo inventario`.
- Si hay `Numero parte`, resuelve por `partNumber` normalizado preservando espacios/signos relevantes salvo acentos/case.
- Si no hay ID ni numero de parte, puede resolver por una "huella natural" de articulo/stock para evitar duplicados en reintentos.
- En filas nuevas, un `Codigo inventario` informado se advierte como ignorado; el sistema asigna el siguiente `IN####`.

Validaciones de bodega:

- La bodega se identifica por `Bodega codigo`.
- La busqueda se limita a `tenantId`.
- No se observa validacion ABAC por contratos permitidos del usuario en la importacion; se cargan bodegas del tenant completo.

## 8. Impacto en articulos

Hoy el importador puede:

- Crear articulos nuevos si `allowCreates !== false`.
- Editar articulos existentes si `allowUpdates !== false`.
- Modificar campos estructurales: `partNumber`, `name`, `description`, `categoryId`, `unitOfMeasureId`, `brand`, `compatibilityInfo`, `supplierId`, flags `isInventory`, `isConsumable`, `isAsset`, `isSerialized`, `policyMinStock`, `policyMaxStock`.
- Autocrear proveedores habituales si esta habilitado.
- Marcar articulos ausentes como candidatos a eliminacion.
- Eliminar fisicamente articulos ausentes solo si `allowItemDeletes=true` y sin impactos.

Riesgo funcional: el Excel actualmente puede cambiar el modelo maestro de articulo, no solo saldos. Esto contradice la politica objetivo de que el CRUD estructural sea exclusivo de UI/API controlada.

## 9. Impacto en stock

Hoy el importador puede:

- Crear o actualizar `ItemStock` por `warehouseId + itemId`.
- Escribir cantidad absoluta (`quantity = Stock`).
- Escribir `unitCost` si viene `CPP`; si no, conserva el costo existente o queda `null` en nueva fila.
- Escribir `minStock`, `maxStock`, `location` y `binId`.
- Autocrear bins si esta habilitado.

El campo `Stock` no se interpreta como delta, sino como **saldo fisico objetivo**. El movimiento de kardex se calcula como `nextStock - previousStock`.

## 10. Impacto en kardex

Cuando cambia la cantidad fisica:

- Se crea `InventoryTransaction` con `type = ADJUST`.
- `quantity = nextStock - previousStock`.
- `previousStock` y `newStock` quedan poblados.
- `userId` viene del usuario autenticado.
- `notes = 'Ajuste desde importacion maestro BaseLogic.'`.

No se define `referenceType` ni `referenceId` para estos ajustes, por lo que la trazabilidad queda en nota generica, no vinculada a un documento de importacion persistente.

El commit primero hace `itemStock.upsert` y luego crea la transaccion si hay diferencia. Esta todo dentro de una transaccion Prisma, por lo que no es una actualizacion silenciosa fuera de kardex, pero el patron no reutiliza `InventoryStockService.performTransactionCore`. Hay que evaluarlo como "genera kardex, pero por camino propio".

## 11. Riesgos de desbloquear columnas

Desbloquear columnas en el Excel no cambia por si solo la seguridad real del backend, pero aumenta la probabilidad de que usuarios editen campos que hoy el archivo comunica como derivados o de solo lectura.

Riesgos principales:

- Cambios accidentales de `ID articulo` pueden resolver filas por otro criterio y producir actualizaciones inesperadas.
- Cambios de `Codigo inventario` no deberian alterar el SKU, pero pueden confundir la vista previa y a usuarios; en filas nuevas se ignora y se asigna otro SKU.
- Cambios en `Permite decimales` no afectan la UoM real, pero pueden inducir cargas fraccionarias que hoy no se bloquean en importacion.
- Cambios en `Bodega nombre`, `Contrato` o `Subcontrato` no identifican bodega; si se edita solo el nombre, el importador seguira usando `Bodega codigo`, generando falsa sensacion de cambio.
- Cambios en `QR payload` se ignoran o advierten, pero pueden confundir trazabilidad operacional.
- Cambios en `CPP` pueden alterar `ItemStock.unitCost`, con impacto de valorizacion, si el usuario puede exportar costos.
- Como el Excel hoy permite updates estructurales, desbloquear todo aumenta riesgo de cambios masivos no revisados en categoria, UoM, flags contables, proveedor y politica.
- No hay validacion actual robusta de no negativos, min/max ni `allowsDecimals` en el importador.
- No se observa filtro por contrato del usuario en export/import; usuarios con permiso suficiente podrian operar bodegas de todo el tenant.

## 12. Regla de negocio recomendada

Politica recomendada para formalizar:

1. El Excel de inventario es una herramienta operativa de stock por bodega, no el canal oficial de CRUD de articulos.
2. Crear, editar estructura o eliminar/desactivar articulos debe hacerse por UI/API del catalogo maestro.
3. La importacion Excel solo debe aceptar articulos existentes.
4. Identidad principal recomendada: `ID articulo` como ancla tecnica; `Codigo inventario` `IN####` como ancla visible; `Numero parte` solo como apoyo/validacion, no como unico criterio destructivo.
5. La bodega debe identificarse por `Bodega codigo` existente y validarse por tenant y contrato/alcance del usuario.
6. El stock importado debe tratarse como saldo fisico objetivo o, si se decide mejor UX, separar explicitamente columnas `Stock actual` solo lectura y `Nuevo stock fisico` editable.
7. Todo cambio de stock debe generar kardex `ADJUST` con `previousStock`, `newStock`, usuario, fecha y nota trazable.
8. Idealmente cada commit de Excel deberia tener `referenceType = 'INVENTORY_MASTER_IMPORT'` y un `referenceId`/batch id si se crea cabecera de importacion futura.
9. Validar cantidades no negativas, `maxStock >= minStock`, `CPP >= 0` si se acepta modificar costo y `UnitOfMeasure.allowsDecimals`.
10. Desactivar por defecto y posteriormente eliminar del flujo Excel: `allowCreates`, `allowUpdates`, `allowItemDeletes`, autocreacion de proveedores y cambios de categoria/UoM/flags.

## 13. Propuesta documental para usuarios

Texto sugerido para manual/ayuda:

> El archivo Excel de inventario se usa para revisar y ajustar saldos de stock por articulo y bodega. No es la via oficial para crear, editar o eliminar articulos del catalogo maestro. Si necesita crear un articulo, cambiar su categoria, unidad de medida, numero de parte, descripcion principal o estado, hagalo desde BaseLogic en Catalogo Maestro de Articulos. Al importar Excel, el sistema validara que el articulo y la bodega existan, y cualquier cambio de stock quedara registrado en Kardex como ajuste auditable.

Instrucciones operativas sugeridas:

- Exporte siempre un Excel actualizado desde BaseLogic antes de editar.
- No cambie `ID articulo`, `Codigo inventario` ni `QR payload`; uselos solo para identificar.
- Para ajustar stock, ubique la fila del articulo y bodega correcta y modifique solo el saldo fisico/ubicacion/bin/umbrales permitidos.
- No agregue filas para crear articulos. Primero cree el articulo en el sistema y luego vuelva a exportar.
- No elimine filas esperando borrar articulos. Las bajas se gestionan desde el sistema.
- Revise la vista previa antes de confirmar; errores bloqueantes deben resolverse antes del commit.

## 14. Tests existentes

Backend:

- `backend/src/features/inventory-items/inventory-items.service.spec.ts`
  - Cubre `findItemLedger`, busqueda, create, quickCreate, update y remove.
  - Verifica `ADJUST + PURCHASE_RECEIPT` como `ADJUST_SALDO_PENDIENTE`.
  - Verifica que `create`, `quickCreate` y `update` no permitan modificar `inventoryCode` desde DTO normal.
  - No se observaron tests especificos para `validateInventoryMasterImport`, `commitInventoryMasterImport` o generacion Excel.
- `backend/src/features/inventory-stock/inventory-stock.service.spec.ts`
  - Cubre transacciones de stock, kardex, regularizacion, reportes, paginacion y posicion de stock.
  - No cubre el importador Excel del maestro.

Frontend:

- `frontend/src/app/features/inventory-items/inventory-item-list/inventory-item-list.component.spec.ts`
- `frontend/src/app/features/inventory-items/inventory-item-form/inventory-item-form.component.spec.ts`
- `frontend/src/app/features/inventory-stock/stock-dashboard/stock-dashboard.component.spec.ts`

No se observaron specs especificos del componente `inventory-master-import`.

## 15. Tests faltantes

Faltan tests unitarios/backend para:

- Export Excel: columnas, orden, presence/absence de columnas de costo segun permiso.
- Proteccion Excel: columnas `locked` esperadas y hoja protegida.
- Validate import: contrato oculto, dominio incorrecto, requisitos de categoria/UoM/bodega, duplicado articulo/bodega.
- Import sin CRUD articulo: cuando se implemente la nueva politica, debe rechazar filas nuevas y cambios estructurales.
- Matching de articulo por ID/SKU/partNumber y conflictos entre identificadores.
- Validacion de cantidades negativas, no numericas, `maxStock < minStock`.
- Validacion `UnitOfMeasure.allowsDecimals=false` contra cantidades fraccionarias.
- Commit stock: genera `InventoryTransaction ADJUST` y no modifica stock si `allowStockAdjustments=false`.
- ABAC por contrato/bodega en export/import.
- CPP: si se decide mantener editable, validar permisos y rangos; si no, asegurar que se ignore/rechace.
- Deletes: confirmar que quedan prohibidos en la nueva politica.

Faltan tests frontend para:

- `InventoryMasterImportComponent`: opciones por defecto, bloqueo de commit con errores, envio de opciones.
- Botones de export/import desde catalogo y stock.
- Mensajeria/documentacion visible alineada a "Excel solo stock".

## 16. Archivos a modificar en implementacion posterior

Backend:

- `backend/src/features/inventory-items/inventory-master-excel.generator.ts`
  - Ajustar columnas bloqueadas/desbloqueadas y notas de encabezado.
  - Considerar separar columnas informativas vs columnas editables de stock.
- `backend/src/common/excel/baselogic-master-export.util.ts`
  - Si se cambia la politica general de proteccion/desbloqueo.
- `backend/src/features/inventory-items/inventory-items.service.ts`
  - Cambiar `validateInventoryMasterImport` y `commitInventoryMasterImport` para no crear/editar/borrar articulos desde Excel.
  - Validar tenant, contrato/bodega, cantidades, min/max y UoM decimals.
  - Reutilizar o alinear con `InventoryStockService.performTransactionCore` o dejar un helper comun que garantice kardex.
- `backend/src/features/inventory-items/inventory-items.controller.ts`
  - Revisar permisos: validar import probablemente deberia poder hacerlo quien tenga lectura/stock-adjust, pero commit debe exigir `inventory:stock:adjust`.
- `backend/src/features/inventory-stock/inventory-stock.service.ts`
  - Si se centraliza la escritura de ajustes desde importacion.
- `backend/src/features/auth/constants/permissions.enum.ts` y espejo frontend si se decide permiso especifico `inventory:stock:import`.
- Specs backend en `inventory-items.service.spec.ts` o nuevo `inventory-master-import.service.spec.ts`.

Frontend:

- `frontend/src/app/features/inventory-items/inventory-master-import/inventory-master-import.component.ts`
  - Cambiar defaults, copy y opciones visibles; eliminar toggles de altas/updates/deletes si ya no aplican.
- `frontend/src/app/core/services/inventory-items/inventory-items.service.ts`
  - Ajustar tipos de opciones/resultado si cambia contrato.
- `frontend/src/app/features/inventory-items/inventory-item-list/*`
  - Copy de export/import.
- `frontend/src/app/features/inventory-stock/stock-dashboard/*`
  - Copy de `Maestro Excel` / `Importar maestro`.
- `frontend/src/app/app.routes.ts`
  - Revisar permisos para `/app/inventario/importar`.

Documentacion:

- `docs/agentes/importacion-exportacion-maestros-excel.md`
- `docs/agentes/inventario-stock-transferencias-kardex.md`
- `docs/MASTER-CONTEXT.md` si cambia contrato API o regla funcional critica.
- `docs/agentes/decisiones.md` con decision fechada.

## 17. Respuestas directas a la auditoria

1. **Pantalla/componente de exportacion:** `/app/articulos` (`InventoryItemListComponent`) y `/app/inventario/stock` (`StockDashboardComponent`).
2. **Endpoint export:** `GET /api/inventory-items/export/master`.
3. **Columnas actuales:** ver seccion 4.
4. **Columnas bloqueadas:** ver seccion 5.
5. **Donde se define la proteccion:** columnas en `inventory-master-excel.generator.ts`; proteccion efectiva en `baselogic-master-export.util.ts`.
6. **Tipo de bloqueo:** hoja protegida + celdas bloqueadas segun columna.
7. **Crear articulos nuevos:** si, con `allowCreates` habilitado por defecto.
8. **Editar articulos existentes:** si, con `allowUpdates` habilitado por defecto.
9. **Borrar/desactivar articulos:** borrar fisicamente solo si `allowItemDeletes=true` y sin impacto; por defecto no. No hay desactivacion porque el modelo no expone `isActive` en `InventoryItem`.
10. **Modificar stock por bodega:** si, mediante `Stock` como saldo absoluto objetivo.
11. **Identificacion articulo:** `ID articulo`, luego `Codigo inventario` solo cuando hay ID, luego `Numero parte`, y huella natural en casos sin ID/partNumber.
12. **Identificacion bodega:** `Bodega codigo`.
13. **Validaciones cantidades:** parse numerico; no se observo hardening suficiente de negativos, min/max ni no numericos.
14. **Validaciones `allowsDecimals`:** no se observo validacion en import Excel.
15. **Movimientos kardex:** `InventoryTransaction` tipo `ADJUST`, cantidad delta, nota generica.
16. **ItemStock directo o transaccion:** hace `ItemStock.upsert` directo y luego crea `InventoryTransaction` si cambia cantidad, dentro de la misma transaccion Prisma.
17. **Riesgos de desbloquear columnas:** ver seccion 11.
18. **Regla documental recomendada:** Excel solo para ajustes controlados de stock; CRUD de articulos solo por UI/API.
19. **Tests existentes:** ver seccion 14.
20. **Archivos a tocar despues:** ver seccion 16.

## 18. Archivos no rastreados detectados al inicio

`git status --short` mostro archivos no rastreados ajenos a esta auditoria:

- `backend/test-generator.js`
- `import_flota.xlsx`
- `import_inventory.xlsx`

No fueron modificados.

## 19. Implementacion aplicada 2026-06-18

La politica recomendada fue implementada posteriormente:

- Export Excel: las celdas de datos del maestro de inventario quedan desbloqueadas visualmente; la hoja puede seguir protegida como ayuda de estructura/UX.
- Export costos: `CPP` y `Valor linea` solo salen cuando el usuario tiene permiso de costos; `CPP` queda informativo.
- Importacion: `allowCreates`, `allowUpdates` estructural, `allowItemDeletes` y autocreacion de proveedores quedan deshabilitados/ignorados para inventario.
- Importacion permitida: solo stock/ubicacion/bin/umbrales por articulo existente y bodega existente.
- Validaciones agregadas: bodega existente, alcance contractual, cantidades no negativas, `maxStock >= minStock`, enteros cuando `UnitOfMeasure.allowsDecimals=false`, conflictos de identidad y cambios estructurales.
- Kardex: todo cambio de cantidad genera `InventoryTransaction ADJUST` con saldo anterior/nuevo, delta, usuario y nota con fila/archivo.
- CPP: la importacion no modifica `ItemStock.unitCost`; conserva el CPP vigente.
- UI: el importador de inventario deja de mostrar opciones de altas/ediciones/bajas por Excel y explica el contrato stock-only.
