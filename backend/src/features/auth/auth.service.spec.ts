import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthAuditService } from './auth-audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from './captcha.service';
import { UserSessionService } from './user-session.service';
import { EmailService } from '../../common/email/email.service';
import { StorageService } from '../../common/storage/storage.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: AuthAuditService,
          useValue: {
            lookupGeo: jest.fn().mockResolvedValue({ city: '', country: '' }),
            recordLoginFailure: jest.fn().mockResolvedValue(undefined),
            recordLoginSuccess: jest.fn().mockResolvedValue(undefined),
            recordPasswordChange: jest.fn().mockResolvedValue(undefined),
            recordLogout: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: CaptchaService, useValue: { validate: jest.fn() } },
        { provide: UserSessionService, useValue: {} },
        { provide: StorageService, useValue: { getReadOnlyUrl: jest.fn() } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
