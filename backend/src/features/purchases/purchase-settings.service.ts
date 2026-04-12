import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PurchaseSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(tenantId: string) {
    let settings = await this.prisma.purchaseSettings.findUnique({
      where: { tenantId },
      include: {
        approvalPolicies: {
          include: { role: { select: { id: true, name: true, baseRole: true } } },
          orderBy: { level: 'asc' },
        },
      },
    });

    if (!settings) {
      settings = await this.prisma.purchaseSettings.create({
        data: { tenantId, approvalThreshold: 0, currency: 'CLP' },
        include: {
          approvalPolicies: {
            include: { role: { select: { id: true, name: true, baseRole: true } } },
            orderBy: { level: 'asc' },
          },
        },
      });
    }

    return settings;
  }

  async updateSettings(
    tenantId: string,
    data: { approvalThreshold?: number; currency?: string },
  ) {
    const settings = await this.getSettings(tenantId);
    return this.prisma.purchaseSettings.update({
      where: { id: settings.id },
      data: {
        approvalThreshold: data.approvalThreshold,
        currency: data.currency,
      },
      include: {
        approvalPolicies: {
          include: { role: { select: { id: true, name: true, baseRole: true } } },
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

    return this.prisma.$transaction(async (tx) => {
      await tx.approvalPolicy.deleteMany({
        where: { purchaseSettingsId: settings.id },
      });

      if (policies.length > 0) {
        await tx.approvalPolicy.createMany({
          data: policies.map((p) => ({
            purchaseSettingsId: settings.id,
            tenantId,
            level: p.level,
            description: p.description,
            roleId: p.roleId,
            minAmount: p.minAmount ?? 0,
          })),
        });
      }

      return tx.approvalPolicy.findMany({
        where: { purchaseSettingsId: settings.id },
        include: { role: { select: { id: true, name: true, baseRole: true } } },
        orderBy: { level: 'asc' },
      });
    });
  }
}
