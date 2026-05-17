import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';

export class CreateCreditNoteDto {
  purchaseOrderId!: string;
  purchaseInvoiceId?: string | null;
  creditNoteNumber!: string;
  emissionDate!: string;
  /** Monto positivo de la nota de crédito (reduce el total facturado neto). */
  totalAmount!: number;
  notes?: string | null;
}

@Injectable()
export class PurchaseCreditNotesService {
  private readonly logger = new Logger(PurchaseCreditNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoicesService: PurchaseInvoicesService,
  ) {}

  /** Lista todas las notas de crédito de una OC. */
  async findByPurchaseOrder(
    purchaseOrderId: string,
    user: { tenantId: string; role?: string; allowedContracts?: string[] },
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, tenantId: user.tenantId },
      select: { contractId: true },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    assertUserHasContractAccess(user, order.contractId);

    return this.prisma.purchaseCreditNote.findMany({
      where: { purchaseOrderId, tenantId: user.tenantId },
      orderBy: { emissionDate: 'desc' },
    });
  }

  /** Crea una nota de crédito y re-dispara la validación 3-way de todas las facturas de la OC. */
  async create(
    dto: CreateCreditNoteDto,
    user: { id: string; tenantId: string; role?: string; allowedContracts?: string[] },
  ) {
    const tenantId = user.tenantId;

    if (dto.totalAmount <= 0) {
      throw new BadRequestException(
        'El monto de la nota de crédito debe ser mayor a 0.',
      );
    }

    const emission = new Date(dto.emissionDate);
    if (Number.isNaN(emission.getTime())) {
      throw new BadRequestException('emissionDate inválida.');
    }

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, tenantId },
      select: { contractId: true, id: true },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    assertUserHasContractAccess(user, order.contractId);

    if (dto.purchaseInvoiceId) {
      const inv = await this.prisma.purchaseInvoice.findFirst({
        where: {
          id: dto.purchaseInvoiceId,
          purchaseOrderId: dto.purchaseOrderId,
          tenantId,
        },
        select: { id: true },
      });
      if (!inv) {
        throw new BadRequestException(
          'La factura indicada no pertenece a esta Orden de Compra.',
        );
      }
    }

    let creditNote: Awaited<ReturnType<typeof this.prisma.purchaseCreditNote.create>>;
    try {
      creditNote = await this.prisma.purchaseCreditNote.create({
        data: {
          tenantId,
          purchaseOrderId: dto.purchaseOrderId,
          purchaseInvoiceId: dto.purchaseInvoiceId ?? null,
          creditNoteNumber: dto.creditNoteNumber.trim(),
          emissionDate: emission,
          totalAmount: new Prisma.Decimal(dto.totalAmount),
          notes: dto.notes?.trim() ?? null,
        },
      });
    } catch (e: unknown) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `Ya existe una nota de crédito con número "${dto.creditNoteNumber.trim()}" para esta Orden de Compra.`,
        );
      }
      throw e;
    }

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_CREDIT_NOTE' as any,
      entityId: creditNote.id,
      action: ActivityAction.CREATE,
      newValue: {
        event: 'credit_note_created',
        creditNoteNumber: creditNote.creditNoteNumber,
        totalAmount: Number(creditNote.totalAmount),
        purchaseOrderId: dto.purchaseOrderId,
        purchaseInvoiceId: creditNote.purchaseInvoiceId ?? null,
        emissionDate: creditNote.emissionDate.toISOString(),
      },
      unified: {
        metadata: {
          purchaseOrderId: dto.purchaseOrderId,
          creditNoteId: creditNote.id,
          creditNoteNumber: creditNote.creditNoteNumber,
        },
      },
    });

    // Re-disparar validación 3-way en todas las facturas activas de la OC.
    await this.revalidateAllInvoicesForOrder(dto.purchaseOrderId, tenantId, user.id);

    return creditNote;
  }

  /** Elimina una nota de crédito y re-valida el 3-way. */
  async remove(
    id: string,
    user: { id: string; tenantId: string; role?: string; allowedContracts?: string[] },
  ) {
    const creditNote = await this.prisma.purchaseCreditNote.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!creditNote) throw new NotFoundException('Nota de crédito no encontrada');

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: creditNote.purchaseOrderId, tenantId: user.tenantId },
      select: { contractId: true },
    });
    if (order) assertUserHasContractAccess(user, order.contractId);

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_CREDIT_NOTE' as any,
      entityId: id,
      action: ActivityAction.DELETE,
      oldValue: {
        creditNoteNumber: creditNote.creditNoteNumber,
        totalAmount: Number(creditNote.totalAmount),
        purchaseOrderId: creditNote.purchaseOrderId,
      },
      unified: {
        metadata: {
          purchaseOrderId: creditNote.purchaseOrderId,
          creditNoteId: id,
          event: 'credit_note_deleted',
        },
      },
    });

    await this.prisma.purchaseCreditNote.delete({ where: { id } });
    await this.revalidateAllInvoicesForOrder(
      creditNote.purchaseOrderId,
      user.tenantId,
      user.id,
    );
  }

  /**
   * Dispara `validateInvoiceMatch` en todas las facturas no pagadas de la OC
   * para que sus semáforos reflejen el nuevo monto neto tras la nota de crédito.
   */
  private async revalidateAllInvoicesForOrder(
    purchaseOrderId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        purchaseOrderId,
        tenantId,
        status: { not: 'PAID' },
      },
      select: { id: true },
    });

    await Promise.allSettled(
      invoices.map((inv) =>
        this.invoicesService
          .validateInvoiceMatch(inv.id, tenantId, userId)
          .catch((e: unknown) =>
            this.logger.warn(
              `Re-validación 3-way tras nota de crédito falló para factura ${inv.id}: ${String(e)}`,
            ),
          ),
      ),
    );
  }
}
