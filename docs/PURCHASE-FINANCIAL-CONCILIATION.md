# Motor de Conciliación Financiera de Compras (v1.3 Enterprise)

Documentación técnica del motor de **3-Way Match** y los modelos relacionados introducidos en la Fase de refactorización v1.3 Enterprise del módulo de Compras.

> **Documentos complementarios:**
> - Flujos operativos SRC/OC/recepción: [PURCHASE-FLOWS.md](./PURCHASE-FLOWS.md)
> - Matriz de firmas y gobernanza de aprobaciones: [PURCHASE-GOVERNANCE.md](./PURCHASE-GOVERNANCE.md)

---

## 1. Modelo de Datos

### 1.1 Transición de relación 1:1 a 1:N (Multi-Factura por OC)

**Antes (≤ v1.2):** una `PurchaseOrder` podía tener como máximo una `PurchaseInvoice` ligada por restricción `@unique` en `purchase_order_id`.

**Desde v1.3:** la restricción `@unique` fue eliminada. Una OC puede agrupar múltiples facturas de proveedor. El campo de relación en `PurchaseOrder` pasó de un objeto singular a un array:

```
PurchaseOrder 1 ──── N PurchaseInvoice
```

#### Índice de rendimiento (agregación)

```sql
-- backend/prisma/migrations/20260517000000_structural_oc_to_multi_invoice
CREATE INDEX "purchase_invoices_tenant_id_purchase_order_id_idx"
  ON "purchase_invoices"("tenant_id", "purchase_order_id");
```

Este índice soporta el `SUM` acumulado de facturas que el motor ejecuta en cada validación 3-way.

### 1.2 Modelo `PurchaseCreditNote`

Registra documentos de descuento/devolución emitidos por el proveedor. Su monto se **resta** del total facturado bruto antes de conciliar contra la bodega.

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | `UUID` | PK |
| `tenantId` | `UUID` | Aislamiento multi-tenant obligatorio |
| `purchaseOrderId` | `UUID` | FK mandatoria → `PurchaseOrder` (RESTRICT) |
| `purchaseInvoiceId` | `UUID?` | FK opcional → `PurchaseInvoice` (SET NULL) — si la NC aplica a una factura específica |
| `creditNoteNumber` | `VARCHAR(80)` | Correlativo único por `(tenantId, creditNoteNumber, purchaseOrderId)` |
| `emissionDate` | `DateTime` | Fecha de emisión del documento |
| `totalAmount` | `Decimal(18,2)` | Monto positivo (siempre > 0) a restar del facturado |
| `notes` | `Text?` | Observaciones libres |

**Relaciones en el esquema Prisma:**

```prisma
// PurchaseOrder
purchaseCreditNotes PurchaseCreditNote[]

// PurchaseInvoice
creditNotes PurchaseCreditNote[]

// PurchaseCreditNote
purchaseOrder   PurchaseOrder    @relation(..., onDelete: Restrict)
purchaseInvoice PurchaseInvoice? @relation(..., onDelete: SetNull)
```

> `onDelete: Restrict` en `purchaseOrder` garantiza que no se pueda eliminar una OC con notas de crédito activas. `onDelete: SetNull` en `purchaseInvoice` desvincula la NC de una factura eliminada sin perder el registro.

---

## 2. La Ecuación del 3-Way Match

### 2.1 Fórmula final (desde v1.3)

$$
\text{Net Invoice Amount} = \sum_{i=1}^{n} \text{InvoiceAmount}_i - \sum_{j=1}^{m} \text{CreditNoteAmount}_j
$$

$$
\text{Conciliación válida si:} \quad \text{Net Invoice Amount} \leq \text{ReceivedAmount} \quad \land \quad \Delta_\text{OC} \leq \text{Tolerancia\%}
$$

Donde:
- `∑InvoiceAmount` = suma de `totalAmount` de **todas** las `PurchaseInvoice` asociadas a la OC.
- `∑CreditNoteAmount` = suma de `totalAmount` de **todas** las `PurchaseCreditNote` asociadas a la OC.
- `ReceivedAmount` = valor económico del material efectivamente ingresado a bodega (calculado desde las `WarehouseReceipt` confirmadas: `∑ quantityReceived × unitCost`).
- `Tolerancia%` = porcentaje configurable por tenant en `PurchaseSettings.invoiceMatchTolerancePercent`.

### 2.2 Implementación en `purchase-invoices.service.ts`

Los dos métodos privados de agregación:

```typescript
// Suma todas las facturas de la OC (excluye opcionalmente la factura actual).
private async computeAccumulatedInvoiceAmount(
  purchaseOrderId: string,
  tenantId: string,
  excludeInvoiceId?: string,
): Promise<Prisma.Decimal>

// Suma todas las notas de crédito de la OC.
private async computeAccumulatedCreditNoteAmount(
  purchaseOrderId: string,
  tenantId: string,
): Promise<Prisma.Decimal>
```

El método central `computeThreeWayMatchNumbers` orquesta ambas llamadas en paralelo y calcula el neto:

```typescript
const [receivedAmount, creditNotesTotal] = await Promise.all([
  this.computeReceivedAmountForPurchaseOrder(purchaseOrderId),
  this.computeAccumulatedCreditNoteAmount(purchaseOrderId, tenantId),
]);

// Ecuación final
const invNum = invAccumulated.sub(creditNotesTotal).toNumber();
```

### 2.3 Semáforos de estado (`PurchaseInvoiceStatus`)

| Estado | Condición |
|---|---|
| `PENDING` | Factura recién registrada, sin validación ejecutada |
| `MATCHED` | `invNum ≤ recNum` **Y** `Δ% ≤ tolerancia` |
| `DISCREPANCY` | Cualquier condición rota |
| `PAID` | Pago registrado manualmente (estado terminal) |

### 2.4 Re-validación automática al registrar una Nota de Crédito

Cada `POST /purchase-credit-notes` dispara `revalidateAllInvoicesForOrder`, que ejecuta `validateInvoiceMatch` sobre **todas las facturas no pagadas** de la OC en paralelo. Esto actualiza los semáforos en tiempo real sin intervención manual del usuario.

```
POST /purchase-credit-notes
  └─ PurchaseCreditNotesService.create()
       └─ revalidateAllInvoicesForOrder()
            └─ PurchaseInvoicesService.validateInvoiceMatch(invId) × N
```

---

## 3. Gobernanza Dinámica: `canOverruleThreeWayMatch`

### 3.1 Problema que resuelve

Antes de v1.3, el endpoint `POST /purchase-invoices/:id/three-way-match/overrule` estaba protegido con el decorador `@Roles('ADMIN', 'SUPERVISOR')`. Esto generaba dos problemas:

1. **Granularidad insuficiente:** cualquier `ADMIN` podía aceptar discrepancias, independientemente de su rol real en el proceso financiero.
2. **Rigidez de configuración:** activar/desactivar la capacidad requería cambiar el rol del usuario en el sistema.

### 3.2 Solución: flag de usuario explícito

Se añadió el campo `canOverruleThreeWayMatch Boolean @default(false)` al modelo `User` (migración `20260517010000_user_can_overrule_three_way_match`).

**Flujo de autorización en el controlador:**

```typescript
// purchase-invoices.controller.ts
// El decorador @Roles fue eliminado de este endpoint.
const user = req.user;
if (!user.canOverruleThreeWayMatch && user.role !== 'SUPER_ADMIN') {
  throw new ForbiddenException(
    'No tienes el permiso explícito de usuario para autorizar discrepancias financieras.'
  );
}
```

### 3.3 Propagación del flag por capas

| Capa | Cambio |
|---|---|
| **Prisma** | `User.canOverruleThreeWayMatch Boolean @default(false)` |
| **`jwt.strategy.ts`** | Sin cambios — ya carga el objeto completo del usuario desde BD |
| **`users.service.ts`** | `meSelect`, `mapMeRow`, `update` y listado paginado exponen el nuevo campo |
| **`auth.service.ts`** | `completeLoginAfterPasswordOk` incluye el campo en el payload JWT |
| **`UserPayload` (frontend)** | `canOverruleThreeWayMatch?: boolean` |
| **`purchase-order-detail.component.ts`** | `canOverruleShortShipment` usa `user?.canOverruleThreeWayMatch === true \|\| user?.role === 'SUPER_ADMIN'` |

### 3.4 Matriz de acceso resultante

| Rol | `canOverruleThreeWayMatch` | ¿Puede aceptar discrepancia? |
|---|:---:|:---:|
| `SUPER_ADMIN` | cualquier valor | ✅ Bypass global |
| `ADMIN` / `SUPERVISOR` / `MECHANIC` | `true` | ✅ Sí |
| `ADMIN` / `SUPERVISOR` / `MECHANIC` | `false` (default) | ❌ No |

---

## 4. Endpoints REST de Notas de Crédito

Base: `POST|GET|DELETE /purchase-credit-notes`  
Guard: `JwtAuthGuard + RolesGuard` — roles `ADMIN`, `SUPERVISOR`, `SUPER_ADMIN`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/purchase-credit-notes?purchaseOrderId=<uuid>` | Lista NCs de una OC ordenadas por `emissionDate DESC` |
| `POST` | `/purchase-credit-notes` | Registra una NC y re-dispara validación 3-way |
| `DELETE` | `/purchase-credit-notes/:id` | Elimina una NC y re-dispara validación 3-way |

**DTO de creación:**

```typescript
class CreateCreditNoteDto {
  purchaseOrderId: string;      // obligatorio
  purchaseInvoiceId?: string;   // opcional (factura específica)
  creditNoteNumber: string;     // único por (tenantId + OC)
  emissionDate: string;         // ISO 8601
  totalAmount: number;          // > 0
  notes?: string;
}
```

---

## 5. Vista en el frontend (pestaña "Facturación")

En `purchase-order-detail.component.html`, cuando la OC tiene notas de crédito registradas, se muestra un bloque de desglose:

```
┌─────────────────────────────────────────────────────┐
│  DESGLOSE CON NOTAS DE CRÉDITO                      │
│                                                     │
│  Total facturas brutas   $1.200.000                 │
│  − Notas de crédito (1)  −$100.000   (NC 001/26)   │
│  = Monto neto a conciliar $1.100.000  ← 3-way match │
└─────────────────────────────────────────────────────┘
```

Los computeds del componente que alimentan este bloque:

```typescript
creditNotesTotal  = computed(() => /* suma de purchaseCreditNotes */ );
netInvoicedTotal  = computed(() => /* gross invoiced − creditNotesTotal */ );
```

---

## 6. Historial de migraciones (v1.3)

| Migración | Descripción |
|---|---|
| `20260517000000_structural_oc_to_multi_invoice` | Elimina `@unique` en `purchase_invoice.purchase_order_id`, añade índice compuesto |
| `20260517010000_user_can_overrule_three_way_match` | Añade columna `can_overrule_three_way_match BOOLEAN DEFAULT false` en `users` |
| `20260517020000_purchase_credit_notes` | Crea tabla `purchase_credit_notes` con FKs, índices y constraint de unicidad |

---

*Documento generado para el sprint v1.3 Enterprise Purchases. Actualizar al introducir nuevos modelos contables (p. ej. notas de débito, retenciones, pagos parciales).*
