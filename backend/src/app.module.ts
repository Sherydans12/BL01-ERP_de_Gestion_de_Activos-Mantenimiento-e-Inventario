import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { EquipmentsModule } from './features/equipments/equipments.module';
import { CatalogsModule } from './features/catalogs/catalogs.module';
import { WorkOrdersModule } from './features/work-orders/work-orders.module';

@Module({
  imports: [PrismaModule, EquipmentsModule, CatalogsModule, WorkOrdersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
