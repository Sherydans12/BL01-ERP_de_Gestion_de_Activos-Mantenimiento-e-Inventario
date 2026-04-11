#!/bin/sh
set -e
if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL is required."
  exit 1
fi
echo "[entrypoint] prisma migrate deploy…"
npx prisma migrate deploy
echo "[entrypoint] starting NestJS…"
exec node dist/src/main.js
