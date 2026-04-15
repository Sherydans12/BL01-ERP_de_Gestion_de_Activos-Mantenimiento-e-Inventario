import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PurchaseSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(tenantId: string) {
    let settings = await this.prisma.purchaseSettings.findUnique({
      where: { tenantId },
      include: {
        approvalPolicies: {
          include: {
            role: { select: { id: true, name: true, baseRole: true } },
          },
          orderBy: { level: 'asc' },
        },
      },
    });

    if (!settings) {
      settings = await this.prisma.purchaseSettings.create({
        data: {
          tenantId,
          approvalThreshold: 0,
          currency: 'CLP',
          invoiceMatchTolerancePercent: 1,
        },
        include: {
          approvalPolicies: {
            include: {
              role: { select: { id: true, name: true, baseRole: true } },
            },
            orderBy: { level: 'asc' },
          },
        },
      });
    }

    return settings;
  }

  async updateSettings(
    tenantId: string,
    data: {
      approvalThreshold?: number;
      currency?: string;
      invoiceMatchTolerancePercent?: number;
    },
  ) {
    const settings = await this.getSettings(tenantId);
    return this.prisma.purchaseSettings.update({
      where: { id: settings.id },
      data: {
        approvalThreshold: data.approvalThreshold,
        currency: data.currency,
        invoiceMatchTolerancePercent: data.invoiceMatchTolerancePercent,
      },
      include: {
        approvalPolicies: {
          include: {
            role: { select: { id: true, name: true, baseRole: true } },
          },
          orderBy: { level: 'asc' },
        },
      },
    });
  }

  async getPolicies(tenantId: string) {
    const settings = await this.getSettings(tenantId);
    return settings.approvalPolicies;
  }

  async upsertPolicies(
    tenantId: string,
    policies: Array<{
      level: number;
      description?: string;
      roleId: string;
      minAmount?: number;
    }>,
  ) {
    const settings = await this.getSettings(tenantId);

    const levels = policies.map((p) => p.level);
    if (new Set(levels).size !== levels.length) {
      throw new BadRequestException('Cada nivel debe aparecer solo una vez');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.approvalPolicy.findMany({
        where: { purchaseSettingsId: settings.id },
      });

      const incomingLevels = new Set(policies.map((p) => p.level));

      for (const p of policies) {
        const row = existing.find((e) => e.level === p.level);
        if (row) {
          await tx.approvalPolicy.update({
            where: { id: row.id },
            data: {
              roleId: p.roleId,
              description: p.description,
              minAmount: p.minAmount ?? 0,
            },
          });
        } else {
          await tx.approvalPolicy.create({
            data: {
              purchaseSettingsId: settings.id,
              tenantId,
              level: p.level,
              description: p.description,
              roleId: p.roleId,
              minAmount: p.minAmount ?? 0,
            },
          });
        }
      }

      for (const ex of existing) {
        if (incomingLevels.has(ex.level)) continue;
        const refCount = await tx.purchaseOrderApproval.count({
          where: { policyId: ex.id },
        });
        if (refCount > 0) {
          throw new BadRequestException(
            `No se puede quitar el nivel ${ex.level} del flujo: ya hay órdenes de compra firmadas con esa política. Puede editar el rol del nivel, pero no eliminarlo del historial.`,
          );
        }
        await tx.approvalPolicy.delete({ where: { id: ex.id } });
      }

      return tx.approvalPolicy.findMany({
        where: { purchaseSettingsId: settings.id },
        include: { role: { select: { id: true, name: true, baseRole: true } } },
        orderBy: { level: 'asc' },
      });
    });
  }
}
