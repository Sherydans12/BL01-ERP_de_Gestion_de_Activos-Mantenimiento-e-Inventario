import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { loadOperationalConfigForJwt } from './jwt-operational-config.util';

describe('loadOperationalConfigForJwt', () => {
  let prisma: DeepMockProxy<PrismaService>;
  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
  });

  it('devuelve null sin tenantId', async () => {
    await expect(loadOperationalConfigForJwt(prisma, null)).resolves.toBeNull();
  });

  it('devuelve defaults si no hay fila persistida', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(null);
    const cfg = await loadOperationalConfigForJwt(prisma, tenantId);
    expect(cfg?.hasNightShift).toBe(true);
    expect(cfg?.dayShiftStartTime).toBe('08:00');
  });

  it('devuelve fila del tenant', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue({
      hasNightShift: false,
      dayShiftStartTime: '07:00',
      nightShiftStartTime: '19:00',
      blockNegativeStock: true,
    } as never);
    const cfg = await loadOperationalConfigForJwt(prisma, tenantId);
    expect(cfg).toEqual({
      hasNightShift: false,
      dayShiftStartTime: '07:00',
      nightShiftStartTime: '19:00',
      blockNegativeStock: true,
    });
  });
});
