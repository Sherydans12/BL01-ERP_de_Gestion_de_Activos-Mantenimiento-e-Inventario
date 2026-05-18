# Prisma: migraciones y cliente generado (BL01)

Tras cambiar `backend/prisma/schema.prisma` o añadir carpetas bajo `backend/prisma/migrations/`, hacen falta **dos cosas distintas**:

1. **Cliente TypeScript (`@prisma/client`)** — debe alinearse con el schema o aparecen errores TS (`Unknown argument …`, selects inválidos) y el servidor puede validar queries contra un modelo viejo.
2. **Base de datos** — las columnas/tablas nuevas existen solo después de aplicar migraciones (`migrate deploy` / `migrate dev`).

## Automático en este repo (`backend/package.json`)

| Momento | Qué corre |
|--------|-----------|
| `npm install` en `backend/` | **`postinstall`** → `prisma generate` |
| `npm run db:sync` en `backend/` | `prisma migrate deploy` + `prisma generate` (un comando tras pull) |
| `npm run build` en `backend/` | **`prebuild`** → `prisma generate`, luego `nest build` |
| Imagen Docker (stage `deps`) | `npm install` → **`postinstall`** → `generate` (requiere `DATABASE_URL` dummy en el Dockerfile) |
| Imagen Docker (stage `builder`) | `ENV DATABASE_URL` dummy + `npm run build` → **`prebuild`** → `generate`, luego `nest build` |
| Contenedor en arranque (`docker-entrypoint.sh`) | `prisma migrate deploy` (con `DATABASE_URL` real del entorno) |

Con esto, un **rebuild** del backend (`npm run build` o build de imagen) **regenera el cliente** solo. **No** aplica migraciones pendientes en tu Postgres local: eso sigue siendo un paso explícito o el entrypoint en Docker.

## Ritual recomendado tras `git pull` (cambios de schema/migraciones)

Desde `backend/` con `.env` y Postgres arriba:

```bash
npm run db:sync
```

Equivale a `prisma migrate deploy` seguido de `prisma generate` (útil tras pull si querés DB + client en un solo comando).

O solo migraciones (el client suele venir de `postinstall` / `prebuild` al instalar o buildear):

```bash
npx prisma migrate deploy
```

Opcional si querés forzar cliente sin reinstalar:

```bash
npx prisma generate
```

`migrate deploy` **no** regenera el client por sí solo; **`npm install`**, **`npm run build`** o `npx prisma generate` sí.

## Desarrollo local (`nest start --watch`)

El watch **no** ejecuta `prisma generate` en cada reinicio (sería lento y raramente hace falta). Si acabás de traer commits que tocan Prisma y **no** reinstaláste dependencias ni corriste build:

```bash
cd backend && npx prisma generate
```

Luego reiniciá el proceso Nest.

## Producción / Coolify

El despliegue debe seguir aplicando migraciones en runtime (p. ej. entrypoint con `prisma migrate deploy`) además del build que ya genera el client.
