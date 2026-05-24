import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

jest.mock('./purchase-contract-access.util', () => {
  const actual = jest.requireActual<typeof import('./purchase-contract-access.util')>(
    './purchase-contract-access.util',
  );
  return {
    ...actual,
    assertUserHasContractAccess: jest.fn(),
  };
});
jest.mock('./purchase-quotation-status-sync.util', () => ({
  syncPurchaseQuotationStatusesFromLineAwards: jest
    .fn()
    .mockResolvedValue([]),
}));
jest.mock('./purchase-requisition-reconciliation.util', () => ({
  buildRequisitionReconciliationSnapshot: jest.fn().mockResolvedValue({}),
}));

const mockAssertContractAccess = jest.mocked(assertUserHasContractAccess);

describe('PurchaseRequisitionsService — saveLineAwards', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const reqItemId = '44444444-4444-4444-4444-444444444444';
  const quotItemId = '55555555-5555-5555-5555-555555555555';
  const inventoryItemId = '66666666-6666-6666-6666-666666666666';
  const userId = '77777777-7777-7777-7777-777777777777';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  function quotingRequisition(
    overrides: Partial<{ status: string; awardedQuotationItemId: string | null }> = {},
  ) {
    return {
      id: requisitionId,
      tenantId,
      contractId,
      status: overrides.status ?? 'QUOTING',
      correlative: 'SRC-100',
      description: 'Repuestos',
      items: [
        {
          id: reqItemId,
          quantity: 2,
          inventoryItemId,
          awardedQuotationItemId:
            overrides.awardedQuotationItemId ?? null,
        },
      ],
      quotations: [],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  it('rechaza adjudicación en estado DRAFT', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(quotingRequisition({ status: 'DRAFT' }) as never);

    await expect(
      service.saveLineAwards(
        requisitionId,
        {
          awards: [{ requisitionItemId: reqItemId, quotationItemId: quotItemId }],
        },
        user,
      ),
    ).rejects.toThrow(/adjudicar por línea/);
  });

  it('rechaza ítems de requerimiento duplicados en el payload', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(quotingRequisition() as never);

    await expect(
      service.saveLineAwards(
        requisitionId,
        {
          awards: [
            { requisitionItemId: reqItemId, quotationItemId: quotItemId },
            { requisitionItemId: reqItemId, quotationItemId: quotItemId },
          ],
        },
        user,
      ),
    ).rejects.toThrow(/duplicados/);
  });

  it('rechaza línea de cotización que no pertenece al ítem', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(quotingRequisition() as never);
    prisma.quotationItem.findFirst.mockResolvedValue(null);

    await expect(
      service.saveLineAwards(
        requisitionId,
        {
          awards: [{ requisitionItemId: reqItemId, quotationItemId: quotItemId }],
        },
        user,
      ),
    ).rejects.toThrow(/no corresponde/);
  });

  it('pasa a PENDING_APPROVAL cuando todas las líneas quedan adjudicadas', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValueOnce(quotingRequisition() as never)
      .mockResolvedValueOnce(
        quotingRequisition({
          status: 'PENDING_APPROVAL',
          awardedQuotationItemId: quotItemId,
        }) as never,
      );
    prisma.quotationItem.findFirst.mockResolvedValue({ id: quotItemId } as never);
    tx.requisitionItem.update.mockResolvedValue({} as never);
    tx.requisitionItem.findMany.mockResolvedValue([
      { awardedQuotationItemId: quotItemId },
    ] as never);
    tx.purchaseRequisition.update.mockResolvedValue({} as never);

    const updated = await service.saveLineAwards(
      requisitionId,
      {
        awards: [{ requisitionItemId: reqItemId, quotationItemId: quotItemId }],
      },
      user,
    );

    expect(updated.status).toBe('PENDING_APPROVAL');
    expect(tx.purchaseRequisition.update).toHaveBeenCalledWith({
      where: { id: requisitionId },
      data: { status: 'PENDING_APPROVAL' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ event: 'line_awards_saved' }),
      }),
    );
  });
});

describe('PurchaseRequisitionsService — submit', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const itemId = '66666666-6666-6666-6666-666666666666';
  const reqLineId = '44444444-4444-4444-4444-444444444444';
  const userId = '77777777-7777-7777-7777-777777777777';

  const user = {
    id: userId,
    tenantId,
    role: 'ADMIN',
    name: 'Solicitante',
    email: 'sol@test.com',
  };

  function draftRequisition(
    overrides: Partial<{ status: string; items: unknown[] }> = {},
  ) {
    return {
      id: requisitionId,
      tenantId,
      contractId,
      status: overrides.status ?? 'DRAFT',
      correlative: 'SRC-DRAFT',
      description: 'Materiales',
      priority: 'MEDIUM',
      items: overrides.items ?? [
        {
          id: reqLineId,
          quantity: 3,
          inventoryItemId: itemId,
        },
      ],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
  });

  it('rechaza envío si no está en DRAFT', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftRequisition({ status: 'SUBMITTED' }) as never);

    await expect(service.submit(requisitionId, user)).rejects.toThrow(
      /estado DRAFT/,
    );
  });

  it('rechaza envío sin líneas', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftRequisition({ items: [] }) as never);

    await expect(service.submit(requisitionId, user)).rejects.toThrow(
      /al menos un ítem/,
    );
  });

  it('pasa a SUBMITTED y audita el cambio de estado', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftRequisition() as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    prisma.purchaseRequisition.update.mockResolvedValue({
      id: requisitionId,
      status: 'SUBMITTED',
    } as never);
    prisma.user.findMany.mockResolvedValue([{ id: userId }] as never);

    const result = await service.submit(requisitionId, user);

    expect(result.status).toBe('SUBMITTED');
    expect(prisma.purchaseRequisition.update).toHaveBeenCalledWith({
      where: { id: requisitionId },
      data: { status: 'SUBMITTED' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        newValue: { status: 'SUBMITTED' },
      }),
    );
  });
});

describe('PurchaseRequisitionsService — cancel', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '77777777-7777-7777-7777-777777777777';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  function baseReq(status: string) {
    return {
      id: requisitionId,
      tenantId,
      contractId,
      status,
      correlative: 'SRC-CANCEL',
      items: [],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
  });

  it('exige motivo de anulación', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(baseReq('SUBMITTED') as never);

    await expect(service.cancel(requisitionId, '  ', user)).rejects.toThrow(
      /motivo de anulación/,
    );
  });

  it('rechaza si ya está CANCELLED', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(baseReq('CANCELLED') as never);

    await expect(
      service.cancel(requisitionId, 'Motivo válido', user),
    ).rejects.toThrow(/ya está anulado/);
  });

  it('rechaza si está APPROVED', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(baseReq('APPROVED') as never);

    await expect(
      service.cancel(requisitionId, 'Motivo válido', user),
    ).rejects.toThrow(/ya aprobado/);
  });

  it('rechaza si existe OC activa vinculada', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(baseReq('QUOTING') as never);
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      correlative: 'OC-LOCK',
    } as never);

    await expect(
      service.cancel(requisitionId, 'Motivo válido', user),
    ).rejects.toThrow(/OC activa/);
  });

  it('anula y audita con motivo', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(baseReq('SUBMITTED') as never);
    prisma.purchaseOrder.findFirst.mockResolvedValue(null);
    prisma.requisitionItem.findMany.mockResolvedValue([] as never);
    prisma.purchaseRequisition.update.mockResolvedValue({
      id: requisitionId,
      status: 'CANCELLED',
    } as never);

    const result = await service.cancel(requisitionId, '  Duplicado por error  ', user);

    expect(result.status).toBe('CANCELLED');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({
          status: 'CANCELLED',
          reason: 'Duplicado por error',
        }),
      }),
    );
  });
});

describe('PurchaseRequisitionsService — startQuoting', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const userId = '77777777-7777-7777-7777-777777777777';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
  });

  it('solo permite desde SUBMITTED', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue({
      id: requisitionId,
      contractId,
      status: 'DRAFT',
    } as never);

    await expect(service.startQuoting(requisitionId, user)).rejects.toThrow(
      /enviado/,
    );
  });

  it('pasa a QUOTING y devuelve detalle actualizado', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValueOnce({
        id: requisitionId,
        contractId,
        status: 'SUBMITTED',
      } as never)
      .mockResolvedValueOnce({
        id: requisitionId,
        contractId,
        status: 'QUOTING',
        correlative: 'SRC-200',
      } as never);
    prisma.purchaseRequisition.update.mockResolvedValue({} as never);

    const result = await service.startQuoting(requisitionId, user);

    expect(result.status).toBe('QUOTING');
    expect(prisma.purchaseRequisition.update).toHaveBeenCalledWith({
      where: { id: requisitionId },
      data: { status: 'QUOTING' },
    });
  });
});

describe('PurchaseRequisitionsService — addQuotation', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const reqItemId = '44444444-4444-4444-4444-444444444444';
  const vendorId = '88888888-8888-8888-8888-888888888888';
  const userId = '77777777-7777-7777-7777-777777777777';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  const quotationPayload = {
    vendorId,
    totalAmount: 300,
    currency: 'CLP',
    items: [{ requisitionItemId: reqItemId, unitPrice: 100 }],
  };

  function submittedRequisition() {
    return {
      id: requisitionId,
      tenantId,
      contractId,
      status: 'SUBMITTED',
      items: [{ id: reqItemId, quantity: 3 }],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  it('rechaza cotización en estado DRAFT', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue({
      ...submittedRequisition(),
      status: 'DRAFT',
    } as never);

    await expect(
      service.addQuotation(requisitionId, quotationPayload, undefined, user),
    ).rejects.toThrow(/no acepta cotizaciones/);
  });

  it('rechaza ítem ajeno al requerimiento', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(submittedRequisition() as never);

    await expect(
      service.addQuotation(
        requisitionId,
        {
          ...quotationPayload,
          items: [{ requisitionItemId: '00000000-0000-4000-8000-000000000099', unitPrice: 1 }],
        },
        undefined,
        user,
      ),
    ).rejects.toThrow(/no pertenecen/);
  });

  it('rechaza total distinto a suma unitPrice × cantidad', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(submittedRequisition() as never);

    await expect(
      service.addQuotation(
        requisitionId,
        { ...quotationPayload, totalAmount: 999 },
        undefined,
        user,
      ),
    ).rejects.toThrow(/monto total no coincide/);
  });

  it('crea cotización y mueve SUBMITTED a QUOTING', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(submittedRequisition() as never);
    tx.purchaseQuotation.create.mockResolvedValue({
      id: 'quot-1',
      totalAmount: 300,
      vendor: { name: 'Proveedor A' },
    } as never);
    tx.purchaseRequisition.update.mockResolvedValue({} as never);

    const result = await service.addQuotation(
      requisitionId,
      quotationPayload,
      undefined,
      user,
    );

    expect(result.id).toBe('quot-1');
    expect(tx.purchaseQuotation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requisitionId,
          vendorId,
          totalAmount: 300,
        }),
      }),
    );
    expect(tx.purchaseRequisition.update).toHaveBeenCalledWith({
      where: { id: requisitionId },
      data: { status: 'QUOTING' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValue: expect.objectContaining({ event: 'quotation_added' }),
      }),
    );
  });
});

describe('PurchaseRequisitionsService — findAll', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const contractId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
  });

  it('filtra por contrato explícito y excluye CLOSED por defecto', async () => {
    prisma.purchaseRequisition.count.mockResolvedValue(1);
    prisma.purchaseRequisition.findMany.mockResolvedValue([
      { id: 'src-1', correlative: 'SRC-1', _count: { items: 2, quotations: 0 } },
    ] as never);

    await service.findAll(tenantId, { role: 'ADMIN' }, { contractId });

    expect(prisma.purchaseRequisition.count).toHaveBeenCalledWith({
      where: {
        tenantId,
        contractId,
        status: { not: 'CLOSED' },
      },
    });
  });

  it('aplica alcance allowedContracts para USER', async () => {
    prisma.purchaseRequisition.count.mockResolvedValue(0);
    prisma.purchaseRequisition.findMany.mockResolvedValue([] as never);

    await service.findAll(
      tenantId,
      { role: 'USER', allowedContracts: [contractId] },
      {},
    );

    expect(prisma.purchaseRequisition.count).toHaveBeenCalledWith({
      where: {
        tenantId,
        contractId: { in: [contractId] },
        status: { not: 'CLOSED' },
      },
    });
  });
});

describe('PurchaseRequisitionsService — create', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: DeepMockProxy<SequenceService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const itemId = '66666666-6666-6666-6666-666666666666';
  const userId = '77777777-7777-7777-7777-777777777777';
  const user = { id: userId, tenantId, role: 'ADMIN', name: 'Comprador' };

  const createPayload = {
    contractId,
    description: 'Repuestos menores',
    items: [
      {
        inventoryItemId: itemId,
        description: 'Filtro',
        quantity: 2,
        unitOfMeasure: 'UN',
      },
    ],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    sequenceService = mockDeep<SequenceService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);
    sequenceService.getNextCorrelative.mockResolvedValue('SRC-NEW-01');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  it('rechaza contrato ALL o inválido', async () => {
    await expect(
      service.create({ ...createPayload, contractId: 'ALL' }, user),
    ).rejects.toThrow(/contrato válido/);
  });

  it('rechaza sin líneas', async () => {
    prisma.contract.findFirst.mockResolvedValue({ id: contractId } as never);

    await expect(
      service.create({ ...createPayload, items: [] }, user),
    ).rejects.toThrow(/al menos un ítem/);
  });

  it('crea borrador SRC con correlativo y líneas', async () => {
    prisma.contract.findFirst.mockResolvedValue({ id: contractId } as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    tx.purchaseRequisition.create.mockResolvedValue({
      id: 'src-new',
      correlative: 'SRC-NEW-01',
      status: 'DRAFT',
      description: createPayload.description,
      items: [{ id: 'line-1' }],
      requestedBy: { id: userId, name: 'Comprador' },
      equipmentId: null,
      workOrderId: null,
      equipment: null,
      workOrder: null,
    } as never);
    prisma.user.findMany.mockResolvedValue([] as never);

    const created = await service.create(createPayload, user);

    expect(created.correlative).toBe('SRC-NEW-01');
    expect(tx.purchaseRequisition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId,
          description: createPayload.description,
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'REQUISITION',
      }),
    );
  });
});

describe('PurchaseRequisitionsService — duplicate', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const user = { id: '77777777-7777-7777-7777-777777777777', tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
  });

  it('delega en create con descripción [Copia] y mismas líneas', async () => {
    const original = {
      contractId,
      subcontractId: null,
      description: 'Materiales faena',
      justification: 'Urgente',
      priority: 'HIGH' as const,
      workOrderId: null,
      equipmentId: null,
      items: [
        {
          inventoryItemId: '66666666-6666-6666-6666-666666666666',
          description: 'Tornillo',
          quantity: 10,
          unitOfMeasure: 'UN',
          estimatedCost: 100,
          partNumber: 'TOR-1',
          itemNotes: null,
        },
      ],
    };
    jest.spyOn(service, 'findById').mockResolvedValue(original as never);
    const createSpy = jest
      .spyOn(service, 'create')
      .mockResolvedValue({ id: 'src-copy', correlative: 'SRC-COPY' } as never);

    const result = await service.duplicate(requisitionId, user);

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        description: '[Copia] Materiales faena',
        contractId,
        items: expect.arrayContaining([
          expect.objectContaining({ description: 'Tornillo', quantity: 10 }),
        ]),
      }),
      user,
    );
    expect(result.correlative).toBe('SRC-COPY');
  });
});

describe('PurchaseRequisitionsService — selectQuotation', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const quotWinId = '55555555-5555-5555-5555-555555555555';
  const quotOtherId = '66666666-6666-6666-6666-666666666666';
  const userId = '77777777-7777-7777-7777-777777777777';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  it('rechaza en estado DRAFT', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue({
      id: requisitionId,
      contractId,
      status: 'DRAFT',
      quotations: [],
    } as never);

    await expect(
      service.selectQuotation(requisitionId, quotWinId, user),
    ).rejects.toThrow(/elegir ganadora/);
  });

  it('rechaza cotización inexistente en el SRC', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue({
      id: requisitionId,
      contractId,
      status: 'QUOTING',
      quotations: [{ id: quotOtherId, isWinner: false }],
    } as never);

    await expect(
      service.selectQuotation(requisitionId, quotWinId, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('marca ganadora y mueve QUOTING a PENDING_APPROVAL', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue({
      id: requisitionId,
      contractId,
      status: 'QUOTING',
      quotations: [
        { id: quotWinId, isWinner: false, vendor: { name: 'Proveedor A' } },
        { id: quotOtherId, isWinner: false, vendor: { name: 'Proveedor B' } },
      ],
    } as never);
    tx.purchaseQuotation.updateMany.mockResolvedValue({ count: 1 } as never);
    tx.purchaseQuotation.update.mockResolvedValue({} as never);
    tx.purchaseRequisition.update.mockResolvedValue({} as never);
    tx.purchaseQuotation.findUnique.mockResolvedValue({
      id: quotWinId,
      status: 'SELECTED',
      isWinner: true,
      vendor: { name: 'Proveedor A' },
    } as never);

    const result = await service.selectQuotation(
      requisitionId,
      quotWinId,
      user,
    );

    expect(result?.id).toBe(quotWinId);
    expect(tx.purchaseQuotation.update).toHaveBeenCalledWith({
      where: { id: quotWinId },
      data: { status: 'SELECTED', isWinner: true },
    });
    expect(tx.purchaseRequisition.update).toHaveBeenCalledWith({
      where: { id: requisitionId },
      data: { status: 'PENDING_APPROVAL' },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STATUS_CHANGE',
        newValue: expect.objectContaining({
          status: 'PENDING_APPROVAL',
          selectedQuotationId: quotWinId,
        }),
      }),
    );
  });
});

describe('PurchaseRequisitionsService — update', () => {
  let service: PurchaseRequisitionsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const requisitionId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const reqItemId = '44444444-4444-4444-4444-444444444444';
  const itemId = '66666666-6666-6666-6666-666666666666';
  const ownerId = '77777777-7777-7777-7777-777777777777';

  const owner = { id: ownerId, tenantId, role: 'USER' };
  const purchaser = { id: ownerId, tenantId, role: 'ADMIN' };
  const woId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const eqId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  function draftReq(overrides: Partial<{ status: string; requestedById: string }> = {}) {
    return {
      id: requisitionId,
      tenantId,
      contractId,
      status: overrides.status ?? 'DRAFT',
      requestedById: overrides.requestedById ?? ownerId,
      description: 'Descripción inicial',
      justification: null,
      priority: 'MEDIUM',
      subcontractId: null,
      equipmentId: null,
      workOrderId: null,
      equipment: null,
      workOrder: null,
      items: [
        {
          id: reqItemId,
          quantity: 2,
          description: 'Línea 1',
          unitOfMeasure: 'UN',
          inventoryItemId: itemId,
        },
      ],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequisitionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: mockDeep<SequenceService>() },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('') },
        },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: NotificationDispatcherService,
          useValue: { dispatch: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PurchaseRequisitionsService);
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );
  });

  it('en QUOTING solo compras puede editar', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReq({ status: 'QUOTING' }) as never);

    await expect(
      service.update(requisitionId, { description: 'Cambio' }, owner),
    ).rejects.toThrow(ForbiddenException);
  });

  it('en SUBMITTED solo permite cambios de OT/equipo', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReq({ status: 'SUBMITTED' }) as never);

    await expect(
      service.update(requisitionId, { description: 'Nueva' }, owner),
    ).rejects.toThrow(/solo puede actualizar equipo/);
  });

  it('actualiza descripción en DRAFT (solicitante)', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReq() as never);
    tx.purchaseRequisition.update.mockResolvedValue({
      ...draftReq(),
      description: 'Descripción editada',
      items: draftReq().items,
    } as never);

    const updated = await service.update(
      requisitionId,
      { description: 'Descripción editada' },
      owner,
    );

    expect(updated.description).toBe('Descripción editada');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'REQUISITION' }),
    );
  });

  it('reemplaza líneas en DRAFT vía transacción', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReq() as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    tx.requisitionItem.deleteMany.mockResolvedValue({ count: 1 } as never);
    tx.requisitionItem.createMany.mockResolvedValue({ count: 1 } as never);
    tx.purchaseRequisition.update.mockResolvedValue({
      ...draftReq(),
      items: [
        {
          id: 'line-new',
          quantity: 5,
          description: 'Línea nueva',
          unitOfMeasure: 'UN',
        },
      ],
    } as never);

    await service.update(
      requisitionId,
      {
        items: [
          {
            inventoryItemId: itemId,
            description: 'Línea nueva',
            quantity: 5,
            unitOfMeasure: 'UN',
          },
        ],
      },
      owner,
    );

    expect(tx.requisitionItem.deleteMany).toHaveBeenCalledWith({
      where: { requisitionId },
    });
    expect(tx.requisitionItem.createMany).toHaveBeenCalled();
  });

  it('impide borrar ítem referenciado en cotización', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReq({ status: 'QUOTING' }) as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    tx.quotationItem.count.mockResolvedValue(1);

    await expect(
      service.update(
        requisitionId,
        {
          items: [
            {
              id: 'line-other',
              description: 'Otra',
              quantity: 1,
              unitOfMeasure: 'UN',
              inventoryItemId: itemId,
            },
          ],
        },
        purchaser,
      ),
    ).rejects.toThrow(/figura en una cotización/);
  });

  it('en SUBMITTED vincula OT y equipo (solicitante)', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReq({ status: 'SUBMITTED' }) as never);
    prisma.workOrder.findFirst.mockResolvedValue({
      id: woId,
      equipmentId: eqId,
      equipment: {
        id: eqId,
        contractId,
        subcontractId: null,
        subcontract: { contractId },
      },
    } as never);
    prisma.purchaseRequisition.update.mockResolvedValue({
      ...draftReq({ status: 'SUBMITTED' }),
      workOrderId: woId,
      equipmentId: eqId,
      equipment: { internalId: 'EQ-01', brand: 'Cat', model: 'M1', type: 'T' },
      workOrder: { correlative: 'OT-100', description: 'Mantenimiento' },
    } as never);

    const updated = await service.update(requisitionId, { workOrderId: woId }, owner);

    expect(updated.workOrderId).toBe(woId);
    expect(updated.equipmentId).toBe(eqId);
    expect(prisma.purchaseRequisition.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { equipmentId: eqId, workOrderId: woId },
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityType: 'REQUISITION' }),
    );
  });

  it('en SUBMITTED solo solicitante o admin puede cambiar vínculos', async () => {
    const otherOwner = '99999999-9999-9999-9999-999999999999';
    jest.spyOn(service, 'findById').mockResolvedValue(
      draftReq({ status: 'SUBMITTED', requestedById: otherOwner }) as never,
    );

    await expect(
      service.update(requisitionId, { equipmentId: eqId }, owner),
    ).rejects.toThrow(ForbiddenException);
  });

  it('en PENDING_APPROVAL solo compras puede editar ítems', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftReq({ status: 'PENDING_APPROVAL' }) as never);

    await expect(
      service.update(requisitionId, { description: 'Cambio' }, owner),
    ).rejects.toThrow(/mientras la OC no haya sido generada/);
  });

  it('en PENDING_APPROVAL compras actualiza cantidad de línea existente', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftReq({ status: 'PENDING_APPROVAL' }) as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    tx.requisitionItem.update.mockResolvedValue({
      id: reqItemId,
      quantity: 10,
      description: 'Línea 1',
      unitOfMeasure: 'UN',
      inventoryItemId: itemId,
    } as never);
    tx.purchaseRequisition.update.mockResolvedValue({
      ...draftReq({ status: 'PENDING_APPROVAL' }),
      items: [
        {
          id: reqItemId,
          quantity: 10,
          description: 'Línea 1',
          unitOfMeasure: 'UN',
          inventoryItemId: itemId,
        },
      ],
    } as never);

    await service.update(
      requisitionId,
      {
        items: [
          {
            id: reqItemId,
            description: 'Línea 1',
            quantity: 10,
            unitOfMeasure: 'UN',
            inventoryItemId: itemId,
          },
        ],
      },
      purchaser,
    );

    expect(tx.requisitionItem.update).toHaveBeenCalledWith({
      where: { id: reqItemId },
      data: expect.objectContaining({ quantity: 10 }),
    });
    expect(tx.requisitionItem.deleteMany).not.toHaveBeenCalled();
  });

  it('en PARTIALLY_PURCHASED compras puede agregar línea nueva', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftReq({ status: 'PARTIALLY_PURCHASED' }) as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    tx.requisitionItem.update.mockResolvedValue({
      id: reqItemId,
      quantity: 2,
      description: 'Línea 1',
      unitOfMeasure: 'UN',
      inventoryItemId: itemId,
    } as never);
    tx.requisitionItem.create.mockResolvedValue({
      id: 'line-partial-new',
      quantity: 4,
      description: 'Línea adicional',
      unitOfMeasure: 'UN',
      inventoryItemId: itemId,
    } as never);
    tx.purchaseRequisition.update.mockResolvedValue({
      ...draftReq({ status: 'PARTIALLY_PURCHASED' }),
      items: [
        {
          id: reqItemId,
          quantity: 2,
          description: 'Línea 1',
          unitOfMeasure: 'UN',
          inventoryItemId: itemId,
        },
        {
          id: 'line-partial-new',
          quantity: 4,
          description: 'Línea adicional',
          unitOfMeasure: 'UN',
          inventoryItemId: itemId,
        },
      ],
    } as never);

    await service.update(
      requisitionId,
      {
        items: [
          {
            id: reqItemId,
            description: 'Línea 1',
            quantity: 2,
            unitOfMeasure: 'UN',
            inventoryItemId: itemId,
          },
          {
            description: 'Línea adicional',
            quantity: 4,
            unitOfMeasure: 'UN',
            inventoryItemId: itemId,
          },
        ],
      },
      purchaser,
    );

    expect(tx.requisitionItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requisitionId,
          description: 'Línea adicional',
          quantity: 4,
        }),
      }),
    );
  });

  it('en PENDING_APPROVAL compras puede eliminar línea sin cotización', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(draftReq({ status: 'PENDING_APPROVAL' }) as never);
    prisma.inventoryItem.findMany.mockResolvedValue([{ id: itemId }] as never);
    tx.quotationItem.count.mockResolvedValue(0);
    tx.requisitionItem.delete.mockResolvedValue({ id: reqItemId } as never);
    tx.requisitionItem.create.mockResolvedValue({
      id: 'line-replacement',
      quantity: 1,
      description: 'Única línea',
      unitOfMeasure: 'UN',
      inventoryItemId: itemId,
    } as never);
    tx.purchaseRequisition.update.mockResolvedValue({
      ...draftReq({ status: 'PENDING_APPROVAL' }),
      items: [
        {
          id: 'line-replacement',
          quantity: 1,
          description: 'Única línea',
          unitOfMeasure: 'UN',
          inventoryItemId: itemId,
        },
      ],
    } as never);

    await service.update(
      requisitionId,
      {
        items: [
          {
            description: 'Única línea',
            quantity: 1,
            unitOfMeasure: 'UN',
            inventoryItemId: itemId,
          },
        ],
      },
      purchaser,
    );

    expect(tx.requisitionItem.delete).toHaveBeenCalledWith({
      where: { id: reqItemId },
    });
    expect(tx.quotationItem.count).toHaveBeenCalledWith({
      where: { requisitionItemId: reqItemId },
    });
  });
});
