import { Module } from '@nestjs/common';
import { KpiAnalyticsController } from './kpi-analytics.controller';
import { KpiAnalyticsService } from './kpi-analytics.service';

@Module({
  controllers: [KpiAnalyticsController],
  providers: [KpiAnalyticsService],
  exports: [KpiAnalyticsService],
})
export class KpiAnalyticsModule {}
