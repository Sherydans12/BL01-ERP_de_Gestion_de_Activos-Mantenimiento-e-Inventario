# Despliegue en Coolify e importación de base de datos

## Qué hace el backend al arrancar (Docker)

El contenedor ejecuta `docker-entrypoint.sh`:

1. **`npx prisma migrate deploy`** — aplica migraciones pendientes (idempotente).
2. Arranca NestJS.

En la **imagen** Docker, `npm run build` ya ejecuta **`prisma generate`** antes de compilar Nest (`prebuild` en `backend/package.json`). Resumen local vs CI vs DB: [docs/agentes/prisma-client-y-migraciones.md](docs/agentes/prisma-client-y-migraciones.md).

**No** se ejecuta `prisma db seed` automáticamente. El seed del repo solo imprime un mensaje: los datos reales vienen del **volcado que importes** desde tu entorno local.

## Variables de entorno mínimas (Coolify)

- `DATABASE_URL` — PostgreSQL del servicio (o base gestionada).
- `JWT_SECRET`, `FRONTEND_URL`, `BACKEND_PUBLIC_URL` y el resto que ya uses (email, storage, etc.).

Asegúrate de que `DATABASE_URL` apunte al mismo Postgres donde importarás el dump.

## Almacenamiento de adjuntos (20 MB máx. por archivo)

En Docker/Coolify, con **`STORAGE_DRIVER=local`** el backend guarda ficheros bajo **`UPLOAD_PATH`** (por defecto `./uploads`; en `docker-compose.prod.yml` suele ser **`/uploads`**).

- Debe existir un **volumen Docker persistente** montado en esa ruta (en el repo: `backend_uploads:/uploads` mapeado al contenedor en `/uploads`), para que PDFs y adjuntos de compras/inventario **no se pierdan** al redeploy.
- Si la carpeta no es escribible, el backend registra una **advertencia al arranque** en los logs.
- Para object storage en Cloudflare R2, use `STORAGE_DRIVER=r2` y configure:
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET`
  - `R2_ENDPOINT` (ej: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`)
  - `R2_REGION` (`auto` recomendado)
  - `R2_PUBLIC_URL` (opcional; dominio custom/CDN si se desea URL pública)
  - `R2_KEY_PREFIX` (opcional)

Si `STORAGE_DRIVER=r2` y falta alguna variable crítica, el backend falla al iniciar para evitar fallback silencioso a disco local.

## Flujo recomendado tras un redeploy

1. **Despliega** la nueva imagen (Coolify ejecutará migraciones al iniciar el backend).
2. **Importa** el volcado de tu máquina local al Postgres de producción/staging (cuando la red y credenciales estén listas).

### Exportar en local (ejemplo)

Formato custom (recomendado para `pg_restore`):

```bash
pg_dump -Fc -h localhost -U TU_USUARIO -d TU_BD -f backups/erp-local.dump
```

SQL plano:

```bash
pg_dump -h localhost -U TU_USUARIO -d TU_BD --no-owner --no-acl -f backups/erp-local.sql
```

Guarda el archivo fuera del repo o en `backups/` (carpeta ignorada por git).

### Importar en el servidor

Según cómo expongas Postgres (contenedor Coolify, túnel, IP interna):

```bash
# Custom format
pg_restore --clean --if-exists -h HOST -U USUARIO -d NOMBRE_BD erp-local.dump

# SQL plano
psql -h HOST -U USUARIO -d NOMBRE_BD -f erp-local.sql
```

**Notas:**

- Si el dump ya incluye esquema y datos alineados con tus migraciones, al **siguiente** arranque `migrate deploy` debería no aplicar nada nuevo (o solo lo que falte).
- Si la base remota está vacía y restauras un dump completo de local, suele ser coherente con el historial de `_prisma_migrations` que traiga el dump.
- Evita commitear `.env`, volcados con datos sensibles o la carpeta `backend/uploads/`.

## Frontend: sincronizar clientes tras redeploy (PWA / Service Worker)

El front en producción usa **Angular Service Worker** (`ngsw`). Tras un redeploy, los usuarios con la pestaña abierta pueden quedar en una mezcla vieja/nueva si no se revalida el shell.

En el repo ya está cubierto así:

- **`AppDeploySyncService`** (`frontend/src/app/core/services/app-deploy-sync/`): cuando el SW detecta una nueva versión (`VERSION_READY`), aplica `activateUpdate()` y **recarga** la página; además llama a `checkForUpdate()` al cargar, al recuperar el **foco** de la ventana y cada **5 minutos**. Si el SW entra en estado irrecuperable, fuerza una recarga.
- **`frontend/nginx.conf`**: `Cache-Control: no-cache` (y equivalentes) en **`/index.html`**, **`/ngsw.json`** y **`/ngsw-worker.js`** para que el navegador o un CDN no sirvan un `index.html` obsoleto junto a bundles con hash nuevos. Los `.js`/`.css` con hash del build siguen con cache largo (`immutable`).

Si delante del contenedor hay **proxy o CDN en Coolify** con reglas de caché propias, alineá lo mismo para esas rutas; de lo contrario pueden anular las cabeceras del nginx interno.

## Frontend Docker: puerto interno **8080** (Coolify / Traefik)

El `frontend/Dockerfile` usa **`nginxinc/nginx-unprivileged:stable-alpine`**, que escucha en **8080** dentro del contenedor (no en 80).

1. En el recurso **Frontend** de Coolify, en **puertos / port mapping / internal port**, apuntá el upstream al **8080** del contenedor.
2. Si hay **healthcheck HTTP** definido en el panel que usaba el puerto **80**, cambialo a **8080** (p. ej. ruta `/`).
3. El dominio público sigue siendo **443** en el proxy de Coolify; solo cambia el **puerto de destino hacia el contenedor**.
4. Si desplegás con `docker-compose.prod.yml`, el servicio `frontend` declara **`expose: "8080"`** para que el proxy de la plataforma descubra el puerto correcto.

Guía detallada: [`docs/agentes/remediacion-docker-trivy-coolify.md`](remediacion-docker-trivy-coolify.md).

## Scripts útiles (solo desarrollo / operaciones manuales)

En el repo, desde `backend/`:

| Comando | Uso |
|--------|-----|
| `npm run db:migrate:deploy` | Igual que en el entrypoint |
| `npm run seed:catalog-masters` | Diccionarios de catálogo (si hiciera falta sin dump) |
| `npm run db:clean-bootstrap-tpm` | Limpieza selectiva + usuarios TPM (solo entornos controlados) |

## Git

Antes de subir cambios: sin `backend/.env`, sin `uploads/`, sin volcados en rutas trackeadas. El build de Docker usa `.dockerignore` para no meter basura en el contexto.
