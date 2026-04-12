import { createHash } from 'crypto';

export interface SignaturePayload {
  userId: string;
  orderId: string;
  totalAmount: string;
  status: string;
  timestamp: string;
  tenantId: string;
}

export function generateSignatureHash(payload: SignaturePayload): string {
  const raw = [
    payload.userId,
    payload.orderId,
    payload.totalAmount,
    payload.status,
    payload.timestamp,
    payload.tenantId,
  ].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

export function verifySignatureIntegrity(
  storedHash: string,
  payload: SignaturePayload,
): boolean {
  return storedHash === generateSignatureHash(payload);
}
