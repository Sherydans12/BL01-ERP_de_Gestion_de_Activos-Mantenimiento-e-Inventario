import type { Page } from '@playwright/test';

export const API_BASE = (process.env.E2E_API_BASE || 'http://localhost:3000/api').replace(/\/$/, '');
export const TENANT_CODE = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
export const PASSWORD = (process.env.PBAC_TEST_PASSWORD || 'Test1234!').trim();

export const PBAC_USERS = {
  vacio: 'pbac-compras-vacio@test.com',
  solicitante: 'pbac-compras-solicitante@test.com',
  comprador: 'pbac-compras-comprador@test.com',
  aprobador1: 'pbac-compras-aprobador1@test.com',
  aprobador2: 'pbac-compras-aprobador2@test.com',
  bodega: 'pbac-compras-bodega@test.com',
  tesoreria: 'pbac-compras-tesoreria@test.com',
  config: 'pbac-compras-config@test.com',
  lectura: 'pbac-compras-lectura@test.com',
  enAclSinApprove: 'pbac-compras-en-acl-sin-approve@test.com',
  approveFueraAcl: 'pbac-compras-approve-fuera-acl@test.com',
  sinContrato: 'pbac-compras-sin-contrato@test.com',
  adminCompras: 'pbac-compras-admin-compras@test.com',
} as const;

async function fetchCaptcha(attempt = 0) {
  if (attempt > 0) {
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  const res = await fetch(`${API_BASE}/auth/captcha`);
  if (res.status === 429 && attempt < 6) {
    return fetchCaptcha(attempt + 1);
  }
  if (!res.ok) throw new Error(`CAPTCHA HTTP ${res.status}`);
  const data = (await res.json()) as { challengeId: string; question: string };
  const m = String(data.question).match(/(\d+)\s*\+\s*(\d+)/);
  if (!m) throw new Error(`CAPTCHA no parseable: ${data.question}`);
  return { challengeId: data.challengeId, answer: Number(m[1]) + Number(m[2]) };
}

function decodeJwtPermissions(token: string): string[] {
  const part = token.split('.')[1];
  const json = Buffer.from(part, 'base64url').toString('utf8');
  const payload = JSON.parse(json) as { permissions?: string[] };
  return Array.isArray(payload.permissions) ? payload.permissions : [];
}

export async function apiLogin(email: string, attempt = 0) {
  if (attempt > 0) {
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
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
  const body = (await res.json()) as {
    access_token?: string;
    user?: {
      id: string;
      email: string;
      name: string;
      role: string;
      allowedContracts?: string[];
      [key: string]: unknown;
    };
    message?: string;
  };
  if (res.status === 429 && attempt < 6) {
    return apiLogin(email, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Login ${email}: ${res.status} ${JSON.stringify(body)}`);
  }
  const token = body.access_token;
  const user = body.user;
  if (!token || !user) throw new Error(`Login ${email}: respuesta incompleta`);
  return { token, user, permissions: decodeJwtPermissions(token) };
}

async function loginWithRetry(email: string) {
  return apiLogin(email);
}

export async function seedBrowserSession(page: Page, email: string) {
  const { token, user, permissions } = await loginWithRetry(email);
  const userWithPermissions = { ...user, permissions };
  let contractId = 'ALL';
  if (
    user.role !== 'ADMIN' &&
    user.role !== 'SUPER_ADMIN' &&
    user.allowedContracts?.length &&
    !user.allowedContracts.includes('ALL')
  ) {
    contractId = user.allowedContracts[0];
  }

  await page.goto('/auth/login');
  await page.evaluate(
    ({ token: t, userJson, cid }) => {
      localStorage.setItem('tpm_token', t);
      localStorage.setItem('tpm_user', userJson);
      localStorage.setItem('tpm_contract_id', cid);
    },
    { token, userJson: JSON.stringify(userWithPermissions), cid: contractId },
  );
  await page.goto('/app/dashboard');
  await page.waitForURL(/\/app\//, { timeout: 30_000 });
}

export async function findPendingPurchaseOrderId(email: string): Promise<string | null> {
  const { token } = await apiLogin(email);
  const res = await fetch(`${API_BASE}/purchase-orders?status=PENDING_APPROVAL&pageSize=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { id: string }[]; items?: { id: string }[] };
  const row = body.data?.[0] ?? body.items?.[0];
  return row?.id ?? null;
}
