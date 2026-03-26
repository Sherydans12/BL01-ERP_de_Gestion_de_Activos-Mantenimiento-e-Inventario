import { Module } from '@nestjs/common';
import { MaintenanceKitsService } from './maintenance-kits.service';
import { MaintenanceKitsController } from './maintenance-kits.controller';

@Module({
  controllers: [MaintenanceKitsController],
  providers: [MaintenanceKitsService],
})
export class MaintenanceKitsModule {}
