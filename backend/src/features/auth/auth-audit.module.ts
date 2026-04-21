import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthAuditService } from './auth-audit.service';

@Module({
  imports: [PrismaModule],
  providers: [AuthAuditService],
  exports: [AuthAuditService],
})
export class AuthAuditModule {}
