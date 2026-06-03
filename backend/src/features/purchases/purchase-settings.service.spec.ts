import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchaseSettingsService } from './purchase-settings.service';

describe('PurchaseSettingsService', () => {
  let service: PurchaseSettingsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const settingsId = '22222222-2222-2222-2222-222222222222';
  const userId1 = '33333333-3333-3333-3333-333333333333';
  const userId2 = '44444444-4444-4444-4444-444444444444';

  const baseSettings = {
    id: settingsId,
    tenantId,
    approvalThreshold: 0,
    currency: 'CLP',
    approvalPolicies: [],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseSettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PurchaseSettingsService);

    prisma.purchaseSettings.findUnique.mockResolvedValue(baseSettings as never);
    prisma.user.findMany.mockResolvedValue([
      { id: userId1 },
      { id: userId2 },
    ] as never);
  });

  describe('upsertPolicies — validaciones previas a transacción', () => {
    it('rechaza niveles duplicados en el payload', async () => {
      await expect(
        service.upsertPolicies(tenantId, [
          { level: 1, userIds: [userId1] },
          { level: 1, userIds: [userId2] },
        ]),
      ).rejects.toThrow('Cada nivel debe aparecer solo una vez');
    });

    it('rechaza nivel sin usuarios autorizados', async () => {
      await expect(
        service.upsertPolicies(tenantId, [
          { level: 1, userIds: [] },
          { level: 2, userIds: [userId1] },
        ]),
      ).rejects.toThrow(/nivel 1 no tiene usuarios autorizados/);
    });

    it('rechaza userIds que no pertenecen al tenant', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: userId1 }] as never);

      await expect(
        service.upsertPolicies(tenantId, [
          { level: 1, userIds: [userId1, userId2] },
        ]),
      ).rejects.toThrow(/no pertenecen al tenant/);
    });
  });

  describe('getSettings', () => {
    it('crea PurchaseSettings por defecto si el tenant no tiene fila', async () => {
      prisma.purchaseSettings.findUnique.mockResolvedValue(null);
      prisma.purchaseSettings.create.mockResolvedValue({
        ...baseSettings,
        approvalPolicies: [],
      } as never);

      const settings = await service.getSettings(tenantId);

      expect(prisma.purchaseSettings.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            currency: 'CLP',
            invoiceMatchTolerancePercent: 1,
          }),
        }),
      );
      expect(settings.tenantId).toBe(tenantId);
    });
  });

  describe('updateSettings', () => {
    it('actualiza moneda y tolerancia 3-way', async () => {
      prisma.purchaseSettings.update.mockResolvedValue({
        ...baseSettings,
        currency: 'USD',
        invoiceMatchTolerancePercent: 2.5,
        approvalPolicies: [],
      } as never);

      const updated = await service.updateSettings(tenantId, {
        currency: 'USD',
        invoiceMatchTolerancePercent: 2.5,
      });

      expect(prisma.purchaseSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            approvalThreshold: undefined,
            currency: 'USD',
            invoiceMatchTolerancePercent: 2.5,
          },
        }),
      );
      expect(updated.currency).toBe('USD');
      expect(updated.invoiceMatchTolerancePercent).toBe(2.5);
    });
  });

  describe('upsertPolicies — transacción', () => {
    it('reemplaza ACL por nivel (deleteMany + createMany) y devuelve políticas ordenadas', async () => {
      const policyL1 = {
        id: 'pol-1',
        level: 1,
        purchaseSettingsId: settingsId,
        tenantId,
        minAmount: 0,
      };

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.approvalPolicy.findMany.mockResolvedValue([policyL1] as never);
        tx.approvalPolicy.update.mockResolvedValue(policyL1 as never);
        tx.approvalPolicyUser.deleteMany.mockResolvedValue({ count: 1 });
        tx.approvalPolicyUser.createMany.mockResolvedValue({ count: 1 });
        tx.approvalPolicy.findMany
          .mockResolvedValueOnce([policyL1] as never)
          .mockResolvedValueOnce([
            {
              ...policyL1,
              allowedUsers: [{ userId: userId1, user: { id: userId1 } }],
            },
          ] as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.upsertPolicies(tenantId, [
        {
          level: 1,
          description: 'Gerencia',
          userIds: [userId1],
          minAmount: 5000,
        },
      ]);

      expect(tx.approvalPolicyUser.deleteMany).toHaveBeenCalledWith({
        where: { policyId: 'pol-1' },
      });
      expect(tx.approvalPolicyUser.createMany).toHaveBeenCalledWith({
        data: [{ policyId: 'pol-1', userId: userId1, tenantId }],
        skipDuplicates: true,
      });
      expect(result).toHaveLength(1);
    });

    it('rechaza eliminar nivel con aprobaciones históricas en OC', async () => {
      const policyL1 = { id: 'pol-1', level: 1 };
      const policyL2 = { id: 'pol-2', level: 2 };

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.approvalPolicy.findMany.mockResolvedValue([
          policyL1,
          policyL2,
        ] as never);
        tx.approvalPolicy.update.mockResolvedValue({} as never);
        tx.approvalPolicyUser.deleteMany.mockResolvedValue({ count: 0 });
        tx.approvalPolicyUser.createMany.mockResolvedValue({ count: 1 });
        tx.purchaseOrderApproval.count.mockResolvedValue(3);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.upsertPolicies(tenantId, [{ level: 1, userIds: [userId1] }]),
      ).rejects.toThrow(/No se puede quitar el nivel 2/);
    });

    it('crea política nueva cuando el nivel no existía', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.approvalPolicy.findMany
          .mockResolvedValueOnce([] as never)
          .mockResolvedValueOnce([
            { id: 'pol-new', level: 1, allowedUsers: [] },
          ] as never);
        tx.approvalPolicy.create.mockResolvedValue({
          id: 'pol-new',
          level: 1,
        } as never);
        tx.approvalPolicyUser.deleteMany.mockResolvedValue({ count: 0 });
        tx.approvalPolicyUser.createMany.mockResolvedValue({ count: 1 });
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await service.upsertPolicies(tenantId, [
        { level: 1, userIds: [userId1], minAmount: 10000 },
      ]);

      expect(tx.approvalPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            level: 1,
            minAmount: 10000,
            tenantId,
          }),
        }),
      );
    });
  });
});
