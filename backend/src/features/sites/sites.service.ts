import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SitesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, data: { name: string; code: string }) {
    try {
      return await this.prisma.contract.create({
        data: {
          ...data,
          tenantId,
        },
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al crear el contrato');
    }
  }

  async findAll(tenantId: string) {
    return this.prisma.contract.findMany({
      where: {
        tenantId,
        // isActive: true // (Opcional, si manejas borrado lógico)
      },
      include: {
        subcontracts: true, // Vital para los desplegables anidados
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: { name: string; code: string; isActive?: boolean },
  ) {
    try {
      const existing = await this.prisma.contract.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new BadRequestException('Contrato no encontrado');

      return await this.prisma.contract.update({
        where: { id },
        data,
      });
    } catch (error) {
      throw new InternalServerErrorException('Error al actualizar el contrato');
    }
  }

  async remove(tenantId: string, id: string) {
    try {
      const existing = await this.prisma.contract.findFirst({
        where: { id, tenantId },
      });
      if (!existing) throw new BadRequestException('Contrato no encontrado');

      return await this.prisma.contract.delete({
        where: { id },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Error al eliminar el contrato. Puede que tenga registros asociados.',
      );
    }
  }
}
