import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SequenceModule } from './common/sequence/sequence.module';
import { StorageModule } from './common/storage/storage.module';
import { EquipmentsModule } from './features/equipments/equipments.module';
import { CatalogsModule } from './features/catalogs/catalogs.module';
import { WorkOrdersModule } from './features/work-orders/work-orders.module';
import { AuthModule } from './features/auth/auth.module';
import { UsersModule } from './features/users/users.module';
import { SitesModule } from './features/sites/sites.module';
import { TenantConfigModule } from './features/tenant-config/tenant-config.module';
import { MaintenanceKitsModule } from './features/maintenance-kits/maintenance-kits.module';
import { InventoryItemsModule } from './features/inventory-items/inventory-items.module';
import { WarehousesModule } from './features/warehouses/warehouses.module';
import { InventoryStockModule } from './features/inventory-stock/inventory-stock.module';
import { MeterAdjustmentsModule } from './features/meter-adjustments/meter-adjustments.module';
import { TenantRolesModule } from './features/tenant-roles/tenant-roles.module';
import { VendorsModule } from './features/vendors/vendors.module';
import { PurchasesModule } from './features/purchases/purchases.module';
import { UnitsOfMeasureModule } from './features/units-of-measure/units-of-measure.module';
import { InventoryAnalyticsModule } from './features/inventory-analytics/inventory-analytics.module';
import { InventoryAdjustmentModule } from './features/inventory-adjustment/inventory-adjustment.module';
import { InventoryTransferModule } from './features/inventory-transfer/inventory-transfer.module';
import { WorkOrderAnalyticsModule } from './features/work-order-analytics/work-order-analytics.module';
import { SecurityAdminModule } from './features/security-admin/security-admin.module';
import { PlatformDataAdminModule } from './features/platform-data-admin/platform-data-admin.module';
import { EmailModule } from './common/email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    SequenceModule,
    StorageModule,
    EquipmentsModule,
    CatalogsModule,
    WorkOrdersModule,
    AuthModule,
    UsersModule,
    SitesModule,
    TenantConfigModule,
    TenantRolesModule,
    MaintenanceKitsModule,
    InventoryItemsModule,
    WarehousesModule,
    InventoryStockModule,
    MeterAdjustmentsModule,
    VendorsModule,
    PurchasesModule,
    UnitsOfMeasureModule,
    InventoryAnalyticsModule,
    InventoryAdjustmentModule,
    InventoryTransferModule,
    WorkOrderAnalyticsModule,
    SecurityAdminModule,
    PlatformDataAdminModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
