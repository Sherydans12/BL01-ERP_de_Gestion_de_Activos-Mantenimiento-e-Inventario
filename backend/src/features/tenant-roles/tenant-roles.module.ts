import { Module } from '@nestjs/common';
import { TenantRolesService } from './tenant-roles.service';
import { TenantRolesController } from './tenant-roles.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TenantRolesController],
  providers: [TenantRolesService],
  exports: [TenantRolesService],
})
export class TenantRolesModule {}
