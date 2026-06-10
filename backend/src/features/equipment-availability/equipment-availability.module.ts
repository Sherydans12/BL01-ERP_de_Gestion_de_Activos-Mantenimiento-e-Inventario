import { Module } from '@nestjs/common';
import { EquipmentAvailabilityController } from './equipment-availability.controller';
import { AvailabilityEventService } from './availability-event.service';
import { EquipmentAvailabilityService } from './equipment-availability.service';
import { EquipmentsModule } from '../equipments/equipments.module';

/**
 * Módulo de Disponibilidad Operativa Diaria.
 *
 * PrismaService es @Global() vía PrismaModule — disponible sin importarlo aquí.
 */
@Module({
  imports: [EquipmentsModule],
  controllers: [EquipmentAvailabilityController],
  providers: [EquipmentAvailabilityService, AvailabilityEventService],
  exports: [EquipmentAvailabilityService, AvailabilityEventService],
})
export class EquipmentAvailabilityModule {}
