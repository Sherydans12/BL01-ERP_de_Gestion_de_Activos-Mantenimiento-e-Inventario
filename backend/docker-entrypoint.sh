#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL is required."
  exit 1
fi

wait_for_postgres() {
  echo "[entrypoint] waiting for PostgreSQL…"
  i=0
  max=60
  while [ "$i" -lt "$max" ]; do
    if node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.end().then(() => process.exit(0)))
  .catch(() => process.exit(1));
" 2>/dev/null; then
      echo "[entrypoint] PostgreSQL is up."
      return 0
    fi
    i=$((i + 1))
    echo "[entrypoint] DB not ready (${i}/${max}), retry in 2s…"
    sleep 2
  done
  echo "[entrypoint] ERROR: cannot reach PostgreSQL (P1001). Check db container and DATABASE_URL."
  return 1
}

wait_for_postgres

if [ "$PRISMA_MIGRATE_AUTO_RECOVER_FAILED" = "true" ]; then
  echo "[entrypoint] QA: recovering failed Prisma migrations (if any)…"
  node scripts/recover-failed-prisma-migrations.mjs
fi

echo "[entrypoint] prisma migrate deploy…"
npx prisma migrate deploy

echo "[entrypoint] (no prisma db seed — restaurar datos con pg_restore/psql si aplica)"
echo "[entrypoint] starting NestJS…"
exec node dist/src/main.js
