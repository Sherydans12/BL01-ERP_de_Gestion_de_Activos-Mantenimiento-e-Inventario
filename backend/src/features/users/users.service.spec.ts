import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuthAuditService } from '../auth/auth-audit.service';
import { EmailService } from '../../common/email/email.service';
import { UserSessionService } from '../auth/user-session.service';
import { StepUpPolicyService } from '../auth/step-up-policy.service';
import { TotpService } from '../auth/totp.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: {} },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StorageService, useValue: { normalizeStorageKey: jest.fn() } },
        {
          provide: AuthAuditService,
          useValue: {
            lookupGeo: jest.fn().mockResolvedValue({ city: '', country: '' }),
            recordPasswordChange: jest.fn(),
            getRecentLoginSuccesses: jest.fn(),
          },
        },
        { provide: UserSessionService, useValue: {} },
        {
          provide: StepUpPolicyService,
          useValue: {
            userRoleUsesEmailStepUp: jest.fn().mockReturnValue(false),
            isGlobalStepUpPolicyEffective: jest
              .fn()
              .mockResolvedValue(false),
          },
        },
        {
          provide: TotpService,
          useValue: {
            decryptSecret: jest.fn(),
            verify: jest.fn(),
            encryptSecret: jest.fn(),
            generateSecret: jest.fn(),
            keyUri: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('debe instanciarse', () => {
    expect(service).toBeDefined();
  });
});
