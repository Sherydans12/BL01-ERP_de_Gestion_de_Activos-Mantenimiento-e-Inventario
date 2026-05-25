/**
 * Personas PBAC para pruebas del módulo Inventario.
 *
 * Uso:
 *   cd backend && npm run seed:inventario-pbac-personas
 *
 * Variables (.env):
 *   TENANT_CODE=TPM
 *   PBAC_TEST_PASSWORD=Test1234!
 */
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcrypt';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const PASSWORD = (process.env.PBAC_TEST_PASSWORD || 'Test1234!').trim();

const P = {
  INVENTORY_ITEM_READ: 'inventory:item:read',
  INVENTORY_ITEM_CREATE: 'inventory:item:create',
  INVENTORY_ITEM_UPDATE: 'inventory:item:update',
  INVENTORY_ITEM_DELETE: 'inventory:item:delete',
  INVENTORY_WAREHOUSE_READ: 'inventory:warehouse:read',
  INVENTORY_WAREHOUSE_MANAGE: 'inventory:warehouse:manage',
  INVENTORY_CATEGORY_READ: 'inventory:category:read',
  INVENTORY_CATEGORY_MANAGE: 'inventory:category:manage',
  INVENTORY_TRANSFER_READ: 'inventory:transfer:read',
  INVENTORY_TRANSFER_CREATE: 'inventory:transfer:create',
  INVENTORY_TRANSFER_APPROVE: 'inventory:transfer:approve',
  INVENTORY_STOCK_READ: 'inventory:stock:read',
  INVENTORY_STOCK_ADJUST: 'inventory:stock:adjust',
  INVENTORY_STOCK_VIEW_COST: 'inventory:stock:view_cost',
};

const INVENTORY_READ_ALL = [
  P.INVENTORY_ITEM_READ,
  P.INVENTORY_WAREHOUSE_READ,
  P.INVENTORY_CATEGORY_READ,
  P.INVENTORY_TRANSFER_READ,
  P.INVENTORY_STOCK_READ,
];

const INVENTORY_CORE_ALL = [
  ...INVENTORY_READ_ALL,
  P.INVENTORY_ITEM_CREATE,
  P.INVENTORY_ITEM_UPDATE,
  P.INVENTORY_ITEM_DELETE,
  P.INVENTORY_WAREHOUSE_MANAGE,
  P.INVENTORY_CATEGORY_MANAGE,
  P.INVENTORY_TRANSFER_CREATE,
  P.INVENTORY_TRANSFER_APPROVE,
  P.INVENTORY_STOCK_ADJUST,
  P.INVENTORY_STOCK_VIEW_COST,
];

/** @type {Array<{ email: string; name: string; roleName: string; description: string; permissions: string[]; userRole?: UserRole; skipContracts?: boolean; singleContractOnly?: boolean }>} */
const PERSONAS = [
  {
    email: 'pbac-inventario-admin@test.com',
    name: 'PBAC · Admin Empresa Inventario',
    roleName: 'PBAC · Admin Empresa',
    description: 'ADMIN tenant-wide — bypass PBAC en API.',
    permissions: [],
    userRole: UserRole.ADMIN,
  },
  {
    email: 'pbac-inventario-bodega@test.com',
    name: 'PBAC · Operador Bodega',
    roleName: 'PBAC · Operador Bodega Inventario',
    description:
      'Operador de bodega (Contrato A): stock, ajustes, W2W y lectura de bodegas.',
    permissions: [
      P.INVENTORY_WAREHOUSE_READ,
      P.INVENTORY_STOCK_READ,
      P.INVENTORY_STOCK_ADJUST,
      P.INVENTORY_TRANSFER_READ,
      P.INVENTORY_TRANSFER_CREATE,
      P.INVENTORY_TRANSFER_APPROVE,
    ],
    singleContractOnly: true,
  },
  {
    email: 'pbac-inventario-vacio@test.com',
    name: 'PBAC · Sin permisos Inventario',
    roleName: 'PBAC · Sin permisos Inventario',
    description: 'USER sin capacidades PBAC de inventario.',
    permissions: [],
  },
  {
    email: 'pbac-inventario-sin-contrato@test.com',
    name: 'PBAC · Inventario sin contrato',
    roleName: 'PBAC · Inventario sin contrato',
    description: 'Permisos de bodega pero sin filas user_contract.',
    permissions: [
      P.INVENTORY_WAREHOUSE_READ,
      P.INVENTORY_STOCK_READ,
      P.INVENTORY_STOCK_ADJUST,
      P.INVENTORY_TRANSFER_READ,
      P.INVENTORY_TRANSFER_CREATE,
      P.INVENTORY_TRANSFER_APPROVE,
    ],
    skipContracts: true,
  },
  {
    email: 'pbac-inventario-lectura@test.com',
    name: 'PBAC · Solo lectura Inventario',
    roleName: 'PBAC · Solo lectura Inventario',
    description: 'Todos los permisos inventory:*:read del núcleo.',
    permissions: [...INVENTORY_READ_ALL],
  },
  {
    email: 'pbac-inventario-gestor@test.com',
    name: 'PBAC · Gestor Inventario',
    roleName: 'PBAC · Gestor Inventario',
    description: 'Las 15 llaves core de inventario (incl. view_cost).',
    permissions: [...INVENTORY_CORE_ALL],
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
  contracts.forEach((c) =>
    console.log(`   · ${c.code ?? c.id.slice(0, 8)} — ${c.name}`),
  );

  const hashed = await bcrypt.hash(PASSWORD, 10);
  const primaryContractId = contracts[0]?.id;

  for (const persona of PERSONAS) {
    const isAdmin = persona.userRole === UserRole.ADMIN;
    let customRoleId = null;

    if (!isAdmin) {
      const role = await upsertTenantRole(tenant.id, persona);
      customRoleId = role.id;
    }

    const user = await prisma.user.upsert({
      where: { email: persona.email },
      update: {
        name: persona.name,
        password: hashed,
        role: persona.userRole ?? UserRole.USER,
        isActive: true,
        tenantId: tenant.id,
        customRoleId,
        activationToken: null,
      },
      create: {
        email: persona.email,
        name: persona.name,
        password: hashed,
        role: persona.userRole ?? UserRole.USER,
        isActive: true,
        tenantId: tenant.id,
        customRoleId,
      },
    });

    await prisma.userContract.deleteMany({ where: { userId: user.id } });

    if (persona.skipContracts) {
      console.log(`  ✓ ${persona.email} → sin contratos (aislamiento)`);
      continue;
    }

    if (isAdmin) {
      console.log(`  ✓ ${persona.email} → ADMIN (bypass PBAC)`);
      continue;
    }

    let contractIds = contracts.map((c) => c.id);
    if (persona.singleContractOnly && primaryContractId) {
      contractIds = [primaryContractId];
      console.log(
        `  ✓ ${persona.email} → ${persona.permissions.length} permisos · contrato único ${primaryContractId.slice(0, 8)}`,
      );
    } else {
      console.log(
        `  ✓ ${persona.email} → ${persona.permissions.length} permisos · ${contractIds.length} contrato(s)`,
      );
    }

    if (contractIds.length) {
      await prisma.userContract.createMany({
        data: contractIds.map((contractId) => ({ userId: user.id, contractId })),
      });
    }
  }

  console.log(`\n✅ Contraseña: ${PASSWORD}`);
  console.log('   Ejecutá: npm run simulate:inventario-pbac (con backend en :3000)\n');
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
