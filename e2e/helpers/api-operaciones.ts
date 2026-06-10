import { API_BASE, apiLogin, INVENTARIO_USERS } from './auth';
import {
  getItemLedger,
  getWarehouseStock,
  performStockIn,
  type StockRow,
} from './api-inventario';

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

export type EquipmentRow = {
  id: string;
  internalId: string;
  brand?: string;
  model?: string;
  contractId?: string | null;
  currentMeter?: number | null;
  initialMeter?: number | null;
};

export type WorkOrderRow = {
  id: string;
  correlative?: string;
  status?: string;
  warehouseId?: string | null;
  initialMeter?: number | null;
  finalMeter?: number | null;
  stockReservations?: { itemId: string; quantity: number; warehouseId: string }[];
  parts?: { inventoryItemId?: string; quantity: number }[];
};

export type OtE2ESetup = {
  contractId: string;
  equipmentId: string;
  equipmentLabel: string;
  warehouseId: string;
  itemId: string;
  itemSearchHint: string;
  initialMeter: number;
  mechanicUserId: string;
  planificadorUserId: string;
};

export async function getEquipments(token: string): Promise<EquipmentRow[]> {
  const { status, body } = await apiJson(token, 'GET', '/equipments?page=1&limit=100');
  if (status !== 200 || !body || Array.isArray(body)) return [];
  const data = (body as ApiJson).data;
  return Array.isArray(data) ? (data as EquipmentRow[]) : [];
}

export async function getCatalogSystems(token: string): Promise<{ id: string; code: string; name: string }[]> {
  const { status, body } = await apiJson(token, 'GET', '/catalog?type=SYSTEM');
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as { id: string; code: string; name: string }[];
}

export async function getWorkOrder(token: string, id: string): Promise<WorkOrderRow | null> {
  const { status, body } = await apiJson(token, 'GET', `/work-orders/${id}`);
  if (status !== 200 || !body || Array.isArray(body)) return null;
  return body as WorkOrderRow;
}

export async function patchWorkOrder(token: string, id: string, payload: ApiJson) {
  return apiJson(token, 'PATCH', `/work-orders/${id}`, payload);
}

export async function updateWorkOrderStatus(
  token: string,
  id: string,
  status: string,
  warehouseId?: string,
  closureEquipmentOperational?: boolean,
) {
  return apiJson(token, 'PATCH', `/work-orders/${id}/status`, {
    status,
    warehouseId,
    closureEquipmentOperational,
  });
}

export async function getStockReservations(
  token: string,
  warehouseId: string,
  itemId: string,
) {
  const { status, body } = await apiJson(
    token,
    'GET',
    `/inventory-stock/warehouse/${warehouseId}/item/${itemId}/reservations`,
  );
  if (status !== 200 || !Array.isArray(body)) return [];
  return body as { quantity: number; workOrder?: { id: string; correlative?: string } }[];
}

export async function getStockRow(
  token: string,
  warehouseId: string,
  itemId: string,
): Promise<StockRow & { reservedQuantity?: number; availableQuantity?: number } | null> {
  const rows = await getWarehouseStock(token, warehouseId);
  return rows.find((r) => r.itemId === itemId) ?? null;
}

export async function getUserIdByEmail(email: string): Promise<string | null> {
  const { user } = await apiLogin(email);
  return user.id ?? null;
}

export async function buildOtE2ESetup(planificadorEmail: string): Promise<OtE2ESetup | null> {
  const { token, user } = await apiLogin(planificadorEmail);
  const contractId =
    user.allowedContracts?.find((c: string) => c !== 'ALL') ?? user.allowedContracts?.[0];
  if (!contractId || contractId === 'ALL') return null;

  const equipments = await getEquipments(token);
  const equipment =
    equipments.find((e) => e.contractId === contractId) ??
    equipments.find((e) => e.internalId?.includes('CA')) ??
    equipments[0];
  if (!equipment?.id) return null;

  const whRes = await apiJson(token, 'GET', `/warehouses?contractId=${encodeURIComponent(contractId)}`);
  const warehouses = Array.isArray(whRes.body) ? whRes.body : [];
  const warehouse = warehouses[0] as { id: string } | undefined;
  if (!warehouse?.id) return null;

  let stockRows = await getWarehouseStock(token, warehouse.id);
  let stocked = stockRows.find(
    (r) =>
      Number(r.quantity) >= 5 &&
      Number(r.availableQuantity ?? r.quantity) >= 5,
  );
  if (!stocked) {
    const catalog = await apiJson(token, 'GET', '/inventory-items?page=1&pageSize=5');
    const items =
      catalog.body && !Array.isArray(catalog.body)
        ? ((catalog.body as ApiJson).data as ApiJson[] | undefined)
        : undefined;
    const item = items?.[0] as { id: string } | undefined;
    if (!item?.id) return null;
    const { token: stockToken } = await apiLogin(INVENTARIO_USERS.admin);
    const stockInRes = await performStockIn(stockToken, warehouse.id, item.id, 30, 100);
    if (stockInRes.status >= 300) return null;
    stockRows = await getWarehouseStock(token, warehouse.id);
    stocked = stockRows.find((r) => r.itemId === item.id);
  }
  if (!stocked || Number(stockRows.find((r) => r.itemId === stocked!.itemId)?.availableQuantity ?? stocked.quantity) < 5) {
    return null;
  }

  const itemDetail = await apiJson(token, 'GET', `/inventory-items/${stocked.itemId}`);
  const item = itemDetail.body && !Array.isArray(itemDetail.body)
    ? (itemDetail.body as ApiJson)
    : null;
  const searchHint =
    String(item?.partNumber ?? '').trim() ||
    String(item?.inventoryCode ?? '').trim() ||
    String(item?.name ?? '').trim().slice(0, 12) ||
    stocked.itemId.slice(0, 8);

  const mechanicUserId = await getUserIdByEmail('pbac-operaciones-mecanico@test.com');
  if (!mechanicUserId) return null;

  const initialMeter = Number(
    equipment.currentMeter ?? equipment.initialMeter ?? 1000,
  );

  return {
    contractId,
    equipmentId: equipment.id,
    equipmentLabel: `${equipment.internalId}`,
    warehouseId: warehouse.id,
    itemId: stocked.itemId,
    itemSearchHint: searchHint,
    initialMeter,
    mechanicUserId,
    planificadorUserId: user.id,
  };
}

export async function findWarehouseInOtherContract(
  token: string,
  excludeContractId: string,
): Promise<{ id: string; contractId: string } | null> {
  const { token: adminToken } = await apiLogin(INVENTARIO_USERS.admin);
  const { status, body } = await apiJson(adminToken, 'GET', '/warehouses');
  if (status !== 200 || !Array.isArray(body)) return null;
  const hit = (body as { id: string; contractId: string }[]).find(
    (w) => w.contractId && w.contractId !== excludeContractId,
  );
  return hit ?? null;
}

export { getItemLedger };
