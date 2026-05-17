import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../common/audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { PurchaseSettingsController } from './purchase-settings.controller';
import { PurchaseSettingsService } from './purchase-settings.service';
import { PurchaseRequisitionsController } from './purchase-requisitions.controller';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { WarehouseReceiptsController } from './warehouse-receipts.controller';
import { WarehouseReceiptsService } from './warehouse-receipts.service';
import { PurchaseInvoicesController } from './purchase-invoices.controller';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchasesAnalyticsController } from './purchases-analytics.controller';
import { PurchasesAnalyticsService } from './purchases-analytics.service';
import { UsersModule } from '../users/users.module';
import { PurchaseDocumentsController } from './purchase-documents.controller';
import { PurchaseDocumentsService } from './purchase-documents.service';
import { PurchaseCreditNotesController } from './purchase-credit-notes.controller';
import { PurchaseCreditNotesService } from './purchase-credit-notes.service';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    NotificationsModule,
    InventoryStockModule,
    UsersModule,
  ],
  controllers: [
    PurchaseSettingsController,
    PurchaseRequisitionsController,
    PurchaseOrdersController,
    WarehouseReceiptsController,
    PurchaseInvoicesController,
    PurchasesAnalyticsController,
    PurchaseDocumentsController,
    PurchaseCreditNotesController,
  ],
  providers: [
    PurchaseSettingsService,
    PurchaseRequisitionsService,
    PurchaseOrdersService,
    WarehouseReceiptsService,
    PurchaseInvoicesService,
    PurchasesAnalyticsService,
    PurchaseDocumentsService,
    PurchaseCreditNotesService,
  ],
  exports: [
    PurchaseOrdersService,
    WarehouseReceiptsService,
    PurchaseInvoicesService,
  ],
})
export class PurchasesModule {}
