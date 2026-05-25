/**
 * Personas PBAC para pruebas E2E Operaciones (OT) × Inventario.
 *
 * Uso:
 *   cd backend && npm run seed:operaciones-pbac-personas
 */
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcrypt';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = (process.env.PBAC_TEST_PASSWORD || 'Test1234!').trim();

const O = {
  WORK_ORDER_READ: 'operations:work-order:read',
  WORK_ORDER_CREATE: 'operations:work-order:create',
  WORK_ORDER_UPDATE: 'operations:work-order:update',
  WORK_ORDER_ASSIGN: 'operations:work-order:assign',
  WORK_ORDER_EXECUTE: 'operations:work-order:execute',
  WORK_ORDER_CLOSE: 'operations:work-order:close',
  EQUIPMENT_READ: 'operations:equipment:read',
  METER_READ: 'operations:meter-reading:read',
  METER_CREATE: 'operations:meter-reading:create',
};

const I = {
  STOCK_READ: 'inventory:stock:read',
  ITEM_READ: 'inventory:item:read',
  WAREHOUSE_READ: 'inventory:warehouse:read',
};

/** @type {Array<{ email: string; name: string; roleName: string; description: string; permissions: string[]; userRole?: UserRole; skipContracts?: boolean; singleContractOnly?: boolean }>} */
const PERSONAS = [
  {
    email: 'pbac-operaciones-planificador@test.com',
    name: 'PBAC · Planificador OT',
    roleName: 'PBAC · Planificador OT',
    description: 'Supervisor/planificador: crear, asignar, actualizar y cerrar OT.',
    permissions: [
      O.WORK_ORDER_READ,
      O.WORK_ORDER_CREATE,
      O.WORK_ORDER_UPDATE,
      O.WORK_ORDER_ASSIGN,
      O.WORK_ORDER_CLOSE,
      O.EQUIPMENT_READ,
      O.METER_READ,
      I.STOCK_READ,
      I.ITEM_READ,
      I.WAREHOUSE_READ,
    ],
    singleContractOnly: true,
  },
  {
    email: 'pbac-operaciones-mecanico@test.com',
    name: 'PBAC · Mecánico OT',
    roleName: 'PBAC · Mecánico OT',
    description: 'Técnico de terreno: ejecutar y cerrar OT asignada; lectura stock.',
    permissions: [
      O.WORK_ORDER_READ,
      O.WORK_ORDER_EXECUTE,
      O.WORK_ORDER_CLOSE,
      O.EQUIPMENT_READ,
      O.METER_READ,
      I.STOCK_READ,
      I.ITEM_READ,
      I.WAREHOUSE_READ,
    ],
    singleContractOnly: true,
  },
];

async function upsertTenantRole(tenantId, spec) {
  const existing = await prisma.tenantRole.findFirst({
    where: { tenantId, name: spec.roleName },
    select: { id: true },
  });
  if (existing) {
    return prisma.tenantRole.update({
      where: { id: existing.id },
      data: {
        description: spec.description,
        permissions: spec.permissions,
        baseRole: UserRole.USER,
        routes: [],
      },
      select: { id: true },
    });
  }
  return prisma.tenantRole.create({
    data: {
      tenantId,
      name: spec.roleName,
      description: spec.description,
      baseRole: UserRole.USER,
      permissions: spec.permissions,
      routes: [],
    },
    select: { id: true },
  });
}

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
  if (!tenant) {
    throw new Error(`No existe tenant "${tenantCode}".`);
  }

  const contracts = await prisma.contract.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: 'asc' },
  });

  console.log(`\n📌 Tenant ${tenant.code} — contratos activos: ${contracts.length}`);
  const hashed = await bcrypt.hash(PASSWORD, 10);
  const primaryContractId = contracts[0]?.id;

  for (const persona of PERSONAS) {
    const role = await upsertTenantRole(tenant.id, persona);
    const user = await prisma.user.upsert({
      where: { email: persona.email },
      update: {
        name: persona.name,
        password: hashed,
        role: UserRole.USER,
        isActive: true,
        tenantId: tenant.id,
        customRoleId: role.id,
        activationToken: null,
      },
      create: {
        email: persona.email,
        name: persona.name,
        password: hashed,
        role: UserRole.USER,
        isActive: true,
        tenantId: tenant.id,
        customRoleId: role.id,
      },
    });

    if (!persona.skipContracts && primaryContractId) {
      const contractIds = persona.singleContractOnly
        ? [primaryContractId]
        : contracts.map((c) => c.id);
      await prisma.userContract.deleteMany({ where: { userId: user.id } });
      await prisma.userContract.createMany({
        data: contractIds.map((contractId) => ({ userId: user.id, contractId })),
        skipDuplicates: true,
      });
    }

    console.log(
      `  ✓ ${persona.email} → ${persona.permissions.length} permisos · ${persona.singleContractOnly ? '1' : contracts.length} contrato(s)`,
    );
  }

  console.log(`\n✅ Personas Operaciones PBAC listas (password: ${PASSWORD})\n`);

  if (primaryContractId) {
    const existingEq = await prisma.equipment.findFirst({
      where: { tenantId: tenant.id, contractId: primaryContractId },
      select: { id: true, internalId: true },
    });
    if (!existingEq) {
      const created = await prisma.equipment.create({
        data: {
          tenantId: tenant.id,
          contractId: primaryContractId,
          internalId: 'CA-01',
          type: 'Camión Extracción',
          brand: 'CAT',
          model: '793F',
          meterType: 'HOURS',
          initialMeter: 1000,
          currentMeter: 1000,
          isOperational: true,
        },
      });
      console.log(`  ✓ Equipo bootstrap E2E: ${created.internalId} (${created.id})`);
    } else {
      console.log(`  · Equipo existente: ${existingEq.internalId}`);
    }

    if (contracts.length >= 2) {
      const secondContractId = contracts[1].id;
      const foreignWh = await prisma.warehouse.findFirst({
        where: { tenantId: tenant.id, contractId: secondContractId },
        select: { id: true, code: true },
      });
      if (!foreignWh) {
        const createdWh = await prisma.warehouse.create({
          data: {
            tenantId: tenant.id,
            contractId: secondContractId,
            code: 'E2E-FOREIGN',
            name: 'Bodega E2E contrato ajeno',
            isActive: true,
          },
        });
        console.log(`  ✓ Bodega cross-contract E2E: ${createdWh.code} (${createdWh.id})`);
      } else {
        console.log(`  · Bodega cross-contract existente: ${foreignWh.code}`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
