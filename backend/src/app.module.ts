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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
