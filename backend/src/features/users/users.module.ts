import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../common/storage/storage.module';
import { AuthAuditModule } from '../auth/auth-audit.module';
import { UserSessionModule } from '../auth/user-session.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AuthAuditModule,
    UserSessionModule,
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
