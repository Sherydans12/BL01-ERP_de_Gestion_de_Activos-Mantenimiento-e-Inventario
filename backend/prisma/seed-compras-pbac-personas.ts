/**
 * Personas PBAC para pruebas del módulo Compras (P2P).
 *
 * Uso:
 *   cd backend && npm run seed:compras-pbac-personas
 *
 * Variables (.env):
 *   TENANT_CODE=TPM
 *   PBAC_TEST_PASSWORD=Test1234!
 *
 * Tras ejecutar: cerrar sesión y volver a entrar con cada usuario para refrescar JWT.
 */
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import { SystemPermissions as P } from '../src/features/auth/constants/permissions.enum';
import { ensureDefaultTenantRolesForTenant } from '../src/features/tenant-roles/tenant-role-defaults';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

const PASSWORD = (process.env.PBAC_TEST_PASSWORD || 'Test1234!').trim();

/** Lecturas mínimas de inventario para pickers en SRC / recepción. */
const PICKER_READ = [P.INVENTORY_ITEM_READ, P.INVENTORY_WAREHOUSE_READ] as const;

const PURCHASES_READ_ALL = [
  P.PURCHASES_REQUISITION_READ,
  P.PURCHASES_ORDER_READ,
  P.PURCHASES_RECEIPT_READ,
  P.PURCHASES_INVOICE_READ,
  P.PURCHASES_SETTING_READ,
  P.PURCHASES_VENDOR_READ,
  P.PURCHASES_DOCUMENT_READ,
  P.PURCHASES_ANALYTICS_READ,
] as const;

type PersonaSpec = {
  email: string;
  name: string;
  roleName: string;
  description: string;
  permissions: string[];
  canOverruleThreeWayMatch?: boolean;
  skipContracts?: boolean;
};

const PERSONAS: PersonaSpec[] = [
  {
    email: 'pbac-compras-solicitante@test.com',
    name: 'PBAC · Solicitante SRC',
    roleName: 'PBAC · Solicitante SRC',
    description: 'Crea y envía requerimientos; edita borradores propios.',
    permissions: [
      ...PURCHASES_READ_ALL.filter((k) => k === P.PURCHASES_REQUISITION_READ),
      P.PURCHASES_REQUISITION_CREATE,
      P.PURCHASES_REQUISITION_UPDATE_OWN,
      P.PURCHASES_REQUISITION_UPDATE_ASSET_LINK,
      P.PURCHASES_REQUISITION_SUBMIT,
      P.PURCHASES_REQUISITION_DUPLICATE,
      ...PICKER_READ,
    ],
  },
  {
    email: 'pbac-compras-comprador@test.com',
    name: 'PBAC · Comprador',
    roleName: 'PBAC · Comprador',
    description:
      'Cotiza, adjudica, genera OC y envía a proveedor. Sin firma ACL ni config global.',
    permissions: [
      ...PURCHASES_READ_ALL,
      P.PURCHASES_REQUISITION_CREATE,
      P.PURCHASES_REQUISITION_UPDATE_PURCHASING,
      P.PURCHASES_REQUISITION_CANCEL,
      P.PURCHASES_REQUISITION_START_QUOTING,
      P.PURCHASES_REQUISITION_MANAGE_QUOTATIONS,
      P.PURCHASES_REQUISITION_AWARD_LINES,
      P.PURCHASES_ORDER_CREATE_FROM_REQUISITION,
      P.PURCHASES_ORDER_CREATE_FROM_QUOTATION,
      P.PURCHASES_ORDER_SEND_TO_SUPPLIER,
      P.PURCHASES_ORDER_CANCEL,
      P.PURCHASES_ORDER_UPDATE_LOGISTICS,
      P.PURCHASES_ORDER_UPDATE_SENSITIVE,
      P.PURCHASES_ORDER_LINK_CATALOG,
      P.PURCHASES_ORDER_REJECT,
      P.PURCHASES_VENDOR_CREATE,
      P.PURCHASES_VENDOR_UPDATE,
      P.PURCHASES_DOCUMENT_READ,
      P.PURCHASES_DOCUMENT_MANAGE,
      ...PICKER_READ,
    ],
  },
  {
    email: 'pbac-compras-aprobador1@test.com',
    name: 'PBAC · Aprobador OC N1',
    roleName: 'PBAC · Aprobador OC N1',
    description: 'Firma nivel 1 en matriz ACL. Solo lectura + approve.',
    permissions: [
      P.PURCHASES_REQUISITION_READ,
      P.PURCHASES_ORDER_READ,
      P.PURCHASES_ORDER_APPROVE,
      P.PURCHASES_DOCUMENT_READ,
    ],
  },
  {
    email: 'pbac-compras-aprobador2@test.com',
    name: 'PBAC · Aprobador OC N2',
    roleName: 'PBAC · Aprobador OC N2',
    description: 'Firma nivel 2 en matriz ACL.',
    permissions: [
      P.PURCHASES_REQUISITION_READ,
      P.PURCHASES_ORDER_READ,
      P.PURCHASES_ORDER_APPROVE,
      P.PURCHASES_DOCUMENT_READ,
    ],
  },
  {
    email: 'pbac-compras-bodega@test.com',
    name: 'PBAC · Operador Bodega',
    roleName: 'PBAC · Operador Bodega',
    description: 'Recepciones parciales/totales contra OC.',
    permissions: [
      P.PURCHASES_ORDER_READ,
      P.PURCHASES_RECEIPT_READ,
      P.PURCHASES_RECEIPT_CREATE,
      P.PURCHASES_RECEIPT_REGISTER,
      P.INVENTORY_STOCK_READ,
      ...PICKER_READ,
    ],
  },
  {
    email: 'pbac-compras-tesoreria@test.com',
    name: 'PBAC · Tesorería',
    roleName: 'PBAC · Tesorería',
    description: 'Facturas, 3-way, pago y notas de crédito.',
    permissions: [
      P.PURCHASES_ORDER_READ,
      P.PURCHASES_INVOICE_READ,
      P.PURCHASES_INVOICE_CREATE,
      P.PURCHASES_INVOICE_UPDATE,
      P.PURCHASES_INVOICE_VALIDATE,
      P.PURCHASES_INVOICE_OVERRULE,
      P.PURCHASES_INVOICE_MARK_PAID,
      P.PURCHASES_INVOICE_DELETE,
      P.PURCHASES_CREDIT_NOTE_MANAGE,
      P.PURCHASES_DOCUMENT_READ,
    ],
    canOverruleThreeWayMatch: true,
  },
  {
    email: 'pbac-compras-config@test.com',
    name: 'PBAC · Config Compras',
    roleName: 'PBAC · Config Compras',
    description: 'Matriz de firmas, parámetros P2P y maestro proveedores.',
    permissions: [
      P.PURCHASES_SETTING_READ,
      P.PURCHASES_SETTING_UPDATE,
      P.PURCHASES_VENDOR_READ,
      P.PURCHASES_VENDOR_CREATE,
      P.PURCHASES_VENDOR_UPDATE,
      P.PURCHASES_VENDOR_DELETE,
      P.PURCHASES_ANALYTICS_READ,
    ],
  },
  {
    email: 'pbac-compras-lectura@test.com',
    name: 'PBAC · Solo lectura Compras',
    roleName: 'PBAC · Solo lectura Compras',
    description: 'Todos los permisos purchases:*:read; sin escritura.',
    permissions: [...PURCHASES_READ_ALL],
  },
  {
    email: 'pbac-compras-vacio@test.com',
    name: 'PBAC · Sin permisos',
    roleName: 'PBAC · Sin permisos',
    description: 'USER sin capacidades PBAC (menú compras oculto).',
    permissions: [],
  },
  {
    email: 'pbac-compras-en-acl-sin-approve@test.com',
    name: 'PBAC · En ACL sin approve',
    roleName: 'PBAC · En ACL sin approve',
    description: 'Está en matriz ACL N1 pero sin purchases:order:approve (flujo C).',
    permissions: [
      P.PURCHASES_REQUISITION_READ,
      P.PURCHASES_ORDER_READ,
      P.PURCHASES_DOCUMENT_READ,
    ],
  },
  {
    email: 'pbac-compras-approve-fuera-acl@test.com',
    name: 'PBAC · Approve fuera ACL',
    roleName: 'PBAC · Approve fuera ACL',
    description: 'Tiene order:approve PBAC pero no está en matriz ACL (flujo D).',
    permissions: [
      P.PURCHASES_REQUISITION_READ,
      P.PURCHASES_ORDER_READ,
      P.PURCHASES_ORDER_APPROVE,
      P.PURCHASES_DOCUMENT_READ,
    ],
  },
  {
    email: 'pbac-compras-sin-contrato@test.com',
    name: 'PBAC · Sin contrato',
    roleName: 'PBAC · Sin contrato',
    description: 'Permisos de lectura compras pero sin filas user_contract (flujo I).',
    permissions: [...PURCHASES_READ_ALL],
    skipContracts: true,
  },
  {
    email: 'pbac-compras-admin-compras@test.com',
    name: 'PBAC · Admin compras',
    roleName: 'PBAC · Admin compras',
    description: 'Operaciones sensibles OC: reject, reset, force-close (flujo H).',
    permissions: [
      ...PURCHASES_READ_ALL,
      P.PURCHASES_REQUISITION_UPDATE_PURCHASING,
      P.PURCHASES_REQUISITION_START_QUOTING,
      P.PURCHASES_REQUISITION_MANAGE_QUOTATIONS,
      P.PURCHASES_REQUISITION_AWARD_LINES,
      P.PURCHASES_ORDER_CREATE_FROM_REQUISITION,
      P.PURCHASES_ORDER_APPROVE,
      P.PURCHASES_ORDER_REJECT,
      P.PURCHASES_ORDER_RESET_DRAFT,
      P.PURCHASES_ORDER_FORCE_CLOSE,
      P.PURCHASES_ORDER_SEND_TO_SUPPLIER,
      P.PURCHASES_RECEIPT_CREATE,
      P.PURCHASES_RECEIPT_REGISTER,
      ...PICKER_READ,
    ],
  },
];

async function upsertTenantRole(
  tenantId: string,
  spec: PersonaSpec,
): Promise<{ id: string }> {
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

async function ensureApprovalMatrix(
  tenantId: string,
  aprobador1Id: string,
  aprobador2Id: string,
  aclSinApproveId?: string,
): Promise<void> {
  let settings = await prisma.purchaseSettings.findUnique({
    where: { tenantId },
  });
  if (!settings) {
    settings = await prisma.purchaseSettings.create({
      data: {
        tenantId,
        approvalThreshold: 0,
        currency: 'CLP',
        invoiceMatchTolerancePercent: 1,
      },
    });
  }

  await prisma.$transaction(async (tx) => {
    const policies = [
      {
        level: 1,
        description: 'PBAC test — Nivel 1',
        minAmount: 0,
        userIds: [aprobador1Id, ...(aclSinApproveId ? [aclSinApproveId] : [])],
      },
      {
        level: 2,
        description: 'PBAC test — Nivel 2',
        minAmount: 0,
        userIds: [aprobador2Id],
      },
    ];

    for (const p of policies) {
      const policy = await tx.approvalPolicy.upsert({
        where: {
          tenantId_level: { tenantId, level: p.level },
        },
        create: {
          tenantId,
          purchaseSettingsId: settings!.id,
          level: p.level,
          description: p.description,
          minAmount: p.minAmount,
        },
        update: {
          description: p.description,
          minAmount: p.minAmount,
        },
      });

      await tx.approvalPolicyUser.deleteMany({
        where: { policyId: policy.id },
      });
      await tx.approvalPolicyUser.createMany({
        data: p.userIds.map((userId) => ({
          tenantId,
          policyId: policy.id,
          userId,
        })),
      });
    }
  });
}

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
  if (!tenant) {
    throw new Error(`No existe tenant "${tenantCode}".`);
  }

  await ensureDefaultTenantRolesForTenant(prisma, tenant.id);

  const contracts = await prisma.contract.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { id: true, name: true, code: true },
  });
  const contractIds = contracts.map((c) => c.id);

  console.log(`\n📌 Tenant ${tenant.code} — contratos activos: ${contracts.length}`);
  contracts.forEach((c) =>
    console.log(`   · ${c.code ?? c.id.slice(0, 8)} — ${c.name}`),
  );

  const hashed = await bcrypt.hash(PASSWORD, 10);
  const userIds = new Map<string, string>();

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
        canOverruleThreeWayMatch: persona.canOverruleThreeWayMatch ?? false,
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
        canOverruleThreeWayMatch: persona.canOverruleThreeWayMatch ?? false,
      },
    });
    userIds.set(persona.email, user.id);

    await prisma.userContract.deleteMany({ where: { userId: user.id } });
    if (!persona.skipContracts && contractIds.length) {
      await prisma.userContract.createMany({
        data: contractIds.map((contractId) => ({ userId: user.id, contractId })),
      });
    } else if (persona.skipContracts) {
      console.log(`     (sin contratos asignados — flujo I)`);
    }

    console.log(
      `  ✓ ${persona.email} → ${persona.permissions.length} permisos (${persona.roleName})`,
    );
  }

  const a1 = userIds.get('pbac-compras-aprobador1@test.com');
  const a2 = userIds.get('pbac-compras-aprobador2@test.com');
  const aclNoApprove = userIds.get('pbac-compras-en-acl-sin-approve@test.com');
  if (a1 && a2) {
    await ensureApprovalMatrix(tenant.id, a1, a2, aclNoApprove);
    console.log('\n  ✓ Matriz ACL: N1 (aprobador1 + en-acl-sin-approve), N2 (aprobador2)');
  }

  console.log(`\n✅ Contraseña: ${PASSWORD}`);
  console.log('   Ejecutá: npm run simulate:compras-pbac (con backend en :3000)\n');
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
