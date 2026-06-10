import { API_BASE } from './auth';

type ApiJson = Record<string, unknown>;

export type ShiftBoardTab = 'ALL' | 'REPORTED' | 'PENDING' | 'EXCLUDED';

export type BatchAvailabilityRow = {
  equipmentId: string;
  status: string;
  meterReading?: number;
  comments?: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export { todayIsoDate };

async function parseJson(res: Response): Promise<ApiJson | null> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as ApiJson) : null;
  } catch {
    return null;
  }
}

export async function getShiftBoard(
  token: string,
  query: {
    date?: string;
    shift?: string;
    contractId?: string;
    search?: string;
    tab?: ShiftBoardTab;
    page?: number;
    pageSize?: number;
  },
): Promise<{ status: number; body: ApiJson | null }> {
  const params = new URLSearchParams();
  params.set('date', query.date ?? todayIsoDate());
  if (query.shift) params.set('shift', query.shift);
  if (query.contractId) params.set('contractId', query.contractId);
  if (query.search) params.set('search', query.search);
  if (query.tab) params.set('tab', query.tab);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));

  const res = await fetch(`${API_BASE}/equipment-availability/shift-board?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await parseJson(res) };
}

export async function exportAvailabilityTemplate(
  token: string,
  query: { reportDate?: string; shift?: string },
): Promise<{ status: number; contentType: string | null }> {
  const params = new URLSearchParams();
  params.set('reportDate', query.reportDate ?? todayIsoDate());
  if (query.shift) params.set('shift', query.shift);

  const res = await fetch(`${API_BASE}/equipment-availability/export?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
  };
}

export async function batchCreateAvailability(
  token: string,
  payload: {
    reportDate: string;
    shift?: string;
    rows: BatchAvailabilityRow[];
  },
): Promise<{ status: number; body: ApiJson | null }> {
  const res = await fetch(`${API_BASE}/equipment-availability/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await parseJson(res) };
}
