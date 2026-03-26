import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

    return this.prisma.$transaction(async (tx) => {
      // Crear el registro de ajuste
      const adjustment = await tx.meterAdjustment.create({
        data: {
          equipmentId: dto.equipmentId,
          userId,
          oldValue: dto.oldValue,
          newValue: dto.newValue,
          reason: dto.reason || null,
        },
      });

      // Actualizar el medidor del equipo al nuevo valor
      await tx.equipment.update({
        where: { id: dto.equipmentId },
        data: { currentMeter: dto.newValue },
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
