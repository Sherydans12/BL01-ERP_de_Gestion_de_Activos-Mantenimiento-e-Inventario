import { Module } from '@nestjs/common';
import { EquipmentsService } from './equipments.service';
import { EquipmentsController } from './equipments.controller';
import { EquipmentOperationalOrchestratorService } from './equipment-operational-orchestrator.service';

@Module({
  controllers: [EquipmentsController],
  providers: [EquipmentsService, EquipmentOperationalOrchestratorService],
  exports: [EquipmentsService, EquipmentOperationalOrchestratorService],
})
export class EquipmentsModule {}
