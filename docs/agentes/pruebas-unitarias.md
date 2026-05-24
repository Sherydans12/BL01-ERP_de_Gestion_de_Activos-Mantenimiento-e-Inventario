# Pruebas unitarias — BaseLogic EAM (índice maestro)

Documento **canónico** para humanos y agentes Cursor. El inventario detallado del backend vive en [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md); el frontend en [pruebas-unitarias-frontend.md](pruebas-unitarias-frontend.md).

**Última actualización:** 2026-05-22

---

## 1. Reglas maestras (resumen obligatorio)

| Ámbito | Regla |
|--------|--------|
| **Aislamiento** | Nunca PostgreSQL real en unit tests. |
| **Backend Prisma** | Siempre `jest-mock-extended`: `mockDeep<PrismaService>()`, `DeepMockProxy<Prisma.TransactionClient>` en `$transaction`. |
| **Backend Nest** | `Test.createTestingModule` + mock de `PrismaService` y dependencias colaboradoras (`jest.mock` de utils). |
| **Foco de negocio** | PBAC/ACL, CPP/kardex, 3-way match, firmas OC, SRC→OC, recepciones con delta, multi-tenant (`tenantId`). |
| **Frontend** | `standalone: true` en `imports: []`; Signals con `.set()` / `.update()`; mock HTTP/servicios; `@if` / `@for` (no `*ngIf`). |
| **Formato** | TypeScript ejecutable con `npm test`; `describe` por flujo; `it` descriptivos en **español**; happy path + ≥2 errores de negocio. |

Regla Cursor dedicada (se activa al tocar specs o servicios de dominio): **`.cursor/rules/testing-baselogic.mdc`**.

---

## 2. Scripts npm (backend)

Desde `backend/`:

| Comando | Uso |
|---------|-----|
| `npm test` | Suite completa en `src/` (incluye smoke; ver §5 deuda). |
| **`npm run test:domain`** | **12 specs de dominio crítico** (inventario + compras ACL) — usar antes de commit/PR. |
| **`npm run test:domain:watch`** | Mismo alcance en **modo watch** — sesión larga de TDD con el agente o en terminal dedicada. |
| `npm run test:watch` | Toda la suite en watch (más lento; incluye smoke rotos). |
| `npm test -- <nombre>.spec` | Un archivo (rápido tras editar un servicio). |
| `npm run test:cov` | Cobertura (CI futuro). |

Frontend: `cd frontend && npm test` (Karma/Jasmine vía Angular CLI).

---

## 3. Flujo para agentes Cursor

Cuando **crees o modifiques** lógica de dominio o archivos `*.spec.ts`:

1. **Leé** [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) (o frontend) y un spec vecino del mismo módulo.
2. **Ejecutá** tras cambios relevantes (no alucinar el conteo):
   - Un archivo: `npm test -- inventory-stock.service.spec`
   - Bloque crítico: `npm run test:domain`
3. **Sesión larga** (varios specs seguidos): el agente puede arrancar en **background** `npm run test:domain:watch` (`block_until_ms: 0`) en `backend/` y revisar la salida del terminal entre iteraciones; el usuario también puede dejar esa terminal abierta en paralelo.
4. **Actualizá** el inventario en `pruebas-unitarias-backend.md` (tabla §2, conteo §0) si añadiste tests.
5. **No** commitear `.env` ni fixtures con secretos.

Prioridad de ejecución: **archivo tocado** → **`test:domain`** → suite completa (solo si el usuario lo pide o arreglás smoke).

---

## 4. Estado actual (dominio crítico)

**240 tests** en **12 archivos**, sin DB real (`npm run test:domain`).

```bash
cd backend
npm run test:domain
```

Detalle por módulo, bloques `describe` y pendientes: [pruebas-unitarias-backend.md](pruebas-unitarias-backend.md) §0–§4.

---

## 5. Suite completa (`npm test`)

Desde 2026-05-22 la suite completa pasa (~220 tests): smoke auth/users/sites con mocks de dependencias y `backend/test/jest-setup.ts` (mock ESM de `file-type`). CI en GitHub ejecuta `test:domain` + `npm test` — ver [entornos-git-despliegue.md](entornos-git-despliegue.md) §3.

---

## 6. Git y entornos (prod hoy → QA mañana)

Hoy: rama **`main`** → un ambiente de **producción** (Coolify). Cuando abras **QA**:

- Rama sugerida: `develop` o `qa` → despliegue Coolify staging.
- `main` solo recibe merges probados (`npm run test:domain` mínimo en CI).
- Guía de ramas y checklist: [entornos-git-despliegue.md](entornos-git-despliegue.md).

---

## 7. Referencias

- Reglas agente: `.cursor/rules/testing-baselogic.mdc`, `.cursor/rules/tpm-arquitectura.mdc` §6 (workflow Testing).
- `AGENTS.md` — índice del repo.
- Compras ACL: [../PURCHASE-GOVERNANCE.md](../PURCHASE-GOVERNANCE.md).
- Inventario kardex: [inventario-stock-transferencias-kardex.md](inventario-stock-transferencias-kardex.md).
