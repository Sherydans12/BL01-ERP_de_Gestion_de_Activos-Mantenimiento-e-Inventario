import { Module } from '@nestjs/common';
import { InventoryTransferController } from './inventory-transfer.controller';
import { InventoryTransferService } from './inventory-transfer.service';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';

@Module({
  imports: [InventoryStockModule],
  controllers: [InventoryTransferController],
  providers: [InventoryTransferService],
  exports: [InventoryTransferService],
})
export class InventoryTransferModule {}
