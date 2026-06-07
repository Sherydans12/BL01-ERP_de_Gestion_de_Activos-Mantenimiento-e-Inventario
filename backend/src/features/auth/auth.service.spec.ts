import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { AuthAuditService } from './auth-audit.service';
import { TotpService } from './totp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptchaService } from './captcha.service';
import { UserSessionService } from './user-session.service';
import { EmailService } from '../../common/email/email.service';
import { StorageService } from '../../common/storage/storage.service';
import { LoginStepUpService } from './login-step-up.service';
import { StepUpPolicyService } from './step-up-policy.service';
import { SystemPermissions } from './constants/permissions.enum';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

const mockBcryptCompare = jest.mocked(bcrypt.compare);

describe('AuthService — login', () => {
  let service: AuthService;
  let prisma: DeepMockProxy<PrismaService>;
  let jwtSign: jest.Mock;
  let recordLoginFailure: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';

  const loginMeta = { clientIp: '127.0.0.1', userAgent: 'jest' };

  const pbacUser = {
    id: userId,
    email: 'operador@baselogic.cl',
    name: 'Operador TPM',
    firstName: 'Op',
    lastName: 'TPM',
    phone: null,
    avatarUrl: null,
    password: '$2b$10$hashed',
    isActive: true,
    role: 'USER',
    tenantId,
    lockoutUntil: null,
    totpEnabled: false,
    totpSecretEncrypted: null,
    notifyUnusualLogin: false,
    canOverruleThreeWayMatch: false,
    customRoleId: 'role-uuid-1',
    customRole: {
      name: 'Mecánico campo',
      permissions: [
        SystemPermissions.OPERATIONS_WORK_ORDER_EXECUTE,
        SystemPermissions.OPERATIONS_WORK_ORDER_ASSIGN,
        'inventory:stock:read',
      ],
    },
    tenant: {
      id: tenantId,
      code: 'TPM',
      name: 'Tenant TPM',
      logoUrl: null,
    },
    contractAccess: [{ contractId }],
  };

  const operationalConfigRow = {
    hasNightShift: false,
    dayShiftStartTime: '08:00',
    nightShiftStartTime: '20:00',
    blockNegativeStock: true,
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      operationalConfigRow as never,
    );
    jwtSign = jest.fn().mockReturnValue('signed-jwt-token');
    recordLoginFailure = jest.fn().mockResolvedValue(undefined);
    mockBcryptCompare.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jwtSign } },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: CaptchaService,
          useValue: { validate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: UserSessionService,
          useValue: { create: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: StorageService, useValue: { getReadOnlyUrl: jest.fn() } },
        {
          provide: LoginStepUpService,
          useValue: {
            createChallengeAndSendEmail: jest.fn(),
            verifyAndConsumeToken: jest.fn(),
          },
        },
        {
          provide: StepUpPolicyService,
          useValue: {
            userRoleUsesEmailStepUp: () => false,
            isGlobalStepUpPolicyEffective: jest.fn().mockResolvedValue(false),
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
        {
          provide: AuthAuditService,
          useValue: {
            lookupGeo: jest.fn().mockResolvedValue({ city: '', country: '' }),
            recordLoginFailure,
            recordLoginSuccess: jest
              .fn()
              .mockResolvedValue({ isSuspicious: false }),
            shouldRequireEmailContextStepUp: jest.fn().mockResolvedValue(false),
            recordPasswordChange: jest.fn(),
            recordLogout: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('firma JWT con permissions PBAC desde TenantRole (kebab-case), sin rol legacy', async () => {
    prisma.user.findFirst.mockResolvedValue(pbacUser as never);
    mockBcryptCompare.mockResolvedValue(true);
    prisma.user.update.mockResolvedValue(pbacUser as never);

    const result = await service.login(
      {
        tenantCode: 'TPM',
        email: 'operador@baselogic.cl',
        password: 'secret',
        challengeId: 'c1',
        challengeAnswer: 42,
      },
      loginMeta,
    );

    expect(result.access_token).toBe('signed-jwt-token');
    expect(jwtSign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: userId,
        role: 'USER',
        tenantId,
        permissions: [
          SystemPermissions.OPERATIONS_WORK_ORDER_EXECUTE,
          SystemPermissions.OPERATIONS_WORK_ORDER_ASSIGN,
          'inventory:stock:read',
        ],
        allowedContracts: [contractId],
        customRoleId: 'role-uuid-1',
        operationalConfig: operationalConfigRow,
      }),
    );
    expect(result.user.tenant?.operationalConfig).toEqual(operationalConfigRow);
    expect(jwtSign.mock.calls[0][0]).not.toHaveProperty('MECHANIC');
    expect(jwtSign.mock.calls[0][0].role).not.toMatch(/MECHANIC|SUPERVISOR/);
  });

  it('rechaza login con lockout activo (423 LOCKED)', async () => {
    const locked = {
      ...pbacUser,
      lockoutUntil: new Date(Date.now() + 15 * 60 * 1000),
    };
    prisma.user.findFirst.mockResolvedValue(locked as never);
    mockBcryptCompare.mockResolvedValue(true);

    await expect(
      service.login(
        {
          tenantCode: 'TPM',
          email: 'operador@baselogic.cl',
          password: 'wrong-or-right',
          challengeId: 'c1',
          challengeAnswer: 1,
        },
        loginMeta,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.LOCKED,
    });

    expect(recordLoginFailure).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
    );
    expect(jwtSign).not.toHaveBeenCalled();
  });

  it('registra fallo de contraseña sin emitir JWT', async () => {
    prisma.user.findFirst.mockResolvedValue(pbacUser as never);
    mockBcryptCompare.mockResolvedValue(false);

    await expect(
      service.login(
        {
          tenantCode: 'TPM',
          email: 'operador@baselogic.cl',
          password: 'bad',
          challengeId: 'c1',
          challengeAnswer: 1,
        },
        loginMeta,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(recordLoginFailure).toHaveBeenCalled();
    expect(jwtSign).not.toHaveBeenCalled();
  });
});
