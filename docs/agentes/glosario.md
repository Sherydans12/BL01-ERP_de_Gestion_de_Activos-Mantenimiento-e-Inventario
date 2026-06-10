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
| `currentMeter` | Horómetro/odómetro vigente del equipo (`Equipment.currentMeter`). **Nunca retrocede.** Alimentado por OT, M1, M2 y M3 vía `applyCurrentMeterChange`; cada cambio deja traza en `EquipmentMeterLog`. |
| `isOperational` | Bandera de estado operativo del equipo. `false` = **fuera de servicio**. La mueven el ciclo de OT (`affectsAvailability=SI` / cierre con `closureEquipmentOperational`) y las **fallas ALTAS** (M3). M2 solo la lee. |
| Disponibilidad (M2) | Reporte **declarativo** por turno (`ShiftType` DÍA/NOCHE) del estado de un equipo (`OperationalStatus`); modelo `EquipmentAvailability`. Es la confirmación del supervisor, ortogonal a `isOperational`. |
| Estado operativo (`OperationalStatus`) | Estado declarado en el parte de disponibilidad (p. ej. operativo / detenido / standby). La función pura `isAvailableStatus()` deriva disponibilidad sin columna persistida. |
| Falla / Reporte de Falla (M3) | Evento correctivo imprevisto en terreno (`FaultReport`, correlativo `RF-XXXXX`); clasificado por `AffectedSystem` y `FaultCriticality`. |
| Falla Crítica / ALTA (`HIGH`) | Criticidad que detiene el equipo: `isOperational=false` + OT `NO_PROGRAMADA_REACTIVA` (`affectsAvailability=SI`) automática en la misma transacción. MEDIA crea OT correctiva sin detener; BAJA solo registra. |
| M1 / M2 / M3 | Módulos de Operaciones en terreno: **M1** Consumo de Lubricantes (`LubeReport`, `RCL-XXXXX`), **M2** Disponibilidad Operativa Diaria (`EquipmentAvailability`), **M3** Registro e Informe de Fallas (`FaultReport`, `RF-XXXXX`). |
| `blockNegativeStock` | Flag en `TenantOperationalConfig`. Si `true`, M1/OT/inventario rechazan descuentos que dejarían stock &lt; 0; si `false`, permite saldo negativo con `isPendingRegularization`. |
| Consumo inusual (fluidos) | Despacho que supera umbral lógico por UoM (p. ej. 100 LT). Requiere `confirmedLargeDispatch` (M1) o `confirmedLargeFluidDispatch` (cierre OT). |
