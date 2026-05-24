/**
 * Marca migraciones fallidas para que `migrate deploy` pueda continuar.
 * Solo debe usarse en QA/staging: PRISMA_MIGRATE_AUTO_RECOVER_FAILED=true
 *
 * - Si el esquema de la migración ya existe (fallo parcial) → --applied
 * - Si no → --rolled-back (reintenta el SQL; debe ser idempotente en el repo)
 */
import { execSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;

/** @type {Record<string, (client: import('pg').Client) => Promise<boolean>>} */
const PARTIAL_APPLIED_CHECKS = {
  '20260414170504_inventory_transfers_w2w': async (client) => {
    const { rows } = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryTransferStatus') AS enum_exists,
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'inventory_transfers'
        ) AS table_exists
    `);
    const row = rows[0];
    return Boolean(row?.enum_exists || row?.table_exists);
  },
};

async function resolveMigration(migrationName, mode) {
  console.log(
    `[recover-migrations] prisma migrate resolve --${mode} ${migrationName}`,
  );
  execSync(`npx prisma migrate resolve --${mode} ${migrationName}`, {
    stdio: 'inherit',
  });
}

async function main() {
  if (process.env.PRISMA_MIGRATE_AUTO_RECOVER_FAILED !== 'true') {
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[recover-migrations] DATABASE_URL missing');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  const { rows } = await client.query(`
    SELECT migration_name
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
    ORDER BY started_at
  `);

  if (rows.length === 0) {
    await client.end();
    console.log('[recover-migrations] no failed migrations to recover');
    return;
  }

  for (const { migration_name } of rows) {
    const partialCheck = PARTIAL_APPLIED_CHECKS[migration_name];
    const looksPartial =
      partialCheck != null && (await partialCheck(client));

    if (looksPartial) {
      console.log(
        `[recover-migrations] partial schema detected for ${migration_name} → mark as applied`,
      );
      await resolveMigration(migration_name, 'applied');
    } else {
      await resolveMigration(migration_name, 'rolled-back');
    }
  }

  await client.end();
}

main().catch((err) => {
  console.error('[recover-migrations] error:', err);
  process.exit(1);
});
