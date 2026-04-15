import { Module } from '@nestjs/common';
import { InventoryStockService } from './inventory-stock.service';
import { InventoryStockController } from './inventory-stock.controller';

@Module({
  controllers: [InventoryStockController],
  providers: [InventoryStockService],
  exports: [InventoryStockService],
})
export class InventoryStockModule {}
