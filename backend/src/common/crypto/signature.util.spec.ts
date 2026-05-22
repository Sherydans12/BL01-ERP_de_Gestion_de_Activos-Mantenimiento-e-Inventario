import {
  generateSignatureHash,
  verifySignatureIntegrity,
  SignaturePayload,
} from './signature.util';

describe('signature.util', () => {
  const payload: SignaturePayload = {
    userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    orderId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    totalAmount: '150000.50',
    status: 'PENDING_APPROVAL',
    timestamp: '2026-05-22T12:00:00.000Z',
    tenantId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  };

  it('generateSignatureHash es determinista para el mismo payload', () => {
    const h1 = generateSignatureHash(payload);
    const h2 = generateSignatureHash(payload);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('cambia el hash si cualquier campo del payload cambia', () => {
    const base = generateSignatureHash(payload);
    const altered = generateSignatureHash({
      ...payload,
      totalAmount: '150000.51',
    });
    expect(altered).not.toBe(base);
  });

  it('verifySignatureIntegrity devuelve true con hash válido', () => {
    const hash = generateSignatureHash(payload);
    expect(verifySignatureIntegrity(hash, payload)).toBe(true);
  });

  it('verifySignatureIntegrity devuelve false con hash alterado', () => {
    const hash = generateSignatureHash(payload);
    expect(
      verifySignatureIntegrity(`${hash.slice(0, -1)}0`, payload),
    ).toBe(false);
  });
});
