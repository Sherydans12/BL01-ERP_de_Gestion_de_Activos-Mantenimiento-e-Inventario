import { Module } from '@nestjs/common';
import { EmailModule } from '../../common/email/email.module';
import { WorkOrdersService } from './work-orders.service';
import { WorkOrdersController } from './work-orders.controller';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';

@Module({
  imports: [EmailModule, InventoryStockModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
