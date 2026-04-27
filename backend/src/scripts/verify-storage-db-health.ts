import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Verifica integridad mínima de punteros a storage tras migración R2.
 * Falla (exit 1) si hay filas con claves vacías en tablas obligatorias.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    console.error('[storage-db-health] Falta DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool as any);
  const prisma = new PrismaClient({ adapter });
  let failed = false;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ check_name: string; bad_count: bigint }>
    >`
      SELECT * FROM (
        SELECT 'inventory_item_attachments.empty_storage_key' AS check_name,
               COUNT(*)::bigint AS bad_count
        FROM inventory_item_attachments
        WHERE storage_key IS NULL OR length(trim(storage_key)) = 0

        UNION ALL
        SELECT 'purchase_documents.empty_storage_key',
               COUNT(*)::bigint
        FROM purchase_documents
        WHERE storage_key IS NULL OR length(trim(storage_key)) = 0

        UNION ALL
        SELECT 'users.avatar_url_whitespace_only',
               COUNT(*)::bigint
        FROM users
        WHERE avatar_url IS NOT NULL AND length(trim(avatar_url)) = 0

        UNION ALL
        SELECT 'purchase_quotations.attachment_url_whitespace_only',
               COUNT(*)::bigint
        FROM purchase_quotations
        WHERE attachment_url IS NOT NULL AND length(trim(attachment_url)) = 0

        UNION ALL
        SELECT 'purchase_invoices.pdf_url_whitespace_only',
               COUNT(*)::bigint
        FROM purchase_invoices
        WHERE pdf_url IS NOT NULL AND length(trim(pdf_url)) = 0

        UNION ALL
        SELECT 'work_orders.responsible_signature_whitespace_only',
               COUNT(*)::bigint
        FROM work_orders
        WHERE responsible_mechanic_signature IS NOT NULL
          AND length(trim(responsible_mechanic_signature)) = 0

        UNION ALL
        SELECT 'work_orders.supervisor_signature_whitespace_only',
               COUNT(*)::bigint
        FROM work_orders
        WHERE shift_supervisor_signature IS NOT NULL
          AND length(trim(shift_supervisor_signature)) = 0
      ) t
      ORDER BY check_name;
    `;

    console.log('[storage-db-health] Resultados:\n');
    for (const r of rows) {
      const n = Number(r.bad_count);
      const ok = n === 0;
      if (!ok) failed = true;
      console.log(
        `  ${ok ? 'OK ' : 'FAIL'} ${r.check_name}: ${n} fila(s) problemáticas`,
      );
    }

    if (failed) {
      console.error(
        '\n[storage-db-health] Corregir filas antes de dar por cerrada la migración.',
      );
      process.exitCode = 1;
    } else {
      console.log(
        '\n[storage-db-health] Sin punteros vacíos en columnas críticas.',
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
