import { Module } from '@nestjs/common';
import { InventoryAdjustmentController } from './inventory-adjustment.controller';
import { InventoryAdjustmentService } from './inventory-adjustment.service';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';

@Module({
  imports: [InventoryStockModule],
  controllers: [InventoryAdjustmentController],
  providers: [InventoryAdjustmentService],
})
export class InventoryAdjustmentModule {}
