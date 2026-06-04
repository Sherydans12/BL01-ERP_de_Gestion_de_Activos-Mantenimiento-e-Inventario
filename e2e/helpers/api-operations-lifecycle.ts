import type { APIRequestContext } from '@playwright/test';
import { API_BASE, apiLogin, OPERACIONES_USERS } from './auth';
import {
  getCategoryChildren,
  getCategoryFamilies,
  getUnits,
  getWarehouseStock,
  type StockRow,
} from './api-inventario';
import type { EquipmentRow, WorkOrderRow } from './api-operaciones';

type ApiJson = Record<string, unknown>;

export type MeterLogRow = {
  id: string;
  oldValue: number;
  newValue: number;
  source: string;
  sourceId?: string | null;
  date: string;
  workOrderCorrelative?: string | null;
  user?: { name?: string; email?: string };
};

export type OperationsLifecycleSeed = {
  runId: string;
  contractId: string;
  mainWarehouseId: string;
  mainWarehouseCode: string;
  mobileWarehouseId: string;
  mobileWarehouseCode: string;
  familyId: string;
  categoryId: string;
  unitId: string;
  itemId: string;
  itemPartNumber: string;
  itemSearchHint: string;
  equipmentId: string;
  equipmentInternalId: string;
  initialMeter: number;
  meterAfterBootstrap: number;
  meterAfterM1: number;
  meterAfterOt: number;
  m1DispatchQty: number;
  transferQty: number;
  stockInQty: number;
  otConsumeQty: number;
};

export async function resolveContractIdForUser(
  token: string,
  user: { role?: string; allowedContracts?: string[] },
): Promise<string | null> {
  const fromJwt = user.allowedContracts?.find((c) => c !== 'ALL');
  if (fromJwt) return fromJwt;

  const contractsRes = await fetch(`${API_BASE}/contracts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (contractsRes.ok) {
    const contracts = (await contractsRes.json()) as {
      id: string;
      code?: string;
      isActive?: boolean;
    }[];
    const primary = contracts
      .filter((c) => c.isActive !== false)
      .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))[0];
    if (primary?.id) return primary.id;
  }

  const res = await fetch(`${API_BASE}/warehouses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const warehouses = (await res.json()) as { contractId?: string }[];
  const hit = warehouses.find((w) => w.contractId);
  return hit?.contractId ?? null;
}

/** Contrato primario PBAC operaciones (misma lógica que seed-operaciones-pbac-personas). */
export async function resolveE2EPrimaryContractId(): Promise<string | null> {
  const { token, user } = await apiLogin(OPERACIONES_USERS.planificador);
  return resolveContractIdForUser(token, user);
}

const DEFAULTS = {
  stockInQty: 100,
  transferQty: 40,
  m1DispatchQty: 8.5,
  otConsumeQty: 2,
  meterBootstrapFrom: 4988,
  meterBootstrapTo: 5000,
  meterAfterM1: 5018,
  meterAfterOt: 5030,
} as const;

async function apiJson(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  contractId?: string,
): Promise<{ status: number; body: ApiJson | ApiJson[] | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (contractId) headers['x-site-id'] = contractId;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
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

/** Cliente Playwright `request` para aserciones post-acción (persistencia en BD vía API). */
export async function requestJson(
  request: APIRequestContext,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: ApiJson | ApiJson[] | null }> {
  const headers = { Authorization: `Bearer ${token}` };
  const url = `${API_BASE}${path}`;
  const res = await request.fetch(url, {
    method,
    headers: body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
    data: body,
  });
  const text = await res.text();
  let json: ApiJson | ApiJson[] | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status(), body: json };
}

export async function findUnitAllowingDecimals(
  token: string,
): Promise<{ id: string; abbreviation: string } | null> {
  const { status, body } = await apiJson(token, 'GET', '/units-of-measure');
  if (status !== 200 || !Array.isArray(body)) return null;
  const units = body as { id: string; abbreviation: string; allowsDecimals?: boolean }[];
  const fluid = units.find(
    (u) =>
      u.allowsDecimals &&
      /^(LT|L|LTR|LITRO|LITROS)$/i.test(String(u.abbreviation ?? '').trim()),
  );
  if (fluid) return { id: fluid.id, abbreviation: fluid.abbreviation };
  const anyDecimal = units.find((u) => u.allowsDecimals);
  return anyDecimal ? { id: anyDecimal.id, abbreviation: anyDecimal.abbreviation } : null;
}

export async function createWarehouseApi(
  token: string,
  payload: { code: string; name: string; contractId: string; location?: string },
): Promise<{ id: string; code: string } | null> {
  const { status, body } = await apiJson(token, 'POST', '/warehouses', payload);
  if (status >= 300 || !body || Array.isArray(body)) return null;
  const row = body as { id?: string; code?: string };
  return row.id ? { id: row.id, code: String(row.code ?? payload.code) } : null;
}

export async function deleteWarehouseApi(token: string, warehouseId: string): Promise<number> {
  const { status } = await apiJson(token, 'DELETE', `/warehouses/${warehouseId}`);
  return status;
}

export async function createInventoryItemApi(
  token: string,
  payload: {
    name: string;
    partNumber: string;
    categoryId: string;
    unitOfMeasureId: string;
  },
): Promise<{ id: string; partNumber: string; inventoryCode?: string } | null> {
  const { status, body } = await apiJson(token, 'POST', '/inventory-items', payload);
  if (status >= 300 || !body || Array.isArray(body)) return null;
  const row = body as { id?: string; partNumber?: string; inventoryCode?: string };
  if (!row.id) return null;
  return {
    id: row.id,
    partNumber: String(row.partNumber ?? payload.partNumber),
    inventoryCode: row.inventoryCode,
  };
}

export async function deleteInventoryItemApi(token: string, itemId: string): Promise<number> {
  const { status } = await apiJson(token, 'DELETE', `/inventory-items/${itemId}`);
  return status;
}

export async function createEquipmentApi(
  token: string,
  payload: {
    contractId: string;
    internalId: string;
    initialMeter: number;
    currentMeter: number;
  },
): Promise<EquipmentRow | null> {
  const { status, body } = await apiJson(token, 'POST', '/equipments', {
    contractId: payload.contractId,
    internalId: payload.internalId,
    type: 'Camión Extracción',
    brand: 'E2E',
    model: 'Lifecycle',
    meterType: 'HOURS',
    initialMeter: payload.initialMeter,
    currentMeter: payload.currentMeter,
    isOperational: true,
  });
  if (status >= 300 || !body || Array.isArray(body)) return null;
  return body as EquipmentRow;
}

export async function deleteEquipmentApi(token: string, equipmentId: string): Promise<number> {
  const { status } = await apiJson(token, 'DELETE', `/equipments/${equipmentId}`);
  return status;
}

export async function executeTransferApi(
  token: string,
  originWarehouseId: string,
  destinationWarehouseId: string,
  itemId: string,
  quantity: number,
): Promise<{ transferId: string } | null> {
  const ship = await apiJson(token, 'POST', '/inventory-transfers', {
    originWarehouseId,
    destinationWarehouseId,
    lines: [{ itemId, quantity }],
  });
  if (ship.status >= 300 || !ship.body || Array.isArray(ship.body)) return null;
  const transferId = String((ship.body as ApiJson).id ?? '');
  if (!transferId) return null;

  const recv = await apiJson(token, 'POST', `/inventory-transfers/${transferId}/receive`);
  if (recv.status >= 300) return null;
  return { transferId };
}

export async function getStockRowApi(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  itemId: string,
): Promise<StockRow | null> {
  const { status, body } = await requestJson(
    request,
    token,
    'GET',
    `/inventory-stock/warehouse/${warehouseId}`,
  );
  if (status !== 200 || !Array.isArray(body)) return null;
  const rows = body as StockRow[];
  return rows.find((r) => r.itemId === itemId) ?? null;
}

export async function getEquipmentAnalyticsApi(
  request: APIRequestContext,
  token: string,
  equipmentId: string,
): Promise<{ equipment?: EquipmentRow; meterLogs?: MeterLogRow[] } | null> {
  const { status, body } = await requestJson(
    request,
    token,
    'GET',
    `/equipments/${equipmentId}/analytics`,
  );
  if (status !== 200 || !body || Array.isArray(body)) return null;
  const analytics = body as {
    equipment?: EquipmentRow;
    meterLogs?: MeterLogRow[];
  };
  return analytics;
}

export async function getMeterLogsChronological(
  request: APIRequestContext,
  token: string,
  equipmentId: string,
): Promise<MeterLogRow[]> {
  const analytics = await getEquipmentAnalyticsApi(request, token, equipmentId);
  const logs = analytics?.meterLogs ?? [];
  return [...logs].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

export async function getWorkOrderApi(
  request: APIRequestContext,
  token: string,
  workOrderId: string,
): Promise<WorkOrderRow | null> {
  const { status, body } = await requestJson(request, token, 'GET', `/work-orders/${workOrderId}`);
  if (status !== 200 || !body || Array.isArray(body)) return null;
  return body as WorkOrderRow;
}

export async function patchWorkOrderApi(
  token: string,
  workOrderId: string,
  payload: ApiJson,
  contractId?: string,
): Promise<number> {
  const { status } = await apiJson(
    token,
    'PATCH',
    `/work-orders/${workOrderId}`,
    payload,
    contractId,
  );
  return status;
}

export async function updateWorkOrderStatusApi(
  token: string,
  workOrderId: string,
  status: string,
  warehouseId?: string,
  closureEquipmentOperational?: boolean,
  extras?: {
    confirmedLargeJump?: boolean;
    confirmedLargeFluidDispatch?: boolean;
    contractId?: string;
  },
): Promise<{ status: number; body: ApiJson | null }> {
  const { contractId, ...statusExtras } = extras ?? {};
  const res = await apiJson(
    token,
    'PATCH',
    `/work-orders/${workOrderId}/status`,
    {
      status,
      warehouseId,
      closureEquipmentOperational,
      ...statusExtras,
    },
    contractId,
  );
  return { status: res.status, body: res.body && !Array.isArray(res.body) ? res.body : null };
}

/**
 * Prepara contrato, bodega principal, equipo ACT-01 efímero y metadatos de categoría/UoM.
 * La bodega móvil y el artículo se crean en el spec (UI o API según fase).
 */
export async function bootstrapOperationsLifecycleSeed(
  adminEmail: string,
): Promise<OperationsLifecycleSeed | null> {
  const contractId = await resolveE2EPrimaryContractId();
  if (!contractId) return null;

  const { token, user } = await apiLogin(adminEmail);
  void user;

  const whRes = await apiJson(token, 'GET', `/warehouses?contractId=${encodeURIComponent(contractId)}`);
  const warehouses = Array.isArray(whRes.body) ? whRes.body : [];
  const mainWh = warehouses[0] as { id: string; code: string } | undefined;
  if (!mainWh?.id) return null;

  const runId = Date.now().toString(36);
  const equipmentInternalId = `ACT-01-E2E-${runId}`;

  const equipment = await createEquipmentApi(token, {
    contractId,
    internalId: equipmentInternalId,
    initialMeter: DEFAULTS.meterBootstrapFrom,
    currentMeter: DEFAULTS.meterBootstrapTo,
  });
  if (!equipment?.id) return null;

  const unit = await findUnitAllowingDecimals(token);
  if (!unit) return null;

  const families = await getCategoryFamilies(token);
  if (!families.length) return null;
  const lubeFamily =
    families.find((f) => /lubric|aceite|grasa|fluido/i.test(f.name)) ?? families[0];
  const children = await getCategoryChildren(token, lubeFamily.id);
  const categoryId = children[0]?.id;
  if (!categoryId) return null;

  const partNumber = `E2E-OIL-${runId.slice(-6).toUpperCase()}`;

  return {
    runId,
    contractId,
    mainWarehouseId: mainWh.id,
    mainWarehouseCode: mainWh.code,
    mobileWarehouseId: '',
    mobileWarehouseCode: '',
    familyId: lubeFamily.id,
    categoryId,
    unitId: unit.id,
    itemId: '',
    itemPartNumber: partNumber,
    itemSearchHint: partNumber,
    equipmentId: equipment.id,
    equipmentInternalId,
    initialMeter: DEFAULTS.meterBootstrapFrom,
    meterAfterBootstrap: DEFAULTS.meterBootstrapTo,
    meterAfterM1: DEFAULTS.meterAfterM1,
    meterAfterOt: DEFAULTS.meterAfterOt,
    m1DispatchQty: DEFAULTS.m1DispatchQty,
    transferQty: DEFAULTS.transferQty,
    stockInQty: DEFAULTS.stockInQty,
    otConsumeQty: DEFAULTS.otConsumeQty,
  };
}

export async function assertStockQuantity(
  request: APIRequestContext,
  token: string,
  warehouseId: string,
  itemId: string,
  expectedQty: number,
  tolerance = 0.01,
): Promise<StockRow | null> {
  const row = await getStockRowApi(request, token, warehouseId, itemId);
  if (!row) return null;
  const qty = Number(row.quantity ?? 0);
  if (Math.abs(qty - expectedQty) > tolerance) {
    throw new Error(
      `Stock mismatch wh=${warehouseId} item=${itemId}: expected ${expectedQty}, got ${qty}`,
    );
  }
  return row;
}

export { getWarehouseStock, getUnits, DEFAULTS as LIFECYCLE_DEFAULTS };
