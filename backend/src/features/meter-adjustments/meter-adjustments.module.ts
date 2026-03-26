import { Module } from '@nestjs/common';
import { MeterAdjustmentsController } from './meter-adjustments.controller';
import { MeterAdjustmentsService } from './meter-adjustments.service';

@Module({
  controllers: [MeterAdjustmentsController],
  providers: [MeterAdjustmentsService],
})
export class MeterAdjustmentsModule {}
