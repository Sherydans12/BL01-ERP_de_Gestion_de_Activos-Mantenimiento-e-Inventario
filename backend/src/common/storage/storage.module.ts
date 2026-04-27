import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { StorageMigrationService } from './storage-migration.service';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [StorageController],
  providers: [StorageService, StorageMigrationService],
  exports: [StorageService, StorageMigrationService],
})
export class StorageModule {}
