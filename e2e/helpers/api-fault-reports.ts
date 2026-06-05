import { API_BASE } from './auth';

type ApiJson = Record<string, unknown>;

export type CreateFaultReportPayload = {
  equipmentId: string;
  eventDate: string;
  affectedSystem: string;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH';
  symptomDescription: string;
  meterAtFault?: number;
};

export async function createFaultReportApi(
  token: string,
  payload: CreateFaultReportPayload,
): Promise<{ status: number; body: ApiJson | null }> {
  const res = await fetch(`${API_BASE}/fault-reports`, {
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
    body = text ? (JSON.parse(text) as ApiJson) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}
