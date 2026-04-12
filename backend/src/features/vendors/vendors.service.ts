import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.vendor.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string, tenantId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, tenantId },
    });
    if (!vendor) throw new NotFoundException('Proveedor no encontrado');
    return vendor;
  }

  async create(
    data: {
      code: string;
      name: string;
      rut?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      address?: string;
    },
    tenantId: string,
  ) {
    try {
      return await this.prisma.vendor.create({
        data: { ...data, tenantId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un proveedor con ese código o RUT');
      }
      throw e;
    }
  }

  async update(
    id: string,
    data: {
      name?: string;
      rut?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      address?: string;
      isActive?: boolean;
    },
    tenantId: string,
  ) {
    await this.findById(id, tenantId);
    try {
      return await this.prisma.vendor.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un proveedor con ese RUT');
      }
      throw e;
    }
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.prisma.vendor.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
