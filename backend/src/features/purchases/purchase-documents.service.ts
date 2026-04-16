import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import type { PurchaseDocumentEntity } from '@prisma/client';
import { Response } from 'express';

const FOLDER = 'purchase-docs';

@Injectable()
export class PurchaseDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(
    tenantId: string,
    entity: PurchaseDocumentEntity,
    entityId: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    await this.assertCanAccessEntity(tenantId, entity, entityId, user);
    return this.prisma.purchaseDocument.findMany({
      where: { tenantId, entity, entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async upload(
    tenantId: string,
    userId: string,
    entity: PurchaseDocumentEntity,
    entityId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    await this.assertCanAccessEntity(tenantId, entity, entityId, user);
    const meta = await this.storage.uploadWithMeta(file, FOLDER);
    const row = await this.prisma.purchaseDocument.create({
      data: {
        tenantId,
        entity,
        entityId,
        storageKey: meta.storageKey,
        originalName: meta.originalName,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        uploadedById: userId,
      },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (entity === 'PURCHASE_INVOICE') {
      await this.prisma.purchaseInvoice.updateMany({
        where: { id: entityId, tenantId },
        data: { pdfUrl: meta.publicUrl },
      });
    }

    return {
      ...row,
      downloadUrl: `/api/purchase-documents/${row.id}/file`,
    };
  }

  async streamToResponse(
    id: string,
    tenantId: string,
    res: Response,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const doc = await this.prisma.purchaseDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.assertCanAccessEntity(
      tenantId,
      doc.entity,
      doc.entityId,
      user,
    );
    const stream = await this.storage.getFileStream(doc.storageKey);
    res.setHeader(
      'Content-Type',
      doc.mimeType || 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(doc.originalName)}"`,
    );
    stream.pipe(res);
  }

  private async assertCanAccessEntity(
    tenantId: string,
    entity: PurchaseDocumentEntity,
    entityId: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    if (!user) return;
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return;

    if (entity === 'REQUISITION') {
      const r = await this.prisma.purchaseRequisition.findFirst({
        where: { id: entityId, tenantId },
        select: { contractId: true },
      });
      if (!r) throw new NotFoundException('Requerimiento no encontrado');
      assertUserHasContractAccess(user, r.contractId);
      return;
    }
    if (entity === 'PURCHASE_ORDER') {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: entityId, tenantId },
        select: { contractId: true },
      });
      if (!po) throw new NotFoundException('Orden de compra no encontrada');
      assertUserHasContractAccess(user, po.contractId);
      return;
    }
    if (entity === 'PURCHASE_INVOICE') {
      const inv = await this.prisma.purchaseInvoice.findFirst({
        where: { id: entityId, tenantId },
        include: {
          purchaseOrder: { select: { contractId: true } },
        },
      });
      if (!inv) throw new NotFoundException('Factura no encontrada');
      assertUserHasContractAccess(user, inv.purchaseOrder.contractId);
      return;
    }
    throw new ForbiddenException('Entidad no soportada');
  }

  async delete(
    id: string,
    tenantId: string,
    userId: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const doc = await this.prisma.purchaseDocument.findFirst({
      where: { id, tenantId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    await this.assertCanAccessEntity(tenantId, doc.entity, doc.entityId, user);
    await this.storage.deleteFile(doc.storageKey);
    await this.prisma.purchaseDocument.delete({ where: { id: doc.id } });
    return { ok: true };
  }
}
