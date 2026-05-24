/**
 * Imprime el checksum SHA-256 de un migration.sql (mismo algoritmo que Prisma migrate).
 * Uso tras editar una migración ya aplicada en prod:
 *   node scripts/prisma-migration-checksum.mjs 20260414170504_inventory_transfers_w2w
 *   UPDATE "_prisma_migrations" SET checksum = '<hash>' WHERE migration_name = '...';
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];

if (!name) {
  console.error('Usage: node scripts/prisma-migration-checksum.mjs <migration_folder_name>');
  process.exit(1);
}

const file = path.join(__dirname, '../prisma/migrations', name, 'migration.sql');
const contents = readFileSync(file, 'utf8');
const checksum = createHash('sha256').update(contents).digest('hex');

console.log(`migration: ${name}`);
console.log(`checksum:  ${checksum}`);
