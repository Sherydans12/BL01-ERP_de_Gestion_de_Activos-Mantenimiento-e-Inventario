import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateKitDto {
  code: string;
  name: string;
  description?: string;
  equipmentBrand?: string;
  equipmentModel?: string;
  contractId: string;
  subcontractId?: string;
  parts: { partNumber: string; description: string; quantity: number }[];
}

@Injectable()
export class MaintenanceKitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    user: any,
    activeContract?: string,
    brand?: string,
    model?: string,
  ) {
    const tenantId = user.tenantId;
    const where: any = { tenantId };

    // 1. Lógica de seguridad por Contrato
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (activeContract && activeContract !== 'ALL') {
        where.OR = [{ contractId: activeContract }];
      }
    } else {
      where.OR = [{ contractId: { in: user.allowedContracts || [] } }];
    }

    // 2. Filtros por Marca y Modelo (Opcionales)
    if (brand) where.equipmentBrand = { equals: brand, mode: 'insensitive' };
    if (model) where.equipmentModel = { equals: model, mode: 'insensitive' };

    return this.prisma.maintenanceKit.findMany({
      where,
      include: { parts: true },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string, user: any) {
    const tenantId = user.tenantId;
    const kit = await this.prisma.maintenanceKit.findFirst({
      where: { id, tenantId },
      include: { parts: true },
    });
    if (!kit) throw new NotFoundException('Kit no encontrado');
    return kit;
  }

  async create(dto: CreateKitDto, user: any) {
    const tenantId = user.tenantId;

    // Verificar si el código ya existe
    const existing = await this.prisma.maintenanceKit.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing)
      throw new BadRequestException('Ya existe un Kit con este código.');

    return this.prisma.maintenanceKit.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        equipmentBrand: dto.equipmentBrand?.toUpperCase() || null,
        equipmentModel: dto.equipmentModel?.toUpperCase() || null,
        contractId: dto.contractId, // <--- MAPEAR
        subcontractId: dto.subcontractId || null, // <--- MAPEAR
        parts: {
          create: dto.parts.map((p) => ({
            partNumber: p.partNumber,
            description: p.description,
            quantity: Number(p.quantity),
          })),
        },
      },
      include: { parts: true },
    });
  }

  async update(id: string, dto: CreateKitDto, user: any) {
    const tenantId = user.tenantId;
    const kit = await this.findOne(id, user); // Valida que exista y pertenezca al tenant

    return this.prisma.$transaction(async (tx) => {
      // Borramos los repuestos anteriores y creamos los nuevos (más seguro que hacer upserts manuales)
      await tx.maintenanceKitPart.deleteMany({ where: { kitId: id } });

      return tx.maintenanceKit.update({
        where: { id },
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          equipmentBrand: dto.equipmentBrand?.toUpperCase() || null,
          equipmentModel: dto.equipmentModel?.toUpperCase() || null,
          contractId: dto.contractId, // <--- MAPEAR
          subcontractId: dto.subcontractId || null, // <--- MAPEAR
          parts: {
            create: dto.parts.map((p) => ({
              partNumber: p.partNumber,
              description: p.description,
              quantity: Number(p.quantity),
            })),
          },
        },
        include: { parts: true },
      });
    });
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user); // Valida acceso
    return this.prisma.maintenanceKit.delete({
      where: { id },
    });
  }
}
