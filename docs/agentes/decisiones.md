# Decisiones de diseño (ligero)

Añadí entradas con fecha cuando un chat o una reunión fije algo importante. Formato sugerido:

```
## YYYY-MM-DD — Título corto
- Contexto: …
- Decisión: …
- Consecuencias: …
```

## 2026-05-19 — Recepciones parciales persistentes con delta de stock

- **Contexto:** El módulo de recepciones creaba una nueva guía por cada recepción parcial, forzando al usuario a volver al listado "Nueva recepción" para continuar. Además el historial de eventos era genérico y usaba "ítem(s)".
- **Decisión:** Una guía de recepción (`WarehouseReceipt`) permanece editable mientras su estado sea `PENDING` o `PARTIAL`; solo `COMPLETED` es de solo lectura. Se agrega el campo `quantityConfirmed` a `ReceiptItem` para trackear el delta ya movido a stock. Cada llamada a `confirm()` solo mueve `quantityReceived − quantityConfirmed` al kardex, evitando doble conteo.
- **Consecuencias:**
  - Migration `20260519000000_receipt_item_quantity_confirmed` agrega la columna con backfill de registros existentes.
  - `forceClose` de OC también cierra guías PENDING/PARTIAL asociadas.
  - Frontend en modo PARTIAL muestra "Agregar ahora" (delta=0 inicial) y el tope es `quantityExpected − quantityConfirmed`. El botón "Guardar avance" fue eliminado; solo existe "Confirmar Recepción" (verde para completa, ámbar para parcial).
  - Historial: eventos separados `warehouse_receipt_partial` vs `warehouse_receipt_completed` con cantidades exactas por artículo.
  - Columnas de tabla fija (7 edit / 6 readonly) para evitar desalineación por columnas condicionales.

## 2026-05-19 — Alcance por contrato para rol base `USER`

- **Contexto:** Usuarios con `role: USER` + TenantRole con todos los permisos PBAC veían listados vacíos en Compras (SRC, OC, etc.) y Operaciones.
- **Decisión:** El alcance de datos no depende del enum `UserRole` salvo bypass `ADMIN` / `SUPER_ADMIN`. Cualquier otro rol usa `allowedContracts` del JWT (filas `UserContract`). Util compartido `backend/src/common/contract-scope.util.ts`. En admin de usuarios, la UI de “Contratos permitidos” aplica también a `baseRole === USER`.
- **Consecuencias:** Sin contratos asignados el listado sigue vacío (sentinel UUID). Tras asignar contratos, el usuario debe **volver a iniciar sesión** para refrescar el JWT. No se concede tenant-wide solo por tener permisos PBAC.

## 2026-05-19 — Indicador visual de qty y modal de ficha de artículo

- **Contexto:** Usuario quería feedback inmediato al ingresar cantidades y poder consultar el catálogo sin salir de la vista.
- **Decisión:** Columna "Estado" con badge coloreado por fila (`sin ingresar`, `parcial: X de Y`, `✓ completo`). Click en nombre del artículo abre un modal con datos del catálogo y tabla de cantidades en contexto.
- **Consecuencias:** Clases CSS con `/` (Tailwind) no se pueden usar en `[class.xxx]` de Angular; se definieron `.row-qty-complete` / `.row-qty-partial` en `styles.scss` y se usa `[ngClass]`.
