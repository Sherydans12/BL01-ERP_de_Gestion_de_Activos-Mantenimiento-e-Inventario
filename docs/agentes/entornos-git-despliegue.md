# Git, ramas y entornos de despliegue

Nota de transición: hoy el flujo es **una rama `main` → producción** (Coolify). Este doc prepara **QA/staging** sin imponer cambios hasta que los habilites.

**Última actualización:** 2026-05-22

---

## 1. Estado actual

| Elemento | Valor |
|----------|--------|
| Rama principal | `main` |
| Despliegue | Producción (ver [DEPLOY-COOLIFY.md](../DEPLOY-COOLIFY.md)) |
| Pruebas pre-release (recomendado ya) | `cd backend && npm run test:domain` |

---

## 2. Modelo objetivo (cuando abras QA)

```text
feature/*  ──PR──►  develop (o qa)  ──►  Coolify STAGING
                         │
                         └── merge estable ──►  main  ──►  PRODUCCIÓN
```

| Rama | Entorno | Uso |
|------|---------|-----|
| `main` | Producción | Solo merges revisados; tag/release opcional |
| `develop` o `qa` | Staging / QA | Integración diaria, datos de prueba, migraciones en sandbox |
| `feature/<ticket>` | Local | Trabajo del agente o dev; PR hacia `develop` |

**Base de datos:** instancia Postgres **separada** para staging (nunca apuntar QA a prod). Mismas migraciones Prisma (`migrate deploy` en entrypoint Docker).

---

## 3. Checklist mínimo antes de merge a `main`

- [ ] `npm run test:domain` en `backend/` (ver [pruebas-unitarias.md](pruebas-unitarias.md))
- [ ] Migraciones probadas en staging (`npx prisma migrate deploy`)
- [ ] Sin secretos en diff (`.env` fuera de git)
- [ ] Si tocó PBAC/compras/inventario: contrastar [MASTER-CONTEXT.md](../MASTER-CONTEXT.md)

CI futuro (GitHub Actions): job único `test:domain` + lint opcional.

---

## 4. Coolify (dos aplicaciones)

Cuando exista staging:

1. App **TPM QA** → rama `develop`, `DATABASE_URL` de staging, dominio `qa.*`.
2. App **TPM Prod** → rama `main`, variables prod, dominio productivo.

Mismo `docker-entrypoint.sh` (migrate + start). No compartir volúmenes de uploads entre entornos.

---

## 5. Trabajo con agentes hasta tener `develop`

- Seguir en `main` si es la política actual del equipo.
- Commits de **solo tests** o **docs** son seguros de subir en bloques.
- Al crear `develop`, actualizar este doc y `decisiones.md` con la fecha de corte.
