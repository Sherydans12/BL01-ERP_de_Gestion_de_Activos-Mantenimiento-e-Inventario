import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { StorageModule } from '../../common/storage/storage.module';
import { AuthAuditModule } from '../auth/auth-audit.module';
import { UserSessionModule } from '../auth/user-session.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    AuthAuditModule,
    UserSessionModule,
    MailerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get('SMTP_HOST'),
          port: config.get('SMTP_PORT'),
          auth: {
            user: config.get('SMTP_USER'),
            pass: config.get('SMTP_PASS'),
          },
        },
        defaults: {
          from: '"TPM No Reply" <no-reply@tpm.cl>',
        },
        // PROPIEDAD CLAVE PARA ETHEREAL
        preview: true,
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, MailerModule],
})
export class UsersModule {}
