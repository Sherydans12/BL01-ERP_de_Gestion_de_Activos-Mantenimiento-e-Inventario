/**
 * Recuperación de migraciones Prisma en QA/staging.
 * Requiere: PRISMA_MIGRATE_AUTO_RECOVER_FAILED=true
 *
 * 1. Repara W2W marcada como applied sin tabla inventory_transfers.
 * 2. Migraciones fallidas: --applied solo si el esquema esperado ya existe;
 *    si no, --rolled-back (el SQL del repo debe ser idempotente).
 */
import { execSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;

const W2W_MIGRATION = '20260414170504_inventory_transfers_w2w';
const TWO_STEP_MIGRATION = '20260415195500_inventory_transfer_two_step_status';

/** @type {Record<string, (client: import('pg').Client) => Promise<boolean>>} */
const PARTIAL_APPLIED_CHECKS = {
  [W2W_MIGRATION]: async (client) => {
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'inventory_transfers'
      ) AS table_exists
    `);
    return Boolean(rows[0]?.table_exists);
  },
  [TWO_STEP_MIGRATION]: async (client) => {
    const { rows } = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'inventory_transfers'
        ) AS table_exists,
        EXISTS (
          SELECT 1
          FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'InventoryTransferStatus'
            AND e.enumlabel = 'SHIPPED'
        ) AS shipped_exists
    `);
    const row = rows[0];
    return Boolean(row?.table_exists && row?.shipped_exists);
  },
};

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists
  `,
    [tableName],
  );
  return Boolean(rows[0]?.exists);
}

async function migrationRecordedAsApplied(client, migrationName) {
  const { rows } = await client.query(
    `
    SELECT 1
    FROM "_prisma_migrations"
    WHERE migration_name = $1
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    LIMIT 1
  `,
    [migrationName],
  );
  return rows.length > 0;
}

/**
 * Caso QA: --applied con solo el enum; la siguiente migración falla (42P01).
 * Quitamos la fila de W2W para que migrate deploy vuelva a ejecutar el SQL idempotente.
 */
async function repairOrphanedW2wApplied(client) {
  const recorded = await migrationRecordedAsApplied(client, W2W_MIGRATION);
  if (!recorded) return;

  if (await tableExists(client, 'inventory_transfers')) return;

  console.log(
    `[recover-migrations] ${W2W_MIGRATION} applied in history but inventory_transfers missing — delete row to re-apply`,
  );
  await client.query(
    `DELETE FROM "_prisma_migrations" WHERE migration_name = $1`,
    [W2W_MIGRATION],
  );
}

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

  await repairOrphanedW2wApplied(client);

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
