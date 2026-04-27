import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../common/storage/storage.service';
import { AuthAuditService } from '../auth/auth-audit.service';
import { EmailService } from '../../common/email/email.service';
import { UserSessionService } from '../auth/user-session.service';

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: {} },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StorageService, useValue: {} },
        {
          provide: AuthAuditService,
          useValue: {
            lookupGeo: jest.fn().mockResolvedValue({ city: '', country: '' }),
            recordPasswordChange: jest.fn(),
            getRecentLoginSuccesses: jest.fn(),
          },
        },
        { provide: UserSessionService, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
