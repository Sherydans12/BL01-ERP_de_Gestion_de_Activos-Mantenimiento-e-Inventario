import { API_BASE } from './auth';

type ApiJson = Record<string, unknown>;

export type TenantOperationalSnapshot = {
  hasNightShift?: boolean;
  dayShiftStartTime?: string;
  nightShiftStartTime?: string;
  blockNegativeStock?: boolean;
};

async function parseJson(res: Response): Promise<ApiJson | null> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as ApiJson) : null;
  } catch {
    return null;
  }
}

/** Lee `operationalConfig` del tenant autenticado (null = defaults en app). */
export async function getOperationalConfig(
  token: string,
): Promise<TenantOperationalSnapshot | null> {
  const res = await fetch(`${API_BASE}/tenant-config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = await parseJson(res);
  const cfg = body?.operationalConfig;
  if (!cfg || typeof cfg !== 'object') return null;
  return cfg as TenantOperationalSnapshot;
}

export async function patchOperationalConfig(
  token: string,
  patch: Partial<TenantOperationalSnapshot>,
): Promise<{ status: number; body: ApiJson | null }> {
  const res = await fetch(`${API_BASE}/tenant-config/operational`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  return { status: res.status, body: await parseJson(res) };
}

export async function setBlockNegativeStock(
  token: string,
  enabled: boolean,
): Promise<number> {
  const { status } = await patchOperationalConfig(token, {
    blockNegativeStock: enabled,
  });
  return status;
}
