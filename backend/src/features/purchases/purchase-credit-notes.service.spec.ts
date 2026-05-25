import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../../common/storage/storage.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import {
  CreateCreditNoteDto,
  PurchaseCreditNotesService,
} from './purchase-credit-notes.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

jest.mock('./purchase-contract-access.util');
jest.mock('./purchase-requisition-auto-close.util', () => ({
  requisitionIdFromPurchaseOrder: jest.fn().mockReturnValue(null),
  tryAutoCloseRequisitionIfFullyReconciled: jest.fn(),
}));

const mockAssertContractAccess = jest.mocked(assertUserHasContractAccess);

describe('PurchaseCreditNotesService', () => {
  let service: PurchaseCreditNotesService;
  let prisma: DeepMockProxy<PrismaService>;
  let validateInvoiceMatch: jest.Mock;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const poId = '22222222-2222-2222-2222-222222222222';
  const userId = '33333333-3333-3333-3333-333333333333';
  const contractId = '44444444-4444-4444-4444-444444444444';
  const creditNoteId = '55555555-5555-5555-5555-555555555555';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  const baseDto: CreateCreditNoteDto = {
    purchaseOrderId: poId,
    creditNoteNumber: 'NC-001',
    emissionDate: '2026-05-22',
    totalAmount: 1500,
    notes: 'Ajuste por diferencia',
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    validateInvoiceMatch = jest.fn().mockResolvedValue({});
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseCreditNotesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: PurchaseInvoicesService,
          useValue: { validateInvoiceMatch },
        },
      ],
    }).compile();

    service = module.get(PurchaseCreditNotesService);
  });

  describe('create', () => {
    it('rechaza monto no positivo', async () => {
      await expect(
        service.create({ ...baseDto, totalAmount: 0 }, user),
      ).rejects.toThrow(/debe ser mayor a 0/);
    });

    it('rechaza fecha de emisión inválida', async () => {
      await expect(
        service.create({ ...baseDto, emissionDate: 'no-es-fecha' }, user),
      ).rejects.toThrow(/emissionDate inválida/);
    });

    it('rechaza OC inexistente', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue(null);

      await expect(service.create(baseDto, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza factura que no pertenece a la OC', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: poId,
        contractId,
      } as never);
      prisma.purchaseInvoice.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, purchaseInvoiceId: 'inv-x' }, user),
      ).rejects.toThrow(/no pertenece a esta Orden de Compra/);
    });

    it('mapea P2002 a ConflictException por número duplicado', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: poId,
        contractId,
      } as never);
      prisma.purchaseCreditNote.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.create(baseDto, user)).rejects.toThrow(
        ConflictException,
      );
    });

    it('crea nota de crédito, audita y revalida 3-way de facturas activas', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: poId,
        contractId,
      } as never);
      prisma.purchaseCreditNote.create.mockResolvedValue({
        id: creditNoteId,
        creditNoteNumber: 'NC-001',
        totalAmount: new Prisma.Decimal(1500),
        purchaseOrderId: poId,
        purchaseInvoiceId: null,
        emissionDate: new Date('2026-05-22'),
      } as never);
      prisma.purchaseInvoice.findMany.mockResolvedValue([
        { id: 'inv-1' },
        { id: 'inv-2' },
      ] as never);

      const result = await service.create(baseDto, user);

      expect(result.id).toBe(creditNoteId);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'PURCHASE_CREDIT_NOTE',
          action: 'CREATE',
        }),
      );
      expect(validateInvoiceMatch).toHaveBeenCalledTimes(2);
      expect(validateInvoiceMatch).toHaveBeenCalledWith(
        'inv-1',
        tenantId,
        userId,
      );
    });
  });

  describe('remove', () => {
    it('rechaza nota inexistente', async () => {
      prisma.purchaseCreditNote.findFirst.mockResolvedValue(null);

      await expect(service.remove(creditNoteId, user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('elimina nota y revalida facturas de la OC', async () => {
      prisma.purchaseCreditNote.findFirst.mockResolvedValue({
        id: creditNoteId,
        tenantId,
        purchaseOrderId: poId,
        creditNoteNumber: 'NC-001',
        totalAmount: new Prisma.Decimal(1500),
      } as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId,
      } as never);
      prisma.purchaseInvoice.findMany.mockResolvedValue([{ id: 'inv-1' }] as never);

      await service.remove(creditNoteId, user);

      expect(prisma.purchaseCreditNote.delete).toHaveBeenCalledWith({
        where: { id: creditNoteId },
      });
      expect(validateInvoiceMatch).toHaveBeenCalledWith(
        'inv-1',
        tenantId,
        userId,
      );
    });
  });

  describe('conciliación 3-way (monto neto facturas − NC)', () => {
    let invoicesService: PurchaseInvoicesService;
    let invoicePrisma: DeepMockProxy<PrismaService>;
    let invoiceTx: DeepMockProxy<Prisma.TransactionClient>;

    const invoiceId = '66666666-6666-6666-6666-666666666666';
    const poAmount = new Prisma.Decimal(10000);
    const invoiceAmount = new Prisma.Decimal(10000);

    beforeEach(async () => {
      invoicePrisma = mockDeep<PrismaService>();
      invoiceTx = mockDeep<Prisma.TransactionClient>();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PurchaseInvoicesService,
          { provide: PrismaService, useValue: invoicePrisma },
          {
            provide: NotificationsService,
            useValue: { sendNotification: jest.fn() },
          },
          { provide: AuditService, useValue: { log: jest.fn() } },
          {
            provide: StorageService,
            useValue: { getReadOnlyUrl: jest.fn().mockResolvedValue(null) },
          },
        ],
      }).compile();

      invoicesService = module.get(PurchaseInvoicesService);
    });

    function setupInvoiceThreeWay(
      creditNotes: Array<{ totalAmount: Prisma.Decimal }>,
      receivedQty: number,
    ) {
      const invoice = {
        id: invoiceId,
        tenantId,
        status: 'PENDING',
        totalAmount: invoiceAmount,
        invoiceNumber: 'F-100',
        pdfUrl: null,
        purchaseOrderId: poId,
        threeWayMatchOverruled: false,
        purchaseOrder: {
          id: poId,
          totalAmount: poAmount,
          contractId,
          correlative: 'OC-100',
          requisitionId: null,
        },
        vendor: { id: 'v1', name: 'Proveedor', code: 'P1' },
        emissionDate: new Date('2026-05-01'),
        dueDate: new Date('2026-06-01'),
        netAmount: null,
        taxAmount: null,
      };

      invoicePrisma.purchaseInvoice.findFirst.mockResolvedValue(invoice as never);
      // Hermanas excluyen la factura actual; acumulado = siblings + invoice.totalAmount.
      invoicePrisma.purchaseInvoice.findMany.mockResolvedValue([] as never);
      invoicePrisma.purchaseCreditNote.findMany.mockResolvedValue(
        creditNotes as never,
      );
      invoicePrisma.purchaseSettings.findUnique.mockResolvedValue({
        invoiceMatchTolerancePercent: new Prisma.Decimal(1),
      } as never);
      invoicePrisma.warehouseReceipt.findMany.mockResolvedValue([
        {
          items: [
            {
              quantityReceived: receivedQty,
              orderItem: { unitCost: new Prisma.Decimal(1000) },
            },
          ],
        },
      ] as never);
      invoicePrisma.purchaseOrder.findFirst.mockResolvedValue({
        requisitionId: null,
        quotation: null,
      } as never);
      invoicePrisma.activityLog.findMany.mockResolvedValue([] as never);
      invoicePrisma.$transaction.mockImplementation(async (fn) => {
        invoiceTx.purchaseInvoice.update.mockImplementation(async ({ data }) => ({
          ...invoice,
          ...data,
          vendor: invoice.vendor,
          purchaseOrder: invoice.purchaseOrder,
        }));
        invoiceTx.activityLog.findMany.mockResolvedValue([]);
        invoiceTx.activityLog.create.mockResolvedValue({} as never);
        return (fn as (client: typeof invoiceTx) => Promise<unknown>)(invoiceTx);
      });
    }

    it('MATCHED cuando monto neto (factura − NC) está alineado con OC y recepción', async () => {
      setupInvoiceThreeWay([{ totalAmount: new Prisma.Decimal(0) }], 10);

      const result = await invoicesService.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.status).toBe('MATCHED');
      expect(result.match.matchPo).toBe(true);
      expect(result.match.matchReceived).toBe(true);
    });

    it('pasa a MATCHED cuando NC reduce el neto (10000 − 3000) al monto de la OC', async () => {
      const poNet = new Prisma.Decimal(7000);
      const invoice = {
        id: invoiceId,
        tenantId,
        status: 'PENDING',
        totalAmount: invoiceAmount,
        invoiceNumber: 'F-100',
        pdfUrl: null,
        purchaseOrderId: poId,
        threeWayMatchOverruled: false,
        purchaseOrder: {
          id: poId,
          totalAmount: poNet,
          contractId,
          correlative: 'OC-100',
          requisitionId: null,
        },
        vendor: { id: 'v1', name: 'Proveedor', code: 'P1' },
        emissionDate: new Date('2026-05-01'),
        dueDate: new Date('2026-06-01'),
        netAmount: null,
        taxAmount: null,
      };

      invoicePrisma.purchaseInvoice.findFirst.mockResolvedValue(invoice as never);
      // Hermanas excluyen la factura actual; acumulado = siblings + invoice.totalAmount.
      invoicePrisma.purchaseInvoice.findMany.mockResolvedValue([] as never);
      invoicePrisma.purchaseCreditNote.findMany.mockResolvedValue([
        { totalAmount: new Prisma.Decimal(3000) },
      ] as never);
      invoicePrisma.purchaseSettings.findUnique.mockResolvedValue({
        invoiceMatchTolerancePercent: new Prisma.Decimal(1),
      } as never);
      invoicePrisma.warehouseReceipt.findMany.mockResolvedValue([
        {
          items: [
            {
              quantityReceived: 7,
              orderItem: { unitCost: new Prisma.Decimal(1000) },
            },
          ],
        },
      ] as never);
      invoicePrisma.purchaseOrder.findFirst.mockResolvedValue({
        requisitionId: null,
        quotation: null,
      } as never);
      invoicePrisma.activityLog.findMany.mockResolvedValue([] as never);
      invoicePrisma.$transaction.mockImplementation(async (fn) => {
        invoiceTx.purchaseInvoice.update.mockImplementation(async ({ data }) => ({
          ...invoice,
          ...data,
          vendor: invoice.vendor,
          purchaseOrder: invoice.purchaseOrder,
        }));
        invoiceTx.activityLog.findMany.mockResolvedValue([]);
        invoiceTx.activityLog.create.mockResolvedValue({} as never);
        return (fn as (client: typeof invoiceTx) => Promise<unknown>)(invoiceTx);
      });

      const result = await invoicesService.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.status).toBe('MATCHED');
      expect(result.match.matchPo).toBe(true);
      expect(result.match.matchReceived).toBe(true);
    });

    it('DISCREPANCY cuando el neto facturado (factura − NC) supera lo recepcionado', async () => {
      setupInvoiceThreeWay([{ totalAmount: new Prisma.Decimal(2000) }], 5);

      const result = await invoicesService.validateInvoiceMatch(
        invoiceId,
        tenantId,
        userId,
      );

      expect(result.match.matchReceived).toBe(false);
      expect(result.status).toBe('DISCREPANCY');
    });
  });

  describe('remove — OC cerrada', () => {
    it('elimina NC aunque la OC esté CLOSED (sin bloqueo en servicio hoy)', async () => {
      prisma.purchaseCreditNote.findFirst.mockResolvedValue({
        id: creditNoteId,
        tenantId,
        purchaseOrderId: poId,
        creditNoteNumber: 'NC-001',
        totalAmount: new Prisma.Decimal(1500),
      } as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId,
        status: 'CLOSED',
      } as never);
      prisma.purchaseInvoice.findMany.mockResolvedValue([] as never);

      await service.remove(creditNoteId, user);

      expect(prisma.purchaseCreditNote.delete).toHaveBeenCalled();
    });
  });

  describe('findByPurchaseOrder', () => {
    it('lista notas cuando la OC existe y el usuario tiene acceso', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        contractId,
      } as never);
      prisma.purchaseCreditNote.findMany.mockResolvedValue([
        { id: creditNoteId, creditNoteNumber: 'NC-001' },
      ] as never);

      const rows = await service.findByPurchaseOrder(poId, user);

      expect(rows).toHaveLength(1);
      expect(prisma.purchaseCreditNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { purchaseOrderId: poId, tenantId },
        }),
      );
    });
  });
});
