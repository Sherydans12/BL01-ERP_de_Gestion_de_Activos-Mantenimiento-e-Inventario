import { PrismaService } from '../../prisma/prisma.service';
import {
  OPERATIONAL_CONFIG_DEFAULTS,
  type TenantOperationalConfigShape,
} from '../tenant-config/tenant-config.service';

export type JwtOperationalConfig = TenantOperationalConfigShape;

/** Carga config operativa del tenant para incluir en JWT y respuesta de login. */
export async function loadOperationalConfigForJwt(
  prisma: PrismaService,
  tenantId: string | null | undefined,
): Promise<JwtOperationalConfig | null> {
  if (!tenantId?.trim()) return null;

  const config = await prisma.tenantOperationalConfig.findUnique({
    where: { tenantId },
    select: {
      hasNightShift: true,
      dayShiftStartTime: true,
      nightShiftStartTime: true,
      blockNegativeStock: true,
    },
  });

  return config ?? { ...OPERATIONAL_CONFIG_DEFAULTS };
}
