import { Module } from '@nestjs/common';
import { InventoryAnalyticsController } from './inventory-analytics.controller';
import { InventoryAnalyticsService } from './inventory-analytics.service';

@Module({
  controllers: [InventoryAnalyticsController],
  providers: [InventoryAnalyticsService],
  exports: [InventoryAnalyticsService],
})
export class InventoryAnalyticsModule {}
