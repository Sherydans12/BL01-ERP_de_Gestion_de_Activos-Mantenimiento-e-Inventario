# Compras PBAC — pruebas API y E2E UI

**Fecha:** 2026-05-24  
**Estado del hito:** **CERRADO** — Compras blindado en `develop` (commit local).  
**Alcance:** módulo P2P (SRC → OC → recepción → factura → pago) con personas seed, matriz de **43 permisos** `purchases:*`, flujos API A–S y suite E2E Playwright modular.

| Capa | Comando | Resultado |
|------|---------|-----------|
| **API matriz + flujos** | `npm run simulate:compras-pbac -- --all` | 43 probes × 13 personas + flujos A–S |
| **E2E Playwright** | `E2E_SKIP_WEBSERVER=1 npm run test:compras` | **35/35 verdes** (6 specs modulares) |

Relacionado: [pbac-matriz-verificacion.md](pbac-matriz-verificacion.md), [PURCHASE-FLOWS.md](../PURCHASE-FLOWS.md), [PURCHASE-GOVERNANCE.md](../PURCHASE-GOVERNANCE.md), [RBAC-PERMISSIONS-CATALOG.md](../RBAC-PERMISSIONS-CATALOG.md).

---

## Prerrequisitos

| Requisito | Detalle |
|-----------|---------|
| Backend | `cd backend && npm run start:dev` → `:3000` |
| Frontend (solo E2E) | `cd frontend && npm start` → `:4200` |
| Tenant | `TENANT_CODE=TPM` (default) con contrato, artículos, bodega y proveedores |
| BD | `DATABASE_URL` en `backend/.env` |

---

## 1. Personas seed (API)

Crea **13 usuarios** con `TenantRole` custom, contratos TPM y matriz ACL N1/N2 para aprobadores.

```bash
cd backend
npm run seed:compras-pbac-personas
```

| Email | Rol custom | Uso principal |
|-------|------------|---------------|
| `pbac-compras-solicitante@test.com` | Solicitante SRC | create, submit, update-own, duplicate |
| `pbac-compras-comprador@test.com` | Comprador | cotización, adjudicación, OC, logistics |
| `pbac-compras-aprobador1@test.com` | Aprobador N1 | `order:approve` + ACL |
| `pbac-compras-aprobador2@test.com` | Aprobador N2 | `order:approve` + ACL |
| `pbac-compras-bodega@test.com` | Operador bodega | recepciones |
| `pbac-compras-tesoreria@test.com` | Tesorería | facturas, 3-way, NC |
| `pbac-compras-config@test.com` | Config compras | settings, vendors |
| `pbac-compras-lectura@test.com` | Solo lectura | todos los `*:read` compras |
| `pbac-compras-vacio@test.com` | Sin permisos | menú Compras oculto |
| `pbac-compras-en-acl-sin-approve@test.com` | En ACL sin approve | flujo C / E2E Firmar oculto |
| `pbac-compras-approve-fuera-acl@test.com` | Approve fuera ACL | flujo D |
| `pbac-compras-sin-contrato@test.com` | Sin `user_contract` | flujo I |
| `pbac-compras-admin-compras@test.com` | Admin compras | reject, reset, force-close |

**Contraseña:** `PBAC_TEST_PASSWORD` (default `Test1234!`).

Tras cambiar permisos en gobernanza: **re-login** obligatorio (JWT cachea permisos).

---

## 2. Simulación API (`simulate-compras-pbac.mjs`)

```bash
cd backend

# Todo: matriz + flujo A + extendidos B–J + cobertura K–S
npm run simulate:compras-pbac -- --all

# Por fase
npm run simulate:compras-pbac -- --matrix      # 43 probes × 13 personas
npm run simulate:compras-pbac -- --flow        # Flujo A — happy path P2P
npm run simulate:compras-pbac -- --extended    # Flujos B–J — ACL, parcial, 3-way, NC…
npm run simulate:compras-pbac -- --coverage    # Flujos K–S — endpoints restantes
```

### Variables de entorno

| Variable | Default | Notas |
|----------|---------|-------|
| `API_BASE` | `http://localhost:3000/api` | |
| `TENANT_CODE` | `TPM` | |
| `PBAC_TEST_PASSWORD` | `Test1234!` | |
| `PBAC_LOGIN_DELAY_MS` | `2000` | Subir a `3500` si hay `429` en login (throttle auth) |
| `DATABASE_URL` | — | Prisma para fixtures (contrato, artículos, bodega) |

### Suites

| Suite | Códigos | Qué valida |
|-------|---------|------------|
| **Matriz** | — | Cada permiso `purchases:*` → 403 vs permitido (13 personas) |
| **Flujo A** | A | SRC → cotización → OC → firmas → recepción → factura → pago |
| **Extendidos** | B–J | ABAC/ACL negativos, parcial WR, DISCREPANCY+overrule, NC, reject/force-close, sin contrato, multi-proveedor |
| **Cobertura** | K–S | update-own/purchasing, duplicate, cancel SRC, selectQuotation, createFromQuotation, logistics/sensitive/cancel OC, link-catalog, invoice update/delete/pay, vendors CRUD, policies noop, NC delete, logs/PDFs/calendario/analytics/documentos |

---

## 3. E2E UI — Playwright avanzado (`e2e/`)

Suite modular **35 tests** en `e2e/tests/compras/` con login vía API + `localStorage` (sin captcha en cada pantalla).

```bash
cd e2e
npm install
npm run install:browsers

# Prerrequisito: backend :3000 + frontend :4200 + seed personas
cd ../backend && npm run seed:compras-pbac-personas

# Con servidores ya levantados
E2E_SKIP_WEBSERVER=1 npm run test:compras
```

### Scripts npm (`e2e/package.json`)

| Script | Alcance |
|--------|---------|
| `npm run test:compras` | Suite completa (35 tests) |
| `npm run test:compras:smoke` | `01-pbac-navigation` — menú PBAC |
| `npm run test:compras:p2p` | `02-p2p-full-ui` — flujo P2P serial UI |

### Archivos de la suite

| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `01-pbac-navigation.spec.ts` | 12 | Sidebar por persona, lectura sin crear, ACL sin Firmar, sin contrato |
| `02-p2p-full-ui.spec.ts` | 6 | P2P completo UI: SRC → cotización → OC → firmas → envío → recepción → factura → pago |
| `03-module-pages.spec.ts` | 9 | Smoke carga 8 rutas `/app/compras/*` + config solo lectura |
| `04-requisition-lifecycle.spec.ts` | 2 | Duplicar SRC, anular SRC enviada |
| `05-vendors-settings-analytics.spec.ts` | 4 | Config, proveedor, analytics PDF, calendario pagos |
| `06-order-governance.spec.ts` | 2 | Reject OC + reset borrador, logistics OC |

Helpers: `e2e/helpers/auth.ts`, `api-compras.ts`, `ui.ts`, `item-picker.ts`, `fixtures/compras.fixture.ts`.

### Variables

| Variable | Default |
|----------|---------|
| `E2E_BASE_URL` | `http://localhost:4200` |
| `E2E_API_BASE` | `http://localhost:3000/api` |
| `E2E_SKIP_WEBSERVER` | `1` si front/back ya corren |
| `TENANT_CODE` / `PBAC_TEST_PASSWORD` | Igual que API |

### Throttle auth

Tras ~30 logins seguidos el backend puede responder `429` en `/auth/captcha`. Mitigación:

- Retry automático en `auth.ts` y `compras.fixture.ts`
- Entre suites largas: `PBAC_LOGIN_DELAY_MS=3500` o pausa manual
- Para CI: subir límite auth en QA o serializar workers (ya `workers: 1`)

### Bugs de producto corregidos durante la suite

| Área | Fix |
|------|-----|
| `ConfirmModalComponent` | Timer de countdown (botón confirm quedaba disabled en E2E) |
| `GET purchase-settings/policies` | Aprobadores con `order:approve` pueden leer matriz ACL |
| `GET warehouses?contractId=` | Filtra por contrato de la OC también para roles USER |

---

## 3b. E2E smoke legacy

El smoke inicial `e2e/tests/compras-pbac.spec.ts` fue reemplazado por la suite modular anterior.

---

## 4. Checklist QA (Coolify develop)

1. `npm run seed:compras-pbac-personas` en contenedor backend (o job one-shot).
2. `npm run simulate:compras-pbac -- --all` contra API QA (`qa-api.baselogic.cl`).
3. Opcional: pipeline CI con `--matrix` + `--coverage` en entorno efímero.
4. E2E Playwright contra `qa.baselogic.cl` tras personas seed en QA.

---

## Referencias de código

| Artefacto | Ruta |
|-----------|------|
| Seed personas | `backend/prisma/seed-compras-pbac-personas.ts` |
| Simulador API | `backend/scripts/simulate-compras-pbac.mjs` |
| Scripts npm | `backend/package.json` → `seed:compras-pbac-personas`, `simulate:compras-pbac` |
| E2E Playwright | `e2e/tests/compras/*.spec.ts`, `e2e/helpers/`, `e2e/fixtures/` |
