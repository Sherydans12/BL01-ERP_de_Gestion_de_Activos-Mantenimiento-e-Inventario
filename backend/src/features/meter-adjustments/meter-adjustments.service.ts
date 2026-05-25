import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { MeterLogSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';

@Injectable()
export class MeterAdjustmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: any,
    dto: {
      equipmentId: string;
      oldValue: number;
      newValue: number;
      reason?: string;
    },
  ) {
    const tenantId = user.tenantId;
    const userId = user.id || user.sub;

    const equipment = await this.prisma.equipment.findFirst({
      where: { id: dto.equipmentId, tenantId },
    });

    if (!equipment) {
      throw new NotFoundException('Equipo no encontrado.');
    }

    if (dto.oldValue < 0 || dto.newValue < 0) {
      throw new BadRequestException('Los valores de medidor deben ser >= 0.');
    }

    if (dto.newValue < equipment.currentMeter) {
      const reason = (dto.reason ?? '').trim();
      if (reason.length < 15) {
        throw new BadRequestException(
          'Una lectura menor al medidor actual requiere justificación de cambio de motor (mín. 15 caracteres).',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.meterAdjustment.create({
        data: {
          equipmentId: dto.equipmentId,
          userId,
          oldValue: dto.oldValue,
          newValue: dto.newValue,
          reason: dto.reason || null,
        },
      });

      await applyCurrentMeterChange(tx, {
        tenantId,
        equipmentId: dto.equipmentId,
        oldMeter: equipment.currentMeter,
        newMeter: dto.newValue,
        source: MeterLogSource.MANUAL,
        sourceId: adjustment.id,
        userId,
      });

      return adjustment;
    });
  }

  async findByEquipment(user: any, equipmentId: string) {
    const tenantId = user.tenantId;

    const equipment = await this.prisma.equipment.findFirst({
      where: { id: equipmentId, tenantId },
    });
    if (!equipment) throw new NotFoundException('Equipo no encontrado.');

    return this.prisma.meterAdjustment.findMany({
      where: { equipmentId },
      orderBy: { date: 'desc' },
      include: {
        user: { select: { name: true, email: true } },
      },
    });
  }
}
