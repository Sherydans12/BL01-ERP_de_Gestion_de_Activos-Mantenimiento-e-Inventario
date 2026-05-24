import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/email/email.service';
import { StorageService } from '../../common/storage/storage.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

jest.mock('./purchase-contract-access.util');
jest.mock('./purchase-quotation-status-sync.util', () => ({
  syncPurchaseQuotationStatusesFromLineAwards: jest
    .fn()
    .mockResolvedValue([]),
}));

const mockAssertContractAccess = jest.mocked(assertUserHasContractAccess);

describe('PurchaseOrdersService — approve', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const signerId = '44444444-4444-4444-4444-444444444444';
  const policyL1Id = '55555555-5555-5555-5555-555555555555';
  const policyL2Id = '66666666-6666-6666-6666-666666666666';

  const adminSigner = {
    id: signerId,
    tenantId,
    role: 'ADMIN',
  };

  const policies = [
    {
      id: policyL1Id,
      level: 1,
      minAmount: 0,
      tenantId,
      allowedUsers: [{ userId: signerId, policyId: policyL1Id }],
    },
    {
      id: policyL2Id,
      level: 2,
      minAmount: 50000,
      tenantId,
      allowedUsers: [
        {
          userId: '77777777-7777-7777-7777-777777777777',
          policyId: policyL2Id,
        },
      ],
    },
  ];

  function baseOrder(
    overrides: Partial<{
      status: string;
      totalAmount: number;
      requiredSignatures: number;
      approvals: Array<{ level: number; approvedById: string }>;
    }> = {},
  ) {
    return {
      id: orderId,
      tenantId,
      contractId,
      status: overrides.status ?? 'PENDING_APPROVAL',
      totalAmount: overrides.totalAmount ?? 100000,
      requiredSignatures: overrides.requiredSignatures ?? 2,
      approvals: overrides.approvals ?? [],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        {
          provide: AuditService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: NotificationsService,
          useValue: {
            sendNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);

    prisma.approvalPolicy.findMany.mockResolvedValue(policies as never);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
    tx.purchaseOrderApproval.create.mockResolvedValue({
      id: 'approval-1',
      level: 1,
      policy: { id: policyL1Id, level: 1, description: 'Nivel 1' },
      approvedBy: { id: signerId, name: 'Signer' },
    } as never);
    tx.purchaseOrder.update.mockResolvedValue({} as never);
  });

  it('rechaza OC inexistente', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza OC que no está pendiente de aprobación', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ status: 'APPROVED' }) as never,
    );

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow('La OC no está pendiente de aprobación');
  });

  it('rechaza doble firma del mismo usuario en la misma OC', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({
        approvals: [{ level: 1, approvedById: signerId }],
      }) as never,
    );

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow(ConflictException);
  });

  it('rechaza usuario sin política ACL configurada', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(baseOrder() as never);
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: policyL1Id,
        level: 1,
        minAmount: 0,
        allowedUsers: [{ userId: '99999999-9999-9999-9999-999999999999' }],
      },
    ] as never);

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rechaza firma cuando el nivel del usuario supera requiredSignatures', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ requiredSignatures: 1 }) as never,
    );
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: policyL2Id,
        level: 2,
        minAmount: 0,
        allowedUsers: [{ userId: signerId }],
      },
    ] as never);

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow('Tu nivel de firma no es requerido para esta OC');
  });

  it('rechaza firma si el monto de la OC no alcanza minAmount del nivel', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ totalAmount: 10000, requiredSignatures: 2 }) as never,
    );
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: policyL2Id,
        level: 2,
        minAmount: 50000,
        allowedUsers: [{ userId: signerId }],
      },
    ] as never);

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow(/no alcanza el mínimo requerido/);
  });

  it('rechaza firma de nivel 2 sin aprobación previa del nivel 1', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ approvals: [], requiredSignatures: 2 }) as never,
    );
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: policyL2Id,
        level: 2,
        minAmount: 0,
        allowedUsers: [{ userId: signerId }],
      },
    ] as never);

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow(/sin la aprobación previa de los niveles anteriores/);
  });

  it('rechaza firma si el nivel ya tiene una aprobación registrada', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({
        approvals: [
          {
            level: 1,
            approvedById: '88888888-8888-8888-8888-888888888888',
          },
        ],
        requiredSignatures: 2,
      }) as never,
    );

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow(/nivel 1 ya tiene una firma registrada/);
  });

  it('registra firma nivel 1 y deja la OC en PARTIALLY_APPROVED', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ requiredSignatures: 2, approvals: [] }) as never,
    );

    const result = await service.approve(orderId, 'OK', adminSigner);

    expect(result.orderStatus).toBe('PARTIALLY_APPROVED');
    expect(tx.purchaseOrderApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          level: 1,
          policyId: policyL1Id,
          approvedById: signerId,
          purchaseOrderId: orderId,
        }),
      }),
    );
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'PARTIALLY_APPROVED' },
    });
  });

  it('aprueba la OC cuando se alcanza requiredSignatures con una sola firma', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ requiredSignatures: 1, approvals: [] }) as never,
    );

    const result = await service.approve(orderId, undefined, adminSigner);

    expect(result.orderStatus).toBe('APPROVED');
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'APPROVED' },
    });
  });

  it('verifica acceso al contrato antes de validar firmas', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(baseOrder() as never);
    mockAssertContractAccess.mockImplementation(() => {
      throw new ForbiddenException('Sin contrato');
    });

    await expect(
      service.approve(orderId, undefined, adminSigner),
    ).rejects.toThrow('Sin contrato');

    expect(prisma.approvalPolicy.findMany).not.toHaveBeenCalled();
  });
});

describe('PurchaseOrdersService — reject', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationsService,
          useValue: { sendNotification: jest.fn() },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  it('rechaza OC inexistente', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.reject(orderId, 'motivo', user),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza OC que no está en flujo de aprobación', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      tenantId,
      contractId,
      status: 'APPROVED',
      notes: null,
    } as never);

    await expect(
      service.reject(orderId, 'motivo', user),
    ).rejects.toThrow('La OC no está pendiente de aprobación');
  });

  it('marca la OC como REJECTED y registra auditoría', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      tenantId,
      contractId,
      status: 'PARTIALLY_APPROVED',
      notes: 'prev',
    } as never);
    prisma.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'REJECTED',
      notes: 'No cumple presupuesto',
    } as never);

    const result = await service.reject(orderId, 'No cumple presupuesto', user);

    expect(result.status).toBe('REJECTED');
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'REJECTED', notes: 'No cumple presupuesto' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        entityType: 'PURCHASE_ORDER',
        newValue: expect.objectContaining({
          status: 'REJECTED',
          reason: 'No cumple presupuesto',
        }),
      }),
    );
  });

  it('conserva notas previas si no se envía motivo', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      tenantId,
      contractId,
      status: 'PENDING_APPROVAL',
      notes: 'nota previa',
    } as never);
    prisma.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'REJECTED',
      notes: 'nota previa',
    } as never);

    await service.reject(orderId, undefined, user);

    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'REJECTED', notes: 'nota previa' },
    });
  });

  it('no rechaza OC ya parcialmente recibida (solo flujo de aprobación)', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      tenantId,
      contractId,
      status: 'PARTIALLY_RECEIVED',
      notes: null,
    } as never);

    await expect(
      service.reject(orderId, 'motivo', user),
    ).rejects.toThrow('La OC no está pendiente de aprobación');
  });
});

describe('PurchaseOrdersService — cancel', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const requisitionId = '55555555-5555-5555-5555-555555555555';
  const userId = '44444444-4444-4444-4444-444444444444';

  const user = { id: userId, tenantId, role: 'ADMIN' };
  const cancelReason = 'Error en cantidades solicitadas';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationsService,
          useValue: { sendNotification: jest.fn() },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  function baseCancelOrder(
    overrides: Partial<{
      status: string;
      requisitionId: string | null;
      items: Array<{ sourceQuotationItemId: string | null }>;
    }> = {},
  ) {
    return {
      id: orderId,
      tenantId,
      contractId,
      status: overrides.status ?? 'APPROVED',
      correlative: 'OC-100',
      requisitionId: overrides.requisitionId ?? null,
      items: overrides.items ?? [],
      quotation: null,
    };
  }

  it('rechaza OC inexistente', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.cancel(orderId, cancelReason, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('exige motivo de anulación', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseCancelOrder() as never,
    );

    await expect(
      service.cancel(orderId, '  ', user),
    ).rejects.toThrow(/motivo de anulación/);
  });

  it('rechaza anulación en estado terminal', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseCancelOrder({ status: 'RECEIVED' }) as never,
    );

    await expect(
      service.cancel(orderId, cancelReason, user),
    ).rejects.toThrow(/no puede anularse en su estado actual/);
  });

  it('rechaza anulación con recepciones operativas confirmadas', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseCancelOrder() as never,
    );
    prisma.warehouseReceipt.count.mockResolvedValue(2);

    await expect(
      service.cancel(orderId, cancelReason, user),
    ).rejects.toThrow(/recepciones de bodega confirmadas/);
  });

  it('permite anular OC PARTIALLY_RECEIVED sin guías confirmadas', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseCancelOrder({ status: 'PARTIALLY_RECEIVED' }) as never,
    );
    prisma.warehouseReceipt.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.purchaseOrder.update.mockResolvedValue({
        id: orderId,
        status: 'CANCELLED',
        notes: cancelReason,
      } as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.cancel(orderId, cancelReason, user);

    expect(result.status).toBe('CANCELLED');
  });

  it('anula la OC y registra auditoría', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseCancelOrder() as never,
    );
    prisma.warehouseReceipt.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.purchaseOrder.update.mockResolvedValue({
        id: orderId,
        status: 'CANCELLED',
        notes: cancelReason,
      } as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.cancel(orderId, cancelReason, user);

    expect(result.status).toBe('CANCELLED');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'PURCHASE_ORDER',
        newValue: expect.objectContaining({
          status: 'CANCELLED',
          reason: cancelReason,
        }),
      }),
    );
  });

  it('libera adjudicación de línea SRC cuando no quedan OCs activas', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseCancelOrder({
        requisitionId,
        items: [{ sourceQuotationItemId: 'sq-item-1' }],
      }) as never,
    );
    prisma.warehouseReceipt.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.purchaseOrder.update.mockResolvedValue({
        id: orderId,
        status: 'CANCELLED',
      } as never);
      tx.purchaseOrderItem.count.mockResolvedValue(0);
      tx.requisitionItem.updateMany.mockResolvedValue({ count: 1 });
      tx.requisitionItem.findMany.mockResolvedValue([
        { awardedQuotationItemId: null },
      ] as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await service.cancel(orderId, cancelReason, user);

    expect(tx.requisitionItem.updateMany).toHaveBeenCalledWith({
      where: {
        requisitionId,
        awardedQuotationItemId: 'sq-item-1',
      },
      data: { awardedQuotationItemId: null },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'REQUISITION',
        newValue: expect.objectContaining({
          event: 'awards_released_after_po_cancel',
        }),
      }),
    );
  });
});

describe('PurchaseOrdersService — markAsSentToSupplier', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationsService,
          useValue: { sendNotification: jest.fn() },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  it('rechaza OC inexistente', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.markAsSentToSupplier(orderId, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('solo permite envío desde estado APPROVED', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      tenantId,
      contractId,
      status: 'PENDING_APPROVAL',
    } as never);

    await expect(
      service.markAsSentToSupplier(orderId, user),
    ).rejects.toThrow(/orden aprobada puede marcarse como enviada/);
  });

  it('marca SENT, persiste sentAt y audita el evento', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      tenantId,
      contractId,
      status: 'APPROVED',
    } as never);
    prisma.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'SENT',
      sentAt: new Date('2026-05-22T15:00:00.000Z'),
    } as never);
    prisma.user.findUnique.mockResolvedValue({ name: 'Comprador Test' } as never);

    const result = await service.markAsSentToSupplier(orderId, user);

    expect(result.status).toBe('SENT');
    expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: expect.objectContaining({
        status: 'SENT',
        sentAt: expect.any(Date),
      }),
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({
          event: 'marked_sent_to_supplier',
          performedByName: 'Comprador Test',
        }),
      }),
    );
  });
});

describe('PurchaseOrdersService — resetToDraft', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationsService,
          useValue: { sendNotification: jest.fn() },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  it('solo permite reiniciar OC en estado REJECTED', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      contractId,
      status: 'APPROVED',
    } as never);

    await expect(service.resetToDraft(orderId, user)).rejects.toThrow(
      /estado REJECTED/,
    );
  });

  it('limpia firmas y deja la OC en DRAFT', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      contractId,
      status: 'REJECTED',
    } as never);
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.purchaseOrderApproval.deleteMany.mockResolvedValue({ count: 2 });
      tx.purchaseOrder.update.mockResolvedValue({
        id: orderId,
        status: 'DRAFT',
        notes: null,
      } as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.resetToDraft(orderId, user);

    expect(tx.purchaseOrderApproval.deleteMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: orderId },
    });
    expect(result.status).toBe('DRAFT');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ approvalsCleared: true }),
      }),
    );
  });
});

describe('PurchaseOrdersService — forceClose', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';
  const user = { id: userId, tenantId, role: 'ADMIN' };
  const reason = 'Cierre administrativo por saldo pendiente acordado';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationsService,
          useValue: { sendNotification: jest.fn() },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  it('solo permite cierre desde PARTIALLY_RECEIVED', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      contractId,
      status: 'APPROVED',
    } as never);

    await expect(
      service.forceClose(orderId, reason, user),
    ).rejects.toThrow(/parcialmente recibida/);
  });

  it('exige justificación', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      contractId,
      status: 'PARTIALLY_RECEIVED',
    } as never);

    await expect(
      service.forceClose(orderId, '  ', user),
    ).rejects.toThrow(/justificación/);
  });

  it('rechaza cierre si la OC no existe', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.forceClose(orderId, reason, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('cierra OC y completa guías PENDING/PARTIAL', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: orderId,
      contractId,
      status: 'PARTIALLY_RECEIVED',
    } as never);
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.purchaseOrder.update.mockResolvedValue({
        id: orderId,
        status: 'CLOSED',
        notes: reason,
      } as never);
      tx.warehouseReceipt.updateMany.mockResolvedValue({ count: 1 });
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    const result = await service.forceClose(orderId, reason, user);

    expect(result.status).toBe('CLOSED');
    expect(tx.warehouseReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purchaseOrderId: orderId,
          status: { in: ['PENDING', 'PARTIAL'] },
        }),
        data: { status: 'COMPLETED' },
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        newValue: expect.objectContaining({
          status: 'CLOSED',
          closedOpenReceipts: true,
        }),
      }),
    );
  });
});

describe('PurchaseOrdersService — notificaciones post-firma', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sendNotification: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const signerId = '44444444-4444-4444-4444-444444444444';
  const nextSignerId = '77777777-7777-7777-7777-777777777777';
  const policyL1Id = '55555555-5555-5555-5555-555555555555';
  const policyL2Id = '66666666-6666-6666-6666-666666666666';

  const adminSigner = { id: signerId, tenantId, role: 'ADMIN' };

  const policies = [
    {
      id: policyL1Id,
      level: 1,
      minAmount: 0,
      tenantId,
      description: 'Jefe compras',
      allowedUsers: [{ userId: signerId, policyId: policyL1Id }],
    },
    {
      id: policyL2Id,
      level: 2,
      minAmount: 0,
      tenantId,
      description: 'Gerencia',
      allowedUsers: [{ userId: nextSignerId, policyId: policyL2Id }],
    },
  ];

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    sendNotification = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { sendNotification },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
    tx.purchaseOrderApproval.create.mockResolvedValue({ id: 'ap-1' } as never);
    tx.purchaseOrder.update.mockResolvedValue({} as never);
  });

  async function flushAsyncSideEffects(): Promise<void> {
    await new Promise((r) => setImmediate(r));
  }

  it('envía Web Push al siguiente nivel tras firma parcial', async () => {
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce({
        id: orderId,
        tenantId,
        contractId,
        status: 'PENDING_APPROVAL',
        totalAmount: 500000,
        requiredSignatures: 2,
        approvals: [],
      } as never)
      .mockResolvedValueOnce({
        id: orderId,
        correlative: 'OC-900',
        currency: 'CLP',
        totalAmount: 500000,
        contractId,
        status: 'PARTIALLY_APPROVED',
        requiredSignatures: 2,
        approvals: [{ level: 1 }],
      } as never);
    prisma.approvalPolicy.findMany.mockResolvedValue(policies as never);
    prisma.user.findMany.mockResolvedValue([{ id: nextSignerId }] as never);

    await service.approve(orderId, undefined, adminSigner);
    await flushAsyncSideEffects();

    expect(sendNotification).toHaveBeenCalledWith(
      nextSignerId,
      expect.stringContaining('OC-900'),
      expect.stringContaining('Gerencia'),
      expect.objectContaining({
        type: 'PURCHASE_ORDER_PENDING_SIGNATURE',
        level: '2',
        orderId,
      }),
    );
  });
});

describe('PurchaseOrdersService — updateSensitiveFields', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;
  let sendNotification: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';
  const itemCatalogId = '88888888-8888-8888-8888-888888888888';
  const policyL1Id = '55555555-5555-5555-5555-555555555555';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  function baseOrder(
    overrides: Partial<{
      status: string;
      totalAmount: number;
      requiredSignatures: number;
      approvals: unknown[];
      items: unknown[];
    }> = {},
  ) {
    return {
      id: orderId,
      tenantId,
      contractId,
      status: overrides.status ?? 'PARTIALLY_APPROVED',
      totalAmount: overrides.totalAmount ?? 2_000_000,
      requiredSignatures: overrides.requiredSignatures ?? 2,
      approvals: overrides.approvals ?? [{ level: 1, approvedById: userId }],
      items: overrides.items ?? [
        {
          description: 'Repuesto hidráulico',
          quantity: 10,
          unitCost: 5000,
          inventoryItemId: itemCatalogId,
        },
      ],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    sendNotification = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationsService,
          useValue: { sendNotification },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  async function flushAsyncSideEffects(): Promise<void> {
    await new Promise((r) => setImmediate(r));
  }

  it('rechaza OC inexistente', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.updateSensitiveFields(orderId, { totalAmount: 100 }, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza edición en estado no permitido', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ status: 'APPROVED', approvals: [] }) as never,
    );

    await expect(
      service.updateSensitiveFields(orderId, { totalAmount: 100 }, user),
    ).rejects.toThrow(/no se puede editar en su estado actual/);
  });

  it('elimina firmas previas y deja la OC en PENDING_APPROVAL', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(baseOrder() as never);
    tx.purchaseOrderApproval.deleteMany.mockResolvedValue({ count: 1 });
    tx.purchaseSettings.findUnique.mockResolvedValue({
      approvalThreshold: 5_000_000,
    } as never);
    tx.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'PENDING_APPROVAL',
      totalAmount: 1_000_000,
      requiredSignatures: 2,
      items: [],
    } as never);

    const updated = await service.updateSensitiveFields(
      orderId,
      { totalAmount: 1_000_000 },
      user,
    );

    expect(tx.purchaseOrderApproval.deleteMany).toHaveBeenCalledWith({
      where: { purchaseOrderId: orderId },
    });
    expect(updated.status).toBe('PENDING_APPROVAL');
    expect(updated.requiredSignatures).toBe(2);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'PURCHASE_ORDER',
      }),
    );
  });

  it('asigna 3 firmas requeridas cuando el monto alcanza el umbral del tenant', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ status: 'PENDING_APPROVAL', approvals: [] }) as never,
    );
    tx.purchaseSettings.findUnique.mockResolvedValue({
      approvalThreshold: 1_000_000,
    } as never);
    tx.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'PENDING_APPROVAL',
      totalAmount: 3_000_000,
      requiredSignatures: 3,
      items: [],
    } as never);

    const updated = await service.updateSensitiveFields(
      orderId,
      { totalAmount: 3_000_000 },
      user,
    );

    expect(tx.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalAmount: 3_000_000,
          requiredSignatures: 3,
          status: 'PENDING_APPROVAL',
        }),
      }),
    );
    expect(updated.requiredSignatures).toBe(3);
  });

  it('reemplaza líneas y audita cambios de cantidad', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue(
      baseOrder({ status: 'DRAFT', approvals: [] }) as never,
    );
    tx.purchaseOrderItem.deleteMany.mockResolvedValue({ count: 1 });
    tx.purchaseOrderItem.createMany.mockResolvedValue({ count: 1 });
    tx.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'PENDING_APPROVAL',
      totalAmount: 2_000_000,
      requiredSignatures: 2,
      items: [
        {
          description: 'Repuesto hidráulico',
          quantity: 12,
          unitCost: 5000,
          inventoryItemId: itemCatalogId,
        },
      ],
    } as never);

    await service.updateSensitiveFields(
      orderId,
      {
        items: [
          {
            description: 'Repuesto hidráulico',
            quantity: 12,
            unitCost: 5000,
            inventoryItemId: itemCatalogId,
          },
        ],
      },
      user,
    );

    expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalled();
    expect(tx.purchaseOrderItem.createMany).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        unified: expect.objectContaining({
          field: 'quantity',
          prev: 10,
          next: 12,
          metadata: expect.objectContaining({
            event: 'po_line_quantity_changed',
          }),
        }),
      }),
    );
  });

  it('notifica firmantes tras reabrir la OC a PENDING_APPROVAL', async () => {
    const signerL1 = userId;
    prisma.purchaseOrder.findFirst
      .mockResolvedValueOnce(
        baseOrder({ status: 'PARTIALLY_APPROVED', approvals: [] }) as never,
      )
      .mockResolvedValueOnce({
        id: orderId,
        correlative: 'OC-EDIT-01',
        currency: 'CLP',
        totalAmount: 1_500_000,
        contractId,
        status: 'PENDING_APPROVAL',
        requiredSignatures: 2,
        approvals: [],
      } as never);
    tx.purchaseOrder.update.mockResolvedValue({
      id: orderId,
      status: 'PENDING_APPROVAL',
      totalAmount: 1_500_000,
      requiredSignatures: 2,
      items: [],
    } as never);
    tx.purchaseSettings.findUnique.mockResolvedValue({
      approvalThreshold: 0,
    } as never);
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: policyL1Id,
        level: 1,
        description: 'Compras',
        allowedUsers: [{ userId: signerL1 }],
      },
    ] as never);
    prisma.user.findMany.mockResolvedValue([{ id: signerL1 }] as never);

    await service.updateSensitiveFields(
      orderId,
      { totalAmount: 1_500_000 },
      user,
    );
    await flushAsyncSideEffects();

    expect(sendNotification).toHaveBeenCalledWith(
      signerL1,
      expect.stringContaining('OC-EDIT-01'),
      expect.any(String),
      expect.objectContaining({
        type: 'PURCHASE_ORDER_PENDING_SIGNATURE',
        level: '1',
      }),
    );
  });
});

describe('PurchaseOrdersService — createOrdersFromRequisition', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: DeepMockProxy<SequenceService>;
  let auditLogMany: jest.Mock;
  let sendNotification: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const awardId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const quotationId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const userId = '44444444-4444-4444-4444-444444444444';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  function baseRequisition(
    overrides: Partial<{
      status: string;
      items: Array<{ awardedQuotationItemId: string | null }>;
    }> = {},
  ) {
    return {
      id: requisitionId,
      tenantId,
      contractId,
      status: overrides.status ?? 'APPROVED',
      equipmentId: null,
      workOrderId: null,
      subcontractId: null,
      items: overrides.items ?? [{ awardedQuotationItemId: awardId }],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    sequenceService = mockDeep<SequenceService>();
    auditLogMany = jest.fn().mockResolvedValue(undefined);
    sendNotification = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);
    sequenceService.getNextCorrelative.mockResolvedValue('OC-SPLIT-01');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        {
          provide: AuditService,
          useValue: { log: jest.fn(), logMany: auditLogMany },
        },
        {
          provide: NotificationsService,
          useValue: { sendNotification },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  async function flushAsyncSideEffects(): Promise<void> {
    await new Promise((r) => setImmediate(r));
  }

  it('lanza NotFoundException si el SRC no existe', async () => {
    tx.purchaseRequisition.findFirst.mockResolvedValue(null);

    await expect(
      service.createOrdersFromRequisition(requisitionId, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza sin líneas adjudicadas', async () => {
    tx.purchaseRequisition.findFirst.mockResolvedValue(
      baseRequisition({
        items: [{ awardedQuotationItemId: null }],
      }) as never,
    );

    await expect(
      service.createOrdersFromRequisition(requisitionId, user),
    ).rejects.toThrow(/adjudicadas/);
  });

  it('retorna idempotente si todas las líneas ya tienen OC activa', async () => {
    tx.purchaseRequisition.findFirst
      .mockResolvedValueOnce(baseRequisition() as never)
      .mockResolvedValueOnce({ status: 'APPROVED' } as never);
    tx.purchaseOrderItem.findMany.mockResolvedValue([
      { sourceQuotationItemId: awardId },
    ] as never);
    tx.requisitionItem.findMany.mockResolvedValue([
      { awardedQuotationItemId: awardId },
    ] as never);

    const result = await service.createOrdersFromRequisition(
      requisitionId,
      user,
    );

    expect(result.idempotent).toBe(true);
    expect(result.orders).toEqual([]);
    expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('crea OC PENDING_APPROVAL agrupada por cotización', async () => {
    tx.purchaseRequisition.findFirst
      .mockResolvedValueOnce(baseRequisition() as never)
      .mockResolvedValueOnce({ status: 'PARTIALLY_PURCHASED' } as never);
    tx.purchaseOrderItem.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ sourceQuotationItemId: awardId }] as never);
    tx.quotationItem.findMany.mockResolvedValue([
      {
        id: awardId,
        quotationId,
        unitPrice: 150,
        requisitionItem: {
          quantity: 2,
          description: 'Filtro hidráulico',
          inventoryItemId: 'item-1',
        },
        quotation: {
          id: quotationId,
          currency: 'CLP',
          paymentDays: 30,
          requisition: { id: requisitionId },
        },
      },
    ] as never);
    tx.purchaseSettings.findUnique.mockResolvedValue({
      approvalThreshold: 0,
    } as never);
    const createdPoId = 'po-new-1';
    tx.purchaseOrder.create.mockResolvedValue({
      id: createdPoId,
      correlative: 'OC-SPLIT-01',
      status: 'PENDING_APPROVAL',
      totalAmount: 300,
      items: [],
    } as never);
    tx.requisitionItem.findMany.mockResolvedValue([
      { awardedQuotationItemId: awardId },
    ] as never);
    prisma.purchaseRequisition.findFirst.mockResolvedValue({
      correlative: 'SRC-2026-001',
    } as never);
    prisma.purchaseOrder.findMany
      .mockResolvedValueOnce([
        { quotation: { vendor: { name: 'Proveedor X' } } },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: createdPoId,
          status: 'PENDING_APPROVAL',
          contractId,
          currency: 'CLP',
          totalAmount: 300,
          requiredSignatures: 2,
          approvals: [],
        },
      ] as never)
      .mockResolvedValueOnce([{ correlative: 'OC-SPLIT-01' }] as never);
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: 'pol-1',
        level: 1,
        allowedUsers: [{ userId }],
      },
    ] as never);
    prisma.user.findMany.mockResolvedValue([
      { id: userId, email: 'signer@test.com' },
    ] as never);

    const result = await service.createOrdersFromRequisition(
      requisitionId,
      user,
    );

    expect(result.idempotent).toBe(false);
    expect(result.orders).toHaveLength(1);
    expect(tx.purchaseOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_APPROVAL',
          requiredSignatures: 2,
          requisitionId,
          quotationId,
        }),
      }),
    );
    expect(auditLogMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          newValue: expect.objectContaining({
            event: 'split_po_from_requisition',
          }),
        }),
      ]),
    );

    await flushAsyncSideEffects();
    expect(sendNotification).toHaveBeenCalledWith(
      userId,
      expect.stringMatching(/pendiente/i),
      expect.stringContaining('SRC-2026-001'),
      expect.objectContaining({
        type: 'PURCHASE_ORDER_BATCH_PENDING_SIGNATURE',
      }),
    );
  });
});

describe('PurchaseOrdersService — notifyApproversForPendingSignatureBatch', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let sendNotification: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const orderId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const signerId = '44444444-4444-4444-4444-444444444444';
  const policyL1Id = '55555555-5555-5555-5555-555555555555';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    sendNotification = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { sendNotification },
        },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get(PurchaseOrdersService);
  });

  it('envía un push batch PURCHASE_ORDER_BATCH_PENDING_SIGNATURE', async () => {
    prisma.purchaseOrder.findMany
      .mockResolvedValueOnce([
        {
          id: orderId,
          status: 'PENDING_APPROVAL',
          contractId,
          currency: 'CLP',
          totalAmount: 250000,
          requiredSignatures: 2,
          approvals: [],
        },
      ] as never)
      .mockResolvedValueOnce([{ correlative: 'OC-BATCH-01' }] as never);
    prisma.approvalPolicy.findMany.mockResolvedValue([
      {
        id: policyL1Id,
        level: 1,
        allowedUsers: [{ userId: signerId }],
      },
    ] as never);
    prisma.user.findMany.mockResolvedValue([{ id: signerId }] as never);

    await (
      service as unknown as {
        notifyApproversForPendingSignatureBatch: (
          t: string,
          ids: string[],
          s: { requisitionCorrelative: string; vendorNames: string[] },
        ) => Promise<void>;
      }
    ).notifyApproversForPendingSignatureBatch(
      tenantId,
      [orderId],
      { requisitionCorrelative: 'SRC-88', vendorNames: ['ACME'] },
    );

    expect(sendNotification).toHaveBeenCalledWith(
      signerId,
      expect.stringMatching(/pendiente/i),
      expect.stringContaining('SRC-88'),
      expect.objectContaining({
        type: 'PURCHASE_ORDER_BATCH_PENDING_SIGNATURE',
        requisitionCorrelative: 'SRC-88',
        firstOrderId: orderId,
      }),
    );
  });

  it('no notifica si orderIds está vacío', async () => {
    await (
      service as unknown as {
        notifyApproversForPendingSignatureBatch: (
          t: string,
          ids: string[],
          s: { requisitionCorrelative: string; vendorNames: string[] },
        ) => Promise<void>;
      }
    ).notifyApproversForPendingSignatureBatch(tenantId, [], {
      requisitionCorrelative: 'SRC-0',
      vendorNames: [],
    });

    expect(sendNotification).not.toHaveBeenCalled();
  });
});
