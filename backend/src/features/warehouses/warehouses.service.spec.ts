import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehousesService } from './warehouses.service';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const contractA = '22222222-2222-2222-2222-222222222222';
  const contractB = '33333333-3333-3333-3333-333333333333';
  const contractForeign = '44444444-4444-4444-4444-444444444444';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(WarehousesService);
  });

  it('scope transfer devuelve todas las bodegas de contratos permitidos para USER', async () => {
    prisma.warehouse.findMany.mockResolvedValue([] as never);

    await service.findAll(
      {
        tenantId,
        role: 'USER',
        allowedContracts: [contractA, contractB],
      },
      contractA,
      { scope: 'transfer' },
    );

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          contractId: { in: [contractA, contractB] },
        },
      }),
    );
  });

  it('scope transfer devuelve todo el tenant para ADMIN aunque exista header de contrato', async () => {
    prisma.warehouse.findMany.mockResolvedValue([] as never);

    await service.findAll(
      { tenantId, role: 'ADMIN', allowedContracts: ['ALL'] },
      contractA,
      { scope: 'transfer' },
    );

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId },
      }),
    );
  });

  it('usuario no admin sin contratos no obtiene bodegas con contractFilter explicito', async () => {
    prisma.warehouse.findMany.mockResolvedValue([] as never);

    await service.findAll(
      { tenantId, role: 'USER', allowedContracts: [] },
      contractForeign,
    );

    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          contractId: '00000000-0000-0000-0000-000000000000',
        },
      }),
    );
  });
});
