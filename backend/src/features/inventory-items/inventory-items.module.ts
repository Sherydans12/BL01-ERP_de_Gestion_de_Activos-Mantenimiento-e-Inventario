import { Module } from '@nestjs/common';
import { InventoryItemsService } from './inventory-items.service';
import { InventoryItemsController } from './inventory-items.controller';
import { ItemCategoriesService } from './item-categories.service';
import { ItemCategoriesController } from './item-categories.controller';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [InventoryItemsController, ItemCategoriesController],
  providers: [InventoryItemsService, ItemCategoriesService],
  exports: [InventoryItemsService, ItemCategoriesService],
})
export class InventoryItemsModule {}
