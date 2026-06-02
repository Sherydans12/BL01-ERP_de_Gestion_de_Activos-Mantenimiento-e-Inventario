import { Module } from '@nestjs/common';
import { EquipmentAvailabilityController } from './equipment-availability.controller';
import { EquipmentAvailabilityService } from './equipment-availability.service';

/**
 * Módulo de Disponibilidad Operativa Diaria.
 *
 * PrismaService es @Global() vía PrismaModule — disponible sin importarlo aquí.
 */
@Module({
  controllers: [EquipmentAvailabilityController],
  providers: [EquipmentAvailabilityService],
  exports: [EquipmentAvailabilityService],
})
export class EquipmentAvailabilityModule {}
