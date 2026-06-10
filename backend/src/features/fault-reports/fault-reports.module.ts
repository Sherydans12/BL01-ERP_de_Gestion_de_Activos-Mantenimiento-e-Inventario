import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FaultReportsController } from './fault-reports.controller';
import { FaultReportsService } from './fault-reports.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SequenceModule } from '../../common/sequence/sequence.module';
import { StorageModule } from '../../common/storage/storage.module';
import { NotificationSettingsModule } from '../notification-settings/notification-settings.module';

@Module({
  imports: [
    PrismaModule,
    SequenceModule,
    StorageModule,
    ConfigModule,
    NotificationSettingsModule,
  ],
  controllers: [FaultReportsController],
  providers: [FaultReportsService],
  exports: [FaultReportsService],
})
export class FaultReportsModule {}
