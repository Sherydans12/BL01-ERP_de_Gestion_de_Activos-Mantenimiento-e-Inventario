# Remediación Docker — Trivy DS-0002 / DS-0026 + Coolify (puerto 8080)

Documentación de equipo para el endurecimiento de imágenes y el despliegue en Coolify. Los informes crudos de auditoría (JSON, logs) **no** se versionan; quedan en `security-audit-reports/` (gitignored) si los generás en local.

## Resumen ejecutivo

| ID Trivy | Severidad | Problema | Remediación |
|----------|-----------|----------|-------------|
| **DS-0002** | HIGH | Contenedor como **root** / sin `USER` no root | **Backend:** `USER node` + `COPY --chown=node:node`. **Frontend:** `nginxinc/nginx-unprivileged:stable-alpine` + **`USER nginx`**. |
| **DS-0026** | LOW | Sin **HEALTHCHECK** | **Backend:** `curl` → `http://127.0.0.1:3000/api`. **Frontend:** `wget` → `http://127.0.0.1:8080/`. |

**Estado:** cubre explícitamente USER + HEALTHCHECK en las imágenes de aplicación; otros chequeos Trivy (compose completo, etc.) pueden ampliarse aparte.

## Archivos en repo afectados

| Archivo | Cambio clave |
|---------|----------------|
| `backend/Dockerfile` | `curl`; `COPY --chown=node:node`; `USER node`; `HEALTHCHECK` → `/api`. |
| `frontend/Dockerfile` | Base unprivileged; `wget`; `USER nginx`; `EXPOSE 8080`; `HEALTHCHECK`. |
| `frontend/nginx.conf` | `listen` **8080**. |
| `docker-compose.prod.yml` | `frontend.expose` **8080**. |
| `docker-compose.yml` | Perfil opcional `with-frontend` + `8080:8080` (solo si lo levantás). |

## Notas operativas

### Backend: volumen `/uploads` (`STORAGE_DRIVER=local`)

Con **`USER node`** (UID típico **1000**), un volumen montado como root puede impedir escritura. Opciones: `chown 1000:1000` en el mount, o **`STORAGE_DRIVER=r2`** en producción (ver `DEPLOY-COOLIFY.md`).

### Frontend: Coolify debe apuntar al **8080** interno

Resumen: el proxy público sigue en **443**; el **target al contenedor** es **8080**. Paso a paso en la sección siguiente.

---

## Coolify (VPS) — paso a paso

1. **Build:** despliegue que use el `frontend/Dockerfile` actual del repo.  
2. **Puertos / internal port:** upstream al contenedor en **8080** (no 80).  
3. **Healthcheck en panel:** si usaba **80**, pasarlo a **8080** (p. ej. `GET /`).  
4. **Dominio:** sin cambio en el FQDN público; solo la ruta interna al servicio.  
5. **Compose:** con `docker-compose.prod.yml`, `frontend` expone **8080** para descubrimiento del proxy.  
6. **Redeploy** del frontend; revisar logs (sin errores de bind).  
7. **Rollback:** redeploy a imagen/commit anterior si falla el mapeo.

### Backend (referencia)

Puerto **3000** sin cambio de contrato; `HEALTHCHECK` interno a `/api`.

---

## Convención de commit sugerida

```text
fix(security): non-root containers and Docker healthchecks
```

Incluí en el mismo commit (cuando corresponda): `gitleaks.toml`, `.gitignore`, Dockerfiles, compose, `DEPLOY-COOLIFY.md` y esta nota bajo `docs/agentes/`.
