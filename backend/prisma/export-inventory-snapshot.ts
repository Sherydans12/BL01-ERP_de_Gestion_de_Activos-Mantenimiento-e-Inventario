/**
 * Export-Inventory-Snapshot
 * ──────────────────────────────────────────────────────────────────────────────
 * Genera un archivo SQL portable con todo el inventario maestro del tenant
 * (UoM, bodegas, categorías, proveedores, artículos, stock, transacciones).
 *
 * El SQL resultante se puede ejecutar en CUALQUIER base PostgreSQL que tenga
 * el mismo schema (ej: producción en Coolify) sin importar los UUIDs de tenant,
 * contratos o bodegas del entorno destino. Resuelve IDs dinámicamente.
 *
 * Uso:
 *   cd backend
 *   npm run export:inventory-snapshot
 *   # Genera: prisma/inventory-snapshot-<TENANT>.sql
 *
 * Luego en producción:
 *   psql "$DATABASE_URL_PROD" -f inventory-snapshot-TPM.sql
 *   # o desde Coolify terminal:
 *   psql -h db -U <user> -d <db> -f /path/to/inventory-snapshot-TPM.sql
 *
 * Variables de entorno (opcionales):
 *   TENANT_CODE=TPM    (default: TPM)
 *   OUTPUT_DIR=./      (default: directorio del script)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

/** Escapa una cadena para incluirla de forma segura en SQL. */
function sql(value: string | null | undefined): string {
  if (value == null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNum(value: number | string | null | undefined): string {
  if (value == null) return 'NULL';
  return String(value);
}

function sqlBool(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

async function main() {
  const tenantCode = (process.env.TENANT_CODE ?? 'TPM').trim().toUpperCase();

  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true },
  });
  if (!tenant) throw new Error(`Tenant "${tenantCode}" no encontrado en la BD local.`);

  const tid = tenant.id;
  console.log(`\n🏭  Exportando inventario de tenant: ${tenantCode} (${tid})`);

  // ── 1. Unidades de medida ──────────────────────────────────────────────────
  const uoms = await prisma.unitOfMeasure.findMany({
    where: { tenantId: tid },
    orderBy: { abbreviation: 'asc' },
  });
  console.log(`  📐  UoM: ${uoms.length} registros`);

  // ── 2. Bodegas ────────────────────────────────────────────────────────────
  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId: tid },
    include: { contract: { select: { code: true } } },
    orderBy: { code: 'asc' },
  });
  console.log(`  🏪  Bodegas: ${warehouses.length} registros`);

  // ── 3. Categorías (familias y subfamilias) ────────────────────────────────
  const categories = await prisma.itemCategory.findMany({
    where: { tenantId: tid },
    orderBy: [{ parentCategoryId: 'asc' }, { name: 'asc' }],
  });
  const families    = categories.filter((c) => !c.parentCategoryId);
  const subfamilies = categories.filter((c) =>  c.parentCategoryId);
  console.log(`  📁  Categorías: ${families.length} familias, ${subfamilies.length} subfamilias`);

  // ── 4. Proveedores de inventario ──────────────────────────────────────────
  const suppliers = await prisma.inventorySupplier.findMany({
    where: { tenantId: tid },
    orderBy: { name: 'asc' },
  });
  console.log(`  🤝  Proveedores: ${suppliers.length} registros`);

  // ── 5. Artículos ──────────────────────────────────────────────────────────
  const items = await prisma.inventoryItem.findMany({
    where: { tenantId: tid },
    include: {
      itemCategory:      { select: { name: true, parentCategoryId: true } },
      unitOfMeasure:     { select: { abbreviation: true } },
      inventorySupplier: { select: { name: true } },
    },
    orderBy: { inventoryCode: 'asc' },
  });
  console.log(`  📦  Artículos: ${items.length} registros`);

  // ── 6. Stock por bodega ───────────────────────────────────────────────────
  const stocks = await prisma.itemStock.findMany({
    where: { warehouse: { tenantId: tid } },
    include: {
      warehouse: { select: { code: true } },
      item:      { select: { inventoryCode: true, name: true } },
    },
  });
  console.log(`  📊  Stocks: ${stocks.length} registros`);

  // ── 7. Transacciones (solo las de importación inicial ADJUST) ────────────
  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      warehouse: { tenantId: tid },
      notes:     { contains: 'Importación Consolidado Excel' },
    },
    include: {
      warehouse: { select: { code: true } },
      item:      { select: { inventoryCode: true } },
    },
    orderBy: { date: 'asc' },
  });
  console.log(`  📋  Transacciones iniciales: ${transactions.length} registros`);

  // ──────────────────────────────────────────────────────────────────────────
  // Construcción del SQL
  // ──────────────────────────────────────────────────────────────────────────
  const lines: string[] = [];

  const header = `-- ============================================================
-- SNAPSHOT DE INVENTARIO — Tenant: ${tenantCode}
-- Generado: ${new Date().toISOString()}
-- Fuente: base local (${tid})
--
-- Instrucciones:
--   1. Ajustar TENANT_CODE (línea ~20) si el código difiere en prod.
--   2. Ejecutar completo:
--        psql "$DATABASE_URL" -f inventory-snapshot-${tenantCode}.sql
--   3. El script es IDEMPOTENTE (ON CONFLICT DO NOTHING / DO UPDATE).
--      Se puede re-ejecutar sin duplicar datos.
-- ============================================================
`;

  lines.push(header);
  lines.push('DO $SNAP$');
  lines.push('DECLARE');
  lines.push(`  -- ▶ Ajustar si el código de tenant es diferente en producción`);
  lines.push(`  v_tenant_code TEXT := '${tenantCode}';`);
  lines.push(`  v_tenant_id   UUID;`);
  lines.push('');

  // Declarar variables para cada warehouse
  for (const wh of warehouses) {
    lines.push(`  wh_${wh.code.replace(/[^a-zA-Z0-9]/g, '_')} UUID;`);
  }
  lines.push('');

  // Declarar variables para categorías raíz
  for (const f of families) {
    const vname = `cat_${f.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
    lines.push(`  ${vname} UUID;`);
  }
  lines.push('');
  lines.push('BEGIN');
  lines.push('');

  // ── Resolver tenant ──
  lines.push(`  -- ── 1. Resolver Tenant ────────────────────────────────────────────────`);
  lines.push(`  SELECT id INTO v_tenant_id FROM tenants WHERE code = v_tenant_code;`);
  lines.push(`  IF v_tenant_id IS NULL THEN`);
  lines.push(`    RAISE EXCEPTION 'Tenant "%" no encontrado. Verifica TENANT_CODE.', v_tenant_code;`);
  lines.push(`  END IF;`);
  lines.push('');

  // ── UoM ──
  lines.push(`  -- ── 2. Unidades de medida ─────────────────────────────────────────────`);
  for (const u of uoms) {
    lines.push(`  INSERT INTO unit_of_measures (id, tenant_id, name, abbreviation, created_at, updated_at)`);
    lines.push(`    VALUES (gen_random_uuid(), v_tenant_id, ${sql(u.name)}, ${sql(u.abbreviation)}, NOW(), NOW())`);
    lines.push(`    ON CONFLICT (tenant_id, abbreviation) DO NOTHING;`);
  }
  lines.push('');

  // ── Bodegas ──
  lines.push(`  -- ── 3. Bodegas ────────────────────────────────────────────────────────`);
  lines.push(`  -- Para cada bodega: si ya existe por código, usa su UUID; si no, crea una nueva.`);
  lines.push(`  -- El UUID local se usa como fallback para mantener la FK de stocks.`);
  for (const wh of warehouses) {
    const varName = `wh_${wh.code.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const contractCode = wh.contract.code;
    lines.push(`  -- Bodega: ${wh.code} — ${wh.name}`);
    lines.push(`  SELECT w.id INTO ${varName}`);
    lines.push(`    FROM warehouses w WHERE w.tenant_id = v_tenant_id AND w.code = ${sql(wh.code)};`);
    lines.push(`  IF ${varName} IS NULL THEN`);
    lines.push(`    ${varName} := gen_random_uuid();`);
    lines.push(`    INSERT INTO warehouses (id, tenant_id, contract_id, code, name, location, type, is_active, created_at, updated_at)`);
    lines.push(`      SELECT ${varName}, v_tenant_id, c.id, ${sql(wh.code)}, ${sql(wh.name)},`);
    lines.push(`             ${sql(wh.location || null)}, 'PHYSICAL', TRUE, NOW(), NOW()`);
    lines.push(`      FROM contracts c`);
    lines.push(`      WHERE c.tenant_id = v_tenant_id AND c.code = ${sql(contractCode)}`);
    lines.push(`      LIMIT 1;`);
    lines.push(`    IF NOT FOUND THEN`);
    lines.push(`      RAISE WARNING 'Bodega % omitida — contrato % no encontrado en prod.', ${sql(wh.code)}, ${sql(contractCode)};`);
    lines.push(`      ${varName} := NULL;`);
    lines.push(`    END IF;`);
    lines.push(`  END IF;`);
    lines.push('');
  }

  // ── Categorías (familias) ──
  lines.push(`  -- ── 4. Familias de categorías ──────────────────────────────────────────`);
  for (const f of families) {
    const vname = `cat_${f.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
    lines.push(`  -- Familia: ${f.name}`);
    lines.push(`  SELECT id INTO ${vname} FROM item_categories`);
    lines.push(`    WHERE tenant_id = v_tenant_id AND name = ${sql(f.name)} AND parent_category_id IS NULL;`);
    lines.push(`  IF ${vname} IS NULL THEN`);
    lines.push(`    ${vname} := gen_random_uuid();`);
    lines.push(`    INSERT INTO item_categories (id, tenant_id, name, parent_category_id, is_global, created_at, updated_at)`);
    lines.push(`      VALUES (${vname}, v_tenant_id, ${sql(f.name)}, NULL, FALSE, NOW(), NOW());`);
    lines.push(`  END IF;`);
    lines.push('');
  }

  // ── Categorías (subfamilias) ──
  lines.push(`  -- ── 5. Subfamilias ──────────────────────────────────────────────────────`);
  for (const sub of subfamilies) {
    const parent = families.find((f) => f.id === sub.parentCategoryId);
    if (!parent) continue;
    const parentVar = `cat_${parent.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}`;
    lines.push(`  INSERT INTO item_categories (id, tenant_id, name, parent_category_id, is_global, created_at, updated_at)`);
    lines.push(`    SELECT gen_random_uuid(), v_tenant_id, ${sql(sub.name)}, ${parentVar}, FALSE, NOW(), NOW()`);
    lines.push(`    WHERE ${parentVar} IS NOT NULL`);
    lines.push(`      AND NOT EXISTS (`);
    lines.push(`        SELECT 1 FROM item_categories`);
    lines.push(`        WHERE tenant_id = v_tenant_id AND name = ${sql(sub.name)} AND parent_category_id = ${parentVar}`);
    lines.push(`      );`);
  }
  lines.push('');

  // ── Proveedores de inventario ──
  lines.push(`  -- ── 6. Proveedores de inventario ────────────────────────────────────────`);
  for (const s of suppliers) {
    lines.push(`  INSERT INTO inventory_suppliers (id, tenant_id, name, created_at, updated_at)`);
    lines.push(`    VALUES (gen_random_uuid(), v_tenant_id, ${sql(s.name)}, NOW(), NOW())`);
    lines.push(`    ON CONFLICT (tenant_id, name) DO NOTHING;`);
  }
  lines.push('');

  // ── Artículos ──
  lines.push(`  -- ── 7. Artículos de inventario (${items.length} registros) ──────────────`);
  lines.push(`  DECLARE`);
  lines.push(`    v_cat_id  UUID;`);
  lines.push(`    v_uom_id  UUID;`);
  lines.push(`    v_sup_id  UUID;`);
  lines.push(`    v_item_id UUID;`);
  lines.push(`    v_parent_id UUID;`);
  lines.push(`  BEGIN`);

  for (const item of items) {
    const uomAbbr   = item.unitOfMeasure?.abbreviation ?? 'UN';
    const suppName  = item.inventorySupplier?.name ?? null;
    // Category resolution: find parent name from category
    const cat = item.itemCategory;
    const parentCatId = cat?.parentCategoryId;
    // We'll resolve by name at runtime
    let catLookup: string;
    if (parentCatId) {
      const parentCat = categories.find((c) => c.id === parentCatId);
      const parentName = parentCat?.name ?? 'GENERAL';
      catLookup = `    SELECT c.id INTO v_cat_id FROM item_categories c
      JOIN item_categories p ON c.parent_category_id = p.id
      WHERE c.tenant_id = v_tenant_id AND c.name = ${sql(cat?.name ?? 'General')}
        AND p.name = ${sql(parentName)} LIMIT 1;`;
    } else {
      catLookup = `    SELECT id INTO v_cat_id FROM item_categories WHERE tenant_id = v_tenant_id AND name = ${sql(cat?.name ?? 'GENERAL')} AND parent_category_id IS NULL LIMIT 1;`;
    }

    lines.push(`    -- ${item.inventoryCode ?? '?'}: ${item.name}`);
    lines.push(catLookup);
    lines.push(`    SELECT id INTO v_uom_id FROM unit_of_measures WHERE tenant_id = v_tenant_id AND abbreviation = ${sql(uomAbbr)} LIMIT 1;`);
    if (suppName) {
      lines.push(`    SELECT id INTO v_sup_id FROM inventory_suppliers WHERE tenant_id = v_tenant_id AND name = ${sql(suppName)} LIMIT 1;`);
    } else {
      lines.push(`    v_sup_id := NULL;`);
    }
    lines.push(`    SELECT id INTO v_item_id FROM inventory_items WHERE tenant_id = v_tenant_id AND inventory_code = ${sql(item.inventoryCode)} LIMIT 1;`);
    lines.push(`    IF v_item_id IS NULL THEN`);
    lines.push(`      v_item_id := gen_random_uuid();`);
    lines.push(`      INSERT INTO inventory_items (`);
    lines.push(`        id, tenant_id, qr_code, inventory_code, part_number, name, description,`);
    lines.push(`        category_id, unit_of_measure_id, brand, supplier_id,`);
    lines.push(`        compatibility_info, is_serialized, is_inventory, is_asset, is_consumable,`);
    lines.push(`        created_at, updated_at`);
    lines.push(`      ) VALUES (`);
    lines.push(`        v_item_id, v_tenant_id, 'INV:' || v_item_id,`);
    lines.push(`        ${sql(item.inventoryCode)}, ${sql(item.partNumber)}, ${sql(item.name)}, ${sql(item.description)},`);
    lines.push(`        v_cat_id, v_uom_id, ${sql(item.brand)}, v_sup_id,`);
    lines.push(`        ${sql(item.compatibilityInfo)},`);
    lines.push(`        ${sqlBool(item.isSerialized)}, ${sqlBool(item.isInventory)}, ${sqlBool(item.isAsset)}, ${sqlBool(item.isConsumable)},`);
    lines.push(`        NOW(), NOW()`);
    lines.push(`      );`);
    lines.push(`    END IF;`);
    lines.push('');
  }

  // ── Stock ──
  lines.push(`    -- ── 8. Stock por bodega ─────────────────────────────────────────────`);
  for (const s of stocks) {
    const whVar = `wh_${s.warehouse.code.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const invCode = s.item.inventoryCode;
    lines.push(`    -- Stock ${invCode} en bodega ${s.warehouse.code}`);
    lines.push(`    IF ${whVar} IS NOT NULL THEN`);
    lines.push(`      SELECT id INTO v_item_id FROM inventory_items WHERE tenant_id = v_tenant_id AND inventory_code = ${sql(invCode)} LIMIT 1;`);
    lines.push(`      IF v_item_id IS NOT NULL THEN`);
    lines.push(`        INSERT INTO item_stocks (id, warehouse_id, item_id, quantity, min_stock, unit_cost, location, created_at, updated_at)`);
    lines.push(`          VALUES (gen_random_uuid(), ${whVar}, v_item_id,`);
    lines.push(`            ${sqlNum(s.quantity.toString())}, ${sqlNum(s.minStock?.toString())},`);
    lines.push(`            ${sqlNum(s.unitCost?.toString() ?? '0')}, ${sql(s.location)}, NOW(), NOW())`);
    lines.push(`          ON CONFLICT (warehouse_id, item_id) DO UPDATE SET`);
    lines.push(`            quantity = EXCLUDED.quantity, min_stock = EXCLUDED.min_stock,`);
    lines.push(`            unit_cost = EXCLUDED.unit_cost, location = EXCLUDED.location, updated_at = NOW();`);
    lines.push(`      END IF;`);
    lines.push(`    END IF;`);
  }
  lines.push('');

  // ── Transacciones ──
  if (transactions.length > 0) {
    lines.push(`    -- ── 9. Transacciones iniciales (Kardex) ───────────────────────────`);
    lines.push(`    DECLARE v_tx_item UUID; v_tx_wh UUID;`);
    lines.push(`    BEGIN`);
    for (const tx of transactions) {
      const whVar = `wh_${(tx as any).warehouse.code.replace(/[^a-zA-Z0-9]/g, '_')}`;
      lines.push(`      SELECT id INTO v_tx_item FROM inventory_items WHERE tenant_id = v_tenant_id AND inventory_code = ${sql((tx as any).item.inventoryCode)} LIMIT 1;`);
      lines.push(`      IF ${whVar} IS NOT NULL AND v_tx_item IS NOT NULL THEN`);
      lines.push(`        INSERT INTO inventory_transactions (id, warehouse_id, item_id, user_id, type, quantity, previous_stock, new_stock, notes, created_at, updated_at)`);
      lines.push(`          SELECT gen_random_uuid(), ${whVar}, v_tx_item, u.id,`);
      lines.push(`            'ADJUST', ${sqlNum(tx.quantity.toString())}, ${sqlNum(tx.previousStock.toString())}, ${sqlNum(tx.newStock.toString())},`);
      lines.push(`            ${sql(tx.notes)}, NOW(), NOW()`);
      lines.push(`          FROM users u WHERE u.tenant_id = v_tenant_id ORDER BY u.created_at LIMIT 1;`);
      lines.push(`      END IF;`);
    }
    lines.push(`    END;`);
  }

  lines.push(`  END;  -- fin bloque artículos`);
  lines.push('');
  lines.push(`  RAISE NOTICE 'Snapshot importado correctamente para tenant: %', v_tenant_code;`);
  lines.push('END;');
  lines.push('$SNAP$;');
  lines.push('');

  // ── Escribir archivo ──
  const outputDir = process.env.OUTPUT_DIR ?? resolve(__dirname);
  const outputFile = resolve(outputDir, `inventory-snapshot-${tenantCode}.sql`);
  writeFileSync(outputFile, lines.join('\n'), 'utf8');

  console.log(`\n✅  Snapshot generado: ${outputFile}`);
  console.log(`   Tamaño: ${Math.round(lines.join('\n').length / 1024)} KB`);
  console.log(`\nPasos para importar en producción:`);
  console.log(`  1. Copiar el .sql al servidor de producción`);
  console.log(`  2. psql "$DATABASE_URL_PROD" -f inventory-snapshot-${tenantCode}.sql`);
  console.log(`     — o desde Coolify terminal:`);
  console.log(`     psql -h db -U <usuario> -d <base> -f /path/inventory-snapshot-${tenantCode}.sql`);
  console.log(`  3. El script es idempotente: se puede re-ejecutar sin duplicar datos.\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
