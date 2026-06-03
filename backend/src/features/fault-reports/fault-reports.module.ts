import { Module } from '@nestjs/common';
import { FaultReportsController } from './fault-reports.controller';
import { FaultReportsService } from './fault-reports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SequenceModule } from '../../common/sequence/sequence.module';
import { StorageModule } from '../../common/storage/storage.module';

@Module({
  imports: [PrismaModule, SequenceModule, StorageModule],
  controllers: [FaultReportsController],
  providers: [FaultReportsService],
  exports: [FaultReportsService],
})
export class FaultReportsModule {}
