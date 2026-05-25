import { API_BASE, apiLogin } from './auth';

type ApiJson = Record<string, unknown>;

async function apiJson(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: ApiJson | ApiJson[] | null }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: ApiJson | ApiJson[] | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

export type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  contractId: string;
};

export type StockRow = {
  itemId: string;
  quantity: number;
  item?: { id: string; partNumber?: string; name?: string; inventoryCode?: string };
};

export type InventoryItemRow = {
  id: string;
  inventoryCode?: string;
  name: string;
  partNumber?: string;
  policyTargetWarehouseId?: string | null;
  policyMinStock?: number | null;
  policyMaxStock?: number | null;
};

export type LedgerRow = {
  type: string;
  referenceType?: string | null;
  quantity: number;
};

export async function getWarehouses(token: string, contractId?: string): Promise<WarehouseRow[]> {
  const q = contractId ? `?contractId=${encodeURIComponent(contractId)}` : '';
  const { status, body } = await apiJson(token, 'GET', `/warehouses${q}`);
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as WarehouseRow[];
}

export async function getCategoryFamilies(token: string): Promise<{ id: string; name: string }[]> {
  const { status, body } = await apiJson(token, 'GET', '/item-categories/families');
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as { id: string; name: string }[];
}

export async function getCategoryChildren(
  token: string,
  parentId: string,
): Promise<{ id: string; name: string }[]> {
  const { status, body } = await apiJson(token, 'GET', `/item-categories/children/${parentId}`);
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as { id: string; name: string }[];
}

export async function getUnits(token: string): Promise<{ id: string; abbreviation: string }[]> {
  const { status, body } = await apiJson(token, 'GET', '/units-of-measure');
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as { id: string; abbreviation: string }[];
}

export async function getInventoryItem(token: string, idOrCode: string): Promise<InventoryItemRow | null> {
  const { status, body } = await apiJson(token, 'GET', `/inventory-items/${idOrCode}`);
  if (status !== 200 || !body || Array.isArray(body)) return null;
  return body as InventoryItemRow;
}

export async function getWarehouseStock(token: string, warehouseId: string): Promise<StockRow[]> {
  const { status, body } = await apiJson(token, 'GET', `/inventory-stock/warehouse/${warehouseId}`);
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as StockRow[];
}

export async function getItemLedger(
  token: string,
  itemId: string,
  warehouseId?: string,
): Promise<LedgerRow[]> {
  const q = warehouseId ? `?warehouseId=${warehouseId}&pageSize=50` : '?pageSize=50';
  const { status, body } = await apiJson(token, 'GET', `/inventory-items/${itemId}/ledger${q}`);
  if (status !== 200 || !body || Array.isArray(body)) return [];
  const data = (body as ApiJson).data;
  return Array.isArray(data) ? (data as LedgerRow[]) : [];
}

export async function getWarehouseTransactions(
  token: string,
  warehouseId: string,
  itemId?: string,
): Promise<LedgerRow[]> {
  const q = itemId ? `?itemId=${itemId}&pageSize=50` : '?pageSize=50';
  const { status, body } = await apiJson(token, 'GET', `/inventory-stock/warehouse/${warehouseId}/transactions${q}`);
  if (status !== 200 || !body) return [];
  if (Array.isArray(body)) return body as LedgerRow[];
  const data = (body as ApiJson).data;
  return Array.isArray(data) ? (data as LedgerRow[]) : [];
}

export async function performStockIn(
  token: string,
  warehouseId: string,
  itemId: string,
  quantity: number,
  unitCost = 100,
) {
  return apiJson(token, 'POST', '/inventory-stock/transaction', {
    warehouseId,
    itemId,
    type: 'IN',
    quantity,
    unitCost,
    notes: 'E2E inventario setup',
  });
}

export async function findW2WPair(token: string): Promise<{
  contractId: string;
  origin: WarehouseRow;
  destination: WarehouseRow;
} | null> {
  const all = await getWarehouses(token);
  const byContract = new Map<string, WarehouseRow[]>();
  for (const w of all) {
    if (!w.contractId) continue;
    const list = byContract.get(w.contractId) ?? [];
    list.push(w);
    byContract.set(w.contractId, list);
  }
  for (const [contractId, list] of byContract) {
    if (list.length >= 2) {
      return { contractId, origin: list[0], destination: list[1] };
    }
  }
  return null;
}

export async function findStockedItemInWarehouse(
  token: string,
  warehouseId: string,
  minQty = 2,
): Promise<{ itemId: string; quantity: number; partNumber?: string } | null> {
  const rows = await getWarehouseStock(token, warehouseId);
  const hit = rows.find((r) => Number(r.quantity) >= minQty);
  if (hit) {
    return {
      itemId: hit.itemId,
      quantity: Number(hit.quantity),
      partNumber: hit.item?.partNumber,
    };
  }
  return null;
}

export async function ensureStockForW2W(
  gestorEmail: string,
  warehouseId: string,
): Promise<{
  itemId: string;
  partNumber?: string;
  inventoryCode?: string;
  searchHint: string;
  qtyBefore: number;
}> {
  const { token } = await apiLogin(gestorEmail);
  let stocked = await findStockedItemInWarehouse(token, warehouseId, 2);
  if (stocked) {
    const item = await getInventoryItem(token, stocked.itemId);
    const searchHint =
      stocked.partNumber?.trim() ||
      item?.inventoryCode?.trim() ||
      item?.name?.trim()?.slice(0, 12) ||
      stocked.itemId.slice(0, 8);
    return {
      itemId: stocked.itemId,
      partNumber: stocked.partNumber,
      inventoryCode: item?.inventoryCode,
      searchHint,
      qtyBefore: stocked.quantity,
    };
  }

  const catalog = await apiJson(token, 'GET', '/inventory-items?page=1&pageSize=5');
  const items = catalog.body && !Array.isArray(catalog.body)
    ? ((catalog.body as ApiJson).data as ApiJson[] | undefined)
    : undefined;
  const item = items?.[0] as { id: string; partNumber?: string; inventoryCode?: string; name?: string } | undefined;
  if (!item?.id) throw new Error('Sin artículos en catálogo para setup W2W');

  const inRes = await performStockIn(token, warehouseId, item.id, 10, 150);
  if (![200, 201].includes(inRes.status)) {
    throw new Error(`Setup stock IN falló: ${inRes.status} ${JSON.stringify(inRes.body)}`);
  }
  const searchHint =
    item.partNumber?.trim() ||
    item.inventoryCode?.trim() ||
    item.name?.trim()?.slice(0, 12) ||
    item.id.slice(0, 8);
  return {
    itemId: item.id,
    partNumber: item.partNumber,
    inventoryCode: item.inventoryCode,
    searchHint,
    qtyBefore: 10,
  };
}

export async function getTransfer(token: string, transferId: string) {
  return apiJson(token, 'GET', `/inventory-transfers/${transferId}`);
}
