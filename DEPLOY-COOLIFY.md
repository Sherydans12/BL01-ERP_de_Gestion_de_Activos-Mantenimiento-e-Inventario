# Despliegue en Coolify e importación de base de datos

## Qué hace el backend al arrancar (Docker)

El contenedor ejecuta `docker-entrypoint.sh`:

1. **`npx prisma migrate deploy`** — aplica migraciones pendientes (idempotente).
2. Arranca NestJS.

**No** se ejecuta `prisma db seed` automáticamente. El seed del repo solo imprime un mensaje: los datos reales vienen del **volcado que importes** desde tu entorno local.

## Variables de entorno mínimas (Coolify)

- `DATABASE_URL` — PostgreSQL del servicio (o base gestionada).
- `JWT_SECRET`, `FRONTEND_URL`, y el resto que ya uses (SMTP, storage, etc.).

Asegúrate de que `DATABASE_URL` apunte al mismo Postgres donde importarás el dump.

## Almacenamiento local de adjuntos (20 MB máx. por archivo)

En Docker/Coolify, con **`STORAGE_DRIVER=local`** el backend guarda ficheros bajo **`UPLOAD_PATH`** (por defecto `./uploads`; en `docker-compose.prod.yml` suele ser **`/uploads`**).

- Debe existir un **volumen Docker persistente** montado en esa ruta (en el repo: `backend_uploads:/uploads` mapeado al contenedor en `/uploads`), para que PDFs y adjuntos de compras/inventario **no se pierdan** al redeploy.
- Si la carpeta no es escribible, el backend registra una **advertencia al arranque** en los logs.
- Para object storage (R2/S3), use `STORAGE_DRIVER=r2` (u homólogo) cuando esté configurado en el servicio.

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

## Scripts útiles (solo desarrollo / operaciones manuales)

En el repo, desde `backend/`:

| Comando | Uso |
|--------|-----|
| `npm run db:migrate:deploy` | Igual que en el entrypoint |
| `npm run seed:catalog-masters` | Diccionarios de catálogo (si hiciera falta sin dump) |
| `npm run db:clean-bootstrap-tpm` | Limpieza selectiva + usuarios TPM (solo entornos controlados) |

## Git

Antes de subir cambios: sin `backend/.env`, sin `uploads/`, sin volcados en rutas trackeadas. El build de Docker usa `.dockerignore` para no meter basura en el contexto.
