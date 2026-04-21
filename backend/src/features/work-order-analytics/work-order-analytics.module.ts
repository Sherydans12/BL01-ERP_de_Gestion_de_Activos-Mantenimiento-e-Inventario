import { Module } from '@nestjs/common';
import { WorkOrderAnalyticsController } from './work-order-analytics.controller';
import { WorkOrderAnalyticsService } from './work-order-analytics.service';

@Module({
  controllers: [WorkOrderAnalyticsController],
  providers: [WorkOrderAnalyticsService],
  exports: [WorkOrderAnalyticsService],
})
export class WorkOrderAnalyticsModule {}
