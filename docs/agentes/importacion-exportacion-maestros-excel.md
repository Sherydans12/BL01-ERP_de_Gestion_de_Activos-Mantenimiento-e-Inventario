# Importacion / exportacion de maestros Excel BaseLogic

Fecha: 2026-06-18

## Objetivo

BaseLogic usa workbooks Excel exportados desde el sistema para cargas controladas. Cada archivo incluye una hoja oculta `_bl_import_contract` con dominio, version, hoja principal y filas de encabezado/datos. El importador rechaza archivos que no provienen del sistema o que pertenecen a otro dominio.

Dominios actuales:

- **Flota:** maestro operativo de equipos.
- **Inventario:** herramienta operativa de stock por articulo existente y bodega existente.

## Inventario: que permite

El Excel de inventario permite:

- Revisar articulos existentes y su stock por bodega.
- Ajustar el **stock fisico objetivo** de un articulo existente en una bodega existente.
- Actualizar `Ubicacion stock`.
- Actualizar `Bin codigo`; si el bin no existe puede crearse al confirmar cuando `autoCreateBins=true`.
- Actualizar `Stock minimo` y `Stock maximo` por bodega.
- Validar cambios antes del commit.
- Registrar todo cambio de cantidad como `InventoryTransaction` tipo `ADJUST`.

## Inventario: que no permite

El Excel de inventario no es via oficial para:

- Crear articulos.
- Editar estructura del articulo.
- Eliminar o desactivar articulos.
- Cambiar categoria/familia/subcategoria.
- Cambiar unidad de medida o `UnitOfMeasure.allowsDecimals`.
- Cambiar `partNumber`, nombre, descripcion, marca, compatibilidad, proveedor habitual o flags estructurales.
- Cambiar el SKU `Codigo inventario` (`IN####`).
- Cambiar `ID articulo` o `QR payload`.
- Modificar CPP (`ItemStock.unitCost`).

El CRUD de articulos debe hacerse desde Catalogo Maestro o API oficial del sistema. Despues de crear o editar un articulo, exportar nuevamente el Excel antes de cargar stock.

## Ubicacion en UI

- `/app/articulos`: exporta e importa stock desde botones `EXPORTAR STOCK` e `IMPORTAR STOCK`.
- `/app/inventario/stock`: exporta e importa stock desde `Stock Excel` e `Importar ajustes`.
- `/app/inventario/importar`: valida y confirma ajustes de stock.

## Backend

Inventario:

- `GET /api/inventory-items/export/master`
- `POST /api/inventory-items/import/validate`
- `POST /api/inventory-items/import/commit`

Permisos:

- Exportar: `inventory:item:read`.
- Validar: `inventory:item:update` o `inventory:stock:adjust`.
- Confirmar: `inventory:stock:adjust`.

Alcance por contrato:

- `ADMIN` y `SUPER_ADMIN`: pueden exportar/importar bodegas de todo el tenant.
- `USER`: export/import solo sobre bodegas cuyo `contractId` esta en `allowedContracts`.
- Si el Excel intenta ajustar una bodega fuera del alcance contractual del usuario, la fila queda bloqueada.

## Columnas de inventario

Columnas informativas o estructurales, no importables:

- `ID articulo`
- `Codigo inventario`
- `Numero parte`
- `Nombre`
- `Descripcion`
- `Familia`
- `Subcategoria`
- `Unidad`
- `Unidad nombre`
- `Permite decimales`
- `Marca`
- `Compatibilidad`
- `Proveedor habitual`
- `Inventariable`
- `Consumible`
- `Activo`
- `Serializado`
- `Bodega nombre`
- `Contrato`
- `Subcontrato`
- `Bin etiqueta`
- `Bodega politica`
- `Politica minimo`
- `Politica maximo`
- `QR payload`
- `CPP`, si se exporta por permiso de costos
- `Valor linea`, si se exporta por permiso de costos

Columnas operativas aceptadas por importacion:

- `Bodega codigo`: identifica la bodega existente.
- `Ubicacion stock`: ubicacion fisica o texto de estanteria.
- `Bin codigo`: bin dentro de la bodega.
- `Stock`: saldo fisico objetivo.
- `Stock minimo`: umbral minimo por articulo/bodega.
- `Stock maximo`: umbral maximo por articulo/bodega.

Las columnas estan visualmente desbloqueadas en la hoja principal para facilitar el trabajo operativo. La proteccion de hoja queda solo como ayuda de estructura/UX; la seguridad real esta en la validacion backend.

## Reglas de edicion para usuario

1. Exportar siempre un archivo actualizado desde BaseLogic.
2. No crear filas para dar de alta articulos.
3. No borrar filas esperando eliminar articulos.
4. No cambiar identidad ni datos estructurales del articulo.
5. Para ajustar stock, editar solo la fila del articulo/bodega correcta.
6. Validar el archivo antes de confirmar.
7. Resolver errores bloqueantes; warnings de bin pueden confirmarse si `autoCreateBins=true`.

## Validaciones de importacion

El importador valida:

- Archivo BaseLogic valido y dominio `inventory`.
- Articulo existente por `ID articulo`, `Codigo inventario` o `Numero parte`.
- Conflictos de identidad entre ID/SKU/numero de parte.
- Bodega existente dentro del tenant.
- Bodega dentro del alcance contractual del usuario.
- Duplicados de articulo/bodega en el mismo archivo.
- `Stock >= 0`.
- `Stock minimo >= 0`.
- `Stock maximo >= 0`.
- `Stock maximo >= Stock minimo` cuando `Stock maximo > 0`.
- Si `UnitOfMeasure.allowsDecimals === false`, `Stock`, `Stock minimo` y `Stock maximo` deben ser enteros.
- Cambios estructurales: quedan bloqueados y no se aplican.

## Kardex generado

El campo `Stock` representa saldo fisico objetivo, no delta.

Si el stock actual es 5 y el Excel trae 8:

- `ItemStock.quantity` queda en 8.
- Se genera `InventoryTransaction` tipo `ADJUST`.
- `quantity = 3`.
- `previousStock = 5`.
- `newStock = 8`.
- `userId` corresponde al usuario autenticado.
- `notes` incluye fila y archivo: `Ajuste desde importacion Excel inventario · fila <n> · archivo <nombre>`.

Si solo cambian ubicacion, bin o umbrales y la cantidad fisica no cambia, no se genera movimiento de kardex porque no hay cambio de saldo.

## CPP y costos

- `CPP` solo se exporta a usuarios con permiso de ver costos.
- `CPP` es informativo.
- La importacion no modifica `ItemStock.unitCost`.
- El ajuste usa el CPP vigente ya registrado para la bodega.
- `Valor linea` es informativo/calculado y no importable.

## Buenas practicas

- Separar cargas grandes por bodega o por familia cuando sea posible.
- No reutilizar archivos antiguos despues de crear/editar articulos en UI.
- Revisar warnings antes de confirmar, especialmente bins nuevos.
- Guardar el archivo usado como evidencia operacional si el proceso interno lo requiere.
- Para correcciones con justificacion detallada individual, preferir el flujo de ajuste manual de stock.

## Flota

Flota mantiene su flujo propio:

- `GET /api/equipments/export/master`
- `POST /api/equipments/import/validate`
- `POST /api/equipments/import/commit`

Permisos:

- Exportar: `operations:equipment:read`
- Validar/confirmar: `operations:equipment:update`

Reglas de flota se documentan separadamente y no cambian por la politica stock-only de inventario.

## Archivos principales

- Export util compartido: `backend/src/common/excel/baselogic-master-export.util.ts`
- Import util compartido: `backend/src/common/excel/baselogic-master-import.util.ts`
- Inventario Excel: `backend/src/features/inventory-items/inventory-master-excel.generator.ts`
- Inventario backend: `backend/src/features/inventory-items/inventory-items.service.ts`
- Inventario controller: `backend/src/features/inventory-items/inventory-items.controller.ts`
- Inventario UI import: `frontend/src/app/features/inventory-items/inventory-master-import/inventory-master-import.component.ts`
- Inventario servicios UI: `frontend/src/app/core/services/inventory-items/inventory-items.service.ts`
