import type { APIRequestContext } from '@playwright/test';
import { API_BASE, apiLogin } from './auth';
import { performStockIn, getCategoryChildren, getCategoryFamilies } from './api-inventario';
import {
  createEquipmentApi,
  createInventoryItemApi,
  createWarehouseApi,
  deleteEquipmentApi,
  deleteInventoryItemApi,
  deleteWarehouseApi,
  findUnitAllowingDecimals,
  requestJson,
  resolveContractIdForUser,
  type MeterLogRow,
} from './api-operations-lifecycle';

type ApiJson = Record<string, unknown>;

export type ChaosFixture = {
  runId: string;
  contractId: string;
  mainWarehouseId: string;
  mobileWarehouseId: string;
  itemId: string;
  itemPartNumber: string;
  equipmentId: string;
  equipmentInternalId: string;
  familyId: string;
  categoryId: string;
  unitId: string;
};

export type LubeReportApiPayload = {
  contractId: string;
  equipmentId: string;
  warehouseId: string;
  dispatchDate: string;
  meterReading?: number;
  lines: { itemId: string; quantity: number; confirmedLargeDispatch?: boolean }[];
};

export type BulkMeterItem = {
  equipmentId: string;
  newReading: number;
  confirmedLargeJump?: boolean;
};

export type BulkMeterResult = {
  successCount: number;
  unchangedCount: number;
  errors: {
    equipmentId: string;
    error: string;
    serverValue?: number;
    delta?: number;
  }[];
  applied: { equipmentId: string; internalId: string; from: number; to: number }[];
};

export async function bootstrapChaosFixture(adminEmail: string): Promise<ChaosFixture | null> {
  const { token, user } = await apiLogin(adminEmail);
  const contractId = await resolveContractIdForUser(token, user);
  if (!contractId) return null;

  const whRes = await fetch(`${API_BASE}/warehouses?contractId=${encodeURIComponent(contractId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const warehouses = (await whRes.json()) as { id: string; code: string }[];
  const mainWh = warehouses[0];
  if (!mainWh?.id) return null;

  const runId = `chaos-${Date.now().toString(36)}`;
  const mobile = await createWarehouseApi(token, {
    code: `CAM-${runId.slice(-6).toUpperCase()}`,
    name: `Camión Lubricador Caos ${runId}`,
    contractId,
    location: 'E2E chaos',
  });
  if (!mobile?.id) return null;

  const unit = await findUnitAllowingDecimals(token);
  if (!unit) return null;
  const families = await getCategoryFamilies(token);
  if (!families.length) return null;
  const family = families.find((f) => /lubric|aceite|fluido/i.test(f.name)) ?? families[0];
  const children = await getCategoryChildren(token, family.id);
  if (!children.length) return null;

  const partNumber = `CHAOS-OIL-${runId.slice(-5).toUpperCase()}`;
  const item = await createInventoryItemApi(token, {
    name: `Aceite caos E2E ${runId}`,
    partNumber,
    categoryId: children[0].id,
    unitOfMeasureId: unit.id,
  });
  if (!item?.id) return null;

  const stockIn = await performStockIn(token, mobile.id, item.id, 10, 100);
  if (stockIn.status >= 300) return null;

  const equipmentInternalId = `ACT-CHAOS-${runId.slice(-6).toUpperCase()}`;
  const equipment = await createEquipmentApi(token, {
    contractId,
    internalId: equipmentInternalId,
    initialMeter: 5000,
    currentMeter: 5000,
  });
  if (!equipment?.id) return null;

  return {
    runId,
    contractId,
    mainWarehouseId: mainWh.id,
    mobileWarehouseId: mobile.id,
    itemId: item.id,
    itemPartNumber: partNumber,
    equipmentId: equipment.id,
    equipmentInternalId,
    familyId: family.id,
    categoryId: children[0].id,
    unitId: unit.id,
  };
}

export async function teardownChaosFixture(
  adminToken: string,
  fx: ChaosFixture,
  extraEquipmentIds: string[] = [],
): Promise<void> {
  for (const eqId of extraEquipmentIds) {
    await deleteEquipmentApi(adminToken, eqId).catch(() => {});
  }
  await deleteInventoryItemApi(adminToken, fx.itemId).catch(() => {});
  await deleteWarehouseApi(adminToken, fx.mobileWarehouseId).catch(() => {});
  await deleteEquipmentApi(adminToken, fx.equipmentId).catch(() => {});
}

export async function createLubeReportApi(
  token: string,
  payload: LubeReportApiPayload,
): Promise<{ status: number; body: ApiJson | null }> {
  const res = await fetch(`${API_BASE}/lube-reports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: ApiJson | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export async function postLubeReportsConcurrently(
  token: string,
  payloadA: LubeReportApiPayload,
  payloadB: LubeReportApiPayload,
): Promise<{ statusA: number; statusB: number; bodyA: ApiJson | null; bodyB: ApiJson | null }> {
  const [resA, resB] = await Promise.all([
    createLubeReportApi(token, payloadA),
    createLubeReportApi(token, payloadB),
  ]);
  return {
    statusA: resA.status,
    statusB: resB.status,
    bodyA: resA.body,
    bodyB: resB.body,
  };
}

export async function getPhysicalStockQty(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  itemId: string,
): Promise<number> {
  const { status, body } = await requestJson(
    request,
    token,
    'GET',
    `/inventory-stock/warehouse/${warehouseId}`,
  );
  if (status !== 200 || !Array.isArray(body)) return NaN;
  const row = (body as { itemId: string; quantity: number }[]).find((r) => r.itemId === itemId);
  return Number(row?.quantity ?? NaN);
}

export async function sumLedgerOutQuantity(
  request: APIRequestContext,
  token: string,
  itemId: string,
  warehouseId: string,
): Promise<number> {
  const { status, body } = await requestJson(
    request,
    token,
    'GET',
    `/inventory-items/${itemId}/ledger?warehouseId=${warehouseId}&pageSize=100`,
  );
  if (status !== 200 || !body || Array.isArray(body)) return 0;
  const data = (body as ApiJson).data;
  if (!Array.isArray(data)) return 0;
  return (data as { type: string; quantity: number }[])
    .filter((r) => r.type === 'OUT' || r.type === 'TRANSFER_OUT')
    .reduce((s, r) => s + Math.abs(Number(r.quantity)), 0);
}

export async function createWorkOrderApi(
  token: string,
  payload: ApiJson,
): Promise<{ status: number; body: ApiJson | null }> {
  const res = await fetch(`${API_BASE}/work-orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: ApiJson | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export async function patchWorkOrderPartsApi(
  token: string,
  workOrderId: string,
  parts: { inventoryItemId: string; quantity: number; partNumber?: string; description?: string }[],
): Promise<number> {
  const res = await fetch(`${API_BASE}/work-orders/${workOrderId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ parts }),
  });
  return res.status;
}

export async function getStockReservationsApi(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  itemId: string,
  workOrderId?: string,
): Promise<{ quantity: number; workOrderId?: string }[]> {
  const { status, body } = await requestJson(
    request,
    token,
    'GET',
    `/inventory-stock/warehouse/${warehouseId}/item/${itemId}/reservations`,
  );
  if (status !== 200 || !Array.isArray(body)) return [];
  const rows = body as { quantity: number; workOrder?: { id: string } }[];
  return rows
    .filter((r) => !workOrderId || r.workOrder?.id === workOrderId)
    .map((r) => ({ quantity: Number(r.quantity), workOrderId: r.workOrder?.id }));
}

export async function bulkSyncMeterReadingsApi(
  token: string,
  items: BulkMeterItem[],
  contractId?: string,
): Promise<{ status: number; body: BulkMeterResult | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (contractId) headers['x-site-id'] = contractId;

  const res = await fetch(`${API_BASE}/equipments/meter-readings/bulk-sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ items }),
  });
  const text = await res.text();
  let body: BulkMeterResult | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export async function createMeterBoardEquipments(
  adminToken: string,
  contractId: string,
  runId: string,
  count: number,
): Promise<{ id: string; internalId: string; currentMeter: number }[]> {
  const out: { id: string; internalId: string; currentMeter: number }[] = [];
  for (let i = 0; i < count; i++) {
    const currentMeter = 1000 + i * 10;
    const internalId = `CHAOS-M-${runId.slice(-4)}-${String(i + 1).padStart(2, '0')}`;
    const eq = await createEquipmentApi(adminToken, {
      contractId,
      internalId,
      initialMeter: currentMeter,
      currentMeter,
    });
    if (eq?.id) {
      out.push({ id: eq.id, internalId, currentMeter });
    }
  }
  return out;
}

export async function getEquipmentCurrentMeter(
  request: APIRequestContext,
  token: string,
  equipmentId: string,
): Promise<number | null> {
  const { status, body } = await requestJson(request, token, 'GET', `/equipments/${equipmentId}`);
  if (status !== 200 || !body || Array.isArray(body)) return null;
  return Number((body as ApiJson).currentMeter ?? null);
}

export function sortMeterLogsByDateAsc(logs: MeterLogRow[]): MeterLogRow[] {
  return [...logs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function sortMeterLogsByIdDesc(logs: MeterLogRow[]): MeterLogRow[] {
  return [...logs].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export async function fetchCatalogSystemId(token: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/catalogs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { id: string; type?: string }[];
  return rows.find((r) => String(r.type ?? '').toUpperCase() === 'SYSTEM')?.id ?? rows[0]?.id ?? null;
}
