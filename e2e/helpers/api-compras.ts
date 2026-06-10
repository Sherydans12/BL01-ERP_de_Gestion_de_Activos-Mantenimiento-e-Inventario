import { API_BASE, apiLogin, PBAC_USERS } from './auth';

type Json = Record<string, unknown>;

async function apiJson(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json as Json };
}

export async function getCatalogSearchHint(email: string): Promise<string> {
  const { token } = await apiLogin(email);
  const r = await apiJson(token, 'GET', '/inventory-items?page=1&pageSize=5');
  const rows = (r.body.data ?? r.body.items ?? []) as Array<{
    name?: string;
    description?: string;
    partNumber?: string;
  }>;
  const item = rows[0];
  if (!item) return 'aceite';
  const hint =
    item.partNumber?.trim() ||
    item.name?.trim()?.slice(0, 6) ||
    item.description?.trim()?.slice(0, 6) ||
    'rep';
  return hint.length >= 2 ? hint : `${hint}x`;
}

export async function getFirstVendorId(email: string): Promise<string | null> {
  const { token } = await apiLogin(email);
  const r = await apiJson(token, 'GET', '/vendors?page=1&pageSize=5');
  const rows = (r.body.data ?? r.body.items ?? []) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function getFirstWarehouseId(email: string): Promise<string | null> {
  const { token } = await apiLogin(email);
  const r = await apiJson(token, 'GET', '/warehouses?page=1&pageSize=10');
  const rows = (r.body.data ?? r.body.items ?? r.body) as Array<{ id: string }>;
  const list = Array.isArray(rows) ? rows : [];
  return list[0]?.id ?? null;
}

export async function findRequisitionByDescription(
  email: string,
  description: string,
): Promise<{ id: string; correlative?: string } | null> {
  const { token } = await apiLogin(email);
  const q = encodeURIComponent(description.slice(0, 40));
  const r = await apiJson(token, 'GET', `/purchase-requisitions?search=${q}&pageSize=10`);
  const rows = (r.body.data ?? r.body.items ?? []) as Array<{
    id: string;
    description?: string;
    correlative?: string;
  }>;
  const hit = rows.find((row) => row.description?.includes(description));
  return hit ? { id: hit.id, correlative: hit.correlative } : null;
}

export async function findPurchaseOrderByRequisition(
  email: string,
  requisitionId: string,
): Promise<{ id: string; correlative?: string; totalAmount?: number } | null> {
  const { token } = await apiLogin(email);
  const r = await apiJson(token, 'GET', `/purchase-requisitions/${requisitionId}`);
  const pos = (r.body.purchaseOrders ?? []) as Array<{
    id: string;
    correlative?: string;
    totalAmount?: number;
  }>;
  return pos[0] ?? null;
}

export async function getPurchaseOrderDetail(email: string, poId: string) {
  const { token } = await apiLogin(email);
  const r = await apiJson(token, 'GET', `/purchase-orders/${poId}`);
  return r.body as Json & { correlative?: string; totalAmount?: number; status?: string };
}

export async function findOpenReceiptForOrder(
  email: string,
  purchaseOrderId: string,
): Promise<{ id: string; correlative?: string } | null> {
  const { token } = await apiLogin(email);
  const r = await apiJson(
    token,
    'GET',
    `/warehouse-receipts?purchaseOrderId=${purchaseOrderId}&pageSize=10`,
  );
  const rows = (r.body.data ?? r.body.items ?? []) as Array<{
    id: string;
    correlative?: string;
    status?: string;
  }>;
  const open = rows.find((row) => row.status === 'PENDING' || row.status === 'PARTIAL');
  return open ? { id: open.id, correlative: open.correlative } : null;
}

/** SRC → cotización → adjudicación → OC `PENDING_APPROVAL` (para tests de gobernanza). */
export async function buildPendingPurchaseOrderViaApi(
  label = `E2E pending OC ${Date.now()}`,
): Promise<{ poId: string; reqId: string } | null> {
  const solicitante = await apiLogin(PBAC_USERS.solicitante);
  const comprador = await apiLogin(PBAC_USERS.comprador);

  const contractId =
    comprador.user.allowedContracts?.find((c) => c && c !== 'ALL') ??
    solicitante.user.allowedContracts?.find((c) => c && c !== 'ALL');
  if (!contractId) return null;

  const itemsRes = await apiJson(comprador.token, 'GET', '/inventory-items?page=1&pageSize=1');
  const catalogItem = ((itemsRes.body.data ?? itemsRes.body.items ?? []) as Array<{ id: string }>)[0];
  if (!catalogItem?.id) return null;

  const vendorId = await getFirstVendorId(PBAC_USERS.comprador);
  if (!vendorId) return null;

  const createReq = await apiJson(solicitante.token, 'POST', '/purchase-requisitions', {
    contractId,
    description: label,
    priority: 'MEDIUM',
    items: [{ inventoryItemId: catalogItem.id, quantity: 2, unitOfMeasure: 'UN', description: 'E2E' }],
  });
  if (createReq.status >= 400) return null;
  const reqId = String(createReq.body.id ?? '');

  const steps: Array<[string, string, string, unknown?]> = [
    ['POST', `/purchase-requisitions/${reqId}/submit`, solicitante.token],
    ['POST', `/purchase-requisitions/${reqId}/start-quoting`, comprador.token],
  ];
  for (const [method, path, token] of steps) {
    const r = await apiJson(token, method, path);
    if (r.status >= 400) return null;
  }

  const reqDetail = await apiJson(comprador.token, 'GET', `/purchase-requisitions/${reqId}`);
  const reqItems = (reqDetail.body.items ?? []) as Array<{ id: string; quantity?: number }>;
  const unitPrice = 2500;
  const quotationItems = reqItems.map((ri) => ({
    requisitionItemId: ri.id,
    unitPrice,
  }));
  const totalAmount = quotationItems.reduce(
    (sum, qi) => sum + qi.unitPrice * (reqItems.find((x) => x.id === qi.requisitionItemId)?.quantity ?? 0),
    0,
  );

  const quote = await apiJson(comprador.token, 'POST', `/purchase-requisitions/${reqId}/quotations`, {
    vendorId,
    totalAmount,
    currency: 'CLP',
    paymentDays: 30,
    items: quotationItems,
  });
  if (quote.status >= 400) return null;

  const awards = ((quote.body.items ?? []) as Array<{ id: string; requisitionItemId: string }>).map((qi) => ({
    requisitionItemId: qi.requisitionItemId,
    quotationItemId: qi.id,
  }));
  const award = await apiJson(comprador.token, 'POST', `/purchase-requisitions/${reqId}/line-awards`, {
    awards,
  });
  if (award.status >= 400) return null;

  const orders = await apiJson(comprador.token, 'POST', `/purchase-orders/from-requisition/${reqId}`);
  if (orders.status >= 400) return null;
  const po = ((orders.body.orders ?? []) as Array<{ id: string }>)[0];
  return po?.id ? { poId: po.id, reqId } : null;
}

export async function rejectPurchaseOrderViaApi(
  poId: string,
  reason = 'Rechazo E2E Playwright',
): Promise<boolean> {
  const { token } = await apiLogin(PBAC_USERS.adminCompras);
  const r = await apiJson(token, 'POST', `/purchase-orders/${poId}/reject`, { reason });
  return r.status < 400;
}
