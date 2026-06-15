import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantRolesService } from './tenant-roles.service';

describe('TenantRolesService', () => {
  let service: TenantRolesService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const roleId = '22222222-2222-4222-8222-222222222222';
  const replacementRoleId = '33333333-3333-4333-8333-333333333333';

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantRolesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TenantRolesService);
  });

  it('rechaza eliminar un rol con usuarios asignados si no se informa reemplazo', async () => {
    prisma.tenantRole.findFirst.mockResolvedValueOnce({
      id: roleId,
      tenantId,
      name: 'Planificador nocturno',
      baseRole: 'USER',
    } as never);
    prisma.user.count.mockResolvedValueOnce(2);

    await expect(service.remove(tenantId, roleId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza un rol de reemplazo de otro baseRole', async () => {
    prisma.tenantRole.findFirst
      .mockResolvedValueOnce({
        id: roleId,
        tenantId,
        name: 'Planificador nocturno',
        baseRole: 'USER',
      } as never)
      .mockResolvedValueOnce({
        id: replacementRoleId,
        tenantId,
        name: 'Sistema · ADMIN',
        baseRole: 'ADMIN',
      } as never);
    prisma.user.count.mockResolvedValueOnce(1);

    await expect(
      service.remove(tenantId, roleId, replacementRoleId),
    ).rejects.toThrow(BadRequestException);
  });

  it('reasigna usuarios y elimina el rol cuando recibe reemplazo compatible', async () => {
    prisma.tenantRole.findFirst
      .mockResolvedValueOnce({
        id: roleId,
        tenantId,
        name: 'Planificador nocturno',
        baseRole: 'USER',
      } as never)
      .mockResolvedValueOnce({
        id: replacementRoleId,
        tenantId,
        name: 'Sistema · USER',
        baseRole: 'USER',
      } as never);
    prisma.user.count.mockResolvedValueOnce(3);

    const result = await service.remove(tenantId, roleId, replacementRoleId);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { tenantId, customRoleId: roleId },
      data: { customRoleId: replacementRoleId },
    });
    expect(prisma.tenantRole.delete).toHaveBeenCalledWith({
      where: { id: roleId },
    });
    expect(result.message).toContain('3 usuario(s) fueron reasignados');
  });

  it('falla si el rol de reemplazo no pertenece al tenant', async () => {
    prisma.tenantRole.findFirst
      .mockResolvedValueOnce({
        id: roleId,
        tenantId,
        name: 'Planificador nocturno',
        baseRole: 'USER',
      } as never)
      .mockResolvedValueOnce(null as never);
    prisma.user.count.mockResolvedValueOnce(1);

    await expect(
      service.remove(tenantId, roleId, replacementRoleId),
    ).rejects.toThrow(NotFoundException);
  });
});
