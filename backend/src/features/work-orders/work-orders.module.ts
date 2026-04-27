import { Module } from '@nestjs/common';
import { EmailModule } from '../../common/email/email.module';
import { WorkOrdersService } from './work-orders.service';
import { WorkOrdersController } from './work-orders.controller';

@Module({
  imports: [EmailModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
