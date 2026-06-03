import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuthAuditService } from '../auth/auth-audit.service';
import { EmailService } from '../../common/email/email.service';
import { UserSessionService } from '../auth/user-session.service';
import { StepUpPolicyService } from '../auth/step-up-policy.service';
import { TotpService } from '../auth/totp.service';
import { SystemPermissions } from '../auth/constants/permissions.enum';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: StorageService,
          useValue: { normalizeStorageKey: jest.fn() },
        },
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
            isGlobalStepUpPolicyEffective: jest.fn().mockResolvedValue(false),
            getSecuritySnapshotForUserRole: jest.fn(),
            appliesToUserRoleWithContext: jest.fn(),
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

  describe('findAssignableForOt', () => {
    const mechanicId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const plannerId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const bareUserId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    it('rechaza sin tenantId', async () => {
      await expect(service.findAssignableForOt('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('filtra por permisos PBAC en customRole.permissions (OR execute/assign/update)', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: mechanicId,
          name: 'Mecánico PBAC',
          email: 'mecanico@test.com',
          role: 'USER',
          customRole: {
            id: 'role-mec',
            name: 'Mecánico',
            baseRole: 'USER',
            permissions: [SystemPermissions.OPERATIONS_WORK_ORDER_EXECUTE],
          },
        },
        {
          id: plannerId,
          name: 'Planificador',
          email: 'plan@test.com',
          role: 'USER',
          customRole: {
            id: 'role-plan',
            name: 'Supervisor turno',
            baseRole: 'USER',
            permissions: [SystemPermissions.OPERATIONS_WORK_ORDER_ASSIGN],
          },
        },
      ] as never);

      await service.findAssignableForOt(tenantId);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          isActive: true,
          OR: [
            {
              customRole: {
                is: {
                  permissions: {
                    array_contains: 'operations:work-order:execute',
                  },
                },
              },
            },
            {
              customRole: {
                is: {
                  permissions: {
                    array_contains: 'operations:work-order:assign',
                  },
                },
              },
            },
            {
              customRole: {
                is: {
                  permissions: {
                    array_contains: 'operations:work-order:update',
                  },
                },
              },
            },
          ],
        },
        select: expect.any(Object),
        orderBy: { name: 'asc' },
      });
    });

    it('marca canExecuteOt y canSuperviseOt según permisos (no por enum legacy)', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: mechanicId,
          name: 'Ejecutor',
          email: 'exec@test.com',
          role: 'USER',
          customRole: {
            id: 'r1',
            name: 'Ejecutor',
            baseRole: 'USER',
            permissions: [SystemPermissions.OPERATIONS_WORK_ORDER_EXECUTE],
          },
        },
        {
          id: plannerId,
          name: 'Asignador',
          email: 'assign@test.com',
          role: 'USER',
          customRole: {
            id: 'r2',
            name: 'Planificador',
            baseRole: 'USER',
            permissions: [SystemPermissions.OPERATIONS_WORK_ORDER_ASSIGN],
          },
        },
        {
          id: bareUserId,
          name: 'Sin permisos OT',
          email: 'bare@test.com',
          role: 'USER',
          customRole: {
            id: 'r3',
            name: 'Operador bodega',
            baseRole: 'USER',
            permissions: ['inventory:stock:read'],
          },
        },
      ] as never);

      const rows = await service.findAssignableForOt(tenantId);

      const executor = rows.find((r) => r.id === mechanicId);
      const planner = rows.find((r) => r.id === plannerId);

      expect(executor?.canExecuteOt).toBe(true);
      expect(executor?.canSuperviseOt).toBe(false);
      expect(planner?.canExecuteOt).toBe(true);
      expect(planner?.canSuperviseOt).toBe(true);

      const bare = rows.find((r) => r.id === bareUserId);
      expect(bare?.canExecuteOt).toBe(false);
      expect(bare?.canSuperviseOt).toBe(false);
    });

    it('no incluye filtro por role MECHANIC ni SUPERVISOR en la query', async () => {
      prisma.user.findMany.mockResolvedValue([] as never);

      await service.findAssignableForOt(tenantId);

      const call = prisma.user.findMany.mock.calls[0]?.[0] as {
        where?: Record<string, unknown>;
      };
      expect(JSON.stringify(call?.where ?? {})).not.toMatch(
        /MECHANIC|SUPERVISOR/,
      );
    });
  });
});
