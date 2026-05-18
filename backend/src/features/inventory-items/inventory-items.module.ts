import { Module } from '@nestjs/common';
import { InventoryItemsService } from './inventory-items.service';
import { InventoryItemsController } from './inventory-items.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemCategoriesController } from './item-categories.controller';
import { ItemCategoryBootstrapService } from './item-category-bootstrap.service';
import { InventorySuppliersService } from './inventory-suppliers.service';
import { InventorySuppliersController } from './inventory-suppliers.controller';
import { StorageModule } from '../../common/storage/storage.module';
import { NotificationSettingsModule } from '../notification-settings/notification-settings.module';

@Module({
  imports: [StorageModule, NotificationSettingsModule],
  controllers: [
    InventoryItemsController,
    ItemCategoriesController,
    InventorySuppliersController,
  ],
  providers: [
    InventoryItemsService,
    ItemCategoriesService,
    ItemCategoryBootstrapService,
    InventorySuppliersService,
  ],
  exports: [InventoryItemsService, ItemCategoriesService, InventorySuppliersService],
})
export class InventoryItemsModule {}
