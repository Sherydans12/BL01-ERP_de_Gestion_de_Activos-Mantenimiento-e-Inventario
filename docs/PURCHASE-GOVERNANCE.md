# Gobernanza de compras — políticas de aprobación (ACL por usuario)

Documentación técnica del módulo de **matriz de firmas** y validación económica por nivel (`minAmount`), alineada con Prisma, NestJS y el panel **Configuración de Compras** (`purchase-settings`).

> **Flujos operativos del módulo de compras** (requerimiento → adjudicación → OC → recepción, cantidades, catálogo por línea, generación única de OC): [PURCHASE-FLOWS.md](./PURCHASE-FLOWS.md). **Avisos Web Push** (pendiente de firma, discrepancia de factura, etc.): [docs/agentes/notificaciones-sistema.md](./agentes/notificaciones-sistema.md).

---

## 1. Cambio de paradigma: de RBAC (rol) a ACL (usuarios explícitos)

### Antes (RBAC sobre `TenantRole`)

- Cada `ApprovalPolicy` apuntaba a un **`role_id`** (`TenantRole`).
- “Quién puede firmar el nivel N” se infería como *todos los usuarios del tenant que encajan en ese rol* (rol custom o rol espejo del sistema).
- **Límites:** acoplamiento al catálogo de roles, poca granularidad por persona, y reglas de negocio difíciles de auditar (“¿este usuario concreto está autorizado en este escalón?”).

### Ahora (ACL por usuario)

- Cada política mantiene una lista explícita de **`userId`** autorizados vía la tabla **`approval_policy_users`** (`ApprovalPolicyUser`).
- La autorización de firma es **lista de control de acceso por identidad**: solo usuarios incluidos en ese nivel pueden aparecer como firmantes válidos para ese escalón.
- La migración `20260515220000_approval_policy_users_replace_role` intentó **poblar** filas nuevas a partir del `role_id` histórico (usuarios activos con ese rol custom o con el rol espejo equivalente). Si una política no tenía usuarios mapeables, quedó sin firmantes hasta reconfiguración manual en UI.

---

## 2. Esquema de datos

### Modelo relacional (texto)

```
Tenant
  └── PurchaseSettings (1 por tenant)
        └── ApprovalPolicy[]  (niveles 1..N, unique por tenantId + level)
              ├── minAmount, description, …
              └── allowedUsers → ApprovalPolicyUser[]
                        └── User (onDelete Cascade desde fila intermedia)
```

### `ApprovalPolicyUser` (Prisma)

| Campo      | Rol |
|-----------|-----|
| `id`      | PK UUID |
| `policyId` | FK → `ApprovalPolicy.id`, **`onDelete: Cascade`** (al borrar la política se borran las filas ACL) |
| `userId`  | FK → `User.id`, **`onDelete: Cascade`** (si se elimina el usuario, se eliminan sus vínculos de firma) |
| `tenantId` | **Desnormalizado** (copia del tenant de la política / usuario del mismo tenant) |

**Restricciones e índices relevantes**

- `@@unique([policyId, userId])` — no duplicar el mismo usuario en el mismo nivel.
- `@@index([tenantId, userId])` — consultas por tenant + usuario sin obligar a join extra para filtrar tenant en algunos patrones de acceso.

### Por qué `tenant_id` desnormalizado en `approval_policy_users`

1. **Integridad multi-tenant en consultas:** permite expresar `where: { tenantId }` directamente sobre la tabla intermedia cuando haga falta, y mantener coherencia con el resto del modelo (cada fila “sabe” de qué empresa es).
2. **Rendimiento:** el índice compuesto `(tenant_id, user_id)` acelera búsquedas del estilo “usuarios vinculados a políticas de este tenant” sin recorrer siempre `approval_policies` → `purchase_settings`.
3. **Escritura controlada:** en `PurchaseSettingsService.upsertPolicies`, al hacer `createMany`, cada fila se crea con `tenantId` explícito junto a `policyId` y `userId`, alineado con el tenant del request autenticado.

> `ApprovalPolicy` también conserva `tenantId` (denormalizado respecto a `purchaseSettings`) para unicidad por nivel y consultas directas en flujos de OC.

---

## 3. Lógica de validación: `approve()` y `minAmount`

**Archivo:** `backend/src/features/purchases/purchase-orders.service.ts` — método `approve`.

Flujo resumido:

1. Cargar la OC por `id` + `tenantId` del usuario, con `approvals` existentes.
2. Comprobar estado (`PENDING_APPROVAL` / `PARTIALLY_APPROVED`), contrato, no firma duplicada del mismo usuario en la misma OC.
3. Cargar **todas** las `ApprovalPolicy` del tenant con `include: { allowedUsers: true }`, ordenadas por `level` ascendente.
4. **`matchingPolicy`** = `resolveApprovalPolicyForUser(policies, { id: user.id })` (`backend/src/features/tenant-roles/tenant-role-defaults.ts`): **primera** política (menor nivel) en la que el `user.id` aparece en `allowedUsers[].userId`.
5. Si no hay política coincidente → `403` (no autorizado en ningún nivel configurado).
6. Si `matchingPolicy.level > order.requiredSignatures` → la firma de ese nivel no aplica a esta OC (umbral crítico / reglas de niveles requeridos).
7. **Umbral económico del nivel:** si `Number(matchingPolicy.minAmount) > 0` y `Number(order.totalAmount) < Number(matchingPolicy.minAmount)` → `400` con mensaje que contrasta monto de la OC vs mínimo del nivel.
8. Validar que no exista ya una firma para ese `level`, y que los niveles `1..n-1` estén firmados (orden estricto).
9. Crear `PurchaseOrderApproval` con `policyId: matchingPolicy.id` y actualizar estado de la OC.

**Interpretación de negocio:** el firmante debe ser **miembro ACL del nivel** y, además, el **total de la OC** debe alcanzar el `minAmount` configurado para *ese* nivel cuando `minAmount > 0` (0 = sin restricción de monto para ese escalón).

**Paridad frontend:** `frontend/src/app/core/utils/approval-policy.util.ts` expone `resolveApprovalPolicyForUser` con la misma semántica para vistas que necesiten saber en qué nivel encaja el usuario actual.

---

## 4. Flujo UI/UX: `PurchaseSettingsComponent`

**Ruta típica:** configuración de compras / matriz de firmas (componente `purchase-settings`).

### Carga de datos

- **Settings + políticas:** `PurchasesService.getSettings()` — hidrata `policies` con `level`, `description`, `userIds` (desde `allowedUsers`), `minAmount`.
- **Usuarios del tenant:** `UsersService.getUsers(1, 200)` — lista plana; el componente filtra **`isActive`**. No hay paginación infinita en UI: se asume hasta **200** usuarios activos por página de API; la **búsqueda** reduce el subconjunto mostrado localmente.

### Chips y multi-selección

- Por cada nivel, los **firmantes asignados** se muestran como chips con nombre y botón quitar (`removeUserFromPolicy`).
- Los **disponibles** excluyen `userIds` ya asignados a *ese* nivel y se filtran por texto (`name`, `email`, `position`) según `userSearch()[nivel]`.

### Validaciones pre-guardado (cliente)

- Mínimo **2 niveles** (`canSaveMatrix` / mensaje al guardar).
- Antes de `upsertPolicies`, se exige **al menos un usuario** por nivel (`emptyLevel`); si falta, aviso y no se llama al API.

### Persistencia

- `updateSettings` (umbral, moneda, tolerancia 3-way) y luego `upsertPolicies(this.policies())` en cadena (`switchMap`).

### Backend al guardar (`PurchaseSettingsService.upsertPolicies`)

- Niveles únicos; cada nivel con `userIds.length >= 1`.
- Validación de que **todos** los `userIds` existen y pertenecen al **mismo `tenantId`**.
- Transacción: update/create `ApprovalPolicy`, **`deleteMany` + `createMany`** sobre `approval_policy_users` por política (reemplazo atómico de la lista ACL).
- No se puede **eliminar** un nivel que ya tenga `PurchaseOrderApproval` referenciando esa política.

---

## 5. Referencias rápidas

| Área | Ubicación |
|------|-----------|
| Schema Prisma | `ApprovalPolicy`, `ApprovalPolicyUser` en `backend/prisma/schema.prisma` |
| Migración rol → usuarios | `backend/prisma/migrations/20260515220000_approval_policy_users_replace_role/migration.sql` |
| Resolución de política por usuario | `backend/src/features/tenant-roles/tenant-role-defaults.ts` |
| Firma OC + `minAmount` | `backend/src/features/purchases/purchase-orders.service.ts` → `approve` |
| Upsert políticas / ACL | `backend/src/features/purchases/purchase-settings.service.ts` |
| UI matriz | `frontend/src/app/features/purchases/purchase-settings/` |
| Util cliente | `frontend/src/app/core/utils/approval-policy.util.ts` |
