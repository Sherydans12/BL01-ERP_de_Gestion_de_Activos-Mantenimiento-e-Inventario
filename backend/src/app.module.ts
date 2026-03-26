import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EquipmentsModule,
    CatalogsModule,
    WorkOrdersModule,
    AuthModule,
    UsersModule,
    SitesModule,
    TenantConfigModule,
    MaintenanceKitsModule,
    InventoryItemsModule,
    WarehousesModule,
    InventoryStockModule,
    MeterAdjustmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
