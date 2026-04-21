import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateItemCategoryDto {
  name: string;
  /** Sin padre → familia (nivel 1). Con padre → subcategoría (solo bajo una familia). */
  parentCategoryId?: string | null;
  description?: string | null;
}

@Injectable()
export class ItemCategoriesService {
  /** Nombre canónico de la familia de catálogo para sistemas intervenidos en OT (item picker). */
  static readonly SYSTEMS_FAMILY_NAME = 'Sistemas';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Garantiza una familia raíz «Sistemas» por tenant (picker OT / maestro de categorías).
   * Idempotente.
   */
  async ensureSystemsFamilyForTenant(tenantId: string): Promise<void> {
    const existing = await this.prisma.itemCategory.findFirst({
      where: {
        tenantId,
        parentCategoryId: null,
        name: {
          equals: ItemCategoriesService.SYSTEMS_FAMILY_NAME,
          mode: 'insensitive',
        },
      },
    });
    if (existing) return;

    await this.prisma.itemCategory.create({
      data: {
        tenantId,
        name: ItemCategoriesService.SYSTEMS_FAMILY_NAME,
        description:
          'Familia para sistemas intervenidos en órdenes de trabajo (generada por el sistema si no existía).',
        parentCategoryId: null,
        isGlobal: true,
      },
    });
  }

  /** Familias (nivel 1): sin padre. */
  async findFamilies(user: any) {
    await this.ensureSystemsFamilyForTenant(user.tenantId as string);

    return this.prisma.itemCategory.findMany({
      where: { tenantId: user.tenantId, parentCategoryId: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true, childCategories: true } } },
    });
  }

  /** Subcategorías bajo una familia. */
  async findChildren(parentId: string, user: any) {
    const parent = await this.prisma.itemCategory.findFirst({
      where: { id: parentId, tenantId: user.tenantId },
    });
    if (!parent) throw new NotFoundException('Familia no encontrada');

    return this.prisma.itemCategory.findMany({
      where: { tenantId: user.tenantId, parentCategoryId: parentId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    });
  }

  async findAll(user: any) {
    return this.prisma.itemCategory.findMany({
      where: { tenantId: user.tenantId },
      orderBy: [{ parentCategoryId: 'asc' }, { name: 'asc' }],
      include: {
        parentCategory: { select: { id: true, name: true } },
        _count: { select: { items: true, childCategories: true } },
      },
    });
  }

  /**
   * Listado paginado (grandes volúmenes de familias/subcategorías).
   */
  async findAllPaged(user: any, opts: { page?: number; pageSize?: number }) {
    const tenantId = user.tenantId as string;
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, opts.pageSize ?? 100));
    const skip = (page - 1) * pageSize;

    const where = { tenantId };

    const [data, total] = await Promise.all([
      this.prisma.itemCategory.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ parentCategoryId: 'asc' }, { name: 'asc' }],
        include: {
          parentCategory: { select: { id: true, name: true } },
          _count: { select: { items: true, childCategories: true } },
        },
      }),
      this.prisma.itemCategory.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async findOne(id: string, user: any) {
    const cat = await this.prisma.itemCategory.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        parentCategory: { select: { id: true, name: true } },
        childCategories: { select: { id: true, name: true } },
      },
    });
    if (!cat) throw new NotFoundException('Categoría no encontrada');
    return cat;
  }

  async create(dto: CreateItemCategoryDto, user: any) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio.');

    const tenantId = user.tenantId;
    const description = dto.description?.trim() ? dto.description.trim() : null;

    if (dto.parentCategoryId) {
      const parent = await this.prisma.itemCategory.findFirst({
        where: { id: dto.parentCategoryId, tenantId },
      });
      if (!parent) {
        throw new BadRequestException('La familia padre no existe.');
      }
      if (parent.parentCategoryId) {
        throw new BadRequestException(
          'Solo se permiten dos niveles: familia y subcategoría.',
        );
      }

      const dup = await this.prisma.itemCategory.findFirst({
        where: {
          tenantId,
          parentCategoryId: parent.id,
          name,
        },
      });
      if (dup) {
        throw new BadRequestException(
          'Ya existe una subcategoría con este nombre en la familia.',
        );
      }

      return this.prisma.itemCategory.create({
        data: {
          tenantId,
          name,
          description,
          parentCategoryId: parent.id,
          isGlobal: false,
        },
      });
    }

    const dupRoot = await this.prisma.itemCategory.findFirst({
      where: { tenantId, parentCategoryId: null, name },
    });
    if (dupRoot) {
      throw new BadRequestException('Ya existe una familia con este nombre.');
    }

    return this.prisma.itemCategory.create({
      data: {
        tenantId,
        name,
        description,
        parentCategoryId: null,
        isGlobal: true,
      },
    });
  }

  async update(id: string, dto: CreateItemCategoryDto, user: any) {
    await this.findOne(id, user);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio.');

    const tenantId = user.tenantId;
    const current = await this.prisma.itemCategory.findFirst({
      where: { id, tenantId },
    });
    if (!current) throw new NotFoundException();

    if (current.parentCategoryId) {
      const dup = await this.prisma.itemCategory.findFirst({
        where: {
          tenantId,
          parentCategoryId: current.parentCategoryId,
          name,
          id: { not: id },
        },
      });
      if (dup) {
        throw new BadRequestException(
          'El nombre ya está en uso en esta familia.',
        );
      }
    } else {
      const dup = await this.prisma.itemCategory.findFirst({
        where: {
          tenantId,
          parentCategoryId: null,
          name,
          id: { not: id },
        },
      });
      if (dup) {
        throw new BadRequestException(
          'Ya existe otra familia con este nombre.',
        );
      }
    }

    const description =
      dto.description === undefined
        ? undefined
        : dto.description?.trim()
          ? dto.description.trim()
          : null;

    return this.prisma.itemCategory.update({
      where: { id },
      data: {
        name,
        ...(description !== undefined ? { description } : {}),
      },
    });
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);

    const children = await this.prisma.itemCategory.count({
      where: { parentCategoryId: id },
    });
    if (children > 0) {
      throw new BadRequestException(
        'No se puede eliminar: tiene subcategorías. Elimine primero las subcategorías.',
      );
    }

    const itemCount = await this.prisma.inventoryItem.count({
      where: { categoryId: id },
    });

    if (itemCount > 0) {
      throw new BadRequestException(
        `No se puede eliminar: la categoría tiene ${itemCount} artículo(s) vinculado(s).`,
      );
    }

    return this.prisma.itemCategory.delete({ where: { id } });
  }
}
