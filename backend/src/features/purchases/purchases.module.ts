import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseSettingsController } from './purchase-settings.controller';
import { PurchaseSettingsService } from './purchase-settings.service';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { WarehouseReceiptsController } from './warehouse-receipts.controller';
import { WarehouseReceiptsService } from './warehouse-receipts.service';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [
    PurchaseSettingsController,
    PurchaseRequisitionsController,
    PurchaseOrdersController,
    WarehouseReceiptsController,
  ],
  providers: [
    PurchaseSettingsService,
    PurchaseRequisitionsService,
    PurchaseOrdersService,
    WarehouseReceiptsService,
  ],
  exports: [
    PurchaseOrdersService,
    WarehouseReceiptsService,
  ],
})
export class PurchasesModule {}
