# Inventario PBAC — pruebas API y E2E UI

**Fecha:** 2026-05-25  
**Estado del hito:** **CERRADO** — Inventario blindado en `develop` (commit local, sin push).  
**Alcance:** catálogo, bodegas, stock/CPP, W2W, umbrales flotantes vs corrección física; **15 permisos** `inventory:*` core, personas seed, matriz API + aislamiento por contrato, suite Playwright modular.

| Capa | Comando | Resultado |
|------|---------|-----------|
| **API matriz + aislamiento** | `npm run simulate:inventario-pbac -- --all` | Probes × 8 personas + contrato cruzado |
| **E2E Playwright** | `E2E_SKIP_WEBSERVER=1 npm run test:inventario` | **7/7 verdes** (4 specs modulares) |

Relacionado: [control-stock-umbrales-vs-correccion-fisica.md](control-stock-umbrales-vs-correccion-fisica.md), [inventario-alta-articulos-y-selector-global.md](inventario-alta-articulos-y-selector-global.md), [ui-quickadd-global-picker-dialogos-nativos.md](ui-quickadd-global-picker-dialogos-nativos.md), [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md), [pbac-matriz-verificacion.md](pbac-matriz-verificacion.md).

---

## Prerrequisitos

| Requisito | Detalle |
|-----------|---------|
| Backend | `cd backend && npm run start:dev` → `:3000` |
| Frontend (solo E2E) | `cd frontend && npm start` → `:4200` |
| Tenant | `TENANT_CODE=TPM` con contratos, bodegas (≥2 en un contrato para W2W), familias/UoM |
| BD | `DATABASE_URL` en `backend/.env` |

---

## 1. Personas seed (API)

Crea **8 usuarios** con `TenantRole` custom y contratos TPM según persona.

```bash
cd backend
npm run seed:inventario-pbac-personas
```

| Email | Uso principal |
|-------|----------------|
| `pbac-inventario-admin@test.com` | ADMIN tenant (bypass PBAC) |
| `pbac-inventario-gestor@test.com` | 15 llaves core + `view_cost` — catálogo, stock, W2W setup E2E |
| `pbac-inventario-bodega@test.com` | Operador bodega contrato A — stock, ajustes, W2W |
| `pbac-inventario-lectura@test.com` | Solo `inventory:*:read` — ghost forms E2E |
| `pbac-inventario-vacio@test.com` | Sin permisos inventario — guard + menú |
| `pbac-inventario-sin-contrato@test.com` | Permisos sin `user_contract` — listados vacíos |
| `pbac-inventario-w2w-origen@test.com` | `transfer:create` — despacho SHIPPED |
| `pbac-inventario-w2w-destino@test.com` | `transfer:approve` — recepción COMPLETED |

**Contraseña:** `PBAC_TEST_PASSWORD` (default `Test1234!`).

Tras cambiar permisos en gobernanza: **re-login** obligatorio (JWT cachea permisos).

---

## 2. Simulación API (`simulate-inventario-pbac.mjs`)

```bash
cd backend

npm run simulate:inventario-pbac              # matriz + aislamiento (default)
npm run simulate:inventario-pbac -- --matrix   # solo matriz PBAC
npm run simulate:inventario-pbac -- --isolation  # solo aislamiento contrato
npm run simulate:inventario-pbac -- --all        # ambos
```

### Variables de entorno

| Variable | Default | Notas |
|----------|---------|-------|
| `API_BASE` | `http://localhost:3000/api` | |
| `TENANT_CODE` | `TPM` | |
| `PBAC_TEST_PASSWORD` | `Test1234!` | |
| `PBAC_LOGIN_DELAY_MS` | `2000` | Subir a `3500` si hay `429` en login |

### Suites

| Suite | Qué valida |
|-------|------------|
| **Matriz** | Cada permiso `inventory:*` core → 403 vs permitido (8 personas) |
| **Aislamiento** | Usuario con contrato único no ve bodegas/stock de otro contrato |

---

## 3. E2E UI — Playwright avanzado (`e2e/tests/inventario/`)

Suite modular **7 tests** con login vía API + `localStorage` (`tpm_token`, `tpm_user`, `tpm_contract_id`).

```bash
cd e2e
npm install
npm run install:browsers

cd ../backend && npm run seed:inventario-pbac-personas

# Con servidores ya levantados
E2E_SKIP_WEBSERVER=1 npm run test:inventario
```

### Scripts npm (`e2e/package.json`)

| Script | Alcance |
|--------|---------|
| `npm run test:inventario` | Suite completa (7 tests) |
| `npm run test:inventario:w2w` | `02-w2w-lifecycle` — serial origen → destino |

### Archivos de la suite

| Archivo | Tests | Qué cubre |
|---------|-------|-----------|
| `01-catalog-floating-policy.spec.ts` | 1 | Alta `/app/articulos/nuevo` con umbrales pendientes; API valida `policyTargetWarehouseId` sin `item_stocks` qty=0 |
| `02-w2w-lifecycle.spec.ts` | 2 | Origen: `SHIPPED` + `TRANSFER_OUT`; destino: `COMPLETED` + `TRANSFER_IN` (sesión distinta) |
| `03-stock-thresholds-vs-adjustment.spec.ts` | 1 | Modal Umbrales sin delta físico; Corregir físico + confirm nativo + kardex `ADJUST` |
| `04-pbac-security-ghost-forms.spec.ts` | 3 | Guard PBAC vacío; `fieldset[disabled]` + sin Guardar en bodega/artículo lectura |

Helpers: `e2e/helpers/auth.ts` (`INVENTARIO_USERS`), `api-inventario.ts`, `ui.ts`, `item-picker.ts`, `fixtures/inventario.fixture.ts`.

### Variables

| Variable | Default |
|----------|---------|
| `E2E_BASE_URL` | `http://localhost:4200` |
| `E2E_API_BASE` | `http://localhost:3000/api` |
| `E2E_SKIP_WEBSERVER` | `1` si front/back ya corren |
| `TENANT_CODE` / `PBAC_TEST_PASSWORD` | Igual que API |

### Patrones E2E aprendidos (bitácora)

| Tema | Mitigación en specs |
|------|---------------------|
| Bodegas UI vs API | Seleccionar bodega visible en `<select>` (contrato del header); no asumir que todo `GET /warehouses` aparece en UI |
| Picker global `strictFamilyFirst` | Búsqueda ≥2 caracteres; si `total === 1` el componente auto-cierra el dialog |
| Códigos cortos (`00`) | No usar `getByText('00')` suelto — matchea `<option>` oculto; filtrar tabla con `{code} —` |
| Guard PBAC | `expect(page).not.toHaveURL(...)` en lugar de `waitForURL(/\/app\/)` (acepta la ruta denegada) |
| Umbrales vs ajuste | Modal política: sin input «Nuevo stock físico»; ajuste: `Confirmar corrección` → `Sí, aplicar ajuste` |

---

## 4. Checklist QA (Coolify develop)

1. `npm run seed:inventario-pbac-personas` en contenedor backend.
2. `npm run simulate:inventario-pbac -- --all` contra API QA.
3. `E2E_SKIP_WEBSERVER=1 npm run test:inventario` contra `qa.baselogic.cl` tras seed en QA.

---

## Referencias de código

| Artefacto | Ruta |
|-----------|------|
| Seed personas | `backend/scripts/seed-inventario-pbac-personas.mjs` |
| Simulador API | `backend/scripts/simulate-inventario-pbac.mjs` |
| Scripts npm | `backend/package.json` → `seed:inventario-pbac-personas`, `simulate:inventario-pbac` |
| E2E Playwright | `e2e/tests/inventario/*.spec.ts`, `e2e/helpers/`, `e2e/fixtures/` |
