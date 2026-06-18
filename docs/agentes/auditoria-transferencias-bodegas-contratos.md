# Auditoria tecnico-funcional: transferencias entre bodegas y contratos

Fecha: 2026-06-18
Alcance: inspeccion estatica de UI Angular, servicios HTTP, NestJS, Prisma, reglas Cursor y documentacion viva del proyecto.
Restriccion inicial: no se modifico codigo productivo, tests, migraciones, commits ni pushes durante la auditoria.

Actualizacion 2026-06-18: correccion implementada. El contrato final para cargar bodegas W2W es `GET /warehouses?scope=transfer`; la creacion W2W valida contrato origen y destino; la UI usa `WarehousesService.getWarehousesForTransfer()`.

---

## 1. Resumen ejecutivo

El modulo W2W tiene una separacion incompleta entre **contexto global de contrato del header** y **alcance real por `allowedContracts`**.

La pantalla `/app/inventario/transferencias` carga bodegas con `WarehousesService.getWarehouses()` sin indicar explicitamente que necesita el alcance completo del usuario. El interceptor frontend agrega automaticamente `x-contract-id` con el contrato activo del header, y el backend de bodegas usa ese header como filtro en `GET /warehouses`. Resultado: para un `USER` con acceso a dos contratos, la UI normalmente muestra solo bodegas del contrato activo y no permite armar comodamente una transferencia entre bodegas de contratos distintos, aunque ambas esten dentro de sus contratos permitidos.

En backend, `InventoryTransferService.executeTransfer()` valida tenant y valida acceso al contrato de la bodega **origen**, pero no valida acceso al contrato de la bodega **destino** al crear la transferencia. Esto es un riesgo de seguridad: un usuario con `inventory:transfer:create` y acceso al origen podria transferir hacia una bodega fuera de sus contratos si conoce el UUID de destino. La recepcion si valida el contrato de la bodega destino.

Diagnostico original: **problema en ambos lados**. Frontend limitaba indebidamente la seleccion por contrato activo; backend tenia una brecha ABAC en creacion por falta de validacion del destino. Estado actual: corregido con scope W2W explicito y validacion de destino en backend.

---

## 2. Flujo actual frontend

### Carga de bodegas origen y destino

Archivos principales:

- `frontend/src/app/features/inventory-transfer/inventory-transfer.component.ts`
- `frontend/src/app/features/inventory-transfer/inventory-transfer.component.html`
- `frontend/src/app/core/services/warehouses/warehouses.service.ts`
- `frontend/src/app/core/services/auth/auth.interceptor.ts`
- `frontend/src/app/core/layout/layout.component.ts`

Flujo:

1. `InventoryTransferComponent` define un unico arreglo `warehouses` para origen y destino.
2. En el constructor tiene un `effect()` que lee `authService.currentContractId()` y ejecuta `loadWarehouses()` cada vez que cambia el contrato activo.
3. `loadWarehouses()` llama `warehousesService.getWarehouses()`.
4. `WarehousesService.getWarehouses()` hace `GET /warehouses` sin query params.
5. Estado original: el interceptor global agregaba `x-contract-id` si habia contrato activo distinto de `ALL`.
6. Estado actual: la UI llama `GET /warehouses?scope=transfer`; el backend detecta `scope=transfer` e ignora el filtro por contrato activo para devolver todas las bodegas operables.
7. El mismo `warehouses()` alimenta ambos selects:
   - `originWarehouseId`
   - `destinationWarehouseId`

Conclusiones:

- La UI ya no queda acoplada al contrato activo del header para cargar bodegas W2W.
- Existe una llamada W2W especifica del tipo "dame todas las bodegas operables por el usuario": `GET /warehouses?scope=transfer`.
- Si el usuario cambia el contrato del header, el formulario conserva el alcance completo permitido para W2W.

### Seleccion de items

El picker de articulos (`app-global-item-picker`) recibe `warehouseId = originWarehouseIdForPicker()` y `onlyWithStockInWarehouse = true`. Este comportamiento es correcto: el articulo se filtra por stock en la bodega origen seleccionada.

### Recepcion en UI

`canConfirmReception()` no usa la lista de bodegas cargada ni el contrato activo del header. Evalua:

- permiso `inventory:transfer:approve`;
- estado en transito;
- `destinationWarehouse.contractId`;
- bypass `ADMIN` / `SUPER_ADMIN`;
- para otros roles, `currentUser.allowedContracts.includes(destContractId)`.

Esta regla esta alineada con el backend de recepcion y es conceptualmente correcta.

---

## 3. Flujo actual backend

Archivos principales:

- `backend/src/features/inventory-transfer/inventory-transfer.controller.ts`
- `backend/src/features/inventory-transfer/inventory-transfer.service.ts`
- `backend/src/features/warehouses/warehouses.controller.ts`
- `backend/src/features/warehouses/warehouses.service.ts`
- `backend/src/common/contract-scope.util.ts`
- `backend/src/features/auth/guards/permissions.guard.ts`
- `backend/src/features/auth/strategies/jwt.strategy.ts`

### Listado y detalle de transferencias

`InventoryTransferController` protege:

- `GET /inventory-transfers` con `inventory:transfer:read`.
- `GET /inventory-transfers/:id` con `inventory:transfer:read`.

`InventoryTransferService.buildTransferListWhere()` filtra:

- siempre por `tenantId`;
- para no admin, usa OR:
  - `originWarehouse.contractId in allowedContracts`
  - `destinationWarehouse.contractId in allowedContracts`

Esto significa que un usuario puede ver transferencias donde participa cualquiera de sus contratos permitidos como origen o destino.

### Creacion de transferencia

`POST /inventory-transfers` requiere `inventory:transfer:create`.

`executeTransfer()`:

- valida usuario;
- valida origen distinto de destino;
- valida lineas y cantidades;
- busca bodegas por `id` + `tenantId`;
- valida acceso contractual solo a `origin.contractId`;
- crea `InventoryTransfer` en `SHIPPED`;
- descuenta stock origen;
- crea lineas y `InventoryTransaction` tipo `TRANSFER_OUT`.

Brecha corregida: ahora existe validacion equivalente para `dest.contractId`; si el usuario no tiene acceso contractual al destino, se lanza `ForbiddenException`.

### Confirmacion de recepcion

`POST /inventory-transfers/:id/receive` requiere `inventory:transfer:approve`.

`confirmReception()`:

- busca transferencia por `id` + `tenantId`;
- exige `status === SHIPPED`;
- valida acceso a `transfer.destinationWarehouse.contractId`;
- incrementa/upsert stock destino;
- calcula CPP destino;
- crea `InventoryTransaction` tipo `TRANSFER_IN`;
- marca transferencia `COMPLETED`.

La recepcion depende de `allowedContracts` y del contrato de la bodega destino. No depende del contrato activo del header.

---

## 4. Matriz de permisos

| Accion | Frontend | Backend | Permiso PBAC exacto | ABAC contrato |
|---|---|---|---|---|
| Ver menu/ruta Transferencias | `app.routes.ts`, `nav.config.ts` | `GET /inventory-transfers` | `inventory:transfer:read` | Listado por `allowedContracts` para no admin |
| Ver detalle | Boton "Detalle" | `GET /inventory-transfers/:id` | `inventory:transfer:read` | Detalle usa mismo filtro OR origen/destino |
| Crear transferencia | Seccion `*appHasPermission="i.TRANSFER_CREATE"` | `POST /inventory-transfers` | `inventory:transfer:create` | Valida origen y destino |
| Confirmar recepcion | `canConfirmReception()` + `*appHasPermission` | `POST /inventory-transfers/:id/receive` | `inventory:transfer:approve` | Valida destino |
| Cargar bodegas del formulario | Selects origen/destino | `GET /warehouses?scope=transfer` | `inventory:warehouse:read` | `ADMIN` / `SUPER_ADMIN` tenant-wide; otros roles por todos sus `allowedContracts` |

Constantes:

- Frontend: `frontend/src/app/core/constants/inventory-permissions.ts`
- Backend: `backend/src/features/auth/constants/permissions.enum.ts`

---

## 5. Reglas de contrato actuales

### ADMIN / SUPER_ADMIN

- `PermissionsGuard` hace bypass PBAC para `ADMIN` y `SUPER_ADMIN`.
- `InventoryTransferService.canAccessContract()` tambien hace bypass contractual para ambos.
- En `WarehousesService.findAll()`, si llega un contrato activo, filtra por ese contrato; si no llega o llega `ALL`, ve todo el tenant. En `scope=transfer`, ignora el contrato activo para devolver el alcance W2W completo.
- El layout no muestra selector de contrato para `ADMIN`/`SUPER_ADMIN` normales (`showContractSelector` false), aunque existe opcion `ALL` en logica para admin.

### USER o roles personalizados

- El JWT se hidrata con `allowedContracts` desde `UserContract`.
- El layout carga todos los contratos del tenant y filtra en cliente por `allowedContracts`.
- `AuthService` inicializa `currentContractId` con el primer contrato permitido si no existe uno guardado.
- El interceptor envia `x-contract-id` en todas las requests cuando `currentContractId` no es `ALL`.
- `GET /warehouses` normal queda restringido al contrato activo cuando se envia ese header.
- `GET /warehouses?scope=transfer` devuelve bodegas de todos los `allowedContracts`.

### Observacion tecnica

`WarehousesService.findAll()` fue endurecido: un usuario no admin sin `allowedContracts` ya no puede obtener bodegas mediante un `contractFilter` explicito.

---

## 6. Diferencias ADMIN/SUPER_ADMIN vs USER

| Tema | ADMIN / SUPER_ADMIN | USER / rol personalizado |
|---|---|---|
| PBAC | Bypass en `PermissionsGuard` y `AuthService.hasPermission()` | Requiere permisos en JWT |
| Contratos | Tenant-wide | Solo `allowedContracts` |
| Bodegas en `/warehouses` | Todas si no hay header o `ALL`; filtradas si hay header especifico. En `scope=transfer`, todas del tenant | Por contrato activo si header existe en flujo normal; en `scope=transfer`, todas las de `allowedContracts` |
| Crear W2W cross-contract | Permitido | Permitido solo si origen y destino estan en `allowedContracts` |
| Confirmar recepcion | Permitido | Permitido solo si destino esta en `allowedContracts` |

---

## 7. Causa probable del problema

Causa principal funcional original:

El formulario W2W usaba el endpoint generico `GET /warehouses`, que interpretaba el `x-contract-id` global como filtro operativo. Como el interceptor agrega ese header de forma automatica, el modulo quedaba acoplado al contrato activo del header sin que el componente lo declarara explicitamente.

Causa secundaria de seguridad original:

La creacion W2W no validaba contrato destino en backend.

Estado actual: ambas causas fueron corregidas con `GET /warehouses?scope=transfer` y validacion de destino en `executeTransfer()`.

---

## 8. Riesgos de seguridad

1. Movimiento no autorizado hacia bodega destino fuera de alcance:
   - Riesgo: fuga operativa o manipulacion de inventario entre contratos.
   - Vector: `POST /inventory-transfers` directo con UUID de destino conocido.
   - Estado actual: falta validacion de `dest.contractId`.

2. Transferencias parcialmente bloqueadas:
   - Un usuario podria crear `SHIPPED` hacia destino no autorizado y otro usuario/admin tendria que resolver la recepcion o correccion.
   - Riesgo contable/logistico: stock sale del origen y queda pendiente hacia un destino no autorizado para el creador.

3. Filtrado de bodegas dependiente de header global:
   - Riesgo funcional mas que confidencial: usuarios con dos contratos permitidos no pueden operar el caso de negocio esperado sin cambiar contexto o usar API directa.

4. Debilidad en `WarehousesService.findAll()` para usuarios sin contratos:
   - La condicion `allowed.length === 0` dentro de `contractFilter` merece revision; para no admin sin contratos deberia devolver vacio/403, no confiar en un contrato explicito.

---

## 9. Casos esperados de negocio

1. `ADMIN` o `SUPER_ADMIN` puede transferir entre cualquier bodega del tenant, incluso entre contratos distintos.
2. `USER` con `allowedContracts = [A]` puede transferir solo entre bodegas del contrato A.
3. `USER` con `allowedContracts = [A, B]` puede:
   - seleccionar origen A y destino B;
   - seleccionar origen B y destino A;
   - confirmar recepciones cuyo destino sea A o B.
4. `USER` con `allowedContracts = [A]` no puede:
   - despachar desde bodega de B;
   - enviar hacia bodega de B;
   - confirmar recepcion en bodega de B.
5. La pantalla W2W no debe depender del contrato activo del header para limitar origen/destino; puede usarlo como valor inicial o agrupador visual, pero no como alcance efectivo unico.
6. El picker de articulos si debe depender de la bodega origen seleccionada, porque el stock disponible es por bodega.

---

## 10. Tests existentes

### Backend unitarios

Archivo: `backend/src/features/inventory-transfer/inventory-transfer.service.spec.ts`

Cobertura existente:

- permiso `inventory:transfer:create`;
- usuario sin ID;
- bodegas inexistentes;
- origen igual a destino;
- lineas vacias;
- cantidad invalida;
- UoM sin decimales;
- stock insuficiente;
- happy path `SHIPPED`, `TRANSFER_OUT`;
- recepcion inexistente;
- recepcion sin usuario;
- recepcion no `SHIPPED`;
- recepcion sin acceso al contrato destino;
- CPP ponderado y `TRANSFER_IN`;
- destino sin stock previo;
- `clearItemStockPolicy`;
- listado paginado;
- listado filtrado por `allowedContracts`;
- detalle sin alcance contractual.

No cubre:

- creacion por `USER` con origen permitido y destino fuera de `allowedContracts`.
- creacion cross-contract valida para `USER` con ambos contratos permitidos.
- `GET /warehouses` sin header vs con header para W2W.

### Frontend unitarios

No se encontraron specs especificos para `InventoryTransferComponent`.

`frontend/src/app/core/services/warehouses/warehouses.service.spec.ts` solo verifica creacion del servicio.

### E2E

Archivo principal: `e2e/tests/inventario/02-w2w-lifecycle.spec.ts`

El helper `findW2WPair()` busca dos bodegas **en el mismo contrato**, por lo que valida el ciclo W2W basico, pero no el caso multi-contrato.

Otros E2E de inventario revisan PBAC de formularios fantasma y bloqueo de POST sin permiso, pero no el escenario `allowedContracts = [A, B]` con origen/destino en contratos distintos.

---

## 11. Tests faltantes

Backend unitarios recomendados:

1. `executeTransfer` debe rechazar `USER` con origen permitido y destino fuera de `allowedContracts`.
2. `executeTransfer` debe permitir `USER` con origen y destino en contratos permitidos distintos.
3. `executeTransfer` debe permitir `ADMIN`/`SUPER_ADMIN` cross-contract.
4. `WarehousesService.findAll` para no admin sin header debe devolver todas las bodegas de `allowedContracts`.
5. `WarehousesService.findAll` para no admin con contrato explicito fuera de alcance debe devolver vacio o 403 segun decision API.
6. `WarehousesService.findAll` para no admin sin contratos no debe permitir acceso por `contractFilter`.

Frontend unitarios recomendados:

1. `InventoryTransferComponent.loadWarehouses()` no debe depender del contrato activo para W2W si el usuario tiene varios contratos.
2. `canConfirmReception()` debe permitir destino en `allowedContracts` aunque el contrato activo del header sea otro.
3. `canConfirmReception()` debe bloquear destino fuera de `allowedContracts`.

E2E recomendados:

1. Usuario no admin con `allowedContracts = [A, B]`: crear transferencia A -> B desde UI.
2. Mismo usuario con header activo A: destino B debe estar seleccionable.
3. Usuario con solo A: destino B no debe aparecer o backend debe responder 403 si se fuerza por API.
4. Recepcion B con header activo A: si el usuario tiene B en `allowedContracts`, debe poder confirmar.
5. Recepcion B con usuario solo A: no debe ver boton y API debe responder 403.

---

## 12. Recomendacion de implementacion posterior

### Backend

1. En `InventoryTransferService.executeTransfer()`, validar tambien:
   - `this.canAccessContract(user, dest.contractId)`;
   - mensaje sugerido: `No tiene permisos para transferir hacia esta bodega destino.`
2. Considerar exigir acceso a ambos contratos para crear, aunque el listado use OR para visibilidad.
3. Endurecer `WarehousesService.findAll()`:
   - quitar `allowed.length === 0` como bypass con `contractFilter`;
   - usar `userCanAccessContractId()` o util comun para consistencia.
4. Crear una ruta/parametro explicito para W2W:
   - opcion A: `GET /warehouses?scope=transfer` ignora `x-contract-id` y devuelve todas las bodegas de `allowedContracts`;
   - opcion B: `GET /warehouses?allAllowed=1`;
   - opcion C: endpoint dedicado `GET /inventory-transfers/warehouses`.

### Frontend

1. Evitar que el formulario W2W use implicitamente el `x-contract-id` global al cargar bodegas.
2. Implementar metodo HTTP explicito, por ejemplo `getWarehousesForTransfer()`, que:
   - omita o sobrescriba `x-contract-id`;
   - use el parametro/backend definido para traer todas las bodegas permitidas.
3. Mostrar contrato/codigo en las opciones de origen y destino para evitar confusion operacional:
   - ejemplo: `BOD-01 - Central (Contrato A)`.
4. Mantener `canConfirmReception()` basado en destino y `allowedContracts`, no en contrato activo.
5. Mantener picker de items filtrado por bodega origen.

### Documentacion

Actualizar, cuando se implemente:

- `docs/agentes/inventario-stock-transferencias-kardex.md`
- `docs/MASTER-CONTEXT.md`
- `docs/agentes/pruebas-unitarias-backend.md`
- esta auditoria o una decision breve en `docs/agentes/decisiones.md`

---

## 13. Archivos revisados

Documentacion y reglas:

- `AGENTS.md`
- `docs/MASTER-CONTEXT.md`
- `docs/agentes/inventario-stock-transferencias-kardex.md`
- `docs/agentes/decisiones.md`
- `docs/agentes/auditoria-contexto-control-stock.md`
- `.cursor/rules/tpm-arquitectura.mdc`
- `.cursor/rules/erp-bl01-context.mdc`
- `docs/agentes/pruebas-unitarias-backend.md`

Modelo de datos:

- `backend/prisma/schema.prisma`

Frontend:

- `frontend/src/app/features/inventory-transfer/inventory-transfer.component.ts`
- `frontend/src/app/features/inventory-transfer/inventory-transfer.component.html`
- `frontend/src/app/core/services/inventory-transfer/inventory-transfer.service.ts`
- `frontend/src/app/core/services/warehouses/warehouses.service.ts`
- `frontend/src/app/core/services/warehouses/warehouses.service.spec.ts`
- `frontend/src/app/core/services/auth/auth.interceptor.ts`
- `frontend/src/app/core/services/auth/auth.service.ts`
- `frontend/src/app/core/services/contracts/contracts.service.ts`
- `frontend/src/app/core/layout/layout.component.ts`
- `frontend/src/app/core/layout/layout.component.html`
- `frontend/src/app/core/navigation/nav.config.ts`
- `frontend/src/app/core/constants/inventory-permissions.ts`
- `frontend/src/app/app.routes.ts`

Backend:

- `backend/src/features/inventory-transfer/inventory-transfer.controller.ts`
- `backend/src/features/inventory-transfer/inventory-transfer.service.ts`
- `backend/src/features/inventory-transfer/inventory-transfer.service.spec.ts`
- `backend/src/features/warehouses/warehouses.controller.ts`
- `backend/src/features/warehouses/warehouses.service.ts`
- `backend/src/common/contract-scope.util.ts`
- `backend/src/features/auth/constants/permissions.enum.ts`
- `backend/src/features/auth/guards/permissions.guard.ts`
- `backend/src/features/auth/permissions.util.ts`
- `backend/src/features/auth/strategies/jwt.strategy.ts`
- `backend/src/features/sites/sites.controller.ts`
- `backend/src/features/sites/sites.service.ts`

E2E:

- `e2e/tests/inventario/02-w2w-lifecycle.spec.ts`
- `e2e/helpers/api-inventario.ts`
- busqueda estatica en `e2e/tests/inventario/04-pbac-security-ghost-forms.spec.ts` y specs relacionadas.

---

## 14. Respuestas directas a las preguntas de auditoria

1. **Como se cargan bodegas origen/destino:** una sola lista `warehouses()` cargada con `GET /warehouses`; ambos selects usan esa lista.
2. **La UI usa contrato activo del header:** si, indirectamente, por el interceptor `x-contract-id` y el backend de bodegas.
3. **Permite bodegas de distintos contratos si el usuario tiene ambos:** no de forma confiable en UI; solo si la llamada a bodegas no queda filtrada por header, lo que no ocurre normalmente para `USER`.
4. **Diferencia ADMIN/SUPER_ADMIN vs USER:** admin tiene bypass PBAC/contrato; USER depende de permisos y `allowedContracts`.
5. **Permisos exactos:** ver `inventory:transfer:read`; crear `inventory:transfer:create`; confirmar `inventory:transfer:approve`.
6. **Backend valida origen:** si, en `executeTransfer()` con `canAccessContract(user, origin.contractId)`.
7. **Backend valida destino:** al crear, no; al confirmar recepcion, si.
8. **Recepcion depende de header o allowedContracts:** depende de contrato destino y `allowedContracts`; no del header.
9. **Validacion correcta fuera de contratos permitidos:** incompleta; origen y recepcion destino si, destino al crear no.
10. **Problema frontend/backend:** ambos.
11. **Tests cross-contract no admin:** no se detectaron tests unitarios/E2E que cubran el caso completo.
12. **Archivos a tocar despues:** `inventory-transfer.service.ts`, su spec, `warehouses.service.ts`/controller o endpoint dedicado, servicios frontend de bodegas, componente W2W, specs frontend/E2E y docs.
