import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const POLICY_INCLUDE = {
  allowedUsers: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          customRole: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class PurchaseSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(tenantId: string) {
    let settings = await this.prisma.purchaseSettings.findUnique({
      where: { tenantId },
      include: {
        approvalPolicies: {
          include: POLICY_INCLUDE,
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
            include: POLICY_INCLUDE,
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
          include: POLICY_INCLUDE,
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
      userIds: string[];
      minAmount?: number;
    }>,
  ) {
    const settings = await this.getSettings(tenantId);

    const levels = policies.map((p) => p.level);
    if (new Set(levels).size !== levels.length) {
      throw new BadRequestException('Cada nivel debe aparecer solo una vez');
    }

    for (const p of policies) {
      if (!p.userIds?.length) {
        throw new BadRequestException(
          `El nivel ${p.level} no tiene usuarios autorizados asignados. Cada nivel debe tener al menos un firmante.`,
        );
      }
    }

    // Validar que todos los userIds pertenecen al mismo tenant
    const allUserIds = [...new Set(policies.flatMap((p) => p.userIds))];
    const existingUsers = await this.prisma.user.findMany({
      where: { id: { in: allUserIds }, tenantId },
      select: { id: true },
    });
    const validUserIdSet = new Set(existingUsers.map((u) => u.id));
    const invalidIds = allUserIds.filter((id) => !validUserIdSet.has(id));
    if (invalidIds.length) {
      throw new BadRequestException(
        `Los siguientes usuarios no pertenecen al tenant o no existen: ${invalidIds.join(', ')}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.approvalPolicy.findMany({
        where: { purchaseSettingsId: settings.id },
      });

      const incomingLevels = new Set(policies.map((p) => p.level));

      for (const p of policies) {
        const row = existing.find((e) => e.level === p.level);
        let policyId: string;

        if (row) {
          await tx.approvalPolicy.update({
            where: { id: row.id },
            data: {
              description: p.description,
              minAmount: p.minAmount ?? 0,
            },
          });
          policyId = row.id;
        } else {
          const created = await tx.approvalPolicy.create({
            data: {
              purchaseSettingsId: settings.id,
              tenantId,
              level: p.level,
              description: p.description,
              minAmount: p.minAmount ?? 0,
            },
          });
          policyId = created.id;
        }

        // Reemplazar usuarios autorizados del nivel (delete + createMany atómico)
        await tx.approvalPolicyUser.deleteMany({ where: { policyId } });
        await tx.approvalPolicyUser.createMany({
          data: p.userIds.map((userId) => ({ policyId, userId, tenantId })),
          skipDuplicates: true,
        });
      }

      for (const ex of existing) {
        if (incomingLevels.has(ex.level)) continue;
        const refCount = await tx.purchaseOrderApproval.count({
          where: { policyId: ex.id },
        });
        if (refCount > 0) {
          throw new BadRequestException(
            `No se puede quitar el nivel ${ex.level}: ya hay órdenes de compra firmadas con esa política. Puede editar los firmantes del nivel, pero no eliminarlo del historial.`,
          );
        }
        await tx.approvalPolicy.delete({ where: { id: ex.id } });
      }

      return tx.approvalPolicy.findMany({
        where: { purchaseSettingsId: settings.id },
        include: POLICY_INCLUDE,
        orderBy: { level: 'asc' },
      });
    });
  }
}
