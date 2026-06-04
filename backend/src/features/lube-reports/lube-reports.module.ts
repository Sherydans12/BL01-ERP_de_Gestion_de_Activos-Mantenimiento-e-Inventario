import { Module } from '@nestjs/common';
import { LubeReportsController } from './lube-reports.controller';
import { LubeReportsService } from './lube-reports.service';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';

@Module({
  imports: [InventoryStockModule],
  controllers: [LubeReportsController],
  providers: [LubeReportsService],
  exports: [LubeReportsService],
})
export class LubeReportsModule {}
