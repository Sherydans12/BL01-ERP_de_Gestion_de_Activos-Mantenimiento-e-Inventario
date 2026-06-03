import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

jest.mock('./purchase-contract-access.util');
jest.mock('./purchase-requisition-auto-close.util', () => ({
  requisitionIdFromPurchaseOrder: jest.fn().mockReturnValue(null),
  tryAutoCloseRequisitionIfFullyReconciled: jest.fn(),
}));

const mockAssertContractAccess = jest.mocked(assertUserHasContractAccess);

describe('PurchaseInvoicesService', () => {
  let service: PurchaseInvoicesService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const invoiceId = '22222222-2222-2222-2222-222222222222';
  const poId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';

  const poAmount = new Prisma.Decimal(10000);
  const invoiceAmount = new Prisma.Decimal(10000);

  function buildInvoice(
    overrides: Partial<{
      status: string;
      totalAmount: Prisma.Decimal;
    }> = {},
  ) {
    return {
      id: invoiceId,
      tenantId,
      status: overrides.status ?? 'PENDING',
      totalAmount: overrides.totalAmount ?? invoiceAmount,
      invoiceNumber: 'F-001',
      pdfUrl: null,
      purchaseOrderId: poId,
      threeWayMatchOverruled: false,
      purchaseOrder: {
        id: poId,
        totalAmount: poAmount,
        contractId: '55555555-5555-5555-5555-555555555555',
        correlative: 'OC-001',
        requisitionId: null,
      },
      vendor: { id: 'v1', name: 'Proveedor', code: 'P1' },
      emissionDate: new Date('2024-06-01'),
      dueDate: new Date('2024-07-01'),
      netAmount: null,
      taxAmount: null,
    };
  }

  function invoiceEntity(
    overrides: Partial<{
      status: string;
      totalAmount: Prisma.Decimal;
      threeWayMatchOverruled: boolean;
    }> = {},
  ) {
    return {
      ...buildInvoice(overrides),
      threeWayMatchOverruled: overrides.threeWayMatchOverruled ?? false,
    };
  }

  function setupThreeWayPrismaMocks(
    invoice: ReturnType<typeof buildInvoice>,
    receivedLines: Array<{ qty: number; unitCost: number }>,
  ): void {
    prisma.purchaseInvoice.findFirst.mockResolvedValue(invoice as never);
    prisma.purchaseInvoice.findMany.mockResolvedValue([] as never);
    prisma.purchaseCreditNote.findMany.mockResolvedValue([] as never);
    prisma.purchaseSettings.findUnique.mockResolvedValue({
      invoiceMatchTolerancePercent: new Prisma.Decimal(1),
    } as never);
    prisma.warehouseReceipt.findMany.mockResolvedValue(
      receivedLines.length
        ? [
            {
              items: receivedLines.map((l) => ({
                quantityReceived: l.qty,
                orderItem: { unitCost: new Prisma.Decimal(l.unitCost) },
              })),
            },
          ]
        : ([] as never),
    );
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      requisitionId: null,
      quotation: null,
    } as never);
    prisma.activityLog.findMany.mockResolvedValue([] as never);
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.purchaseInvoice.update.mockImplementation(async ({ data }) => ({
        ...invoice,
        ...data,
        vendor: invoice.vendor,
        purchaseOrder: invoice.purchaseOrder,
      }));
      tx.activityLog.findMany.mockResolvedValue([]);
      tx.activityLog.create.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseInvoicesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: {
            sendNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AuditService, useValue: { log: jest.fn() } },
        {
          provide: StorageService,
          useValue: { getReadOnlyUrl: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get(PurchaseInvoicesService);
    mockAssertContractAccess.mockImplementation(() => undefined);
  });

  describe('computeReceivedAmountForPurchaseOrder', () => {
    it('suma cantidad recibida × costo unitario de líneas de recepción', async () => {
      prisma.warehouseReceipt.findMany.mockResolvedValue([
        {
          items: [
            {
              quantityReceived: 5,
              orderItem: { unitCost: new Prisma.Decimal(100) },
            },
            {
              quantityReceived: 2,
              orderItem: { unitCost: new Prisma.Decimal(250) },
            },
          ],
        },
      ] as never);

      const total = await service.computeReceivedAmountForPurchaseOrder(poId);

      expect(total.toNumber()).toBe(1000);
    });

    it('devuelve cero sin recepciones operativas', async () => {
      prisma.warehouseReceipt.findMany.mockResolvedValue([] as never);

      const total = await service.computeReceivedAmountForPurchaseOrder(poId);

      expect(total.toNumber()).toBe(0);
    });
  });

  describe('validateInvoiceMatch — 3-way', () => {
    it('rechaza factura inexistente', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(null);

      await expect(
        service.validateInvoiceMatch(invoiceId, tenantId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza revalidación de factura ya pagada', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        buildInvoice({ status: 'PAID' }) as never,
      );

      await expect(
        service.validateInvoiceMatch(invoiceId, tenantId, userId),
      ).rejects.toThrow(/ya marcada como pagada/);
    });

    it('marca MATCHED cuando factura, OC y recepción están alineados', async () => {
      const invoice = buildInvoice();
      setupThreeWayPrismaMocks(invoice, [{ qty: 10, unitCost: 1000 }]);

      const result = await service.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.match.matchPo).toBe(true);
      expect(result.match.matchReceived).toBe(true);
      expect(result.match.reasons).toHaveLength(0);
      expect(tx.purchaseInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'MATCHED' },
        }),
      );
    });

    it('marca DISCREPANCY cuando el monto facturado supera la OC', async () => {
      const invoice = buildInvoice({
        totalAmount: new Prisma.Decimal(20000),
      });
      setupThreeWayPrismaMocks(invoice, [{ qty: 10, unitCost: 1000 }]);

      const result = await service.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.match.matchPo).toBe(false);
      expect(result.match.reasons.length).toBeGreaterThan(0);
      expect(tx.purchaseInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'DISCREPANCY' },
        }),
      );
      expect(tx.activityLog.create).toHaveBeenCalled();
    });

    it('marca DISCREPANCY cuando factura supera valor recepcionado', async () => {
      const invoice = buildInvoice();
      setupThreeWayPrismaMocks(invoice, [{ qty: 2, unitCost: 1000 }]);

      const result = await service.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.match.matchReceived).toBe(false);
      expect(result.status).toBe('DISCREPANCY');
    });

    it('marca MATCHED dentro del margen de tolerancia vs OC', async () => {
      const invoice = buildInvoice({
        totalAmount: new Prisma.Decimal(10050),
      });
      setupThreeWayPrismaMocks(invoice, [{ qty: 10, unitCost: 1000 }]);

      const result = await service.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.match.matchPo).toBe(true);
      expect(result.match.matchReceived).toBe(true);
      expect(result.status).toBe('MATCHED');
    });

    it('revoca overrule si la recepción ya no cubre la factura', async () => {
      const invoice = {
        ...buildInvoice({ status: 'DISCREPANCY' }),
        threeWayMatchOverruled: true,
      };
      prisma.purchaseInvoice.findFirst
        .mockResolvedValueOnce(invoice as never)
        .mockResolvedValueOnce({
          ...invoice,
          threeWayMatchOverruled: false,
        } as never);
      prisma.purchaseInvoice.findMany.mockResolvedValue([] as never);
      prisma.purchaseCreditNote.findMany.mockResolvedValue([] as never);
      prisma.purchaseSettings.findUnique.mockResolvedValue({
        invoiceMatchTolerancePercent: new Prisma.Decimal(1),
      } as never);
      prisma.warehouseReceipt.findMany.mockResolvedValue([
        {
          items: [
            {
              quantityReceived: 2,
              orderItem: { unitCost: new Prisma.Decimal(1000) },
            },
          ],
        },
      ] as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        requisitionId: null,
        quotation: null,
      } as never);
      prisma.activityLog.findMany.mockResolvedValue([] as never);
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.purchaseInvoice.update.mockImplementation(async ({ data }) => ({
          ...invoice,
          ...data,
          vendor: invoice.vendor,
          purchaseOrder: invoice.purchaseOrder,
        }));
        tx.activityLog.create.mockResolvedValue({} as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(prisma.purchaseInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: invoiceId },
          data: expect.objectContaining({
            threeWayMatchOverruled: false,
            threeWayMatchOverruledAt: null,
          }),
        }),
      );
      expect(result.match.matchReceived).toBe(false);
      expect(result.status).toBe('DISCREPANCY');
    });

    it('concilia monto neto restando notas de crédito de la OC', async () => {
      const invoice = buildInvoice({
        totalAmount: new Prisma.Decimal(10500),
      });
      setupThreeWayPrismaMocks(invoice, [{ qty: 10, unitCost: 1000 }]);
      prisma.purchaseCreditNote.findMany.mockResolvedValue([
        { totalAmount: new Prisma.Decimal(500) },
      ] as never);

      const result = await service.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.match.creditNotesAmount).toBe(500);
      expect(result.status).toBe('MATCHED');
    });
  });

  describe('create', () => {
    const user = {
      id: userId,
      tenantId,
      role: 'ADMIN' as const,
    };
    const vendorId = '66666666-6666-6666-6666-666666666666';
    const contractId = '55555555-5555-5555-5555-555555555555';

    it('rechaza factura si la OC no está en estado facturable', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: poId,
        tenantId,
        contractId,
        status: 'DRAFT',
        correlative: 'OC-001',
        quotation: { vendorId },
      } as never);

      await expect(
        service.create(
          {
            purchaseOrderId: poId,
            vendorId,
            invoiceNumber: 'F-900',
            emissionDate: '2024-06-01',
            totalAmount: 5000,
          },
          user,
        ),
      ).rejects.toThrow(/debe estar aprobada/);
    });

    it('encadena validateInvoiceMatch al crear factura en OC PARTIALLY_RECEIVED', async () => {
      const createdInvoice = {
        ...buildInvoice(),
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        invoiceNumber: 'F-PARCIAL',
        emissionDate: new Date('2024-06-01'),
        dueDate: new Date('2024-07-01'),
      };

      prisma.purchaseInvoice.create.mockResolvedValue(createdInvoice as never);
      prisma.vendor.findFirst.mockResolvedValue({
        name: 'Proveedor',
        code: 'P1',
      } as never);
      setupThreeWayPrismaMocks(createdInvoice, [{ qty: 4, unitCost: 1000 }]);
      prisma.purchaseOrder.findFirst
        .mockResolvedValueOnce({
          id: poId,
          tenantId,
          contractId,
          status: 'PARTIALLY_RECEIVED',
          correlative: 'OC-001',
          quotation: { vendorId },
        } as never)
        .mockResolvedValue({ requisitionId: null, quotation: null } as never);

      const result = await service.create(
        {
          purchaseOrderId: poId,
          vendorId,
          invoiceNumber: 'F-PARCIAL',
          emissionDate: '2024-06-01',
          totalAmount: 10000,
        },
        user,
      );

      expect(prisma.purchaseInvoice.create).toHaveBeenCalled();
      expect(result.match.matchReceived).toBe(false);
      expect(result.status).toBe('DISCREPANCY');
      expect(tx.purchaseInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'DISCREPANCY' },
        }),
      );
    });

    it('en recepción parcial: matchReceived ok pero DISCREPANCY si factura no calza con OC', async () => {
      const createdInvoice = {
        ...buildInvoice({ totalAmount: new Prisma.Decimal(4000) }),
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        invoiceNumber: 'F-OK-PARCIAL',
        emissionDate: new Date('2024-06-01'),
        dueDate: new Date('2024-07-01'),
      };

      prisma.purchaseInvoice.create.mockResolvedValue(createdInvoice as never);
      prisma.vendor.findFirst.mockResolvedValue({
        name: 'Proveedor',
        code: 'P1',
      } as never);
      setupThreeWayPrismaMocks(createdInvoice, [{ qty: 4, unitCost: 1000 }]);
      prisma.purchaseOrder.findFirst
        .mockResolvedValueOnce({
          id: poId,
          tenantId,
          contractId,
          status: 'PARTIALLY_RECEIVED',
          correlative: 'OC-001',
          quotation: { vendorId },
        } as never)
        .mockResolvedValue({ requisitionId: null, quotation: null } as never);

      const result = await service.create(
        {
          purchaseOrderId: poId,
          vendorId,
          invoiceNumber: 'F-OK-PARCIAL',
          emissionDate: '2024-06-01',
          totalAmount: 4000,
        },
        user,
      );

      expect(result.match.matchReceived).toBe(true);
      expect(result.match.matchPo).toBe(false);
      expect(result.status).toBe('DISCREPANCY');
    });
  });

  describe('update', () => {
    const user = {
      id: userId,
      tenantId,
      role: 'ADMIN' as const,
    };

    it('rechaza editar factura ya pagada', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        invoiceEntity({ status: 'PAID' }) as never,
      );

      await expect(
        service.update(invoiceId, { invoiceNumber: 'F-EDIT' }, user),
      ).rejects.toThrow(/marcada como pagada/);
    });

    it('rechaza update sin campos', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        invoiceEntity() as never,
      );

      await expect(service.update(invoiceId, {}, user)).rejects.toThrow(
        /campos para actualizar/,
      );
    });

    it('revoca overrule y encadena validateInvoiceMatch al cambiar totalAmount', async () => {
      const inv = invoiceEntity({
        status: 'DISCREPANCY',
        threeWayMatchOverruled: true,
      });
      const fresh = {
        ...inv,
        totalAmount: new Prisma.Decimal(12000),
      };
      prisma.purchaseInvoice.findFirst
        .mockResolvedValueOnce(inv as never)
        .mockResolvedValueOnce(fresh as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId: inv.purchaseOrder.contractId,
      } as never);
      prisma.purchaseInvoice.update.mockResolvedValue({} as never);
      const validateSpy = jest
        .spyOn(service, 'validateInvoiceMatch')
        .mockResolvedValue({ status: 'DISCREPANCY' } as never);

      await service.update(invoiceId, { totalAmount: 12000 }, user);

      expect(prisma.purchaseInvoice.update).toHaveBeenCalledWith({
        where: { id: invoiceId },
        data: expect.objectContaining({
          status: 'PENDING',
          threeWayMatchOverruled: false,
          totalAmount: expect.any(Prisma.Decimal),
        }),
      });
      expect(validateSpy).toHaveBeenCalledWith(invoiceId, tenantId, userId);
      validateSpy.mockRestore();
    });
  });

  describe('markPaid', () => {
    const user = {
      id: userId,
      tenantId,
      role: 'ADMIN' as const,
    };

    it('rechaza marcar pagada si no está MATCHED', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        invoiceEntity({ status: 'DISCREPANCY' }) as never,
      );

      await expect(service.markPaid(invoiceId, user)).rejects.toThrow(
        /match 3-way OK/,
      );
    });

    it('marca factura MATCHED como PAID', async () => {
      const inv = invoiceEntity({ status: 'MATCHED' });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(inv as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId: inv.purchaseOrder.contractId,
      } as never);
      prisma.purchaseInvoice.update.mockResolvedValue({
        ...inv,
        status: 'PAID',
        paidAt: new Date('2024-06-15'),
      } as never);

      const result = await service.markPaid(invoiceId, user);

      expect(result.status).toBe('PAID');
      expect(prisma.purchaseInvoice.update).toHaveBeenCalledWith({
        where: { id: invoiceId },
        data: expect.objectContaining({ status: 'PAID' }),
        include: expect.any(Object),
      });
    });
  });

  describe('recordPayment', () => {
    const user = {
      id: userId,
      tenantId,
      role: 'ADMIN' as const,
    };

    it('rechaza referencia de pago vacía', async () => {
      await expect(
        service.recordPayment(invoiceId, '  ', user),
      ).rejects.toThrow(/paymentReference es obligatorio/);
    });

    it('rechaza pago si la factura no está MATCHED', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        invoiceEntity({ status: 'PENDING' }) as never,
      );

      await expect(
        service.recordPayment(invoiceId, 'TRX-9001', user),
      ).rejects.toThrow(/validación 3-way OK/);
    });

    it('registra PAID con paymentReference', async () => {
      const inv = invoiceEntity({ status: 'MATCHED' });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(inv as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId: inv.purchaseOrder.contractId,
      } as never);
      prisma.purchaseInvoice.update.mockResolvedValue({
        ...inv,
        status: 'PAID',
        paymentReference: 'TRX-9001',
        paidAt: new Date('2024-06-20'),
      } as never);

      const result = await service.recordPayment(invoiceId, 'TRX-9001', user);

      expect(result.status).toBe('PAID');
      expect(prisma.purchaseInvoice.update).toHaveBeenCalledWith({
        where: { id: invoiceId },
        data: expect.objectContaining({
          status: 'PAID',
          paymentReference: 'TRX-9001',
        }),
        include: expect.any(Object),
      });
    });
  });

  describe('remove', () => {
    const user = {
      id: userId,
      tenantId,
      role: 'ADMIN' as const,
    };

    it('rechaza eliminar factura PAID', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        invoiceEntity({ status: 'PAID' }) as never,
      );

      await expect(service.remove(invoiceId, user)).rejects.toThrow(
        /marcada como pagada/,
      );
    });

    it('elimina factura no pagada y audita', async () => {
      const inv = invoiceEntity({ status: 'DISCREPANCY' });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(inv as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId: inv.purchaseOrder.contractId,
      } as never);
      prisma.purchaseInvoice.delete.mockResolvedValue(inv as never);

      await service.remove(invoiceId, user);

      expect(prisma.purchaseInvoice.delete).toHaveBeenCalledWith({
        where: { id: invoiceId },
      });
    });
  });

  describe('overruleThreeWayMatch', () => {
    const user = {
      id: userId,
      tenantId,
      role: 'ADMIN' as const,
    };

    const justification =
      'Entrega parcial autorizada por gerencia de operaciones.';

    function setupOverruleInvoice(
      invoiceTotal: number,
      receivedLines: Array<{ qty: number; unitCost: number }>,
    ) {
      const invoice = buildInvoice({
        status: 'DISCREPANCY',
        totalAmount: new Prisma.Decimal(invoiceTotal),
      });
      prisma.purchaseInvoice.findFirst.mockResolvedValue(invoice as never);
      prisma.purchaseInvoice.findMany.mockResolvedValue([] as never);
      prisma.purchaseCreditNote.findMany.mockResolvedValue([] as never);
      prisma.purchaseSettings.findUnique.mockResolvedValue({
        invoiceMatchTolerancePercent: new Prisma.Decimal(1),
      } as never);
      prisma.warehouseReceipt.findMany.mockResolvedValue(
        receivedLines.length
          ? [
              {
                items: receivedLines.map((l) => ({
                  quantityReceived: l.qty,
                  orderItem: { unitCost: new Prisma.Decimal(l.unitCost) },
                })),
              },
            ]
          : ([] as never),
      );
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        requisitionId: null,
        quotation: null,
      } as never);
      prisma.activityLog.findMany.mockResolvedValue([] as never);
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.purchaseInvoice.update.mockResolvedValue({
          ...invoice,
          status: 'MATCHED',
          threeWayMatchOverruled: true,
          vendor: invoice.vendor,
          purchaseOrder: invoice.purchaseOrder,
        } as never);
        tx.activityLog.create.mockResolvedValue({} as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });
    }

    it('rechaza justificación menor a 15 caracteres', async () => {
      await expect(
        service.overruleThreeWayMatch(invoiceId, 'corta', user),
      ).rejects.toThrow(/al menos 15 caracteres/);
    });

    it('rechaza factura inexistente', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(null);

      await expect(
        service.overruleThreeWayMatch(invoiceId, justification, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza si la factura no está en DISCREPANCY', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        buildInvoice({ status: 'PENDING' }) as never,
      );

      await expect(
        service.overruleThreeWayMatch(invoiceId, justification, user),
      ).rejects.toThrow(/estado DISCREPANCY/);
    });

    it('rechaza overrule si factura supera lo recepcionado en bodega', async () => {
      setupOverruleInvoice(20000, [{ qty: 5, unitCost: 1000 }]);

      await expect(
        service.overruleThreeWayMatch(invoiceId, justification, user),
      ).rejects.toThrow(/supera el stock físico ingresado/);
    });

    it('acepta discrepancia short-shipment cuando factura ≤ recepcionado', async () => {
      setupOverruleInvoice(8000, [{ qty: 10, unitCost: 1000 }]);

      const result = await service.overruleThreeWayMatch(
        invoiceId,
        justification,
        user,
      );

      expect(result.status).toBe('MATCHED');
      expect(result.threeWayMatchOverruled).toBe(true);
      expect(tx.purchaseInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'MATCHED',
            threeWayMatchOverruleNotes: justification,
          }),
        }),
      );
      expect(tx.activityLog.create).toHaveBeenCalled();
    });

    it('rechaza overrule sin acceso al contrato de la OC', async () => {
      prisma.purchaseInvoice.findFirst.mockResolvedValue(
        buildInvoice({ status: 'DISCREPANCY' }) as never,
      );
      mockAssertContractAccess.mockImplementation(() => {
        throw new ForbiddenException('Sin contrato');
      });

      await expect(
        service.overruleThreeWayMatch(invoiceId, justification, user),
      ).rejects.toThrow(ForbiddenException);

      mockAssertContractAccess.mockImplementation(() => undefined);
    });

    it('rechaza overrule si factura vs OC no calza y supera recepción', async () => {
      setupOverruleInvoice(25000, [{ qty: 5, unitCost: 1000 }]);

      await expect(
        service.overruleThreeWayMatch(invoiceId, justification, user),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
