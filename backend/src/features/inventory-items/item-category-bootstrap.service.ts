import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ItemCategoriesService } from './item-categories.service';

/**
 * Al arranque, asegura la familia de catálogo «Sistemas» en todos los tenants
 * (misma lógica que en `ItemCategoriesService.findFamilies` al primer request).
 */
@Injectable()
export class ItemCategoryBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ItemCategoryBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly itemCategories: ItemCategoriesService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const tenants = await this.prisma.tenant.findMany({
        select: { id: true },
      });
      for (const t of tenants) {
        await this.itemCategories.ensureSystemsFamilyForTenant(t.id);
      }
      if (tenants.length > 0) {
        this.logger.log(
          `Familia de catálogo «${ItemCategoriesService.SYSTEMS_FAMILY_NAME}» verificada para ${tenants.length} tenant(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        'No se pudo verificar la familia «Sistemas» en arranque',
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
