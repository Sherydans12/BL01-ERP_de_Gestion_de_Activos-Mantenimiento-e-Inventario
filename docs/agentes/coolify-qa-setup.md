# Montaje del entorno QA en Coolify (rama `develop`)

Guía operativa para una **segunda aplicación** en la misma VPS que producción: base Postgres **aislada**, dominios **distintos**, rama Git **`develop`**, compose **`docker-compose.qa.yml`**.

**Última actualización:** 2026-05-22

---

## 0. Qué vas a tener al terminar

| Recurso | Producción (actual) | QA (nuevo) |
|---------|---------------------|------------|
| Rama Git | `main` | **`develop`** |
| Compose | `docker-compose.prod.yml` | **`docker-compose.qa.yml`** |
| Front (ejemplo) | `https://app.baselogic.cl` | `https://qa.app.baselogic.cl` |
| API (ejemplo) | `https://api.baselogic.cl` | `https://qa.api.baselogic.cl` |
| Postgres | volumen prod | volumen **`pgdata-qa`** (otro) |
| Uploads | volumen prod | volumen **`backend_uploads_qa`** |
| JWT / VAPID | prod | **valores nuevos** (no reutilizar prod) |

---

## 1. Prerrequisitos

- [ ] Coolify operativo en la VPS (misma instancia que prod está bien).
- [ ] Red Docker externa **`coolify`** existe (la crea Coolify; prod ya la usa).
- [ ] Rama **`develop`** en GitHub con este repo (compose QA + `environment.qa.ts`).
- [ ] DNS: registros **A** (o CNAME) hacia la IP de la VPS, por ejemplo:
  - `qa.app.baselogic.cl`
  - `qa.api.baselogic.cl`  
  (Podés usar otros nombres; luego los copiás **tal cual** en variables y en Coolify.)

---

## 2. Archivos del repo (referencia)

| Archivo | Uso |
|---------|-----|
| [`docker-compose.qa.yml`](../../docker-compose.qa.yml) | Stack db + backend + frontend QA |
| [`deploy/qa.env.example`](../../deploy/qa.env.example) | Plantilla de variables para Coolify |
| [`frontend/src/environments/environment.qa.ts`](../../frontend/src/environments/environment.qa.ts) | Build Angular `configuration=qa` |
| [`DEPLOY-COOLIFY.md`](../../DEPLOY-COOLIFY.md) | Migraciones, uploads, puerto 8080 |

**No** incluye backup S3 diario (prod sí); en QA podés omitirlo o añadirlo después con bucket/prefijo `env/qa`.

---

## 3. Paso a paso en Coolify

### 3.1 Nuevo proyecto

1. Coolify → **+ Add New Resource** → **Project** (ej. `TPM QA`).
2. Dentro del proyecto → **+ New** → **Docker Compose** (no “Application” suelta si querés el stack completo como prod).

### 3.2 Repositorio y rama

| Campo | Valor |
|-------|--------|
| Repository | `Sherydans12/BL01-ERP_de_Gestion_de_Activos-Mantenimiento-e-Inventario` (o tu fork) |
| Branch | **`develop`** |
| Compose file | **`docker-compose.qa.yml`** |
| Base directory | `/` (raíz del repo) |

Activá **Auto Deploy** en push a `develop` si querés CI + despliegue continuo (opcional).

### 3.3 Variables de entorno

En el recurso Compose → **Environment Variables**:

1. Abrí [`deploy/qa.env.example`](../../deploy/qa.env.example) en local.
2. Copiá **todas** las claves al panel de Coolify (incluidas las de Postgres).
3. Completá valores reales (ver §4).
4. **No** subas un `.env` con secretos al repo.

**Crítico — sin esto Postgres no arranca y el backend entra en bucle de reinicio:**

| Variable | Uso |
|----------|-----|
| `DB_USER` | Usuario Postgres (`POSTGRES_USER` en el contenedor `db`) |
| `DB_PASSWORD` | Contraseña **no vacía** (`POSTGRES_PASSWORD`) |
| `DB_NAME` | Nombre de la BD (`POSTGRES_DB` y segmento final de `DATABASE_URL`) |

Si `DB_PASSWORD` está vacía, verás en logs de **db**: *«superuser password is not specified»* y en **backend**: *P1001 Can't reach database server*.

Coolify inyecta `${VAR}` en el compose y en los **build args** del frontend (`QA_API_URL`, etc.).

### 3.4 Dominios (FQDN) por servicio

Asigná dominio HTTPS en Coolify **por servicio** (Traefik / Let’s Encrypt):

| Servicio en compose | Puerto interno | FQDN sugerido |
|---------------------|----------------|---------------|
| `backend` | **3000** | `qa.api.baselogic.cl` |
| `frontend` | **8080** (no 80) | `qa.app.baselogic.cl` |

**Importante (puerto 8080):** el nginx del front escucha en **8080** dentro del contenedor. En healthcheck y “port mapping” interno usá **8080**. La URL pública **no** debe llevar `:8080`. Ver [DEPLOY-COOLIFY.md](../../DEPLOY-COOLIFY.md) § Frontend Docker.

### 3.5 Red

El compose declara:

```yaml
networks:
  coolify:
    external: true
```

Si Coolify no creó la red, en la VPS: `docker network create coolify` (suele existir ya por prod).

### 3.6 Primer deploy

1. **Deploy** / **Redeploy**.
2. Revisá logs del **backend**:
   - `prisma migrate deploy` OK
   - Nest escuchando en 3000
   - Sin error de `STORAGE_DRIVER=r2` incompleto (si usás R2).
3. Revisá logs del **frontend**: nginx en 8080.
4. Abrí `https://qa.app.baselogic.cl` → login (si hay usuarios en BD).

---

## 4. Valores que debes generar / decidir

### 4.1 Obligatorios

```bash
# JWT solo QA (ejemplo Linux/macOS)
openssl rand -base64 48

# VAPID QA (en backend/)
cd backend && npx web-push generate-vapid-keys
```

| Variable | Regla |
|----------|--------|
| `JWT_SECRET` | **Distinto** al de producción |
| `DB_PASSWORD` | Fuerte, solo QA |
| `FRONTEND_URL` | Exactamente el origen del front QA (`https://qa.app...`, sin `/` final) |
| `BACKEND_PUBLIC_URL` | Origen API sin `/api` (`https://qa.api...`) |
| `QA_API_URL` | API + `/api` (`https://qa.api.../api`) |
| `QA_SITE_URL` | Mismo origen que `FRONTEND_URL` |
| `VAPID_*` | Par **nuevo**; `VAPID_PUBLIC_KEY` también va al build del front |

### 4.2 CORS

Si el login falla con error CORS, `FRONTEND_URL` en el backend no coincide **carácter a carácter** con la URL del navegador (http vs https, subdominio, sin barra final).

### 4.3 Email

Podés usar la misma `RESEND_API_KEY` que prod con `RESEND_FROM_NAME=BaseLogic QA` para distinguir correos.

### 4.4 Storage (local en QA)

Config recomendada en Coolify:

```env
STORAGE_DRIVER=local
UPLOAD_PATH=/uploads
ALLOW_LOCAL_STORAGE_PURGE=true
```

| Tema | Comportamiento |
|------|----------------|
| **Redeploy** | Los archivos **no se pierden** si Coolify mantiene el volumen nombrado **`backend_uploads_qa`**. Un redeploy normal solo recrea contenedores, no el volumen. |
| **Pérdida de archivos** | Solo si en Coolify **eliminás el volumen** o borrás el stack con “delete volumes”. |
| **Limpiar disco** | UI **Datos plataforma** (`/app/admin/platform-data`) como `SUPER_ADMIN` → bloque «Archivos en disco» → confirmar `PURGE_LOCAL_UPLOADS`. API: `POST /api/super-admin/platform/local-storage/purge`. |
| **BD vs archivos** | Purga de módulos (compras, etc.) **no** borra ficheros huérfanos; usá «Vaciar uploads» cuando quieras resetear adjuntos en QA. |

En **producción** no definas `ALLOW_LOCAL_STORAGE_PURGE` (o `false`): el botón queda deshabilitado.

---

## 5. Datos iniciales en Postgres QA

### 5.0 Comprobar si ya hay tenants y usuarios

En Coolify → servicio **db** → terminal, o desde tu PC con `DATABASE_URL` de QA:

```sql
SELECT id, code, name FROM tenants;
SELECT email, role, "isActive", "tenantId" FROM users ORDER BY email;
```

| Resultado | Significado |
|-----------|-------------|
| **0 tenants** | BD vacía tras migraciones (normal en QA nuevo). Hay que crear tenant + usuario (§5 A) o restaurar dump (§5 B). |
| **Tenants sin users** | Ejecutá `npm run seed:super-admin` (§5 A). |
| **Filas con emails conocidos** | Podés iniciar sesión en `https://qa.app.baselogic.cl` con esas credenciales (si no importaste solo BD sin conocer passwords, reseteá con bootstrap). |

No puedo ver tu BD QA desde el repo; ejecutá esas consultas en tu entorno.

Elegí **una** opción de carga:

### A) Base vacía + migraciones (arranque limpio)

El entrypoint ya ejecuta `migrate deploy`. **`prisma seed` no inserta datos** (está vacío a propósito).

1. Crear empresa **TPM** (si no existe tenant), desde tu PC apuntando a QA:

```bash
cd backend
# .env con DATABASE_URL de Postgres QA
```

Si no hay tenant, insert mínimo (una vez):

```sql
INSERT INTO tenants (id, code, name, "isActive", "primaryColor", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'TPM',
  'TPM QA',
  true,
  '#00B4D8',
  NOW(),
  NOW()
);
```

2. Usuario **SUPER_ADMIN** (acceso a Datos plataforma y limpieza de uploads):

```bash
npm run seed:super-admin
# Por defecto: superadmin@test.com / Test1234!  — cambiar en QA tras primer login
```

3. Opcional — usuarios de negocio de prueba:

```bash
npm run db:clean-bootstrap-tpm
# o solo catálogos:
npm run seed:catalog-masters
```

### B) Copia de producción (recomendado para pruebas realistas)

1. En local o prod: `pg_dump -Fc ... -f erp-prod.dump`
2. Restaurar en la BD QA (usuario/host del servicio `db` QA):

```bash
pg_restore --clean --if-exists -h HOST_QA -U erp_qa -d erp_qa erp-prod.dump
```

3. **No** compartas JWT de prod con clientes QA: los usuarios existen en BD pero el **navegador** debe apuntar solo a dominios QA.

Opcional: anonimizar emails en QA con SQL ad hoc antes de dar acceso al equipo.

---

## 6. Checklist post-deploy

- [ ] `GET https://qa.api.baselogic.cl/api` responde (health del backend).
- [ ] Front carga sin 522 / sin `:8080` en la barra de direcciones.
- [ ] Login con usuario de prueba.
- [ ] Un flujo inventario (consulta stock) o lectura de OT.
- [ ] Push Web (opcional): solo tras configurar VAPID QA en front + back.
- [ ] GitHub Actions verde en rama `develop` ([`entornos-git-despliegue.md`](entornos-git-despliegue.md) §3).

---

## 7. Flujo de trabajo diario

```text
feature/xxx  →  PR a develop  →  CI verde  →  Coolify auto-deploy QA
       →  pruebas en qa.app.*
       →  PR develop → main  →  deploy producción
```

---

## 8. Problemas frecuentes

| Síntoma | Causa probable | Acción |
|---------|----------------|--------|
| CORS en login | `FRONTEND_URL` mal | Igualar a URL del navegador |
| 522 / URL con `:8080` | Proxy apunta mal | Puerto interno **8080**, FQDN sin puerto |
| Backend no arranca R2 | Variables R2 incompletas | `STORAGE_DRIVER=local` en QA o completar R2 |
| Front llama API prod | Build sin args QA | Rebuild con `ANGULAR_BUILD_CONFIGURATION=qa` y `QA_API_URL` |
| Uploads perdidos | Sin volumen | Ver volumen `backend_uploads_qa` en Coolify |
| Migraciones fallan | BD vieja / dump incompatible | Logs entrypoint; revisar `_prisma_migrations` |
| Build backend falla en `npm install` / `npm ci` | Peer Jest 30 vs `jest-mock-extended`; falta `prisma.config.ts` en etapa deps | Repo: `backend/.npmrc` + `Dockerfile` con `COPY prisma.config.ts` y `npm ci` |
| Backend reinicia / P1001 | `DB_PASSWORD` vacía o Postgres aún no listo | Definir `DB_USER`/`DB_PASSWORD`/`DB_NAME`; si el volumen `pgdata-qa` se creó sin password, **borrarlo** en Coolify y redeploy |
| Log db: *password is not specified* | Falta `DB_PASSWORD` en variables Coolify | Misma tabla §3.3; volumen PG corrupto → eliminar volumen `pgdata-qa` y volver a desplegar |

### Reparar Postgres tras primer deploy fallido

Si el primer arranque creó el volumen `pgdata-qa` **sin** contraseña válida, Postgres puede quedar en estado inválido aunque luego agregues variables.

1. En Coolify → recurso QA → **Volumes** → eliminar el volumen de datos Postgres (`pgdata-qa` o `…_pgdata-qa`).
2. Confirmar `DB_USER`, `DB_PASSWORD`, `DB_NAME` en Environment.
3. **Redeploy** (el volumen `backend_uploads_qa` puede conservarse si ya tenías archivos).

---

## 9. Duplicar app prod como plantilla (alternativa)

Si ya tenés prod en Coolify como Compose:

1. **Clone** el recurso o creá uno nuevo con los mismos ajustes.
2. Cambiá rama → `develop`, compose → `docker-compose.qa.yml`.
3. Reemplazá **todas** las variables y dominios (§4).
4. **No** reutilices volúmenes de prod (`pgdata-prod`, `backend_uploads`).

---

## 10. Referencias

- Git / ramas: [entornos-git-despliegue.md](entornos-git-despliegue.md)
- Producción: [DEPLOY-COOLIFY.md](../../DEPLOY-COOLIFY.md)
- Docker puerto 8080: [remediacion-docker-trivy-coolify.md](remediacion-docker-trivy-coolify.md)
