import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityAdminController } from './security-admin.controller';
import { SecurityAdminService } from './security-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [SecurityAdminController],
  providers: [SecurityAdminService],
})
export class SecurityAdminModule {}
