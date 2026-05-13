# Glosario TPM / negocio

Términos internos del dominio para que los agentes no inventen sinónimos distintos al producto.

| Término | Significado en este proyecto |
|--------|------------------------------|
| TPM | Nombre del producto / gestión de activos y EAM (ver README raíz) |
| CPP | Costo promedio ponderado (valorización de inventario) |
| OT | Orden de trabajo (mantenimiento) |
| W2W | Traslado **warehouse to warehouse** (transferencia entre bodegas del mismo tenant; ver [`inventario-stock-transferencias-kardex.md`](inventario-stock-transferencias-kardex.md)). |
| Kardex (inventario) | Historial inmutable en `inventory_transactions` por artículo y/o por bodega. |
| Transferencia (inventario) | Flujo `InventoryTransfer` + líneas + movimientos `TRANSFER_OUT` / `TRANSFER_IN` con `referenceType = INVENTORY_TRANSFER`. |
