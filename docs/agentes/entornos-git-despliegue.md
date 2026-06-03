# Git, ramas y entornos de despliegue

Flujo **main → producción** y rama **`develop` → QA/staging** (Coolify). CI en GitHub Actions valida tests antes de merge.

**Última actualización:** 2026-05-24

---

## 1. Ramas y entornos

| Rama | Entorno | Despliegue Coolify | CI (GitHub) |
|------|---------|-------------------|-------------|
| **`main`** | Producción | App prod (dominio productivo) | `ci.yml` en push/PR |
| **`develop`** | QA / staging | App QA (subdominio `qa.*` — pendiente en VPS) | Mismo workflow |
| **`feature/<nombre>`** | Local | — | PR hacia `develop` (recomendado) o `main` |

```text
feature/*  ──PR──►  develop  ──►  Coolify QA (rama develop)
                         │
                         └── merge estable ──PR──►  main  ──►  Coolify PROD
```

**Base de datos:** Postgres **separado** para QA (nunca reutilizar `DATABASE_URL` de producción). Mismas migraciones: `prisma migrate deploy` en el entrypoint Docker.

---

## 2. Rama `develop` (QA)

La rama **`develop`** existe en el remoto como línea de integración para staging.

### Trabajo diario

```bash
git fetch origin
git checkout develop
git pull origin develop
# ... cambios ...
git push origin develop
```

Flujo recomendado cuando el entorno QA esté en Coolify:

1. Crear `feature/mi-cambio` desde `develop`.
2. PR → `develop` (CI debe quedar verde).
3. Probar en URL QA.
4. PR `develop` → `main` cuando esté listo para producción.

### Crear la rama en otro clone (si no existe localmente)

```bash
git fetch origin
git checkout -b develop origin/develop
```

---

## 3. CI — GitHub Actions

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)

| Paso | Comando | Qué valida |
|------|---------|------------|
| Instalación | `npm ci` (backend con `--legacy-peer-deps`) | Dependencias reproducibles |
| Prisma | `npx prisma generate` | Cliente alineado al schema |
| Lint backend | `npx eslint …` (sin `--fix`) | Estilo y reglas ESLint |
| Build backend | `npm run build` | Compila NestJS |
| Dominio crítico | `npm run test:domain` | **313 tests** en 17 specs (inventario, compras, OT, auth, …) |
| Build frontend | `npm run build` | Compila Angular 18 |

**Disparadores:** `push` y `pull_request` a `main` y `develop` (sin filtro de paths).

**Secrets:** no requiere `DATABASE_URL` (unit tests con mocks).

**Caché:** `actions/cache` sobre `~/.npm` y `node_modules` por lockfile (backend y frontend).

### Badge opcional en README

```markdown
![CI](https://github.com/<ORG>/<REPO>/actions/workflows/ci.yml/badge.svg?branch=main)
```

Reemplazar `<ORG>/<REPO>` por el slug real del repositorio en GitHub.

---

## 4. Coolify — segunda app (QA)

**Guía paso a paso (compose, DNS, variables, datos):** [coolify-qa-setup.md](coolify-qa-setup.md)

Archivos en repo:

| Archivo | Uso |
|---------|-----|
| `docker-compose.qa.yml` | Stack QA (rama `develop`) |
| `deploy/qa.env.example` | Variables para pegar en Coolify |

Checklist rápido:

- [ ] Proyecto **TPM QA** en Coolify → Docker Compose → `docker-compose.qa.yml` → rama **`develop`**
- [ ] DNS `qa.baselogic.cl` y `qa-api.baselogic.cl` → misma VPS (ver [coolify-qa-setup.md](coolify-qa-setup.md) §1)
- [ ] Variables desde `deploy/qa.env.example` (`JWT_SECRET` y VAPID **nuevos**)
- [ ] FQDN backend puerto **3000**, frontend puerto interno **8080**
- [ ] Volúmenes **nuevos** (`pgdata-qa`, `backend_uploads_qa`) — no los de prod
- [ ] Smoke: login + API + un flujo inventario ([coolify-qa-setup.md](coolify-qa-setup.md) §6)

Producción: [DEPLOY-COOLIFY.md](../DEPLOY-COOLIFY.md).

---

## 5. Checklist antes de merge a `main`

- [ ] `cd backend && npm run lint:ci` (mismo gate que GitHub Actions; ver abajo)
- [ ] `cd backend && npm run test:domain` (local)
- [ ] PR con CI verde en GitHub
- [ ] Migraciones probadas en **QA** (`develop` desplegado)
- [ ] Sin secretos en el diff
- [ ] Si tocó PBAC/compras/inventario: [MASTER-CONTEXT.md](../MASTER-CONTEXT.md)

---

## 6. Pruebas locales

```bash
cd backend
npm run lint:ci        # ESLint idéntico al job CI (--max-warnings 0, sin --fix)
npm run lint:ci:report # mismo lint + resumen por regla/archivo → eslint-ci-report.json
npm run test:domain    # gate mínimo (dominio)
npm test               # suite completa (incluye smoke)
```

**Lint completo (no inferir desde las ~10 anotaciones de GitHub):** el UI de Actions solo muestra un subconjunto. En local, `lint:ci` lista **todos** los errores; `lint:ci:report` ordena por regla y archivo. Auto-fix opcional: `npm run lint` (con `--fix`).

Detalle: [pruebas-unitarias.md](pruebas-unitarias.md).

---

## 7. Historial

| Fecha | Cambio |
|-------|--------|
| 2026-06-02 | `npm run lint:ci` / `lint:ci:report`; ESLint alineado al repo (unsafe-* off en legado); CI verde. |
| 2026-05-25 | CI unificado `ci.yml`: lint + build backend/frontend + `test:domain` (313 tests). |
| 2026-05-22 | Rama `develop` creada; CI inicial; smoke Jest arreglados (`jest-setup` + mocks guards/deps). |
