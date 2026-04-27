import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { StorageMigrationService } from './storage-migration.service';

@Global()
@Module({
  controllers: [StorageController],
  providers: [StorageService, StorageMigrationService],
  exports: [StorageService, StorageMigrationService],
})
export class StorageModule {}
