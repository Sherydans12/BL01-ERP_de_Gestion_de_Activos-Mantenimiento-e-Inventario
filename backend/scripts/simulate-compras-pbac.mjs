/**
 * Simulación PBAC + flujos P2P (Compras) vía API HTTP.
 *
 * Uso:
 *   cd backend && npm run seed:compras-pbac-personas
 *   npm run simulate:compras-pbac -- --all
 *   npm run simulate:compras-pbac -- --matrix
 *   npm run simulate:compras-pbac -- --flow
 *   npm run simulate:compras-pbac -- --extended
 *   npm run simulate:compras-pbac -- --coverage
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const API_BASE = (process.env.API_BASE || 'http://localhost:3000/api').replace(/\/$/, '');
const TENANT_CODE = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
const PASSWORD = (process.env.PBAC_TEST_PASSWORD || 'Test1234!').trim();
const LOGIN_DELAY_MS = Number(process.env.PBAC_LOGIN_DELAY_MS || 2000);

const FAKE_ID = '00000000-0000-4000-8000-000000000001';
const FAKE_QID = '00000000-0000-4000-8000-000000000002';
const FAKE_ITEM = '00000000-0000-4000-8000-000000000003';
const REQUISITION_PATCH_ANY = [
  'purchases:requisition:update-own',
  'purchases:requisition:update-purchasing',
  'purchases:requisition:update-asset-link',
];

const args = new Set(process.argv.slice(2));
const RUN_ALL = args.has('--all');
const RUN_MATRIX = RUN_ALL || args.has('--matrix') || args.size === 0;
const RUN_FLOW = RUN_ALL || args.has('--flow') || args.size === 0;
const RUN_EXTENDED = RUN_ALL || args.has('--extended') || args.size === 0;
const RUN_COVERAGE = RUN_ALL || args.has('--coverage');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const tokenCache = new Map();

/** Un probe por permiso purchases:* (43). Guard → 403; servicio puede devolver 4xx con UUID ficticio. */
const PERMISSION_PROBES = [
  { perm: 'purchases:requisition:read', method: 'GET', path: '/purchase-requisitions?page=1&pageSize=5' },
  { perm: 'purchases:requisition:create', method: 'POST', path: '/purchase-requisitions', body: {} },
  {
    perm: 'purchases:requisition:update-own',
    method: 'PATCH',
    path: `/purchase-requisitions/${FAKE_ID}`,
    body: { description: 'probe' },
    anyOf: REQUISITION_PATCH_ANY,
  },
  {
    perm: 'purchases:requisition:update-purchasing',
    method: 'PATCH',
    path: `/purchase-requisitions/${FAKE_ID}`,
    body: { description: 'probe' },
    anyOf: REQUISITION_PATCH_ANY,
  },
  {
    perm: 'purchases:requisition:update-asset-link',
    method: 'PATCH',
    path: `/purchase-requisitions/${FAKE_ID}`,
    body: { equipmentId: null },
    anyOf: REQUISITION_PATCH_ANY,
  },
  { perm: 'purchases:requisition:submit', method: 'POST', path: `/purchase-requisitions/${FAKE_ID}/submit` },
  {
    perm: 'purchases:requisition:cancel',
    method: 'POST',
    path: `/purchase-requisitions/${FAKE_ID}/cancel`,
    body: { reason: 'probe PBAC' },
  },
  { perm: 'purchases:requisition:start-quoting', method: 'POST', path: `/purchase-requisitions/${FAKE_ID}/start-quoting` },
  {
    perm: 'purchases:requisition:manage-quotations',
    method: 'POST',
    path: `/purchase-requisitions/${FAKE_ID}/quotations/${FAKE_QID}/select`,
  },
  {
    perm: 'purchases:requisition:award-lines',
    method: 'POST',
    path: `/purchase-requisitions/${FAKE_ID}/line-awards`,
    body: { awards: [] },
  },
  { perm: 'purchases:requisition:duplicate', method: 'POST', path: `/purchase-requisitions/${FAKE_ID}/duplicate` },
  { perm: 'purchases:order:read', method: 'GET', path: '/purchase-orders?page=1&pageSize=5' },
  {
    perm: 'purchases:order:create-from-requisition',
    method: 'POST',
    path: `/purchase-orders/from-requisition/${FAKE_ID}`,
  },
  {
    perm: 'purchases:order:create-from-quotation',
    method: 'POST',
    path: '/purchase-orders',
    body: { quotationId: FAKE_ID },
  },
  {
    perm: 'purchases:order:approve',
    method: 'POST',
    path: `/purchase-orders/${FAKE_ID}/approve`,
    body: { comment: 'probe' },
  },
  { perm: 'purchases:order:send-to-supplier', method: 'POST', path: `/purchase-orders/${FAKE_ID}/sent-to-supplier` },
  {
    perm: 'purchases:order:cancel',
    method: 'POST',
    path: `/purchase-orders/${FAKE_ID}/cancel`,
    body: { reason: 'probe PBAC' },
  },
  {
    perm: 'purchases:order:force-close',
    method: 'POST',
    path: `/purchase-orders/${FAKE_ID}/force-close`,
    body: { reason: 'probe PBAC cierre administrativo simulación matriz' },
  },
  {
    perm: 'purchases:order:reject',
    method: 'POST',
    path: `/purchase-orders/${FAKE_ID}/reject`,
    body: { reason: 'probe PBAC' },
  },
  { perm: 'purchases:order:reset-draft', method: 'POST', path: `/purchase-orders/${FAKE_ID}/reset` },
  {
    perm: 'purchases:order:update-logistics',
    method: 'PATCH',
    path: `/purchase-orders/${FAKE_ID}/logistics`,
    body: { deliveryAddress: 'Probe PBAC' },
  },
  {
    perm: 'purchases:order:update-sensitive',
    method: 'PATCH',
    path: `/purchase-orders/${FAKE_ID}/sensitive`,
    body: { totalAmount: 1 },
  },
  {
    perm: 'purchases:order:link-catalog',
    method: 'PATCH',
    path: `/purchase-orders/${FAKE_ID}/items/${FAKE_ITEM}/link-catalog`,
    body: { inventoryItemId: FAKE_ITEM },
  },
  { perm: 'purchases:receipt:read', method: 'GET', path: '/warehouse-receipts?page=1&pageSize=5' },
  { perm: 'purchases:receipt:create', method: 'POST', path: '/warehouse-receipts', body: {} },
  { perm: 'purchases:receipt:register', method: 'POST', path: `/warehouse-receipts/${FAKE_ID}/confirm` },
  { perm: 'purchases:invoice:read', method: 'GET', path: '/purchase-invoices?page=1&pageSize=5' },
  { perm: 'purchases:invoice:create', method: 'POST', path: '/purchase-invoices', body: {} },
  {
    perm: 'purchases:invoice:update',
    method: 'PATCH',
    path: `/purchase-invoices/${FAKE_ID}`,
    body: { invoiceNumber: 'PROBE-PBAC' },
  },
  { perm: 'purchases:invoice:validate', method: 'POST', path: `/purchase-invoices/${FAKE_ID}/validate` },
  {
    perm: 'purchases:invoice:overrule',
    method: 'POST',
    path: `/purchase-invoices/${FAKE_ID}/three-way-match/overrule`,
    body: { notes: 'Justificación probe PBAC matriz permisos' },
  },
  { perm: 'purchases:invoice:mark-paid', method: 'POST', path: `/purchase-invoices/${FAKE_ID}/mark-paid` },
  { perm: 'purchases:invoice:delete', method: 'DELETE', path: `/purchase-invoices/${FAKE_ID}` },
  {
    perm: 'purchases:credit-note:manage',
    method: 'DELETE',
    path: `/purchase-credit-notes/${FAKE_ID}`,
  },
  { perm: 'purchases:setting:read', method: 'GET', path: '/purchase-settings/policies' },
  { perm: 'purchases:setting:update', method: 'PUT', path: '/purchase-settings', body: null, dynamicSettings: true },
  { perm: 'purchases:vendor:read', method: 'GET', path: '/vendors?page=1&pageSize=5' },
  { perm: 'purchases:vendor:create', method: 'POST', path: '/vendors', body: {} },
  {
    perm: 'purchases:vendor:update',
    method: 'PATCH',
    path: `/vendors/${FAKE_ID}`,
    body: { name: 'Probe PBAC' },
  },
  { perm: 'purchases:vendor:delete', method: 'DELETE', path: `/vendors/${FAKE_ID}` },
  {
    perm: 'purchases:document:read',
    method: 'GET',
    path: `/purchase-documents?entity=REQUISITION&entityId=${FAKE_ID}`,
  },
  {
    perm: 'purchases:document:manage',
    method: 'POST',
    path: `/purchase-documents?entity=REQUISITION&entityId=${FAKE_ID}`,
    multipart: 'empty',
  },
  { perm: 'purchases:analytics:read', method: 'GET', path: '/purchases/analytics/report/pdf' },
];

const SEED_EMAILS = [
  'pbac-compras-solicitante@test.com',
  'pbac-compras-comprador@test.com',
  'pbac-compras-aprobador1@test.com',
  'pbac-compras-aprobador2@test.com',
  'pbac-compras-bodega@test.com',
  'pbac-compras-tesoreria@test.com',
  'pbac-compras-config@test.com',
  'pbac-compras-lectura@test.com',
  'pbac-compras-vacio@test.com',
  'pbac-compras-en-acl-sin-approve@test.com',
  'pbac-compras-approve-fuera-acl@test.com',
  'pbac-compras-sin-contrato@test.com',
  'pbac-compras-admin-compras@test.com',
];

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

async function apiMultipart(token, method, path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
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

function minimalPdfBlob() {
  const bytes = Buffer.from('%PDF-1.4\n%%EOF\n');
  return new Blob([bytes], { type: 'application/pdf' });
}

async function runProbe(token, probe) {
  if (probe.multipart === 'empty') {
    const form = new FormData();
    return apiMultipart(token, probe.method, probe.path, form);
  }
  return api(token, probe.method, probe.path, probe.body);
}

function probeExpected(probe, permissions) {
  if (probe.anyOf?.length) {
    return probe.anyOf.some((p) => permissions.includes(p));
  }
  return permissions.includes(probe.perm);
}

async function resolvePermissionProbes() {
  const tenant = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
  const settings = tenant
    ? await prisma.purchaseSettings.findUnique({ where: { tenantId: tenant.id } })
    : null;
  const safeSettingsBody = {
    approvalThreshold: settings ? Number(settings.approvalThreshold) : 0,
    currency: settings?.currency ?? 'CLP',
    invoiceMatchTolerancePercent: settings ? Number(settings.invoiceMatchTolerancePercent) : 0,
  };
  return PERMISSION_PROBES.map((probe) =>
    probe.dynamicSettings ? { ...probe, body: safeSettingsBody } : probe,
  );
}

function assertStatus(label, r, expectedStatuses) {
  const ok = expectedStatuses.includes(r.status);
  if (!ok) {
    throw new Error(`${label}: HTTP ${r.status} ${JSON.stringify(r.body)} (esperado ${expectedStatuses.join('|')})`);
  }
  return r;
}

async function getFixtures() {
  const tenant = await prisma.tenant.findUnique({ where: { code: TENANT_CODE } });
  if (!tenant) throw new Error(`Tenant ${TENANT_CODE} no encontrado`);

  const contract = await prisma.contract.findFirst({
    where: { tenantId: tenant.id, isActive: true },
    select: { id: true, name: true },
  });
  const items = await prisma.inventoryItem.findMany({
    where: { tenantId: tenant.id },
    take: 2,
    select: {
      id: true,
      description: true,
      name: true,
      unitOfMeasure: { select: { abbreviation: true } },
    },
  });
  const vendors = await prisma.vendor.findMany({
    where: { tenantId: tenant.id, isActive: true },
    take: 2,
    select: { id: true, name: true, code: true },
  });
  const warehouse = await prisma.warehouse.findFirst({
    where: { tenantId: tenant.id, isActive: true, contractId: contract?.id },
    select: { id: true, name: true },
  });

  if (!contract || items.length < 1 || !warehouse) {
    throw new Error('Faltan datos maestros (contrato, artículo o bodega).');
  }

  return { tenant, contract, items, vendors, warehouse };
}

function itemLine(item, qty, unitPrice) {
  return {
    inventoryItemId: item.id,
    description: item.description ?? item.name,
    quantity: qty,
    unitOfMeasure: item.unitOfMeasure?.abbreviation || 'UN',
    estimatedCost: unitPrice,
  };
}

/** SRC → cotización → adjudicación → OC en PENDING_APPROVAL */
async function buildPendingOc(fixtures, opts = {}) {
  const qty = opts.qty ?? 4;
  const unitPrice = opts.unitPrice ?? 2500;
  const items = opts.items ?? [itemLine(fixtures.items[0], qty, unitPrice)];
  const solicitante = await getToken('pbac-compras-solicitante@test.com');
  const comprador = await getToken('pbac-compras-comprador@test.com');

  let r = assertStatus(
    'Crear SRC',
    await api(solicitante, 'POST', '/purchase-requisitions', {
      contractId: fixtures.contract.id,
      description: opts.label ?? `PBAC ${Date.now()}`,
      priority: 'MEDIUM',
      items,
    }),
    [200, 201],
  );
  const reqId = r.body.id;

  assertStatus('Submit SRC', await api(solicitante, 'POST', `/purchase-requisitions/${reqId}/submit`), [200, 201]);
  assertStatus('Start quoting', await api(comprador, 'POST', `/purchase-requisitions/${reqId}/start-quoting`), [200, 201]);

  r = assertStatus('GET SRC', await api(comprador, 'GET', `/purchase-requisitions/${reqId}`), [200]);
  const reqItems = r.body.items ?? [];

  const vendor = opts.vendor ?? fixtures.vendors[0];
  if (!vendor) throw new Error('Sin proveedor en fixtures');

  const quotationItems = reqItems.map((ri) => ({
    requisitionItemId: ri.id,
    unitPrice: opts.unitPrices?.[ri.id] ?? unitPrice,
  }));
  const totalAmount = quotationItems.reduce(
    (sum, qi) => sum + qi.unitPrice * (reqItems.find((x) => x.id === qi.requisitionItemId)?.quantity ?? 0),
    0,
  );

  r = assertStatus(
    'Add quotation',
    await api(comprador, 'POST', `/purchase-requisitions/${reqId}/quotations`, {
      vendorId: vendor.id,
      totalAmount,
      currency: 'CLP',
      paymentDays: 30,
      items: quotationItems,
    }),
    [200, 201],
  );

  const awards = (r.body.items ?? []).map((qi) => ({
    requisitionItemId: qi.requisitionItemId,
    quotationItemId: qi.id,
  }));
  if (opts.awards) {
    assertStatus(
      'Award lines (custom)',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/line-awards`, { awards: opts.awards }),
      [200, 201],
    );
  } else {
    assertStatus(
      'Award lines',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/line-awards`, { awards }),
      [200, 201],
    );
  }

  r = assertStatus(
    'Create OC',
    await api(comprador, 'POST', `/purchase-orders/from-requisition/${reqId}`),
    [200, 201],
  );
  const orders = r.body.orders ?? [];
  if (!orders.length) throw new Error(`Sin OC: ${JSON.stringify(r.body)}`);

  return {
    reqId,
    poId: orders[0].id,
    poCorrelative: orders[0].correlative,
    orders,
    qty,
    unitPrice,
    totalAmount: Number(orders[0].totalAmount ?? totalAmount),
    vendor,
  };
}

async function approvePoTwoLevels(poId) {
  const a1 = await getToken('pbac-compras-aprobador1@test.com');
  const a2 = await getToken('pbac-compras-aprobador2@test.com');
  assertStatus('Approve N1', await api(a1, 'POST', `/purchase-orders/${poId}/approve`, { comment: 'N1' }), [200, 201]);
  assertStatus('Approve N2', await api(a2, 'POST', `/purchase-orders/${poId}/approve`, { comment: 'N2' }), [200, 201]);
}

async function sendPoToSupplier(poId) {
  const comprador = await getToken('pbac-compras-comprador@test.com');
  assertStatus('Sent to supplier', await api(comprador, 'POST', `/purchase-orders/${poId}/sent-to-supplier`), [200, 201]);
}

async function loadPersonaPermissions(email) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { customRole: { select: { permissions: true, name: true } } },
  });
  if (!user?.customRole) return { permissions: [], roleName: '?' };
  const perms = Array.isArray(user.customRole.permissions) ? user.customRole.permissions : [];
  return { permissions: perms, roleName: user.customRole.name };
}

async function runMatrix() {
  console.log('\n=== Matriz PBAC (API) ===\n');
  const probes = await resolvePermissionProbes();
  console.log(`Probes: ${probes.length} permisos purchases:*\n`);
  let failures = 0;

  for (const email of SEED_EMAILS) {
    const { permissions, roleName } = await loadPersonaPermissions(email);
    console.log(`\n▶ ${email} (${roleName}) — ${permissions.length} permisos`);

    let token;
    try {
      token = await getToken(email);
    } catch (e) {
      console.log(`  ✗ Login falló: ${e.message}`);
      failures++;
      continue;
    }

    for (const probe of probes) {
      const expected = probeExpected(probe, permissions);
      const { status } = await runProbe(token, probe);
      const allowed = status !== 403;
      if (allowed !== expected) {
        failures++;
        console.log(
          `  ✗ ${probe.perm} → HTTP ${status} (esperado ${expected ? 'permitido' : '403'})`,
        );
      }
    }
    console.log(`  ✓ Probes (${probes.length})`);
  }

  console.log(`\nMatriz: ${failures === 0 ? 'OK' : `${failures} discrepancias`}\n`);
  return failures;
}

async function runFlowA() {
  console.log('\n=== Flujo A — P2P happy path ===\n');
  const fixtures = await getFixtures();
  const built = await buildPendingOc(fixtures, { label: 'Flujo A happy path' });
  console.log(`OC ${built.poCorrelative} pendiente aprobación`);

  await approvePoTwoLevels(built.poId);
  console.log('Firmas ACL N1 + N2');

  await sendPoToSupplier(built.poId);
  console.log('Enviada a proveedor');

  const bodega = await getToken('pbac-compras-bodega@test.com');
  let r = assertStatus(
    'Crear recepción',
    await api(bodega, 'POST', '/warehouse-receipts', {
      purchaseOrderId: built.poId,
      warehouseId: fixtures.warehouse.id,
    }),
    [200, 201],
  );
  const receiptId = r.body.id;
  const lineId = r.body.items?.[0]?.id;
  assertStatus(
    'Registrar cantidades',
    await api(bodega, 'PATCH', `/warehouse-receipts/${receiptId}/items`, {
      items: [{ id: lineId, quantityReceived: built.qty }],
    }),
    [200],
  );
  assertStatus('Confirmar recepción', await api(bodega, 'POST', `/warehouse-receipts/${receiptId}/confirm`), [200, 201]);
  console.log(`Recepción total (${built.qty} uds)`);

  const tesoreria = await getToken('pbac-compras-tesoreria@test.com');
  r = assertStatus(
    'Crear factura',
    await api(tesoreria, 'POST', '/purchase-invoices', {
      purchaseOrderId: built.poId,
      vendorId: built.vendor.id,
      invoiceNumber: `FAC-A-${Date.now()}`,
      emissionDate: new Date().toISOString(),
      totalAmount: built.totalAmount,
      currency: 'CLP',
    }),
    [200, 201],
  );
  const invId = r.body.id;
  r = assertStatus('Validate 3-way', await api(tesoreria, 'POST', `/purchase-invoices/${invId}/validate`), [200, 201]);
  console.log(`3-way → ${r.body?.status ?? r.body?.invoice?.status ?? 'OK'}`);
  if ((r.body?.status ?? r.body?.invoice?.status) === 'MATCHED') {
    assertStatus('Mark paid', await api(tesoreria, 'POST', `/purchase-invoices/${invId}/mark-paid`), [200, 201]);
    console.log('Factura pagada');
  }
  console.log('\n✅ Flujo A OK\n');
}

async function runExtendedFlows() {
  console.log('\n=== Flujos extendidos B–J ===\n');
  const fixtures = await getFixtures();
  let passed = 0;
  let failed = 0;

  const run = async (code, title, fn) => {
    process.stdout.write(`\n[${code}] ${title} … `);
    try {
      await fn();
      console.log('✓');
      passed++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
  };

  // B — solicitante no edita SRC en QUOTING
  await run('B', 'Solicitante bloqueado en QUOTING', async () => {
    const solicitante = await getToken('pbac-compras-solicitante@test.com');
    const comprador = await getToken('pbac-compras-comprador@test.com');
    let r = assertStatus(
      'Crear SRC',
      await api(solicitante, 'POST', '/purchase-requisitions', {
        contractId: fixtures.contract.id,
        description: 'Flujo B QUOTING',
        priority: 'MEDIUM',
        items: [itemLine(fixtures.items[0], 2, 1000)],
      }),
      [200, 201],
    );
    const reqId = r.body.id;
    assertStatus('Submit', await api(solicitante, 'POST', `/purchase-requisitions/${reqId}/submit`), [200, 201]);
    assertStatus('Start quoting', await api(comprador, 'POST', `/purchase-requisitions/${reqId}/start-quoting`), [200, 201]);
    r = await api(solicitante, 'PATCH', `/purchase-requisitions/${reqId}`, {
      description: 'Intento editar en cotización',
    });
    assertStatus('PATCH QUOTING sin update-purchasing', r, [403]);
  });

  // C — en ACL pero sin PBAC approve
  await run('C', 'En ACL sin permiso approve → 403 guard', async () => {
    const built = await buildPendingOc(fixtures, { label: 'Flujo C' });
    const user = await getToken('pbac-compras-en-acl-sin-approve@test.com');
    const r = await api(user, 'POST', `/purchase-orders/${built.poId}/approve`, { comment: 'test' });
    assertStatus('Approve sin PBAC', r, [403]);
  });

  // D — PBAC approve pero fuera de ACL
  await run('D', 'Approve PBAC fuera de matriz ACL → 403 servicio', async () => {
    const built = await buildPendingOc(fixtures, { label: 'Flujo D' });
    const user = await getToken('pbac-compras-approve-fuera-acl@test.com');
    const r = await api(user, 'POST', `/purchase-orders/${built.poId}/approve`, { comment: 'test' });
    assertStatus('Approve fuera ACL', r, [403]);
  });

  // E — recepción parcial en dos confirmaciones
  await run('E', 'Recepción parcial + cierre en misma guía', async () => {
    const built = await buildPendingOc(fixtures, { qty: 6, label: 'Flujo E' });
    await approvePoTwoLevels(built.poId);
    await sendPoToSupplier(built.poId);
    const bodega = await getToken('pbac-compras-bodega@test.com');
    let r = assertStatus(
      'WR create',
      await api(bodega, 'POST', '/warehouse-receipts', {
        purchaseOrderId: built.poId,
        warehouseId: fixtures.warehouse.id,
      }),
      [200, 201],
    );
    const wrId = r.body.id;
    const lineId = r.body.items?.[0]?.id;
    assertStatus(
      'Parcial 2/6',
      await api(bodega, 'PATCH', `/warehouse-receipts/${wrId}/items`, {
        items: [{ id: lineId, quantityReceived: 2 }],
      }),
      [200],
    );
    assertStatus('Confirm parcial', await api(bodega, 'POST', `/warehouse-receipts/${wrId}/confirm`), [200, 201]);
    assertStatus(
      'Resto 4/6',
      await api(bodega, 'PATCH', `/warehouse-receipts/${wrId}/items`, {
        items: [{ id: lineId, quantityReceived: 6 }],
      }),
      [200],
    );
    assertStatus('Confirm total', await api(bodega, 'POST', `/warehouse-receipts/${wrId}/confirm`), [200, 201]);
    r = assertStatus('GET OC', await api(bodega, 'GET', `/purchase-orders/${built.poId}`), [200]);
    if (!['RECEIVED', 'CLOSED', 'PARTIALLY_RECEIVED'].includes(r.body.status)) {
      throw new Error(`Estado OC inesperado: ${r.body.status}`);
    }
  });

  // F — discrepancia + overrule (short shipment: factura ≤ recepcionado, PO no cuadra)
  await run('F', '3-way DISCREPANCY + overrule', async () => {
    const built = await buildPendingOc(fixtures, { qty: 4, unitPrice: 2500, label: 'Flujo F' });
    await approvePoTwoLevels(built.poId);
    await sendPoToSupplier(built.poId);
    const bodega = await getToken('pbac-compras-bodega@test.com');
    let r = assertStatus(
      'WR',
      await api(bodega, 'POST', '/warehouse-receipts', {
        purchaseOrderId: built.poId,
        warehouseId: fixtures.warehouse.id,
      }),
      [200, 201],
    );
    const lineId = r.body.items?.[0]?.id;
    assertStatus(
      'Receive full',
      await api(bodega, 'PATCH', `/warehouse-receipts/${r.body.id}/items`, {
        items: [{ id: lineId, quantityReceived: 4 }],
      }),
      [200],
    );
    assertStatus('Confirm', await api(bodega, 'POST', `/warehouse-receipts/${r.body.id}/confirm`), [200, 201]);

    const tesoreria = await getToken('pbac-compras-tesoreria@test.com');
    // Tolerancia tenant puede ser alta (p. ej. 20%): usar ~25% bajo OC, aún ≤ recepcionado
    const invoiceAmount = Math.round(built.totalAmount * 0.75);
    r = assertStatus(
      'Invoice',
      await api(tesoreria, 'POST', '/purchase-invoices', {
        purchaseOrderId: built.poId,
        vendorId: built.vendor.id,
        invoiceNumber: `FAC-F-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: invoiceAmount,
        currency: 'CLP',
      }),
      [200, 201],
    );
    const invId = r.body.id;
    r = assertStatus('Validate', await api(tesoreria, 'POST', `/purchase-invoices/${invId}/validate`), [200, 201]);
    const st = r.body?.status ?? r.body?.invoice?.status;
    if (st !== 'DISCREPANCY') throw new Error(`Esperaba DISCREPANCY, got ${st}`);
    assertStatus(
      'Overrule',
      await api(tesoreria, 'POST', `/purchase-invoices/${invId}/three-way-match/overrule`, {
        notes: 'Justificación flujo F: short shipment autorizado por tesorería PBAC test',
      }),
      [200, 201],
    );
  });

  // G — nota de crédito + re-validación
  await run('G', 'Nota de crédito + re-validate', async () => {
    const built = await buildPendingOc(fixtures, { label: 'Flujo G' });
    await approvePoTwoLevels(built.poId);
    await sendPoToSupplier(built.poId);
    const bodega = await getToken('pbac-compras-bodega@test.com');
    let r = assertStatus(
      'WR',
      await api(bodega, 'POST', '/warehouse-receipts', {
        purchaseOrderId: built.poId,
        warehouseId: fixtures.warehouse.id,
      }),
      [200, 201],
    );
    const lineId = r.body.items?.[0]?.id;
    assertStatus(
      'Receive',
      await api(bodega, 'PATCH', `/warehouse-receipts/${r.body.id}/items`, {
        items: [{ id: lineId, quantityReceived: built.qty }],
      }),
      [200],
    );
    assertStatus('Confirm', await api(bodega, 'POST', `/warehouse-receipts/${r.body.id}/confirm`), [200, 201]);

    const tesoreria = await getToken('pbac-compras-tesoreria@test.com');
    r = assertStatus(
      'Invoice',
      await api(tesoreria, 'POST', '/purchase-invoices', {
        purchaseOrderId: built.poId,
        vendorId: built.vendor.id,
        invoiceNumber: `FAC-G-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: built.totalAmount,
        currency: 'CLP',
      }),
      [200, 201],
    );
    const invId = r.body.id;
    assertStatus('Validate matched', await api(tesoreria, 'POST', `/purchase-invoices/${invId}/validate`), [200, 201]);
    assertStatus(
      'Credit note',
      await api(tesoreria, 'POST', '/purchase-credit-notes', {
        purchaseOrderId: built.poId,
        purchaseInvoiceId: invId,
        creditNoteNumber: `NC-G-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: 500,
        notes: 'NC prueba flujo G',
      }),
      [200, 201],
    );
    r = assertStatus('Re-validate', await api(tesoreria, 'POST', `/purchase-invoices/${invId}/validate`), [200, 201]);
    console.log(`   estado post-NC: ${r.body?.status ?? r.body?.invoice?.status ?? '?'}`);
  });

  // H — reject + reset draft; partial + force-close
  await run('H', 'Reject→reset draft y force-close', async () => {
    const admin = await getToken('pbac-compras-admin-compras@test.com');
    const built = await buildPendingOc(fixtures, { label: 'Flujo H reject' });
    assertStatus(
      'Reject OC',
      await api(admin, 'POST', `/purchase-orders/${built.poId}/reject`, { reason: 'Prueba reset' }),
      [200, 201],
    );
    assertStatus('Reset draft', await api(admin, 'POST', `/purchase-orders/${built.poId}/reset`), [200, 201]);

    const built2 = await buildPendingOc(fixtures, { qty: 5, label: 'Flujo H force-close' });
    await approvePoTwoLevels(built2.poId);
    await sendPoToSupplier(built2.poId);
    const bodega = await getToken('pbac-compras-bodega@test.com');
    let r = assertStatus(
      'WR partial',
      await api(bodega, 'POST', '/warehouse-receipts', {
        purchaseOrderId: built2.poId,
        warehouseId: fixtures.warehouse.id,
      }),
      [200, 201],
    );
    const lineId = r.body.items?.[0]?.id;
    assertStatus(
      'Receive 2/5',
      await api(bodega, 'PATCH', `/warehouse-receipts/${r.body.id}/items`, {
        items: [{ id: lineId, quantityReceived: 2 }],
      }),
      [200],
    );
    assertStatus('Confirm partial', await api(bodega, 'POST', `/warehouse-receipts/${r.body.id}/confirm`), [200, 201]);
    assertStatus(
      'Force close',
      await api(admin, 'POST', `/purchase-orders/${built2.poId}/force-close`, {
        reason: 'Cierre administrativo prueba flujo H con pendiente en bodega',
      }),
      [200, 201],
    );
  });

  // I — sin contrato → listado vacío
  await run('I', 'Usuario sin contrato → listado vacío', async () => {
    const user = await getToken('pbac-compras-sin-contrato@test.com');
    const r = assertStatus('List SRC', await api(user, 'GET', '/purchase-requisitions?page=1&pageSize=20'), [200]);
    const total = r.body.total ?? r.body.data?.length ?? 0;
    if (total !== 0) throw new Error(`Esperaba 0 SRC, total=${total}`);
    const r2 = assertStatus('List OC', await api(user, 'GET', '/purchase-orders?page=1&pageSize=20'), [200]);
    const total2 = r2.body.total ?? r2.body.data?.length ?? 0;
    if (total2 !== 0) throw new Error(`Esperaba 0 OC, total=${total2}`);
  });

  // J — multi-proveedor → 2 OC (si hay 2 ítems y 2 proveedores)
  await run('J', 'Adjudicación multi-proveedor → 2 OC', async () => {
    if (fixtures.items.length < 2) throw new Error('Se necesitan ≥2 artículos en catálogo');
    let v2 = fixtures.vendors[1];
    const comprador = await getToken('pbac-compras-comprador@test.com');
    if (!v2) {
      const r = assertStatus(
        'Create vendor 2',
        await api(comprador, 'POST', '/vendors', {
          code: `PBAC-V2-${Date.now()}`,
          name: 'Proveedor PBAC Flujo J',
          isActive: true,
        }),
        [200, 201],
      );
      v2 = { id: r.body.id, name: r.body.name };
    }
    const v1 = fixtures.vendors[0];
    const qty = 2;
    const price = 3000;
    const solicitante = await getToken('pbac-compras-solicitante@test.com');

    let r = assertStatus(
      'SRC 2 líneas',
      await api(solicitante, 'POST', '/purchase-requisitions', {
        contractId: fixtures.contract.id,
        description: 'Flujo J multi-vendor',
        priority: 'MEDIUM',
        items: [
          itemLine(fixtures.items[0], qty, price),
          itemLine(fixtures.items[1], qty, price),
        ],
      }),
      [200, 201],
    );
    const reqId = r.body.id;
    assertStatus('Submit', await api(solicitante, 'POST', `/purchase-requisitions/${reqId}/submit`), [200, 201]);
    assertStatus('Start quoting', await api(comprador, 'POST', `/purchase-requisitions/${reqId}/start-quoting`), [200, 201]);
    r = assertStatus('GET SRC', await api(comprador, 'GET', `/purchase-requisitions/${reqId}`), [200]);
    const [line1, line2] = r.body.items;

    r = assertStatus(
      'Quote V1 line1',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/quotations`, {
        vendorId: v1.id,
        totalAmount: qty * price,
        currency: 'CLP',
        paymentDays: 30,
        items: [{ requisitionItemId: line1.id, unitPrice: price }],
      }),
      [200, 201],
    );
    const q1Item = r.body.items[0].id;

    r = assertStatus(
      'Quote V2 line2',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/quotations`, {
        vendorId: v2.id,
        totalAmount: qty * price,
        currency: 'CLP',
        paymentDays: 30,
        items: [{ requisitionItemId: line2.id, unitPrice: price }],
      }),
      [200, 201],
    );
    const q2Item = r.body.items[0].id;

    assertStatus(
      'Awards',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/line-awards`, {
        awards: [
          { requisitionItemId: line1.id, quotationItemId: q1Item },
          { requisitionItemId: line2.id, quotationItemId: q2Item },
        ],
      }),
      [200, 201],
    );

    r = assertStatus('Generate OCs', await api(comprador, 'POST', `/purchase-orders/from-requisition/${reqId}`), [200, 201]);
    const orders = r.body.orders ?? [];
    if (orders.length < 2) throw new Error(`Esperaba 2 OC, got ${orders.length}`);
    const vendorIds = new Set(orders.map((o) => o.quotation?.vendorId ?? o.vendorId).filter(Boolean));
    if (vendorIds.size < 2 && orders.length >= 2) {
      console.log(`   (${orders.length} OC generadas)`);
    }
  });

  console.log(`\nExtendidos: ${passed} OK, ${failed} fallidos\n`);
  return failed;
}

/** Flujos funcionales K–R: endpoints compras no cubiertos solo por matriz A–J */
async function runCoverageFlows() {
  console.log('\n=== Cobertura API K–R (endpoints restantes) ===\n');
  const fixtures = await getFixtures();
  let passed = 0;
  let failed = 0;

  const run = async (code, title, fn) => {
    process.stdout.write(`\n[${code}] ${title} … `);
    try {
      await fn();
      console.log('✓');
      passed++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
  };

  await run('K', 'update-own en DRAFT + update-purchasing en QUOTING', async () => {
    const solicitante = await getToken('pbac-compras-solicitante@test.com');
    const comprador = await getToken('pbac-compras-comprador@test.com');
    let r = assertStatus(
      'SRC DRAFT',
      await api(solicitante, 'POST', '/purchase-requisitions', {
        contractId: fixtures.contract.id,
        description: 'Flujo K update-own',
        priority: 'MEDIUM',
        items: [itemLine(fixtures.items[0], 2, 1500)],
      }),
      [200, 201],
    );
    const reqId = r.body.id;
    assertStatus(
      'PATCH own DRAFT',
      await api(solicitante, 'PATCH', `/purchase-requisitions/${reqId}`, {
        description: 'Flujo K editado solicitante',
      }),
      [200],
    );
    assertStatus('Submit', await api(solicitante, 'POST', `/purchase-requisitions/${reqId}/submit`), [200, 201]);
    assertStatus('Start quoting', await api(comprador, 'POST', `/purchase-requisitions/${reqId}/start-quoting`), [200, 201]);
    assertStatus(
      'PATCH purchasing QUOTING',
      await api(comprador, 'PATCH', `/purchase-requisitions/${reqId}`, {
        description: 'Flujo K editado comprador',
      }),
      [200],
    );
  });

  await run('L', 'duplicate SRC', async () => {
    const solicitante = await getToken('pbac-compras-solicitante@test.com');
    let r = assertStatus(
      'SRC',
      await api(solicitante, 'POST', '/purchase-requisitions', {
        contractId: fixtures.contract.id,
        description: 'Flujo L original',
        priority: 'LOW',
        items: [itemLine(fixtures.items[0], 1, 500)],
      }),
      [200, 201],
    );
    const copy = assertStatus(
      'Duplicate',
      await api(solicitante, 'POST', `/purchase-requisitions/${r.body.id}/duplicate`),
      [200, 201],
    );
    if (!String(copy.body.description ?? '').includes('[Copia]')) {
      throw new Error('Duplicado sin prefijo [Copia]');
    }
  });

  await run('M', 'cancel SRC (SUBMITTED)', async () => {
    const solicitante = await getToken('pbac-compras-solicitante@test.com');
    const comprador = await getToken('pbac-compras-comprador@test.com');
    let r = assertStatus(
      'SRC',
      await api(solicitante, 'POST', '/purchase-requisitions', {
        contractId: fixtures.contract.id,
        description: 'Flujo M cancel',
        priority: 'MEDIUM',
        items: [itemLine(fixtures.items[0], 1, 800)],
      }),
      [200, 201],
    );
    const reqId = r.body.id;
    assertStatus('Submit', await api(solicitante, 'POST', `/purchase-requisitions/${reqId}/submit`), [200, 201]);
    r = assertStatus(
      'Cancel',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/cancel`, {
        reason: 'Anulación prueba cobertura M',
      }),
      [200, 201],
    );
    if (r.body.status !== 'CANCELLED') throw new Error(`Estado ${r.body.status}`);
  });

  await run('N', 'selectQuotation + createFromQuotation', async () => {
    const solicitante = await getToken('pbac-compras-solicitante@test.com');
    const comprador = await getToken('pbac-compras-comprador@test.com');
    const vendor = fixtures.vendors[0];
    if (!vendor) throw new Error('Sin proveedor');
    let r = assertStatus(
      'SRC',
      await api(solicitante, 'POST', '/purchase-requisitions', {
        contractId: fixtures.contract.id,
        description: 'Flujo N select quotation',
        priority: 'MEDIUM',
        items: [itemLine(fixtures.items[0], 3, 2000)],
      }),
      [200, 201],
    );
    const reqId = r.body.id;
    assertStatus('Submit', await api(solicitante, 'POST', `/purchase-requisitions/${reqId}/submit`), [200, 201]);
    assertStatus('Start quoting', await api(comprador, 'POST', `/purchase-requisitions/${reqId}/start-quoting`), [200, 201]);
    r = assertStatus('GET SRC', await api(comprador, 'GET', `/purchase-requisitions/${reqId}`), [200]);
    const reqItem = r.body.items[0];
    r = assertStatus(
      'Quotation',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/quotations`, {
        vendorId: vendor.id,
        totalAmount: 6000,
        currency: 'CLP',
        paymentDays: 30,
        items: [{ requisitionItemId: reqItem.id, unitPrice: 2000 }],
      }),
      [200, 201],
    );
    const qId = r.body.id;
    assertStatus(
      'Select winner',
      await api(comprador, 'POST', `/purchase-requisitions/${reqId}/quotations/${qId}/select`),
      [200, 201],
    );
    r = assertStatus(
      'OC from quotation',
      await api(comprador, 'POST', '/purchase-orders', { quotationId: qId }),
      [200, 201],
    );
    if (!r.body.id) throw new Error('Sin OC desde cotización');
  });

  await run('O', 'update-logistics + update-sensitive + cancel OC', async () => {
    const comprador = await getToken('pbac-compras-comprador@test.com');
    const built = await buildPendingOc(fixtures, { label: 'Flujo O logistics' });
    assertStatus(
      'Logistics',
      await api(comprador, 'PATCH', `/purchase-orders/${built.poId}/logistics`, {
        deliveryAddress: 'Bodega central PBAC test',
        paymentTerms: '30 días',
      }),
      [200],
    );
    assertStatus(
      'Sensitive total',
      await api(comprador, 'PATCH', `/purchase-orders/${built.poId}/sensitive`, {
        totalAmount: built.totalAmount + 100,
      }),
      [200],
    );
    assertStatus(
      'Cancel OC',
      await api(comprador, 'POST', `/purchase-orders/${built.poId}/cancel`, {
        reason: 'Cancelación cobertura O',
      }),
      [200, 201],
    );
  });

  await run('P', 'link-catalog en línea libre (vía update-sensitive)', async () => {
    const comprador = await getToken('pbac-compras-comprador@test.com');
    const built = await buildPendingOc(fixtures, { label: 'Flujo P link catalog', qty: 2, unitPrice: 1200 });
    let r = assertStatus(
      'Sensitive → línea sin catálogo',
      await api(comprador, 'PATCH', `/purchase-orders/${built.poId}/sensitive`, {
        items: [
          {
            description: 'Repuesto libre PBAC en OC',
            quantity: 2,
            unitCost: 1200,
          },
        ],
      }),
      [200],
    );
    const line = r.body.items?.[0] ?? (await api(comprador, 'GET', `/purchase-orders/${built.poId}`)).body.items?.[0];
    if (!line?.id) throw new Error('Sin línea OC tras sensitive');
    assertStatus(
      'Link catalog',
      await api(comprador, 'PATCH', `/purchase-orders/${built.poId}/items/${line.id}/link-catalog`, {
        inventoryItemId: fixtures.items[0].id,
      }),
      [200],
    );
  });

  await run('Q', 'invoice update + delete + pay con referencia', async () => {
    const built = await buildPendingOc(fixtures, { label: 'Flujo Q invoice' });
    await approvePoTwoLevels(built.poId);
    await sendPoToSupplier(built.poId);
    const bodega = await getToken('pbac-compras-bodega@test.com');
    let r = assertStatus(
      'WR',
      await api(bodega, 'POST', '/warehouse-receipts', {
        purchaseOrderId: built.poId,
        warehouseId: fixtures.warehouse.id,
      }),
      [200, 201],
    );
    const lineId = r.body.items?.[0]?.id;
    assertStatus(
      'Receive',
      await api(bodega, 'PATCH', `/warehouse-receipts/${r.body.id}/items`, {
        items: [{ id: lineId, quantityReceived: built.qty }],
      }),
      [200],
    );
    assertStatus('Confirm', await api(bodega, 'POST', `/warehouse-receipts/${r.body.id}/confirm`), [200, 201]);

    const tesoreria = await getToken('pbac-compras-tesoreria@test.com');
    r = assertStatus(
      'Invoice draft',
      await api(tesoreria, 'POST', '/purchase-invoices', {
        purchaseOrderId: built.poId,
        vendorId: built.vendor.id,
        invoiceNumber: `FAC-Q-DRAFT-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: built.totalAmount,
        currency: 'CLP',
      }),
      [200, 201],
    );
    const draftId = r.body.id;
    const newNumber = `FAC-Q-UPD-${Date.now()}`;
    assertStatus(
      'Update invoice',
      await api(tesoreria, 'PATCH', `/purchase-invoices/${draftId}`, {
        invoiceNumber: newNumber,
      }),
      [200],
    );
    assertStatus('Delete draft', await api(tesoreria, 'DELETE', `/purchase-invoices/${draftId}`), [200, 204]);

    r = assertStatus(
      'Invoice pay flow',
      await api(tesoreria, 'POST', '/purchase-invoices', {
        purchaseOrderId: built.poId,
        vendorId: built.vendor.id,
        invoiceNumber: `FAC-Q-PAY-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: built.totalAmount,
        currency: 'CLP',
      }),
      [200, 201],
    );
    const invId = r.body.id;
    assertStatus('Validate', await api(tesoreria, 'POST', `/purchase-invoices/${invId}/validate`), [200, 201]);
    assertStatus(
      'Pay with reference',
      await api(tesoreria, 'POST', `/purchase-invoices/${invId}/pay`, {
        paymentReference: `TRX-Q-${Date.now()}`,
      }),
      [200, 201],
    );
  });

  await run('R', 'vendors + settings policies + credit note delete', async () => {
    const config = await getToken('pbac-compras-config@test.com');
    const code = `PBAC-COV-${Date.now()}`;
    let r = assertStatus(
      'Create vendor',
      await api(config, 'POST', '/vendors', {
        code,
        name: 'Proveedor Cobertura R',
        isActive: true,
      }),
      [200, 201],
    );
    const vendorId = r.body.id;
    assertStatus(
      'Update vendor',
      await api(config, 'PATCH', `/vendors/${vendorId}`, { name: 'Proveedor Cobertura R (edit)' }),
      [200],
    );
    assertStatus('Delete vendor', await api(config, 'DELETE', `/vendors/${vendorId}`), [200, 204]);

    r = assertStatus('GET policies', await api(config, 'GET', '/purchase-settings/policies'), [200]);
    const rawPolicies = Array.isArray(r.body) ? r.body : [];
    const policies = rawPolicies.map((p) => ({
      level: p.level,
      description: p.description ?? undefined,
      userIds: (p.allowedUsers ?? [])
        .map((au) => au.user?.id ?? au.userId)
        .filter(Boolean),
      minAmount: p.minAmount != null ? Number(p.minAmount) : undefined,
    }));
    assertStatus('PUT policies noop', await api(config, 'PUT', '/purchase-settings/policies', { policies }), [200]);

    const built = await buildPendingOc(fixtures, { label: 'Flujo R NC delete' });
    await approvePoTwoLevels(built.poId);
    await sendPoToSupplier(built.poId);
    const bodega = await getToken('pbac-compras-bodega@test.com');
    r = assertStatus(
      'WR',
      await api(bodega, 'POST', '/warehouse-receipts', {
        purchaseOrderId: built.poId,
        warehouseId: fixtures.warehouse.id,
      }),
      [200, 201],
    );
    const lineId = r.body.items?.[0]?.id;
    assertStatus(
      'Receive',
      await api(bodega, 'PATCH', `/warehouse-receipts/${r.body.id}/items`, {
        items: [{ id: lineId, quantityReceived: built.qty }],
      }),
      [200],
    );
    assertStatus('Confirm', await api(bodega, 'POST', `/warehouse-receipts/${r.body.id}/confirm`), [200, 201]);

    const tesoreria = await getToken('pbac-compras-tesoreria@test.com');
    r = assertStatus(
      'Invoice',
      await api(tesoreria, 'POST', '/purchase-invoices', {
        purchaseOrderId: built.poId,
        vendorId: built.vendor.id,
        invoiceNumber: `FAC-R-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: built.totalAmount,
        currency: 'CLP',
      }),
      [200, 201],
    );
    const invId = r.body.id;
    r = assertStatus(
      'Credit note',
      await api(tesoreria, 'POST', '/purchase-credit-notes', {
        purchaseOrderId: built.poId,
        purchaseInvoiceId: invId,
        creditNoteNumber: `NC-R-${Date.now()}`,
        emissionDate: new Date().toISOString(),
        totalAmount: 200,
        notes: 'NC cobertura R',
      }),
      [200, 201],
    );
    const ncId = r.body.id;
    assertStatus('Delete NC', await api(tesoreria, 'DELETE', `/purchase-credit-notes/${ncId}`), [200, 204]);
  });

  await run('S', 'lecturas: logs, PDFs, calendario, elegibles, analytics, documentos', async () => {
    const lectura = await getToken('pbac-compras-lectura@test.com');
    const built = await buildPendingOc(fixtures, { label: 'Flujo S reads' });

    assertStatus('SRC logs', await api(lectura, 'GET', `/purchase-requisitions/${built.reqId}/logs`), [200]);
    assertStatus('SRC pdf', await api(lectura, 'GET', `/purchase-requisitions/${built.reqId}/pdf`), [200]);
    assertStatus('OC logs', await api(lectura, 'GET', `/purchase-orders/${built.poId}/logs`), [200]);
    assertStatus('OC pdf', await api(lectura, 'GET', `/purchase-orders/${built.poId}/pdf`), [200]);
    assertStatus('Eligible receipt', await api(lectura, 'GET', '/purchase-orders/eligible-for-receipt'), [200]);
    assertStatus('Dashboard', await api(lectura, 'GET', '/purchases/analytics/dashboard'), [200]);
    assertStatus('Analytics pdf', await api(lectura, 'GET', '/purchases/analytics/report/pdf'), [200]);

    const from = new Date();
    from.setDate(1);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 2);
    assertStatus(
      'Payment calendar',
      await api(
        lectura,
        'GET',
        `/purchase-invoices/payment-calendar?contractId=${fixtures.contract.id}&from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`,
      ),
      [200],
    );
    assertStatus(
      'Documents list',
      await api(lectura, 'GET', `/purchase-documents?entity=REQUISITION&entityId=${built.reqId}`),
      [200],
    );

    const comprador = await getToken('pbac-compras-comprador@test.com');
    const form = new FormData();
    form.append('file', minimalPdfBlob(), 'pbac-coverage.pdf');
    const upload = await apiMultipart(
      comprador,
      'POST',
      `/purchase-documents?entity=REQUISITION&entityId=${built.reqId}`,
      form,
    );
    if (![200, 201].includes(upload.status)) {
      throw new Error(`Upload documento HTTP ${upload.status} ${JSON.stringify(upload.body)}`);
    }
    assertStatus(
      'Documents after upload',
      await api(lectura, 'GET', `/purchase-documents?entity=REQUISITION&entityId=${built.reqId}`),
      [200],
    );
  });

  console.log(`\nCobertura K–R: ${passed} OK, ${failed} fallidos\n`);
  return failed;
}

async function main() {
  console.log(`API: ${API_BASE} | Tenant: ${TENANT_CODE}`);
  console.log(
    `Modos: matrix=${RUN_MATRIX} flowA=${RUN_FLOW} extended=${RUN_EXTENDED} coverage=${RUN_COVERAGE}`,
  );

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
  if (RUN_FLOW) {
    try {
      await runFlowA();
    } catch (e) {
      console.error(`\n❌ Flujo A: ${e.message}\n`);
      exitCode = 1;
    }
  }
  if (RUN_EXTENDED) {
    const fails = await runExtendedFlows();
    if (fails > 0) exitCode = 1;
  }
  if (RUN_COVERAGE) {
    const fails = await runCoverageFlows();
    if (fails > 0) exitCode = 1;
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
