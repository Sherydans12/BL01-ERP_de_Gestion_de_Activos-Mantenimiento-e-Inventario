import { Module } from '@nestjs/common';
import { LubeReportsController } from './lube-reports.controller';
import { LubeReportsService } from './lube-reports.service';

/**
 * Módulo de Consumo de Lubricantes.
 *
 * SequenceService es @Global() — disponible sin importar SequenceModule aquí.
 * PrismaService es @Global() vía PrismaModule — disponible de igual forma.
 */
@Module({
  controllers: [LubeReportsController],
  providers: [LubeReportsService],
  exports: [LubeReportsService],
})
export class LubeReportsModule {}
