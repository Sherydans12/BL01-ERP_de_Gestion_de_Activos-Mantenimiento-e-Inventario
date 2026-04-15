import { Module } from '@nestjs/common';
import { UnitsOfMeasureController } from './units-of-measure.controller';
import { UnitsOfMeasureService } from './units-of-measure.service';

@Module({
  controllers: [UnitsOfMeasureController],
  providers: [UnitsOfMeasureService],
  exports: [UnitsOfMeasureService],
})
export class UnitsOfMeasureModule {}
