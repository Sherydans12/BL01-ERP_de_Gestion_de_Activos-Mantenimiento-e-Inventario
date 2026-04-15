/**
 * Limpia datos operativos del tenant (mantenimiento, compras, OT, equipos, etc.)
 * sin tocar: contratos/subcontratos, bodegas, artículos, stock, movimientos,
 * transferencias ni demás tablas núcleo de inventario.
 *
 * Conserva un usuario administrador (admin@tpm.cl o admin@tpm.ch) y crea roles
 * de negocio + usuarios según bootstrap interno TPM.
 *
 * Uso: cd backend && npm run db:clean-bootstrap-tpm
 *
 * Variables opcionales:
 *   TENANT_CODE=TPM
 *   KEEP_ADMIN_EMAIL=admin@tpm.cl
 *   BOOTSTRAP_USER_PASSWORD=Test1234!
 */
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  ensureDefaultTenantRolesForTenant,
  SYSTEM_MIRROR_ROLE_NAME,
} from '../src/features/tenant-roles/tenant-role-defaults';
import { upsertCatalogMastersForTenant } from './data/catalog-master-items';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- pg vs @prisma/adapter-pg nested @types/pg mismatch
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

const DEFAULT_ADMIN_EMAILS = ['admin@tpm.cl', 'admin@tpm.ch'] as const;

type BootstrapUser = {
  email: string;
  name: string;
  position: string;
  tenantRoleName: string;
  tenantRoleDescription: string;
  baseRole: UserRole;
};

const BOOTSTRAP_USERS: BootstrapUser[] = [
  {
    email: 'alexander.vega@tpm-chile.com',
    name: 'Alexander Vega',
    position: 'Supervisor de mantención',
    tenantRoleName: 'Supervisor de mantención',
    tenantRoleDescription:
      'Supervisión de mantención; permisos base tipo supervisor.',
    baseRole: UserRole.SUPERVISOR,
  },
  {
    email: 'hugo.godoy@tmp-chile.con',
    name: 'Hugo Godoy',
    position: 'Gerente de contrato (firma 1)',
    tenantRoleName: 'Gerente de contrato (firma 1)',
    tenantRoleDescription:
      'Firma de aprobación nivel 1 en órdenes de compra y gestión de contrato.',
    baseRole: UserRole.ADMIN,
  },
  {
    email: 'juan.rodriguez@tpm-chile.com',
    name: 'Juan Pablo González',
    position: 'Administrador de contrato 395 (firma 2)',
    tenantRoleName: 'Administrador de contrato 395 (firma 2)',
    tenantRoleDescription:
      'Administración del contrato 395; segunda firma en documentos.',
    baseRole: UserRole.ADMIN,
  },
  {
    email: 'alejandro.stuardo@tpm-chile.com',
    name: 'Alejandro Stuardo',
    position: 'Dueño de la Empresa (firma 3)',
    tenantRoleName: 'Dueño de la Empresa (firma 3)',
    tenantRoleDescription:
      'Máxima responsabilidad operativa en la empresa / tercera firma; permisos base ADMIN (SUPER_ADMIN queda para soporte multi-tenant).',
    baseRole: UserRole.ADMIN,
  },
  {
    email: 'orlando.maldonado@tmp-chile.com',
    name: 'Orlando Maldonado',
    position: 'Jefe de compras',
    tenantRoleName: 'Jefe de compras',
    tenantRoleDescription:
      'Responsable del módulo de compras (requisiciones, OC, recepciones).',
    baseRole: UserRole.ADMIN,
  },
];

async function resolveKeepAdminEmail(): Promise<string> {
  const fromEnv = process.env.KEEP_ADMIN_EMAIL?.trim().toLowerCase();
  const candidates = fromEnv ? [fromEnv] : [...DEFAULT_ADMIN_EMAILS];
  for (const email of candidates) {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { id: true, tenantId: true },
    });
    if (u?.tenantId) return email;
  }
  throw new Error(
    `No se encontró usuario admin en el tenant. Probados: ${candidates.join(', ')}. Defina KEEP_ADMIN_EMAIL.`,
  );
}

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const passwordPlain = (
    process.env.BOOTSTRAP_USER_PASSWORD || 'Test1234!'
  ).trim();

  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true },
  });
  if (!tenant) {
    throw new Error(`No existe tenant "${tenantCode}".`);
  }

  const keepEmail = await resolveKeepAdminEmail();
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: keepEmail },
    select: { id: true, tenantId: true, role: true },
  });
  if (admin.tenantId !== tenant.id) {
    throw new Error(
      `El usuario ${keepEmail} no pertenece al tenant ${tenantCode}.`,
    );
  }

  console.log(`Tenant: ${tenant.code} (${tenant.id})`);
  console.log(`Usuario conservado: ${keepEmail}`);

  await prisma.$transaction(async (tx) => {
    const tenantId = tenant.id;
    const adminId = admin.id;

    const others = await tx.user.findMany({
      where: { tenantId, id: { not: adminId } },
      select: { id: true },
    });
    const otherIds = others.map((o) => o.id);

    if (otherIds.length) {
      await tx.inventoryTransaction.updateMany({
        where: { userId: { in: otherIds } },
        data: { userId: adminId },
      });
      await tx.inventoryItemAttachment.updateMany({
        where: { uploadedById: { in: otherIds } },
        data: { uploadedById: adminId },
      });
      await tx.inventoryTransfer.updateMany({
        where: { createdById: { in: otherIds } },
        data: { createdById: adminId },
      });
    }

    await tx.assetCostRecord.deleteMany({ where: { tenantId } });

    await tx.receiptItem.deleteMany({
      where: { receipt: { tenantId } },
    });
    await tx.warehouseReceipt.deleteMany({ where: { tenantId } });

    await tx.purchaseOrderApproval.deleteMany({
      where: { purchaseOrder: { tenantId } },
    });
    await tx.purchaseInvoice.deleteMany({ where: { tenantId } });

    await tx.purchaseOrder.deleteMany({ where: { tenantId } });

    await tx.quotationItem.deleteMany({
      where: { quotation: { tenantId } },
    });
    await tx.purchaseQuotation.deleteMany({ where: { tenantId } });

    await tx.purchaseRequisition.deleteMany({ where: { tenantId } });

    await tx.approvalPolicy.deleteMany({ where: { tenantId } });

    await tx.vendor.deleteMany({ where: { tenantId } });

    await tx.stockReservation.deleteMany({
      where: { workOrder: { tenantId } },
    });
    await tx.workOrder.deleteMany({ where: { tenantId } });

    await tx.meterAdjustment.deleteMany({
      where: { equipment: { tenantId } },
    });
    await tx.equipment.deleteMany({ where: { tenantId } });

    await tx.maintenanceKit.deleteMany({ where: { tenantId } });
    await tx.catalogItem.deleteMany({ where: { tenantId } });
    await upsertCatalogMastersForTenant(tx, tenantId);

    await tx.activityLog.deleteMany({ where: { tenantId } });
    await tx.pushSubscription.deleteMany({ where: { tenantId } });

    if (otherIds.length) {
      await tx.userContract.deleteMany({
        where: { userId: { in: otherIds } },
      });
      await tx.user.deleteMany({ where: { id: { in: otherIds } } });
    }

    await ensureDefaultTenantRolesForTenant(tx, tenantId);

    const mirrorName = SYSTEM_MIRROR_ROLE_NAME[admin.role];
    const mirrorRole = await tx.tenantRole.findFirst({
      where: { tenantId, name: mirrorName },
    });
    if (!mirrorRole) {
      throw new Error(`Falta rol espejo del tenant: ${mirrorName}`);
    }
    await tx.user.update({
      where: { id: adminId },
      data: { customRoleId: mirrorRole.id },
    });

    await tx.tenantRole.deleteMany({
      where: {
        tenantId,
        NOT: { name: { startsWith: 'Sistema ·' } },
      },
    });

    const roleByName = new Map<string, { id: string }>();
    for (const row of BOOTSTRAP_USERS) {
      const created = await tx.tenantRole.create({
        data: {
          tenantId,
          name: row.tenantRoleName,
          description: row.tenantRoleDescription,
          baseRole: row.baseRole,
          routes: [],
        },
      });
      roleByName.set(row.email, created);
    }

    const hashed = await bcrypt.hash(passwordPlain, 10);

    for (const row of BOOTSTRAP_USERS) {
      const role = roleByName.get(row.email);
      if (!role) throw new Error(`Rol interno faltante para ${row.email}`);

      await tx.user.upsert({
        where: { email: row.email.toLowerCase() },
        create: {
          email: row.email.toLowerCase(),
          password: hashed,
          name: row.name,
          position: row.position,
          role: row.baseRole,
          isActive: true,
          tenantId,
          customRoleId: role.id,
        },
        update: {
          password: hashed,
          name: row.name,
          position: row.position,
          role: row.baseRole,
          isActive: true,
          tenantId,
          customRoleId: role.id,
          activationToken: null,
        },
      });
    }
  });

  console.log('\n✅ Limpieza y usuarios TPM listos.\n');
  console.log(`   Contraseña nueva usuarios (bootstrap): ${passwordPlain}\n`);
  for (const u of BOOTSTRAP_USERS) {
    console.log(
      `   - ${u.name} <${u.email.toLowerCase()}> → ${u.tenantRoleName}`,
    );
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
