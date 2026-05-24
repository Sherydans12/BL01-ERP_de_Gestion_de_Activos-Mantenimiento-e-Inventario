import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformDataAdminController } from './platform-data-admin.controller';
import { PlatformDataAdminService } from './platform-data-admin.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [PlatformDataAdminController],
  providers: [PlatformDataAdminService],
})
export class PlatformDataAdminModule {}
