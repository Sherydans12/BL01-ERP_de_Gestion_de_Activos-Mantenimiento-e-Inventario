/**
 * Marca migraciones fallidas como rolled-back para que `migrate deploy` pueda reintentar.
 * Solo debe usarse en QA/staging: PRISMA_MIGRATE_AUTO_RECOVER_FAILED=true
 */
import { execSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;

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

  await client.end();

  if (rows.length === 0) {
    console.log('[recover-migrations] no failed migrations to recover');
    return;
  }

  for (const { migration_name } of rows) {
    console.log(
      `[recover-migrations] prisma migrate resolve --rolled-back ${migration_name}`,
    );
    execSync(`npx prisma migrate resolve --rolled-back ${migration_name}`, {
      stdio: 'inherit',
    });
  }
}

main().catch((err) => {
  console.error('[recover-migrations] error:', err);
  process.exit(1);
});
