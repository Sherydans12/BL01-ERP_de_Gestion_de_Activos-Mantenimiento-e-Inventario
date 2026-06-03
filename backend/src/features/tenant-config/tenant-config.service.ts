import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
import { ensureDefaultTenantRolesForTenant } from '../tenant-roles/tenant-role-defaults';
import { ensureDefaultUnitsOfMeasureForTenant } from '../inventory-items/unit-of-measure-defaults';
import {
  StorageService,
  S3_COMPATIBLE_MAX_PRESIGN_TTL_SECONDS,
} from '../../common/storage/storage.service';

/** Logos en UI (R2/S3): máximo permitido por SigV4; sesiones más largas → recargar o re-fetch config. */
const TENANT_LOGO_SIGNED_TTL_SECONDS = S3_COMPATIBLE_MAX_PRESIGN_TTL_SECONDS;

function looksLikeExternalOrLocalUrl(raw: string): boolean {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith('/uploads/')) return true;
  return false;
}

@Injectable()
export class TenantConfigService {
  constructor(
    private prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async resolveLogoPublicUrl(
    raw: string | null | undefined,
  ): Promise<string> {
    const s = (raw || '').trim();
    if (!s) return '';
    if (looksLikeExternalOrLocalUrl(s)) {
      return this.storage.getReadOnlyUrl(s);
    }
    return this.storage.getReadOnlyUrl(s, {
      signedTtlSeconds: TENANT_LOGO_SIGNED_TTL_SECONDS,
    });
  }

  private async mapTenantToClientResponse(tenant: {
    id: string;
    code: string;
    name: string;
    rut: string | null;
    address: string | null;
    phone: string | null;
    city: string | null;
    invoiceLegalName: string | null;
    ocPdfLegalNotice: string | null;
    logoUrl: string | null;
    logoLightUrl: string | null;
    pdfLogoUrl: string | null;
    primaryColor: string;
    laborRatePerHour: unknown;
    backgroundPreference: unknown;
    sidebarPermissions: unknown;
    tenantRoles?: unknown;
  }) {
    const rawLogo = (tenant.logoUrl || '').trim();
    const logoPublicUrl = rawLogo
      ? await this.resolveLogoPublicUrl(tenant.logoUrl)
      : '';
    const rawLogoLight = (tenant.logoLightUrl || '').trim();
    const logoLightPublicUrl = rawLogoLight
      ? await this.resolveLogoPublicUrl(tenant.logoLightUrl)
      : '';
    const rawPdfLogo = (tenant.pdfLogoUrl || '').trim();
    const pdfLogoPublicUrl = rawPdfLogo
      ? await this.resolveLogoPublicUrl(tenant.pdfLogoUrl)
      : '';
    return {
      ...tenant,
      rut: tenant.rut || '',
      address: tenant.address || '',
      phone: tenant.phone || '',
      city: tenant.city || '',
      invoiceLegalName: tenant.invoiceLegalName || '',
      ocPdfLegalNotice: tenant.ocPdfLegalNotice || '',
      /** Valor persistido (URL externa o clave de storage). No usar como `src` directo si es clave R2. */
      logoUrl: rawLogo,
      /** URL lista para `<img src>` (firmada o pública según driver). */
      logoPublicUrl,
      logoLightUrl: rawLogoLight,
      logoLightPublicUrl,
      pdfLogoUrl: rawPdfLogo,
      pdfLogoPublicUrl,
      laborRatePerHour:
        typeof tenant.laborRatePerHour === 'number'
          ? tenant.laborRatePerHour
          : typeof tenant.laborRatePerHour === 'object' &&
              tenant.laborRatePerHour !== null &&
              'toNumber' in tenant.laborRatePerHour
            ? (tenant.laborRatePerHour as { toNumber: () => number }).toNumber()
            : 0,
    };
  }

  async getTenantConfig(tenantId: string) {
    await ensureDefaultTenantRolesForTenant(this.prisma, tenantId);
    await ensureDefaultUnitsOfMeasureForTenant(this.prisma, tenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        city: true,
        invoiceLegalName: true,
        ocPdfLegalNotice: true,
        logoUrl: true,
        logoLightUrl: true,
        pdfLogoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
        tenantRoles: {
          select: {
            id: true,
            name: true,
            description: true,
            baseRole: true,
            routes: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(
        'Tenant no encontrado al consultar configuración',
      );
    }

    return this.mapTenantToClientResponse(tenant);
  }

  async updateTenantConfig(tenantId: string, dto: UpdateTenantConfigDto) {
    const payload: Record<string, unknown> = { ...dto };
    /** Código y nombre de tenant son identidad de plataforma; no se editan desde configuración de empresa. */
    delete payload.name;
    delete payload.code;
    for (const key of [
      'invoiceLegalName',
      'ocPdfLegalNotice',
      'city',
      'rut',
      'address',
      'phone',
      'logoLightUrl',
      'pdfLogoUrl',
    ]) {
      const v = payload[key];
      if (typeof v === 'string' && v.trim() === '') {
        payload[key] = null;
      }
    }

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: payload as Prisma.TenantUpdateInput,
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        city: true,
        invoiceLegalName: true,
        ocPdfLegalNotice: true,
        logoUrl: true,
        logoLightUrl: true,
        pdfLogoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
      },
    });

    return this.mapTenantToClientResponse(tenant);
  }

  async uploadTenantLogo(
    tenantId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío.');
    }

    const prev = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoUrl: true },
    });
    if (!prev) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const storageKey = await this.storage.uploadFile(file, 'tenant-branding');

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: storageKey },
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        city: true,
        invoiceLegalName: true,
        ocPdfLegalNotice: true,
        logoUrl: true,
        logoLightUrl: true,
        pdfLogoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
      },
    });

    const old = prev.logoUrl?.trim();
    if (
      old &&
      !looksLikeExternalOrLocalUrl(old) &&
      old !== storageKey &&
      !/^https?:\/\//i.test(old)
    ) {
      try {
        await this.storage.deleteFile(old);
      } catch {
        /* no bloquear actualización de marca */
      }
    }

    return this.mapTenantToClientResponse(tenant);
  }

  async uploadTenantLogoLight(
    tenantId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío.');
    }

    const prev = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoLightUrl: true },
    });
    if (!prev) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const storageKey = await this.storage.uploadFile(file, 'tenant-branding');

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { logoLightUrl: storageKey },
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        city: true,
        invoiceLegalName: true,
        ocPdfLegalNotice: true,
        logoUrl: true,
        logoLightUrl: true,
        pdfLogoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
      },
    });

    const old = prev.logoLightUrl?.trim();
    if (
      old &&
      !looksLikeExternalOrLocalUrl(old) &&
      old !== storageKey &&
      !/^https?:\/\//i.test(old)
    ) {
      try {
        await this.storage.deleteFile(old);
      } catch {
        /* no bloquear actualización de marca */
      }
    }

    return this.mapTenantToClientResponse(tenant);
  }

  async uploadTenantPdfLogo(
    tenantId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío.');
    }

    const prev = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { pdfLogoUrl: true },
    });
    if (!prev) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const storageKey = await this.storage.uploadFile(
      file,
      'tenant-pdf-branding',
    );

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { pdfLogoUrl: storageKey },
      select: {
        id: true,
        code: true,
        name: true,
        rut: true,
        address: true,
        phone: true,
        city: true,
        invoiceLegalName: true,
        ocPdfLegalNotice: true,
        logoUrl: true,
        logoLightUrl: true,
        pdfLogoUrl: true,
        primaryColor: true,
        laborRatePerHour: true,
        backgroundPreference: true,
        sidebarPermissions: true,
      },
    });

    const old = prev.pdfLogoUrl?.trim();
    if (
      old &&
      !looksLikeExternalOrLocalUrl(old) &&
      old !== storageKey &&
      !/^https?:\/\//i.test(old)
    ) {
      try {
        await this.storage.deleteFile(old);
      } catch {
        /* no bloquear actualización */
      }
    }

    return this.mapTenantToClientResponse(tenant);
  }
}
