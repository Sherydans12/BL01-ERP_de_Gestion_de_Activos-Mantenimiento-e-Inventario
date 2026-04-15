import { Module } from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';
import { WarehouseBinsService } from './warehouse-bins.service';
import { WarehouseBinsController } from './warehouse-bins.controller';

@Module({
  controllers: [WarehousesController, WarehouseBinsController],
  providers: [WarehousesService, WarehouseBinsService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
