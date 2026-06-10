/**
 * Simulación PBAC + aislamiento por contrato (Inventario) vía API HTTP.
 *
 * Uso:
 *   cd backend && npm run seed:inventario-pbac-personas
 *   npm run simulate:inventario-pbac
 *   npm run simulate:inventario-pbac -- --matrix
 *   npm run simulate:inventario-pbac -- --isolation
 *   npm run simulate:inventario-pbac -- --all
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const API_BASE = (process.env.API_BASE || 'http://localhost:3000/api').replace(/\/$/, '');
const TENANT_CODE = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
const PASSWORD = (process.env.PBAC_TEST_PASSWORD || 'Test1234!').trim();
const LOGIN_DELAY_MS = Number(process.env.PBAC_LOGIN_DELAY_MS || 2000);

const FAKE_ITEM = '00000000-0000-4000-8000-000000000001';
const FAKE_WAREHOUSE = '00000000-0000-4000-8000-000000000002';
const FAKE_BIN = '00000000-0000-4000-8000-000000000003';
const FAKE_CATEGORY = '00000000-0000-4000-8000-000000000004';
const FAKE_TRANSFER = '00000000-0000-4000-8000-000000000005';

const args = new Set(process.argv.slice(2));
const RUN_ALL = args.has('--all');
const RUN_MATRIX = RUN_ALL || args.has('--matrix') || args.size === 0;
const RUN_ISOLATION = RUN_ALL || args.has('--isolation') || args.size === 0;

/** 15 llaves core inventario (catálogo, bodegas, categorías, W2W, stock). */
const PERMISSION_PROBES = [
  { perm: 'inventory:item:read', method: 'GET', path: '/inventory-items?page=1&pageSize=5' },
  { perm: 'inventory:item:read', method: 'GET', path: `/inventory-items/${FAKE_ITEM}/ledger` },
  { perm: 'inventory:item:create', method: 'POST', path: '/inventory-items', body: {} },
  { perm: 'inventory:item:update', method: 'PUT', path: `/inventory-items/${FAKE_ITEM}`, body: {} },
  { perm: 'inventory:item:delete', method: 'DELETE', path: `/inventory-items/${FAKE_ITEM}` },
  { perm: 'inventory:warehouse:read', method: 'GET', path: '/warehouses' },
  {
    perm: 'inventory:warehouse:read',
    method: 'GET',
    path: `/warehouses/${FAKE_WAREHOUSE}/bins`,
  },
  { perm: 'inventory:warehouse:manage', method: 'POST', path: '/warehouses', body: {} },
  {
    perm: 'inventory:warehouse:manage',
    method: 'POST',
    path: `/warehouses/${FAKE_WAREHOUSE}/bins`,
    body: {},
  },
  { perm: 'inventory:category:read', method: 'GET', path: '/item-categories/families' },
  { perm: 'inventory:category:read', method: 'GET', path: '/item-categories?page=1&pageSize=5' },
  { perm: 'inventory:category:manage', method: 'POST', path: '/item-categories', body: {} },
  {
    perm: 'inventory:category:manage',
    method: 'PUT',
    path: `/item-categories/${FAKE_CATEGORY}`,
    body: {},
  },
  { perm: 'inventory:transfer:read', method: 'GET', path: '/inventory-transfers?page=1&pageSize=5' },
  {
    perm: 'inventory:transfer:read',
    method: 'GET',
    path: `/inventory-transfers/${FAKE_TRANSFER}`,
  },
  {
    perm: 'inventory:transfer:create',
    method: 'POST',
    path: '/inventory-transfers',
    body: {},
    contractScoped: true,
  },
  {
    perm: 'inventory:transfer:approve',
    method: 'POST',
    path: `/inventory-transfers/${FAKE_TRANSFER}/receive`,
    contractScoped: true,
  },
  { perm: 'inventory:stock:read', method: 'GET', path: '/inventory-stock/supply-alerts' },
  {
    perm: 'inventory:stock:read',
    method: 'GET',
    path: `/inventory-stock/warehouse/${FAKE_WAREHOUSE}`,
  },
  {
    perm: 'inventory:stock:read',
    method: 'GET',
    path: `/inventory-stock/warehouse/${FAKE_WAREHOUSE}/transactions`,
  },
  {
    perm: 'inventory:stock:adjust',
    method: 'POST',
    path: '/inventory-stock/transaction',
    body: {},
    contractScoped: true,
  },
  {
    perm: 'inventory:stock:adjust',
    method: 'POST',
    path: '/inventory-adjustments',
    body: {},
    contractScoped: true,
  },
  {
    perm: 'inventory:stock:adjust',
    method: 'PUT',
    path: `/inventory-stock/warehouse/${FAKE_WAREHOUSE}/item/${FAKE_ITEM}/levels`,
    body: {},
    contractScoped: true,
  },
  {
    perm: 'inventory:stock:view_cost',
    method: 'GET',
    path: `/inventory-stock/warehouse/${FAKE_WAREHOUSE}`,
    costMaskProbe: true,
  },
];

const SEED_EMAILS = [
  'pbac-inventario-admin@test.com',
  'pbac-inventario-bodega@test.com',
  'pbac-inventario-vacio@test.com',
  'pbac-inventario-sin-contrato@test.com',
  'pbac-inventario-lectura@test.com',
  'pbac-inventario-gestor@test.com',
];

const CORE_PERMISSION_KEYS = [
  'inventory:item:read',
  'inventory:item:create',
  'inventory:item:update',
  'inventory:item:delete',
  'inventory:warehouse:read',
  'inventory:warehouse:manage',
  'inventory:category:read',
  'inventory:category:manage',
  'inventory:transfer:read',
  'inventory:transfer:create',
  'inventory:transfer:approve',
  'inventory:stock:read',
  'inventory:stock:adjust',
  'inventory:stock:view_cost',
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const tokenCache = new Map();

async function fetchCaptcha() {
  const res = await fetch(`${API_BASE}/auth/captcha`);
  if (!res.ok) throw new Error(`CAPTCHA HTTP ${res.status}`);
  const data = await res.json();
  const m = String(data.question).match(/(\d+)\s*\+\s*(\d+)/);
  if (!m) throw new Error(`CAPTCHA no parseable: ${data.question}`);
  return { challengeId: data.challengeId, answer: Number(m[1]) + Number(m[2]) };
}

async function login(email, attempt = 0) {
  await new Promise((r) => setTimeout(r, attempt === 0 ? LOGIN_DELAY_MS : 5000 * attempt));
  const captcha = await fetchCaptcha();
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantCode: TENANT_CODE,
      email,
      password: PASSWORD,
      challengeId: captcha.challengeId,
      challengeAnswer: captcha.answer,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429 && attempt < 5) {
    return login(email, attempt + 1);
  }
  if (!res.ok) throw new Error(`Login ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token ?? body.accessToken ?? body.token;
}

async function getToken(email) {
  if (!tokenCache.has(email)) tokenCache.set(email, await login(email));
  return tokenCache.get(email);
}

async function api(token, method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

const CONTRACTLESS_EMAIL = 'pbac-inventario-sin-contrato@test.com';

function probeExpected(probe, permissions, userRole, email) {
  if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') return true;
  if (email === CONTRACTLESS_EMAIL && probe.contractScoped) return false;
  if (probe.anyOf?.length) {
    return probe.anyOf.some((p) => permissions.includes(p));
  }
  return permissions.includes(probe.perm);
}

async function loadPersona(email) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { customRole: { select: { permissions: true, name: true } } },
  });
  if (!user) return { permissions: [], roleName: '?', role: '?' };
  const perms = Array.isArray(user.customRole?.permissions)
    ? user.customRole.permissions
    : [];
  return {
    permissions: perms,
    roleName: user.customRole?.name ?? user.role,
    role: user.role,
  };
}

async function runProbe(token, probe) {
  return api(token, probe.method, probe.path, probe.body);
}

async function runMatrix() {
  console.log('\n=== Matriz PBAC Inventario (API) ===\n');
  const uniqueKeys = new Set(PERMISSION_PROBES.map((p) => p.perm));
  console.log(
    `Probes: ${PERMISSION_PROBES.length} endpoints · ${uniqueKeys.size} llaves únicas (core: ${CORE_PERMISSION_KEYS.length})\n`,
  );

  let failures = 0;

  for (const email of SEED_EMAILS) {
    const { permissions, roleName, role } = await loadPersona(email);
    console.log(`\n▶ ${email} (${roleName} · ${role}) — ${permissions.length} permisos PBAC`);

    let token;
    try {
      token = await getToken(email);
    } catch (e) {
      console.log(`  ✗ Login falló: ${e.message}`);
      failures++;
      continue;
    }

    for (const probe of PERMISSION_PROBES) {
      if (probe.costMaskProbe) continue;

      const expected = probeExpected(probe, permissions, role, email);
      const { status } = await runProbe(token, probe);
      let ok;
      if (email === CONTRACTLESS_EMAIL && probe.contractScoped) {
        ok = !expected && status !== 200 && status !== 201;
      } else {
        const allowed = status !== 403;
        ok = allowed === expected;
      }
      if (!ok) {
        failures++;
        console.log(
          `  ✗ ${probe.method} ${probe.path} [${probe.perm}] → HTTP ${status} (esperado ${expected ? 'permitido' : '403'})`,
        );
      }
    }
    console.log(`  ✓ Probes guard (${PERMISSION_PROBES.filter((p) => !p.costMaskProbe).length})`);
  }

  console.log(`\nMatriz: ${failures === 0 ? 'OK' : `${failures} discrepancias`}\n`);
  return failures;
}

async function getFixtures() {
  const tenant = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
  if (!tenant) throw new Error(`Tenant ${TENANT_CODE} no encontrado`);

  const contracts = await prisma.contract.findMany({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, name: true, code: true },
  });

  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { id: true, name: true, contractId: true },
    orderBy: { code: 'asc' },
  });

  const item = await prisma.inventoryItem.findFirst({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });

  const stockRow =
    item && warehouses[0]
      ? await prisma.itemStock.findFirst({
          where: { warehouseId: warehouses[0].id, itemId: item.id },
          select: { unitCost: true, quantity: true },
        })
      : null;

  return { tenant, contracts, warehouses, item, stockRow };
}

function assertStatus(label, r, expectedStatuses) {
  const ok = expectedStatuses.includes(r.status);
  if (!ok) {
    throw new Error(
      `${label}: HTTP ${r.status} ${JSON.stringify(r.body)} (esperado ${expectedStatuses.join('|')})`,
    );
  }
  return r;
}

async function runIsolation() {
  console.log('\n=== Aislamiento contrato / tenant (Inventario) ===\n');
  let failures = 0;
  const fixtures = await getFixtures();

  const vacio = await getToken('pbac-inventario-vacio@test.com');
  assertStatus(
    'USER vacío → catálogo',
    await api(vacio, 'GET', '/inventory-items?page=1&pageSize=5'),
    [403],
  );
  console.log('  ✓ USER sin permisos → GET items 403');

  const sinContrato = await getToken('pbac-inventario-sin-contrato@test.com');
  const whList = await api(sinContrato, 'GET', '/warehouses');
  if (whList.status === 403) {
    console.log('  ✓ Sin contrato → GET warehouses 403');
  } else if (whList.status === 200 && Array.isArray(whList.body) && whList.body.length === 0) {
    console.log('  ✓ Sin contrato → GET warehouses lista vacía');
  } else {
    failures++;
    console.log(
      `  ✗ Sin contrato → GET warehouses HTTP ${whList.status} (esperado 403 o [])`,
    );
  }

  if (fixtures.warehouses.length >= 1) {
    const whId = fixtures.warehouses[0].id;
    const stockDenied = await api(
      sinContrato,
      'GET',
      `/inventory-stock/warehouse/${whId}`,
    );
    if (![403, 404].includes(stockDenied.status)) {
      failures++;
      console.log(
        `  ✗ Sin contrato → stock bodega HTTP ${stockDenied.status} (esperado 403|404)`,
      );
    } else {
      console.log(`  ✓ Sin contrato → stock bodega ${stockDenied.status}`);
    }
  }

  if (fixtures.contracts.length >= 2 && fixtures.warehouses.length >= 2) {
    const contractA = fixtures.contracts[0].id;
    const contractB = fixtures.contracts[1].id;
    const whA = fixtures.warehouses.find((w) => w.contractId === contractA);
    const whB = fixtures.warehouses.find((w) => w.contractId === contractB);

    if (whA && whB) {
      const bodega = await getToken('pbac-inventario-bodega@test.com');

      assertStatus(
        'Operador → stock bodega propia',
        await api(bodega, 'GET', `/inventory-stock/warehouse/${whA.id}`),
        [200],
      );
      console.log(`  ✓ Operador (contrato A) → stock bodega A 200`);

      const cross = await api(bodega, 'GET', `/inventory-stock/warehouse/${whB.id}`);
      if (![403, 404].includes(cross.status)) {
        failures++;
        console.log(
          `  ✗ Operador (contrato A) → stock bodega B HTTP ${cross.status} (esperado 403|404)`,
        );
      } else {
        console.log(`  ✓ Operador (contrato A) → stock bodega B ${cross.status}`);
      }

      const xferCross = await api(bodega, 'POST', '/inventory-transfers', {
        originWarehouseId: whB.id,
        destinationWarehouseId: whA.id,
        lines: fixtures.item ? [{ itemId: fixtures.item.id, quantity: 1 }] : [],
      });
      if (![400, 403, 404].includes(xferCross.status)) {
        failures++;
        console.log(
          `  ✗ Transfer origen contrato B → HTTP ${xferCross.status} (esperado 400|403|404)`,
        );
      } else {
        console.log(`  ✓ Transfer origen contrato B bloqueado (${xferCross.status})`);
      }
    } else {
      console.log('  ⚠ Sin par bodega A/B para aislamiento cruzado');
    }
  } else {
    console.log('  ⚠ Menos de 2 contratos/bodegas — omitiendo cruce A↔B');
  }

  if (fixtures.warehouses[0]?.id && fixtures.item?.id) {
    const whId = fixtures.warehouses[0].id;
    const bodega = await getToken('pbac-inventario-bodega@test.com');
    const gestor = await getToken('pbac-inventario-gestor@test.com');

    const rBodega = await api(bodega, 'GET', `/inventory-stock/warehouse/${whId}`);
    const rGestor = await api(gestor, 'GET', `/inventory-stock/warehouse/${whId}`);

    if (rBodega.status === 200 && rGestor.status === 200) {
      const dbCost = fixtures.stockRow?.unitCost != null ? Number(fixtures.stockRow.unitCost) : 0;
      const rowB = Array.isArray(rBodega.body) ? rBodega.body[0] : null;
      const rowG = Array.isArray(rGestor.body) ? rGestor.body[0] : null;
      if (dbCost > 0 && rowB && rowG) {
        const masked = Number(rowB.unitCost ?? 0) === 0;
        const visible = Number(rowG.unitCost ?? 0) > 0;
        if (!masked || !visible) {
          failures++;
          console.log(
            `  ✗ view_cost: bodega unitCost=${rowB.unitCost} gestor=${rowG.unitCost} (db=${dbCost})`,
          );
        } else {
          console.log('  ✓ view_cost: operador enmascara CPP, gestor ve costo');
        }
      } else {
        console.log('  ⚠ Sin fila stock con costo > 0 — omitiendo check view_cost');
      }
    }
  }

  const admin = await getToken('pbac-inventario-admin@test.com');
  assertStatus('ADMIN → supply-alerts', await api(admin, 'GET', '/inventory-stock/supply-alerts'), [
    200,
  ]);
  console.log('  ✓ ADMIN bypass → supply-alerts 200');

  console.log(`\nAislamiento: ${failures === 0 ? 'OK' : `${failures} fallos`}\n`);
  return failures;
}

async function main() {
  console.log(`API: ${API_BASE} | Tenant: ${TENANT_CODE}`);
  console.log(`Modos: matrix=${RUN_MATRIX} isolation=${RUN_ISOLATION}`);

  try {
    const ping = await fetch(`${API_BASE}/auth/captcha`, { signal: AbortSignal.timeout(15000) });
    if (!ping.ok) throw new Error(`HTTP ${ping.status}`);
  } catch {
    console.error('\n❌ Backend no responde en :3000. Levantá: cd backend && npm run start:dev\n');
    process.exit(1);
  }

  let exitCode = 0;
  if (RUN_MATRIX) {
    const fails = await runMatrix();
    if (fails > 0) exitCode = 1;
  }
  if (RUN_ISOLATION) {
    try {
      const fails = await runIsolation();
      if (fails > 0) exitCode = 1;
    } catch (e) {
      console.error(`\n❌ Aislamiento: ${e.message}\n`);
      exitCode = 1;
    }
  }

  await prisma.$disconnect();
  await pool.end();
  process.exit(exitCode);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
