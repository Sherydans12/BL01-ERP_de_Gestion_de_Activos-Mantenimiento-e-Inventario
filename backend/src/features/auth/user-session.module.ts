import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserSessionService } from './user-session.service';

@Module({
  imports: [PrismaModule],
  providers: [UserSessionService],
  exports: [UserSessionService],
})
export class UserSessionModule {}
